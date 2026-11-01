/**
 * OTAKUVA — enqueue helper: creates the PENDING SyncJob row, then adds the
 * matching BullMQ job, then links the two (`SyncJob.bullJobId`). Every
 * route/script that used to run sync work inline now calls this instead.
 */

import { getSyncQueue } from './queue';
import { isRedisConfigured } from './connection';
import type { SyncJobName } from './queue';
import { createPendingSyncJob, attachBullJobId, markSyncJobFailedPermanently } from './syncJob';
import type { CreatePendingSyncJobInput } from './syncJob';

export interface EnqueueSyncJobInput extends CreatePendingSyncJobInput {
  name: SyncJobName;
  /** Extra fields merged into the BullMQ job payload alongside syncJobId. */
  data?: Record<string, unknown>;
  /** BullMQ job id — set for jobs that should dedupe (e.g. one active broadcast-schedule sync at a time). */
  jobId?: string;
}

export async function enqueueSyncJob(input: EnqueueSyncJobInput) {
  // Production without REDIS_URL has no queue: say so instead of opening a
  // connection to localhost that retries (and logs errors) in the background.
  if (!isRedisConfigured()) {
    throw new Error('Background jobs need REDIS_URL, which is not set on this deployment.');
  }
  const syncJob = await createPendingSyncJob({
    provider: input.provider,
    jobType: input.jobType,
    mode: input.mode,
    totalItems: input.totalItems,
    page: input.page,
    payload: input.payload,
  });

  const queue = getSyncQueue();
  try {
    const bullJob = await queue.add(
      input.name,
      { syncJobId: syncJob.id, ...(input.data || {}) },
      input.jobId ? { jobId: input.jobId } : undefined
    );
    await attachBullJobId(syncJob.id, bullJob.id);
    return { syncJob, bullJobId: bullJob.id };
  } catch (err: any) {
    // The PENDING row was already created — if it never actually reaches
    // Redis (e.g. Redis unreachable), don't leave it stuck PENDING forever
    // looking like real queued work. Fail it now and let the caller's
    // catch block turn this into a 5xx instead of a false "queued" 200.
    await markSyncJobFailedPermanently(syncJob.id, `Failed to enqueue: ${err?.message || err}`);
    throw err;
  }
}
