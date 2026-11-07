/**
 * OTAKUVA — routes a permanently-failed queue job to DeadLetterQueue.
 *
 * Only called from scripts/worker.ts's Worker 'failed' listener, and only
 * once `job.attemptsMade >= job.opts.attempts` (every retry exhausted —
 * see src/lib/queue/queue.ts for the 5-attempt exponential backoff policy).
 * A mid-retry failure never reaches here; see recordSyncJobAttemptFailure
 * in src/lib/queue/syncJob.ts for that path.
 *
 * Writes to the same DeadLetterQueue table src/lib/syncEngine.ts's inline
 * provider-fetch failures use, and the same table
 * scripts/retry_dead_letters.ts / src/lib/deadLetter.ts already retry and
 * archive — one dead-letter queue regardless of whether the failure
 * originated from a direct fetch or an exhausted queue job.
 */

import { recordDeadLetter } from '../deadLetter';
import { logger } from '../logger';

export interface DeadLetterFromJobInput {
  provider: string;
  entityType: string;
  externalId: string;
  error: string;
}

export async function routeExhaustedJobToDeadLetter(input: DeadLetterFromJobInput) {
  try {
    await recordDeadLetter(input);
  } catch (e) {
    logger.error('failed to write DeadLetterQueue row', {
      error: e,
      component: 'queue/deadLetterRouting',
      provider: input.provider,
      entityType: input.entityType,
      externalId: input.externalId,
      originalError: input.error,
    });
  }
}
