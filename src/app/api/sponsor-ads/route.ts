import { NextResponse } from 'next/server';
import { prisma } from '../../../lib/prisma';
import { SPONSOR_AD_PLACEMENTS } from '../../../lib/monetization/mediaValidation';

export const dynamic = 'force-dynamic';

export async function GET(request: Request) {
  const [settings] = await prisma.$queryRaw<{ sponsorAdsEnabled: boolean }[]>`SELECT "sponsorAdsEnabled" FROM "MonetizationSetting" WHERE id = 'main' LIMIT 1`;
  if (!settings?.sponsorAdsEnabled) return NextResponse.json({ ads: [] });
  const requestedPlacement = new URL(request.url).searchParams.get('placement');
  const placement = requestedPlacement === SPONSOR_AD_PLACEMENTS.ANIME
    ? SPONSOR_AD_PLACEMENTS.ANIME
    : SPONSOR_AD_PLACEMENTS.HOME;
  const now = new Date();
  const ads = await prisma.$queryRaw<{ id: string; title: string | null; imageUrl: string | null; videoUrl: string | null; clickUrl: string | null; altText: string | null }[]>`SELECT id, title, "imageUrl", "videoUrl", "clickUrl", "altText" FROM "SponsorAd" WHERE enabled = true AND placement = ${placement} AND ("startsAt" IS NULL OR "startsAt" <= ${now}) AND ("endsAt" IS NULL OR "endsAt" >= ${now}) ORDER BY "updatedAt" DESC LIMIT 3`;
  return NextResponse.json({ ads }, { headers: { 'Cache-Control': 'no-store' } });
}
