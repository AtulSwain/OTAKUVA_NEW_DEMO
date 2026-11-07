import { NextRequest, NextResponse } from 'next/server';
import { requireVerifiedUser } from '../../../../lib/auth';
import { prisma } from '../../../../lib/prisma';
import { getStorageProvider, ImageProcessor, validateImageMagicBytes, MAX_BANNER_SIZE_BYTES } from '../../../../lib/storage';
import { RateLimiter } from '../../../../lib/security/rateLimiter';
import { logger } from '../../../../lib/logger';

export const dynamic = 'force-dynamic';

/**
 * POST /api/lists/banner (multipart, field "file")
 * Uploads a collection banner and returns { assetId, url }. The asset is
 * attached by POST /api/lists or PATCH /api/lists/:id with bannerAssetId;
 * only the uploader can attach it (listService.resolveBanner).
 */
export async function POST(request: NextRequest) {
  try {
    const authUser = await requireVerifiedUser(request);
    if (authUser instanceof NextResponse) return authUser;

    const rate = await RateLimiter.check('MEDIA_UPLOAD', authUser.id);
    if (!rate.allowed) {
      return NextResponse.json(
        { error: 'Too many uploads. Please wait a minute and try again.' },
        { status: 429, headers: { 'Retry-After': String(rate.retryAfterSec || 60) } }
      );
    }

    const form = await request.formData();
    const file = form.get('file') as File | null;
    if (!file) return NextResponse.json({ error: 'No image file provided.' }, { status: 400 });
    if (file.size > MAX_BANNER_SIZE_BYTES) {
      return NextResponse.json({ error: 'Image is too large. Maximum size is 15 MB.' }, { status: 400 });
    }

    const buffer = Buffer.from(await file.arrayBuffer());
    const magic = validateImageMagicBytes(buffer);
    if (!magic.valid) return NextResponse.json({ error: magic.error || 'Unsupported image format.' }, { status: 400 });

    let processed;
    try {
      processed = await ImageProcessor.processBanner(buffer);
    } catch (err) {
      return NextResponse.json({ error: (err as Error).message || 'Could not process that image.' }, { status: 400 });
    }

    const storage = getStorageProvider();
    const uploaded = await storage.upload({
      file: processed.buffer,
      filename: 'banner.webp',
      mimeType: 'image/webp',
      category: 'list-banner',
      entityId: authUser.id,
      maxSizeBytes: MAX_BANNER_SIZE_BYTES,
    });

    try {
      const asset = await prisma.mediaAsset.create({
        data: {
          userId: authUser.id,
          type: 'LIST_BANNER',
          source: uploaded.provider,
          sourceUrl: uploaded.url,
          storedUrl: uploaded.url,
          storageKey: uploaded.storageKey || null,
          width: processed.width,
          height: processed.height,
          size: processed.size,
          mimeType: 'image/webp',
          format: 'webp',
        },
        select: { id: true },
      });
      return NextResponse.json({ assetId: asset.id, url: uploaded.url, width: processed.width, height: processed.height });
    } catch (dbErr) {
      // Don't leave an orphaned file behind if the DB write fails.
      await storage.delete(uploaded.url).catch(() => {});
      throw dbErr;
    }
  } catch (error) {
    logger.error('Collection banner upload failed', { error: error as Error, component: 'api/lists/banner' });
    return NextResponse.json({ error: 'Failed to upload image.' }, { status: 500 });
  }
}
