/**
 * OTAKUVA — background job queue (BullMQ + Redis).
 *
 * One queue, `otakuva-sync`, carries every job kind that used to run inline
 * in an HTTP request or a hand-run script:
 *   - 'sync:anime'              (was POST /api/admin/sync {action:"SYNC_ANIME"})
 *   - 'sync:catalog'            (was POST /api/admin/sync {action:"SYNC_CATALOG"})
 *   - 'sync:airing'             (was POST /api/admin/sync {action:"SYNC_AIRING"}, scripts/sync_real_world_schedule.ts)
 *   - 'sync:broadcast-schedule' (was POST /api/admin/sync {action:"SYNC_BROADCAST_SCHEDULE"}, scripts/sync_broadcast_schedule.ts)
 *   - 'anime-import'            (was POST /api/admin/anime/import — src/lib/ingestion/jikanImportJob.ts)
 *   - 'news-sync'               (was scripts/news_poller.ts's per-cycle work)
 *   - 'episode-backfill'        (new — src/lib/catalog/episodeBackfillEngine.ts, a recurring resumable
 *                                catalog-wide episode backfill; there was never a manual-script equivalent)
 *
 * A single queue (rather than one per kind) keeps scripts/worker.ts to one
 * Worker and one Redis connection; job kinds are told apart by `job.name`.
 * See src/lib/queue/handlers.ts for the dispatch and src/lib/queue/syncJob.ts
 * for how each job's SyncJob row gets created/updated.
 *
 * Retry policy: 5 attempts, exponential backoff (BullMQ's default multiplier
 * off a 5s base: 5s, 10s, 20s, 40s, 80s between attempts). A job only lands
 * in DeadLetterQueue once every attempt is exhausted — see the Worker's
 * 'failed' listener in scripts/worker.ts, which checks
 * `job.attemptsMade >= job.opts.attempts` before writing there, so a normal
 * mid-retry failure never gets treated as a permanent one.
 */

import { Queue } from 'bullmq';
import { getProducerRedisConnection } from './connection';

export const QUEUE_NAME = 'otakuva-sync';

export type SyncJobName =
  | 'sync:anime'
  | 'sync:catalog'
  | 'sync:airing'
  | 'sync:broadcast-schedule'
  | 'anime-import'
  | 'news-sync'
  | 'episode-backfill'
  | 'badges:maturation'
  | 'dead-letter:sweep';

export const MAX_JOB_ATTEMPTS = 5;
export const BACKOFF_BASE_MS = 5000;

let queue: Queue | null = null;

export function getSyncQueue(): Queue {
  if (!queue) {
    queue = new Queue(QUEUE_NAME, {
      connection: getProducerRedisConnection(),
      defaultJobOptions: {
        attempts: MAX_JOB_ATTEMPTS,
        backoff: { type: 'exponential', delay: BACKOFF_BASE_MS },
        removeOnComplete: { age: 7 * 24 * 3600, count: 1000 },
        removeOnFail: { age: 30 * 24 * 3600 },
      },
    });
  }
  return queue;
}
