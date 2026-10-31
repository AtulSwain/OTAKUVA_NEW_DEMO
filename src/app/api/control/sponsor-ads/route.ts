import { NextRequest, NextResponse } from 'next/server';
import { randomUUID } from 'node:crypto';
import { prisma } from '@/lib/prisma';
import { logger } from '@/lib/logger';
import { requireControl } from '@control/lib/access';
import { SPONSOR_AD_PLACEMENTS, validateMonetizationMedia } from '@/lib/monetization/mediaValidation';

export const dynamic = 'force-dynamic';

export async function GET(request: NextRequest) {
  const auth = await requireControl(request); if (auth instanceof NextResponse) return auth;
  const ads = await prisma.$queryRaw<any[]>`SELECT id, title, "imageUrl", "videoUrl", "clickUrl", "altText", placement, enabled, "startsAt", "endsAt", "updatedAt" FROM "SponsorAd" ORDER BY "updatedAt" DESC`;
  return NextResponse.json({ ads });
}
export async function POST(request: NextRequest) {
  const auth = await requireControl(request); if (auth instanceof NextResponse) return auth;
  const b = await request.json();
  const media = validateMonetizationMedia(b);
  if (!media.ok) return NextResponse.json({ error: media.error, code: media.code }, { status: 400 });
  const placement = b.placement ?? SPONSOR_AD_PLACEMENTS.HOME;
  const title = typeof b.title === 'string' ? b.title.trim().slice(0, 120) || null : null;
  const altText = typeof b.altText === 'string' ? b.altText.trim().slice(0, 200) || null : null;
  try {
    const ad = await prisma.$transaction(async (tx) => {
      const [created] = await tx.$queryRaw<any[]>`INSERT INTO "SponsorAd" (id, title, "imageUrl", "videoUrl", "clickUrl", "altText", placement, enabled, "startsAt", "endsAt", "createdById", "createdAt", "updatedAt") VALUES (${randomUUID()}, ${title}, ${media.imageUrl}, ${media.videoUrl}, ${media.clickUrl}, ${altText}, ${placement}, true, ${b.startsAt ? new Date(b.startsAt) : null}, ${b.endsAt ? new Date(b.endsAt) : null}, ${auth.id}, NOW(), NOW()) RETURNING *`;
      await tx.$executeRaw`INSERT INTO "MonetizationSetting" (id, "sponsorAdsEnabled", "commissionsEnabled", "updatedAt") VALUES ('main', true, false, NOW()) ON CONFLICT (id) DO UPDATE SET "sponsorAdsEnabled" = true, "updatedAt" = NOW()`;
      return created;
    });
    return NextResponse.json({ ad });
  } catch (error) {
    logger.error('Publishing sponsor ad failed', {
      error,
      route: '/api/control/sponsor-ads',
      method: 'POST',
      placement,
    });
    return NextResponse.json(
      { error: 'The ad could not be published. Check that the monetization database migrations are applied.' },
      { status: 500 },
    );
  }
}
