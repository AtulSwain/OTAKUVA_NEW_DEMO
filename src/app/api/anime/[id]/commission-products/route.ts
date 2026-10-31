import { NextResponse } from 'next/server';
import { prisma } from '../../../../../lib/prisma';
import { selectCommissionProducts } from '../../../../../lib/monetization/commissionDistribution';

export const dynamic = 'force-dynamic';

export async function GET(_: Request, { params }: { params: { id: string } }) {
  const [settings] = await prisma.$queryRaw<{ commissionsEnabled: boolean }[]>`SELECT "commissionsEnabled" FROM "MonetizationSetting" WHERE id = 'main' LIMIT 1`;
  if (!settings?.commissionsEnabled) return NextResponse.json({ products: [] });
  const anime = await prisma.anime.findFirst({ where: { OR: [{ id: params.id }, { slug: params.id }] }, select: { id: true, slug: true, anilistId: true, malId: true } });
  if (!anime) return NextResponse.json({ products: [] });
  const available = await prisma.$queryRaw<{ id: string; animeId: string | null; title: string | null; merchant: string | null; url: string | null; imageUrl: string | null; videoUrl: string | null; price: string | null; disclosure: string | null; position: number }[]>`SELECT id, "animeId", title, merchant, url, "imageUrl", "videoUrl", price, disclosure, position FROM "CommissionProduct" WHERE enabled = true AND ("imageUrl" IS NOT NULL OR "videoUrl" IS NOT NULL) AND ("animeId" IS NULL OR "animeId" = ${anime.id}) ORDER BY ("animeId" = ${anime.id}) DESC NULLS LAST, position ASC, "createdAt" DESC`;
  const pinned = available.filter((product) => product.animeId === anime.id);
  const shared = available.filter((product) => product.animeId === null);
  const animeKey = String(anime.anilistId ?? anime.malId ?? anime.slug);
  const products = selectCommissionProducts(animeKey, shared, pinned);
  return NextResponse.json({ products }, { headers: { 'Cache-Control': 'no-store' } });
}
