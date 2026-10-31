import { NextResponse } from 'next/server';
import { prisma } from '../../../../../lib/prisma';
import { COMMISSION_PRODUCTS_PER_ANIME } from '../../../../../lib/monetization/commissionDistribution';

export const dynamic = 'force-dynamic';

type Row = { id: string; animeId: string | null; title: string | null; merchant: string | null; url: string | null; imageUrl: string | null; videoUrl: string | null; price: string | null; disclosure: string | null; position: number };

/**
 * GET /api/anime/:id/commission-products
 * Returns the products pinned to this anime plus the whole shared pool, in a
 * fixed order. The page shows `perView` of them: pinned first, then the
 * shared pool in an even per-visitor rotation (src/lib/monetization/rotation.ts),
 * so every pool item gets the same exposure across all anime pages.
 */
export async function GET(_: Request, { params }: { params: { id: string } }) {
  const [settings] = await prisma.$queryRaw<{ commissionsEnabled: boolean }[]>`SELECT "commissionsEnabled" FROM "MonetizationSetting" WHERE id = 'main' LIMIT 1`;
  if (!settings?.commissionsEnabled) return NextResponse.json({ pinned: [], shared: [], products: [], perView: COMMISSION_PRODUCTS_PER_ANIME });
  const anime = await prisma.anime.findFirst({ where: { OR: [{ id: params.id }, { slug: params.id }] }, select: { id: true } });
  if (!anime) return NextResponse.json({ pinned: [], shared: [], products: [], perView: COMMISSION_PRODUCTS_PER_ANIME });
  const available = await prisma.$queryRaw<Row[]>`SELECT id, "animeId", title, merchant, url, "imageUrl", "videoUrl", price, disclosure, position FROM "CommissionProduct" WHERE enabled = true AND ("imageUrl" IS NOT NULL OR "videoUrl" IS NOT NULL) AND ("animeId" IS NULL OR "animeId" = ${anime.id}) ORDER BY position ASC, "createdAt" ASC, id ASC`;
  const pinned = available.filter((product) => product.animeId === anime.id).slice(0, COMMISSION_PRODUCTS_PER_ANIME);
  const shared = available.filter((product) => product.animeId === null);
  return NextResponse.json(
    // `products` keeps the old response shape for any older client still open.
    { pinned, shared, perView: COMMISSION_PRODUCTS_PER_ANIME, products: [...pinned, ...shared].slice(0, COMMISSION_PRODUCTS_PER_ANIME) },
    { headers: { 'Cache-Control': 'no-store' } },
  );
}
