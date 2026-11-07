/**
 * OTAKUVA — DeadLetterQueue retry + retention sweep.
 *
 * Usage:
 *   npx tsx scripts/retry_dead_letters.ts             # one sweep, then exit
 *   npx tsx scripts/retry_dead_letters.ts --daemon     # loop forever, one sweep every DLQ_INTERVAL_MS (default 6h)
 *
 * Each sweep does two things:
 *   1. Retries every unresolved row with `attempts < MAX_RETRIES` (see
 *      src/lib/deadLetter.ts) through the provider path that originally
 *      queued it — currently only provider=jikan/entityType=ANIME exists in
 *      the table (see syncEngine.syncFullCatalogById), retried via
 *      `syncEngine.ingestAnimeByMalId`, the same call the old inline
 *      `RETRY_FAILED=1` mode in scripts/full_catalog_sync.ts used. Any other
 *      provider/entityType combination is logged as unsupported and left
 *      untouched (not counted as a failed attempt — we never actually
 *      called anything for it) — add a case to `retryOne()` below when a
 *      new kind starts appearing (characters/staff/episodes/relations were
 *      named as future DLQ entity types in CLAUDE.md's Jikan-degradation
 *      note, but none exist in the table yet).
 *   2. Calls archiveExpiredDeadLetters() to compress-and-delete whatever has
 *      now reached MAX_RETRIES and aged past RETENTION_DAYS days — see
 *      src/lib/deadLetter.ts for that policy.
 *
 * Scheduling: there's no background job queue yet to register this with
 * (CLAUDE.md's Phase 10 backlog, item 6 — SyncJob/DeadLetterQueue exist but
 * nothing drives them). --daemon here is a stopgap: a long-lived Node
 * process you start under pm2 / systemd / Windows Task Scheduler /
 * `nohup npx tsx scripts/retry_dead_letters.ts --daemon &`, not a real
 * scheduler — it has no persistence, retry-on-crash, or overlap protection
 * beyond what's in this file. Once a real job queue exists, register
 * `runSweep()` as a recurring job there and delete the daemon loop below.
 */

import { prisma } from '../src/lib/prisma';
import { runDeadLetterSweep } from '../src/lib/deadLetterSweep';

const DEFAULT_INTERVAL_MS = 6 * 60 * 60 * 1000; // 6 hours

// The sweep itself lives in src/lib/deadLetterSweep.ts (2026-11-06) so the
// worker can also run it as the recurring 'dead-letter:sweep' job.
export async function runSweep(): Promise<void> {
  const startedAt = Date.now();
  console.log(`[retry_dead_letters] sweep starting ${new Date().toISOString()}`);
  const r = await runDeadLetterSweep();
  console.log(
    `[retry_dead_letters] merged ${r.collapsed} duplicate rows; retried ${r.examined}: ${r.recovered} recovered, ${r.failed} still failing, ${r.unsupported} unsupported; archived ${r.archived}.`
  );
  console.log(`[retry_dead_letters] sweep done in ${((Date.now() - startedAt) / 1000).toFixed(1)}s.`);
}

async function main() {
  const daemon = process.argv.includes('--daemon');
  const intervalMs = parseInt(process.env.DLQ_INTERVAL_MS || '', 10) || DEFAULT_INTERVAL_MS;

  if (!daemon) {
    await runSweep();
    await prisma.$disconnect();
    return;
  }

  console.log(`[retry_dead_letters] daemon mode — sweeping every ${(intervalMs / 60_000).toFixed(0)} minute(s). Ctrl+C to stop.`);
  let stopRequested = false;
  const onSignal = () => {
    console.log('\n[retry_dead_letters] stop requested — exiting after the current sweep.');
    stopRequested = true;
  };
  process.on('SIGINT', onSignal);
  process.on('SIGTERM', onSignal);

  while (!stopRequested) {
    await runSweep().catch((e) => console.error('[retry_dead_letters] sweep failed:', e));
    if (stopRequested) break;
    await new Promise((r) => setTimeout(r, intervalMs));
  }
  await prisma.$disconnect();
}

if (require.main === module) {
  main().catch(async (e) => {
    console.error(e);
    await prisma.$disconnect();
    process.exit(1);
  });
}
