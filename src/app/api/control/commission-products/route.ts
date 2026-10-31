import { NextRequest, NextResponse } from 'next/server';
import { randomUUID } from 'node:crypto';
import { prisma } from '@/lib/prisma';
import { logger } from '@/lib/logger';
import { requireControl } from '@control/lib/access';
import { validateMonetizationMedia } from '@/lib/monetization/mediaValidation';

export const dynamic = 'force-dynamic';

export async function GET(request: NextRequest) {
  const auth = await requireControl(request); if (auth instanceof NextResponse) return auth;
  const products = await prisma.$queryRaw<any[]>`SELECT p.id, p."animeId", p.title, p.merchant, p.url, p."imageUrl", p."videoUrl", p.price, p.enabled, p.position, p."createdAt", p."updatedAt", a."canonicalTitle" AS "animeTitle" FROM "CommissionProduct" p LEFT JOIN "Anime" a ON a.id = p."animeId" ORDER BY (p."animeId" IS NULL) DESC, p.position ASC, p."createdAt" DESC`;
  return NextResponse.json({ products });
}
export async function POST(request: NextRequest) {
  const auth = await requireControl(request); if (auth instanceof NextResponse) return auth;
  const b = await request.json();
  const media = validateMonetizationMedia(b);
  if (!media.ok) return NextResponse.json({ error: media.error, code: media.code }, { status: 400 });
  const title = typeof b.title === 'string' ? b.title.trim().slice(0, 160) || null : null;
  const merchant = media.clickUrl && ['Amazon', 'Flipkart'].includes(b.merchant) ? b.merchant : null;
  if (media.clickUrl && !merchant) return NextResponse.json({ error: 'Choose Amazon or Flipkart for the product link.' }, { status: 400 });
  try {
    const product = await prisma.$transaction(async (tx) => {
      await tx.$queryRaw`SELECT pg_advisory_xact_lock(0, hashtext('otakuva_shared_commission_pool'))::text AS lock_result`;
      const countRows = await tx.$queryRaw<{ count: bigint }[]>`SELECT COUNT(*) AS count FROM "CommissionProduct" WHERE "animeId" IS NULL`;
      const count = Number(countRows[0]?.count ?? 0);
      if (count >= 10) return null;
      const [created] = await tx.$queryRaw<any[]>`INSERT INTO "CommissionProduct" (id, "animeId", title, merchant, url, "imageUrl", "videoUrl", price, position, enabled, "createdAt", "updatedAt") VALUES (${randomUUID()}, NULL, ${title}, ${merchant}, ${media.clickUrl}, ${media.imageUrl}, ${media.videoUrl}, ${b.price ? String(b.price).trim().slice(0, 40) : null}, ${count}, true, NOW(), NOW()) RETURNING *`;
      await tx.$executeRaw`INSERT INTO "MonetizationSetting" (id, "sponsorAdsEnabled", "commissionsEnabled", "updatedAt") VALUES ('main', false, true, NOW()) ON CONFLICT (id) DO UPDATE SET "commissionsEnabled" = true, "updatedAt" = NOW()`;
      return created || null;
    });
    if (!product) return NextResponse.json({ error: 'The shared commission pool can contain up to 10 products.' }, { status: 400 });
    return NextResponse.json({ product });
  } catch (error) {
    logger.error('Publishing commission product failed', {
      error,
      route: '/api/control/commission-products',
      method: 'POST',
    });
    return NextResponse.json(
      { error: 'The commission item could not be saved. Check the server logs for the database error.' },
      { status: 500 },
    );
  }
}
