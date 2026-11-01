import { NextRequest, NextResponse } from 'next/server';
import { timingSafeEqual } from 'node:crypto';
import { logger } from '../../../../lib/logger';
import { syncAnnouncedAnime } from '../../../../lib/announcements/announcementSync';

export const dynamic = 'force-dynamic';
export const maxDuration = 60;

function authorized(req: NextRequest): boolean {
  const secret = process.env.CRON_SECRET;
  if (!secret) return false; // fail closed: no secret configured, no run
  const got = Buffer.from(req.headers.get('authorization') || '');
  const want = Buffer.from(`Bearer ${secret}`);
  return got.length === want.length && timingSafeEqual(got, want);
}

/**
 * Daily Vercel Cron (vercel.json): pulls new announcements from AniList.
 * On serverless, background work after a response can be frozen, so this is
 * how the Announced section stays current there. Vercel sends
 * `Authorization: Bearer $CRON_SECRET`; anything else gets 401.
 * Kept small to fit the function time limit — the next run continues.
 */
export async function GET(req: NextRequest) {
  if (!authorized(req)) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  try {
    const res = await syncAnnouncedAnime({ pages: 2, maxNew: 15, maxRefresh: 10 });
    return NextResponse.json({
      ran: res.ran,
      added: res.added.length,
      refreshed: res.refreshed,
      heldForReview: res.heldForReview.length,
      newsLinked: res.newsLinked,
      failed: res.failed,
    });
  } catch (err) {
    logger.error('announced cron failed', { error: err instanceof Error ? err : new Error(String(err)) });
    return NextResponse.json({ error: 'Sync failed' }, { status: 500 });
  }
}
