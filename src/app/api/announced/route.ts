import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '../../../lib/prisma';
import { logger } from '../../../lib/logger';
import { countAnnouncedAnime, getAnnouncedAnime } from '../../../lib/announcements/announcedAnime';
import { ensureFreshAnnouncements } from '../../../lib/announcements/announcementSync';

export const dynamic = 'force-dynamic';

/**
 * GET /api/announced?limit=&offset=&format=&studio=<slug|id>
 * Announced, not-yet-premiered anime, newest announcement first.
 */
export async function GET(req: NextRequest) {
  ensureFreshAnnouncements();
  try {
    const sp = req.nextUrl.searchParams;
    const limit = Math.min(60, Math.max(1, Number(sp.get('limit')) || 24));
    const offset = Math.max(0, Number(sp.get('offset')) || 0);
    const format = sp.get('format') || undefined;
    const studioKey = (sp.get('studio') || '').trim().slice(0, 200);
    let studioId: string | undefined;
    if (studioKey) {
      const studio = await prisma.studio.findFirst({ where: { OR: [{ slug: studioKey }, { id: studioKey }] }, select: { id: true } });
      if (!studio) return NextResponse.json({ error: 'Studio not found' }, { status: 404 });
      studioId = studio.id;
    }
    const [items, total] = await Promise.all([
      getAnnouncedAnime({ limit, offset, format, studioId }),
      countAnnouncedAnime({ format, studioId }),
    ]);
    const nextOffset = offset + items.length < total ? offset + items.length : null;
    return NextResponse.json({ items, total, nextOffset }, { headers: { 'Cache-Control': 'no-store' } });
  } catch (err) {
    logger.error('GET /api/announced failed', { error: err instanceof Error ? err.message : String(err) });
    return NextResponse.json({ error: 'Failed to load announced anime' }, { status: 500 });
  }
}
