/**
 * OTAKUVA — SyncJob.jobType constants used by the queue.
 *
 * Centralised so the value used when a PENDING row is created (routes,
 * scripts/*.ts enqueue helpers) and the value used to auto-track a
 * scheduler-triggered tick that has no pre-created row (see
 * src/lib/queue/handlers.ts's processSyncJob) can't drift apart.
 */
export const JOB_TYPES = {
  SYNC_ANIME: 'SYNC_ANIME',
  FULL_CATALOG: 'FULL_CATALOG',
  AIRING: 'AIRING',
  BROADCAST_SCHEDULE: 'BROADCAST_SCHEDULE',
  JIKAN_IMPORT: 'JIKAN_IMPORT',
  NEWS_SYNC: 'NEWS_SYNC',
  EPISODE_BACKFILL: 'EPISODE_BACKFILL',
  BADGE_MATURATION: 'BADGE_MATURATION',
  DEAD_LETTER_SWEEP: 'DEAD_LETTER_SWEEP',
} as const;
