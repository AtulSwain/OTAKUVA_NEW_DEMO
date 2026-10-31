import { NextRequest, NextResponse } from 'next/server';
import { logger } from '../../../lib/logger';
import { getCachedCreatorDirectory } from '../../../lib/creator/creatorDirectory';

export const dynamic = 'force-dynamic';

/**
 * GET /api/creators?limit=24&feed=8 — creator accounts (most followed first)
 * and recent joins, ratings, reviews, and hype. Public data, no viewer-
 * specific fields, so a short shared cache is fine.
 */
export async function GET(request: NextRequest) {
  try {
    const sp = request.nextUrl.searchParams;
    const data = await getCachedCreatorDirectory({ limit: Number(sp.get('limit')) || undefined, feedLimit: Number(sp.get('feed')) || undefined });
    return NextResponse.json(data, { headers: { 'Cache-Control': 'private, no-store' } });
  } catch (err) {
    logger.error('creator directory failed', { component: 'creator', err });
    return NextResponse.json({ error: 'Could not load creators.' }, { status: 500 });
  }
}
