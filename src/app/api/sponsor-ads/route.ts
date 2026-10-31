import { NextResponse } from 'next/server';
import { prisma } from '../../../lib/prisma';
import { MAX_ADS_PER_PLACEMENT, SPONSOR_AD_PLACEMENTS } from '../../../lib/monetization/mediaValidation';

export const dynamic = 'force-dynamic';

type PublicAd = { id: string; title: string | null; imageUrl: string | null; videoUrl: string | null; clickUrl: string | null; altText: string | null };

/**
 * GET /api/sponsor-ads?placement=HOME_ABOVE_HYPE|ANIME_PAGE
 * Homepage: the newest few, all shown. Anime pages: every enabled ad (up to
 * MAX_ADS_PER_PLACEMENT) in a fixed order; the browser shows one per view in
 * rotation so each gets an equal share (src/lib/monetization/rotation.ts).
 */
export async function GET(request: Request) {
  const [settings] = await prisma.$queryRaw<{ sponsorAdsEnabled: boolean }[]>`SELECT "sponsorAdsEnabled" FROM "MonetizationSetting" WHERE id = 'main' LIMIT 1`;
  if (!settings?.sponsorAdsEnabled) return NextResponse.json({ ads: [] });
  const requestedPlacement = new URL(request.url).searchParams.get('placement');
  const placement = requestedPlacement === SPONSOR_AD_PLACEMENTS.ANIME
    ? SPONSOR_AD_PLACEMENTS.ANIME
    : SPONSOR_AD_PLACEMENTS.HOME;
  const now = new Date();
  const limit = MAX_ADS_PER_PLACEMENT[placement];
  const ads = placement === SPONSOR_AD_PLACEMENTS.ANIME
    ? await prisma.$queryRaw<PublicAd[]>`SELECT id, title, "imageUrl", "videoUrl", "clickUrl", "altText" FROM "SponsorAd" WHERE enabled = true AND placement = ${placement} AND ("startsAt" IS NULL OR "startsAt" <= ${now}) AND ("endsAt" IS NULL OR "endsAt" >= ${now}) ORDER BY "createdAt" ASC, id ASC LIMIT ${limit}`
    : await prisma.$queryRaw<PublicAd[]>`SELECT id, title, "imageUrl", "videoUrl", "clickUrl", "altText" FROM "SponsorAd" WHERE enabled = true AND placement = ${placement} AND ("startsAt" IS NULL OR "startsAt" <= ${now}) AND ("endsAt" IS NULL OR "endsAt" >= ${now}) ORDER BY "updatedAt" DESC LIMIT ${limit}`;
  return NextResponse.json({ ads, rotate: placement === SPONSOR_AD_PLACEMENTS.ANIME }, { headers: { 'Cache-Control': 'no-store' } });
}
