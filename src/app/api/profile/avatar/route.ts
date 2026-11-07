import { NextRequest, NextResponse } from 'next/server';
import { getAuthUserFromRequest } from '../../../../lib/auth';
import { prisma } from '../../../../lib/prisma';
import {
  getStorageProvider,
  ImageProcessor,
  validateImageMagicBytes,
  MAX_ICON_SIZE_BYTES,
} from '../../../../lib/storage';
import { RateLimiter } from '../../../../lib/security/rateLimiter';

export const dynamic = 'force-dynamic';

export async function POST(request: NextRequest) {
  try {
    const authUser = await getAuthUserFromRequest(request);
    if (!authUser) {
      return NextResponse.json({ error: 'Authentication required to upload an avatar.' }, { status: 401 });
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

    // Check size upfront (< 10 MB)
    if (file.size > MAX_ICON_SIZE_BYTES) {
      return NextResponse.json(
        { error: 'Avatar file is too large. Maximum allowed size is 10 MB.' },
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

    // Server-side image processing: square crop (400x400), WebP conversion, metadata stripping
    let processed;
    try {
      processed = await ImageProcessor.processAvatar(buffer);
    } catch (procErr: any) {
      return NextResponse.json(
        { error: procErr.message || 'Failed to process avatar image.' },
        { status: 400 }
      );
    }

    const storage = getStorageProvider();

    // Fetch existing user record to track old asset for replacement cleanup
    const currentUser = await prisma.user.findUnique({
      where: { id: authUser.id },
      select: { avatarUrl: true, avatarAssetId: true },
    });

    // Upload new optimized WebP image to R2
    const uploadResult = await storage.upload({
      file: processed.buffer,
      filename: 'avatar.webp',
      mimeType: 'image/webp',
      category: 'profile-avatar',
      entityId: authUser.id,
      maxSizeBytes: MAX_ICON_SIZE_BYTES,
    });

    // Transactional database update with compensation safety
    let mediaAsset;
    try {
      const result = await prisma.$transaction(async (tx) => {
        const asset = await tx.mediaAsset.create({
          data: {
            userId: authUser.id,
            type: 'AVATAR',
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
            avatarUrl: uploadResult.url,
            avatarAssetId: asset.id,
          },
        });

        return asset;
      });

      mediaAsset = result;
    } catch (dbError) {
      // Compensation: Delete newly uploaded R2 object if database update failed
      console.error('Database update failed after R2 upload, rolling back storage object:', dbError);
      await storage.delete(uploadResult.url).catch(() => {});
      throw dbError;
    }

    // Asynchronously delete previous custom avatar object if one existed
    if (currentUser?.avatarUrl && !currentUser.avatarUrl.includes('dicebear.com')) {
      storage.delete(currentUser.avatarUrl).catch((delErr) => {
        console.warn('Failed to delete superseded avatar from storage:', delErr);
      });
    }

    return NextResponse.json({
      success: true,
      avatarUrl: uploadResult.url,
      assetId: mediaAsset.id,
      provider: uploadResult.provider,
    });
  } catch (error: any) {
    console.error('Error uploading avatar:', error);
    return NextResponse.json({ error: error.message || 'Failed to upload avatar.' }, { status: 500 });
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
      select: { id: true, avatarUrl: true, avatarAssetId: true },
    });

    if (!user) {
      return NextResponse.json({ error: 'User not found.' }, { status: 404 });
    }

    const oldAvatarUrl = user.avatarUrl;

    // Update database: remove custom avatar
    await prisma.$transaction(async (tx) => {
      await tx.user.update({
        where: { id: authUser.id },
        data: {
          avatarUrl: null,
          avatarAssetId: null,
        },
      });

      if (user.avatarAssetId) {
        await tx.mediaAsset.deleteMany({
          where: { id: user.avatarAssetId, userId: authUser.id },
        });
      }
    });

    // Delete from storage
    if (oldAvatarUrl && !oldAvatarUrl.includes('dicebear.com')) {
      const storage = getStorageProvider();
      await storage.delete(oldAvatarUrl).catch(() => {});
    }

    return NextResponse.json({ success: true, message: 'Avatar removed successfully.' });
  } catch (error: any) {
    console.error('Error deleting avatar:', error);
    return NextResponse.json({ error: error.message || 'Failed to delete avatar.' }, { status: 500 });
  }
}
