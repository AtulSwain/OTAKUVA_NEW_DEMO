/**
 * OTAKUVA — recurring queue jobs.
 *
 * Registers BullMQ's native repeatable jobs for the things that used to
 * require a hand-run, always-on loop script
 * (scripts/news_poller.ts, scripts/sync_broadcast_schedule.ts /
 * scripts/sync_real_world_schedule.ts): news polling and broadcast-schedule
 * recomputation — plus the episode backfill (src/lib/catalog/
 * episodeBackfillEngine.ts), which never had a manual-script equivalent at
 * all; it's recurring-only by design, since it's meant to make continuous
 * background progress through the catalog, not something anyone runs
 * once. `registerRecurringJobs()` is called once from
 * scripts/worker.ts on startup — BullMQ dedupes repeatable jobs by their
 * `{name, repeat}` key, so calling this on every worker restart is a
 * no-op if the schedule hasn't changed, not a pile of duplicate timers.
 *
 * This is a real scheduler (Redis-backed, survives worker restarts,
 * doesn't depend on a script staying alive in a terminal) for these two
 * jobs specifically — not the general-purpose job queue/scheduler still
 * tracked as a gap in CLAUDE.md's Phase 10 backlog (item 6), which this
 * change is a step toward but doesn't fully close (there's still no UI to
 * manage arbitrary recurring jobs, retries here still cap at the same
 * per-job attempt count as everything else, etc).
 *
 * Each repeatable tick still goes through the normal SyncJob-tracked path
 * (enqueueSyncJob), so it shows up in GET /api/admin/datacenter exactly
 * like a manually-triggered sync — nothing about how a job is tracked or
 * retried differs based on whether a person or the scheduler enqueued it.
 */

import { enqueueSyncJob } from './enqueue';
import { getSyncQueue } from './queue';
import { logger } from '../logger';
import { BADGE_RULES } from '../badges/config';

const NEWS_SYNC_INTERVAL_MS = 60_000; // matches scripts/news_poller.ts's default
const BROADCAST_SCHEDULE_INTERVAL_MS = 30 * 60_000; // recompute every 30 min
const AIRING_SCHEDULE_INTERVAL_MS = 6 * 60 * 60_000; // AniList-backed; less frequent, health is uncertain (see CLAUDE.md)
// A batch of 10 pages (episodeBackfillEngine's default) through
// rate-limited providers typically takes well under this — generous
// headroom so ticks don't pile up in the queue (Worker concurrency is 1;
// see scripts/worker.ts) if a batch runs long under provider backoff.
const EPISODE_BACKFILL_INTERVAL_MS = 2 * 60_000;
const DEAD_LETTER_SWEEP_INTERVAL_MS = 6 * 60 * 60_000;

export async function registerRecurringJobs() {
  const queue = getSyncQueue();

  await queue.upsertJobScheduler(
    'recurring:news-sync',
    { every: NEWS_SYNC_INTERVAL_MS },
    { name: 'news-sync', data: {} }
  );

  await queue.upsertJobScheduler(
    'recurring:sync:broadcast-schedule',
    { every: BROADCAST_SCHEDULE_INTERVAL_MS },
    { name: 'sync:broadcast-schedule', data: {} }
  );

  await queue.upsertJobScheduler(
    'recurring:sync:airing',
    { every: AIRING_SCHEDULE_INTERVAL_MS },
    { name: 'sync:airing', data: {} }
  );

  await queue.upsertJobScheduler(
    'recurring:episode-backfill',
    { every: EPISODE_BACKFILL_INTERVAL_MS },
    { name: 'episode-backfill', data: {} }
  );

  await queue.upsertJobScheduler(
    'recurring:badges-maturation',
    { every: BADGE_RULES.job.intervalMinutes * 60_000 },
    { name: 'badges:maturation', data: {} }
  );

  // DeadLetterQueue sweep (2026-11-06; was only the hand-run retry_dead_letters.ts).
  await queue.upsertJobScheduler(
    'recurring:dead-letter-sweep',
    { every: DEAD_LETTER_SWEEP_INTERVAL_MS },
    { name: 'dead-letter:sweep', data: {} }
  );

  logger.info('recurring jobs registered', {
    component: 'queue/recurring',
    newsSyncIntervalSec: NEWS_SYNC_INTERVAL_MS / 1000,
    broadcastScheduleIntervalMin: BROADCAST_SCHEDULE_INTERVAL_MS / 60_000,
    airingIntervalHours: AIRING_SCHEDULE_INTERVAL_MS / 3_600_000,
    episodeBackfillIntervalMin: EPISODE_BACKFILL_INTERVAL_MS / 60_000,
    badgeMaturationIntervalMin: BADGE_RULES.job.intervalMinutes,
  });
}

/**
 * A repeatable job's processor only receives whatever static `data` was
 * given to upsertJobScheduler above — no syncJobId, since there's no
 * enqueueSyncJob call per tick to create one. src/lib/queue/handlers.ts's
 * processSyncJob() handles that: any job that arrives without
 * `data.syncJobId` gets a PENDING (immediately RUNNING) SyncJob row
 * created on the fly before the real handler runs, keyed by job.name via
 * its `autoTrackedJobMeta` map — so a scheduler tick shows up in the admin
 * UI exactly like a manually-triggered sync of the same kind.
 */
