/**
 * Runs the episode backfill by hand (2026-11-06) — same engine and resumable
 * checkpoint as the worker's 'episode-backfill' job and the Vercel cron
 * (/api/cron/episode-backfill), so nothing starts over.
 *
 *   npx tsx scripts/run_episode_backfill.ts                # 5 batches of 10 pages
 *   npx tsx scripts/run_episode_backfill.ts --batches=50 --pages=10
 *
 * Don't run it while the worker's recurring job is also running against the
 * same database — both advance the one shared cursor.
 */
import { prisma } from '../src/lib/prisma';
import { runEpisodeBackfillBatch } from '../src/lib/catalog/episodeBackfillEngine';

const arg = (name: string, fallback: number) => {
  const hit = process.argv.find((a) => a.startsWith(`--${name}=`));
  const n = hit ? Number(hit.split('=')[1]) : NaN;
  return Number.isFinite(n) && n > 0 ? Math.floor(n) : fallback;
};

async function main() {
  const batches = arg('batches', 5);
  const pages = arg('pages', 10);
  for (let i = 1; i <= batches; i++) {
    const r = await runEpisodeBackfillBatch(pages);
    console.log(`[episode-backfill] batch ${i}/${batches}: ${JSON.stringify(r)}`);
  }
}

main()
  .catch((e) => {
    console.error(e);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
