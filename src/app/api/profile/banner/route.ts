import { NextRequest, NextResponse } from 'next/server';
import { getAuthUserFromRequest } from '../../../../lib/auth';
import { prisma } from '../../../../lib/prisma';
import {
  getStorageProvider,
  ImageProcessor,
  validateImageMagicBytes,
  MAX_BANNER_SIZE_BYTES,
} from '../../../../lib/storage';
import { RateLimiter } from '../../../../lib/security/rateLimiter';

export const dynamic = 'force-dynamic';

export async function POST(request: NextRequest) {
  try {
    const authUser = await getAuthUserFromRequest(request);
    if (!authUser) {
      return NextResponse.json({ error: 'Authentication required to upload a banner.' }, { status: 401 });
    }

    // Rate Limiting (10 requests / minute)
    const rateCheck = await RateLimiter.check('MEDIA_UPLOAD', authUser.id);
    if (!rateCheck.allowed) {
      return NextResponse.json(
        { error: 'Too many upload attempts. Please wait a minute and try again.' },
        { status: 429, headers: { 'Retry-After': String(rateCheck.retryAfterSec || 60) } }
      );
    }

    const formData = await request.formData();
    const file = formData.get('file') as File | null;

    if (!file) {
      return NextResponse.json({ error: 'No image file provided.' }, { status: 400 });
    }

    // Check size upfront (< 15 MB)
    if (file.size > MAX_BANNER_SIZE_BYTES) {
      return NextResponse.json(
        { error: 'Banner file is too large. Maximum allowed size is 15 MB.' },
        { status: 400 }
      );
    }

    const arrayBuffer = await file.arrayBuffer();
    const buffer = Buffer.from(arrayBuffer);

    // Validate magic bytes
    const magicValidation = validateImageMagicBytes(buffer);
    if (!magicValidation.valid) {
      return NextResponse.json(
        { error: magicValidation.error || 'Unsupported or corrupted image format.' },
        { status: 400 }
      );
    }

    // Server-side image processing: resize up to 1920x640, WebP conversion, metadata stripping
    let processed;
    try {
      processed = await ImageProcessor.processBanner(buffer);
    } catch (procErr: any) {
      return NextResponse.json(
        { error: procErr.message || 'Failed to process banner image.' },
        { status: 400 }
      );
    }

    const storage = getStorageProvider();

    // Fetch existing user record to track old banner for replacement cleanup
    const currentUser = await prisma.user.findUnique({
      where: { id: authUser.id },
      select: { bannerUrl: true, bannerAssetId: true },
    });

    // Upload new optimized WebP banner to R2
    const uploadResult = await storage.upload({
      file: processed.buffer,
      filename: 'banner.webp',
      mimeType: 'image/webp',
      category: 'profile-banner',
      entityId: authUser.id,
      maxSizeBytes: MAX_BANNER_SIZE_BYTES,
    });

    // Transactional database update with compensation safety
    let mediaAsset;
    try {
      const result = await prisma.$transaction(async (tx) => {
        const asset = await tx.mediaAsset.create({
          data: {
            userId: authUser.id,
            type: 'BANNER',
            source: uploadResult.provider,
            sourceUrl: uploadResult.url,
            storedUrl: uploadResult.url,
            storageKey: uploadResult.storageKey || null,
            width: processed.width,
            height: processed.height,
            size: processed.size,
            mimeType: 'image/webp',
            format: 'webp',
          },
        });

        await tx.user.update({
          where: { id: authUser.id },
          data: {
            bannerUrl: uploadResult.url,
            bannerAssetId: asset.id,
          },
        });

        return asset;
      });

      mediaAsset = result;
    } catch (dbError) {
      // Compensation: Delete newly uploaded R2 object if database update failed
      console.error('Database update failed after R2 banner upload, rolling back storage object:', dbError);
      await storage.delete(uploadResult.url).catch(() => {});
      throw dbError;
    }

    // Asynchronously delete previous banner object if one existed
    if (currentUser?.bannerUrl) {
      storage.delete(currentUser.bannerUrl).catch((delErr) => {
        console.warn('Failed to delete superseded banner from storage:', delErr);
      });
    }

    return NextResponse.json({
      success: true,
      bannerUrl: uploadResult.url,
      assetId: mediaAsset.id,
      provider: uploadResult.provider,
    });
  } catch (error: any) {
    console.error('Error uploading banner:', error);
    return NextResponse.json({ error: error.message || 'Failed to upload banner.' }, { status: 500 });
  }
}

export async function DELETE(request: NextRequest) {
  try {
    const authUser = await getAuthUserFromRequest(request);
    if (!authUser) {
      return NextResponse.json({ error: 'Authentication required.' }, { status: 401 });
    }

    const user = await prisma.user.findUnique({
      where: { id: authUser.id },
      select: { id: true, bannerUrl: true, bannerAssetId: true },
    });

    if (!user) {
      return NextResponse.json({ error: 'User not found.' }, { status: 404 });
    }

    const oldBannerUrl = user.bannerUrl;

    // Update database: remove banner
    await prisma.$transaction(async (tx) => {
      await tx.user.update({
        where: { id: authUser.id },
        data: {
          bannerUrl: null,
          bannerAssetId: null,
        },
      });

      if (user.bannerAssetId) {
        await tx.mediaAsset.deleteMany({
          where: { id: user.bannerAssetId, userId: authUser.id },
        });
      }
    });

    // Delete from storage
    if (oldBannerUrl) {
      const storage = getStorageProvider();
      await storage.delete(oldBannerUrl).catch(() => {});
    }

    return NextResponse.json({ success: true, message: 'Banner removed successfully.' });
  } catch (error: any) {
    console.error('Error deleting banner:', error);
    return NextResponse.json({ error: error.message || 'Failed to delete banner.' }, { status: 500 });
  }
}
