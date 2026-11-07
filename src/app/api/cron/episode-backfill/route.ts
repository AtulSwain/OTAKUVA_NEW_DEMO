import { NextRequest, NextResponse } from 'next/server';
import { timingSafeEqual } from 'node:crypto';
import { logger } from '../../../../lib/logger';
import { runEpisodeBackfillBatch } from '../../../../lib/catalog/episodeBackfillEngine';

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
 * Vercel Cron (vercel.json), 2026-11-06: fills in episode lists without the
 * Redis worker, which production doesn't run. Same engine and resumable
 * checkpoint as the worker's 'episode-backfill' job (currently-airing anime
 * first, then by popularity), so the two never start over — each run picks
 * up where the last stopped. Three pages per run: a Jikan timeout can cost 20s before failover, and
 * Vercel stops the function at 60s.
 */
export async function GET(req: NextRequest) {
  if (!authorized(req)) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  try {
    const res = await runEpisodeBackfillBatch(3);
    return NextResponse.json(res);
  } catch (err) {
    logger.error('episode-backfill cron failed', { error: err instanceof Error ? err : new Error(String(err)) });
    return NextResponse.json({ error: 'Backfill failed' }, { status: 500 });
  }
}
