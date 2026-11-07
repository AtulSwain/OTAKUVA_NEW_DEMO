/**
 * OTAKUVA — job processors for the `otakuva-sync` queue.
 *
 * One function per SyncJobName (see src/lib/queue/queue.ts), dispatched by
 * `processSyncJob` below. scripts/worker.ts is the only thing that calls
 * this — it's the Worker's processor function. Every handler:
 *   1. marks its SyncJob row RUNNING,
 *   2. does the actual work (the same calls the old inline route/script
 *      code made — see each handler's comment for exactly which one it
 *      replaces),
 *   3. marks the row COMPLETED/PAUSED/CANCELLED, or throws so BullMQ
 *      retries with backoff (src/lib/queue/syncJob.ts's
 *      recordSyncJobAttemptFailure records the interim error either way).
 *
 * None of these handlers write DeadLetterQueue themselves — that only
 * happens once BullMQ has exhausted every retry, handled centrally in
 * scripts/worker.ts's Worker 'failed' listener (see
 * src/lib/queue/deadLetterRouting.ts).
 */

import type { Job } from 'bullmq';
import { syncEngine } from '../syncEngine';
import { getFailoverProvider } from '../providers';
import { ScheduleEngine } from '../engine/schedule/scheduleEngine';
import { newsEngine } from '../engine/news/newsEngine';
import { getJikanAnimeFull, getJikanSeasonalAnime, getJikanTopAnime, syncJikanAnimeToDatabase } from '../jikanService';
import { runEpisodeBackfillBatch } from '../catalog/episodeBackfillEngine';
import { runMaturationBatch } from '../badges/countingService';
import { logger } from '../logger';
import { getRedisConnection } from './connection';
import type { SyncJobName } from './queue';
import { runDeadLetterSweep } from '../deadLetterSweep';
import { JOB_TYPES } from './jobTypes';
import {
  markSyncJobRunning,
  completeSyncJob,
  pauseSyncJob,
  cancelSyncJob,
  markSyncJobFailedPermanently,
  updateSyncJobProgress,
  createPendingSyncJob,
  attachBullJobId,
} from './syncJob';

// ---------------------------------------------------------------------------
// 'sync:anime' — was POST /api/admin/sync {action:"SYNC_ANIME"}
// ---------------------------------------------------------------------------
interface SyncAnimeData {
  syncJobId: string;
  externalId: string;
  provider?: 'anilist' | 'jikan';
}

async function handleSyncAnime(job: Job<SyncAnimeData>) {
  const { syncJobId, externalId, provider = 'anilist' } = job.data;
  await markSyncJobRunning(syncJobId, job.attemptsMade);

  // getFailoverProvider(provider): tries `provider` first, automatically
  // retries the same anime against the other registered adapter if it
  // fails/times out/comes back incomplete (src/lib/providers/
  // failoverProvider.ts). ingestAnime() below trusts
  // rawAnime.externalSource over the `provider` param for provenance, so
  // it's still recorded correctly even when failover actually served this.
  const rawAnime = await getFailoverProvider(provider).getAnime(String(externalId));
  if (!rawAnime) {
    throw new Error(`Anime ${externalId} not found on any registered provider (tried ${provider} and its fallback(s))`);
  }

  const res = await syncEngine.ingestAnime(rawAnime, provider);
  await Promise.allSettled([
    syncEngine.syncEpisodes(res.animeId, String(externalId), 'jikan'),
    syncEngine.syncCharacters(res.animeId, String(externalId), 'anilist'),
    syncEngine.syncStaff(res.animeId, String(externalId), 'anilist'),
    syncEngine.syncRelations(res.animeId, String(externalId), 'anilist'),
  ]);

  await completeSyncJob(syncJobId, {
    processedCount: 1,
    createdCount: res.isNew ? 1 : 0,
    updatedCount: res.isNew ? 0 : 1,
  });
  return res;
}

// ---------------------------------------------------------------------------
// 'sync:catalog' — was POST /api/admin/sync {action:"SYNC_CATALOG"}
// ---------------------------------------------------------------------------
interface SyncCatalogData {
  syncJobId: string;
  provider?: 'anilist' | 'jikan';
  maxPages?: number;
}

async function handleSyncCatalog(job: Job<SyncCatalogData>) {
  const { syncJobId, provider = 'anilist', maxPages = 2 } = job.data;
  // syncEngine.syncCatalog does its own RUNNING/COMPLETED bookkeeping on
  // this row (it accepts an existing SyncJob id precisely so the queue's
  // PENDING row is the one that gets updated, not a second one).
  const res = await syncEngine.syncCatalog(provider, maxPages, 'FULL_CATALOG', syncJobId);
  if (!res.success) {
    // syncCatalog swallows its own errors into {success:false}; re-throw so
    // BullMQ actually retries with backoff instead of silently "completing".
    throw new Error(res.error || 'Catalog sync failed');
  }
  return res;
}

// ---------------------------------------------------------------------------
// 'sync:airing' — was POST /api/admin/sync {action:"SYNC_AIRING"},
// scripts/sync_real_world_schedule.ts
// ---------------------------------------------------------------------------
interface SyncAiringData {
  syncJobId: string;
}

async function handleSyncAiring(job: Job<SyncAiringData>) {
  const { syncJobId } = job.data;
  await markSyncJobRunning(syncJobId, job.attemptsMade);

  const res = await syncEngine.syncWeeklySchedule();
  if (!res.success) throw new Error(res.error || 'Airing schedule sync failed');

  await completeSyncJob(syncJobId, { processedCount: res.syncedCount, createdCount: res.syncedCount });
  return res;
}

// ---------------------------------------------------------------------------
// 'sync:broadcast-schedule' — was POST /api/admin/sync
// {action:"SYNC_BROADCAST_SCHEDULE"}, scripts/sync_broadcast_schedule.ts
// ---------------------------------------------------------------------------
interface SyncBroadcastScheduleData {
  syncJobId: string;
}

async function handleSyncBroadcastSchedule(job: Job<SyncBroadcastScheduleData>) {
  const { syncJobId } = job.data;
  await markSyncJobRunning(syncJobId, job.attemptsMade);

  const res = await ScheduleEngine.syncFromBroadcastMetadata();
  await completeSyncJob(syncJobId, {
    processedCount: res.processed,
    createdCount: res.created,
    updatedCount: res.updated,
    failedCount: res.skipped,
  });
  return res;
}

// ---------------------------------------------------------------------------
// 'news-sync' — was the per-cycle work in scripts/news_poller.ts
// ---------------------------------------------------------------------------
interface NewsSyncData {
  syncJobId: string;
}

async function handleNewsSync(job: Job<NewsSyncData>) {
  const { syncJobId } = job.data;
  await markSyncJobRunning(syncJobId, job.attemptsMade);

  const results = await newsEngine.syncAllProviders(30);
  const totalNew = results.reduce((sum, r) => sum + r.createdCount, 0);
  const totalUpdated = results.reduce((sum, r) => sum + r.updatedCount, 0);
  const failed = results.filter((r) => r.status === 'FAILED');

  // Every provider failing in the same cycle is worth a retry (could be a
  // shared transient issue); some providers failing while others succeed
  // is normal per-source flakiness and shouldn't block the good results.
  if (results.length > 0 && failed.length === results.length) {
    throw new Error(failed.map((f) => `${f.provider}: ${f.errors?.[0] || 'unknown error'}`).join('; '));
  }

  await completeSyncJob(syncJobId, {
    processedCount: results.length,
    createdCount: totalNew,
    updatedCount: totalUpdated,
    failedCount: failed.length,
  });
  return { results };
}

// ---------------------------------------------------------------------------
// 'episode-backfill' — new: a resumable, catalog-wide episode backfill.
// See src/lib/catalog/episodeBackfillEngine.ts for the full design
// (SyncCheckpoint-based resumability, priority ordering, per-page writes).
// Recurring only (src/lib/queue/recurring.ts) — there's no manual-trigger
// route/script for this one, unlike the other job kinds.
// ---------------------------------------------------------------------------
interface EpisodeBackfillData {
  syncJobId: string;
  maxPagesPerRun?: number;
}

const EPISODE_BACKFILL_PAGES_PER_RUN = 10;

async function handleEpisodeBackfill(job: Job<EpisodeBackfillData>) {
  const { syncJobId, maxPagesPerRun = EPISODE_BACKFILL_PAGES_PER_RUN } = job.data;
  await markSyncJobRunning(syncJobId, job.attemptsMade);

  const result = await runEpisodeBackfillBatch(maxPagesPerRun);

  await completeSyncJob(syncJobId, {
    processedCount: result.pagesProcessed,
    createdCount: result.episodesWritten,
    updatedCount: result.animeCompleted,
  });
  return result;
}

// ---------------------------------------------------------------------------
// 'badges:maturation' — reviewer badges (src/lib/badges/countingService.ts):
// matures PENDING reviews after the window, runs the duplicate/spam check and
// daily cap, recalculates tiers, and emits tier-earned events. Recurring only.
// ---------------------------------------------------------------------------
async function handleBadgeMaturation(job: Job<{ syncJobId: string }>) {
  const { syncJobId } = job.data;
  await markSyncJobRunning(syncJobId, job.attemptsMade);
  const result = await runMaturationBatch();
  await completeSyncJob(syncJobId, {
    processedCount: result.examined,
    createdCount: result.counted,
    updatedCount: result.tiersChanged,
  });
  return result;
}

// ---------------------------------------------------------------------------
// 'dead-letter:sweep' (2026-11-06) — merges duplicate DeadLetterQueue rows,
// retries what's retryable, archives what's exhausted. Recurring only.
// ---------------------------------------------------------------------------
async function handleDeadLetterSweep(job: Job<{ syncJobId: string }>) {
  const { syncJobId } = job.data;
  await markSyncJobRunning(syncJobId, job.attemptsMade);
  const result = await runDeadLetterSweep({ batchSize: 500 });
  await completeSyncJob(syncJobId, {
    processedCount: result.examined,
    updatedCount: result.recovered,
  });
  return result;
}

// ---------------------------------------------------------------------------
// 'anime-import' — was POST /api/admin/anime/import
// (src/lib/ingestion/jikanImportJob.ts's JikanImportJobManager)
// ---------------------------------------------------------------------------
export type ImportMode = 'FULL' | 'SEASON' | 'TOP' | 'AIRING' | 'UPCOMING' | 'SPECIFIC_ID' | 'RETRY_FAILED';

export interface AnimeImportData {
  syncJobId: string;
  mode: ImportMode;
  startPage?: number;
  maxPages: number;
  specificId?: number;
}

const IMPORT_CANCEL_KEY_PREFIX = 'otakuva:import:cancel:';
const IMPORT_INTER_PAGE_DELAY_MS = 500;
type ImportStopAction = 'PAUSED' | 'CANCELLED';

/**
 * Called by the 'stop'/'pause'/'cancel' branches of
 * POST /api/admin/anime/import — see that route. Cooperative: a job
 * that's actively fetching a page only notices between pages (same
 * granularity the old in-memory `isJobRunning` flag had), not mid-fetch.
 */
export async function requestAnimeImportStop(syncJobId: string, action: ImportStopAction) {
  await getRedisConnection().set(`${IMPORT_CANCEL_KEY_PREFIX}${syncJobId}`, action, 'EX', 3600);
}

async function getRequestedImportStop(syncJobId: string): Promise<ImportStopAction | null> {
  const value = await getRedisConnection().get(`${IMPORT_CANCEL_KEY_PREFIX}${syncJobId}`);
  return value === 'PAUSED' || value === 'CANCELLED' ? value : null;
}

async function clearImportCancelFlag(syncJobId: string) {
  await getRedisConnection().del(`${IMPORT_CANCEL_KEY_PREFIX}${syncJobId}`);
}

async function handleAnimeImport(job: Job<AnimeImportData>) {
  const { syncJobId, mode, startPage, maxPages, specificId } = job.data;
  await markSyncJobRunning(syncJobId, job.attemptsMade);
  // A fresh start/resume always wins over a stale cancel flag left by an
  // earlier run of the same SyncJob row.
  await clearImportCancelFlag(syncJobId);

  if (mode === 'SPECIFIC_ID' && specificId) {
    const anime = await getJikanAnimeFull(specificId);
    if (!anime) {
      // A single explicit id 404ing isn't a transient failure worth
      // BullMQ's retry/backoff — fail the SyncJob directly instead of
      // throwing.
      await markSyncJobFailedPermanently(syncJobId, `Anime with ID ${specificId} not found.`);
      return { insertedAnime: 0, failedAnime: 1 };
    }
    await syncJikanAnimeToDatabase(anime);
    await completeSyncJob(syncJobId, { processedCount: 1, createdCount: 1 });
    return { insertedAnime: 1, processedAnime: 1 };
  }

  let currentPage = startPage || 1;
  let pagesProcessedInRun = 0;
  let processedAnime = 0;
  let insertedAnime = 0;
  let failedAnime = 0;
  const failedPages: number[] = [];
  const failedIds: number[] = [];
  let reachedEnd = false;

  while (pagesProcessedInRun < maxPages) {
    const requestedStop = await getRequestedImportStop(syncJobId);
    if (requestedStop) {
      const patch = {
        page: currentPage,
        processedCount: processedAnime,
        createdCount: insertedAnime,
        failedCount: failedAnime,
        processedPages: pagesProcessedInRun,
        failedPagesJson: JSON.stringify(failedPages),
        failedIdsJson: JSON.stringify(failedIds),
      };
      if (requestedStop === 'CANCELLED') {
        await cancelSyncJob(syncJobId, patch);
      } else {
        await pauseSyncJob(syncJobId, patch);
      }
      await clearImportCancelFlag(syncJobId);
      return { stopped: requestedStop, processedAnime, insertedAnime, failedAnime };
    }

    try {
      const res =
        mode === 'SEASON'
          ? await getJikanSeasonalAnime(new Date().getFullYear(), 'summer', currentPage, 25)
          : await getJikanTopAnime(currentPage, 25);

      if (res.animes?.length) {
        for (const anime of res.animes) {
          const animeId = await syncJikanAnimeToDatabase(anime);
          if (animeId) {
            insertedAnime++;
          } else {
            failedAnime++;
            if (anime.mal_id) failedIds.push(anime.mal_id);
          }
          processedAnime++;
        }
      }

      pagesProcessedInRun++;
      await updateSyncJobProgress(syncJobId, {
        page: currentPage + 1,
        processedCount: processedAnime,
        createdCount: insertedAnime,
        failedCount: failedAnime,
        processedPages: pagesProcessedInRun,
        failedIdsJson: JSON.stringify(failedIds),
      });
      await job.updateProgress(Math.min(100, Math.round((pagesProcessedInRun / maxPages) * 100)));

      if (!res.pagination?.has_next_page) {
        reachedEnd = true;
        break;
      }

      currentPage++;
      await new Promise((resolve) => setTimeout(resolve, IMPORT_INTER_PAGE_DELAY_MS));
    } catch (pageErr: any) {
      failedPages.push(currentPage);
      // logged before incrementing — currentPage is the page that just
      // failed, not the next one about to be attempted.
      logger.error('anime-import page failed', { error: pageErr, page: currentPage, syncJobId, mode });
      currentPage++;
      pagesProcessedInRun++;
      await updateSyncJobProgress(syncJobId, { failedPagesJson: JSON.stringify(failedPages) });
    }
  }

  const finalPatch = {
    page: currentPage,
    processedCount: processedAnime,
    createdCount: insertedAnime,
    failedCount: failedAnime,
    processedPages: pagesProcessedInRun,
    failedPagesJson: JSON.stringify(failedPages),
    failedIdsJson: JSON.stringify(failedIds),
  };

  if (reachedEnd) {
    await completeSyncJob(syncJobId, finalPatch);
  } else {
    // Ran out of maxPages for this invocation without reaching the end of
    // the dataset — PAUSED, same as the old in-memory job manager, so
    // "Start/Resume" in the admin UI enqueues the next batch from here.
    await pauseSyncJob(syncJobId, finalPatch);
  }

  return { processedAnime, insertedAnime, failedAnime, reachedEnd };
}

// ---------------------------------------------------------------------------
// Dispatch
// ---------------------------------------------------------------------------
const handlersByName: Record<SyncJobName, (job: Job<any>) => Promise<unknown>> = {
  'sync:anime': handleSyncAnime,
  'sync:catalog': handleSyncCatalog,
  'sync:airing': handleSyncAiring,
  'sync:broadcast-schedule': handleSyncBroadcastSchedule,
  'anime-import': handleAnimeImport,
  'news-sync': handleNewsSync,
  'episode-backfill': handleEpisodeBackfill,
  'badges:maturation': handleBadgeMaturation,
  'dead-letter:sweep': handleDeadLetterSweep,
};

// Job names BullMQ's repeatable scheduler (src/lib/queue/recurring.ts) can
// fire without a pre-created SyncJob row — the recurring tick's static
// template data has no syncJobId to give it. Mapped to the provider/jobType
// an on-the-fly PENDING (immediately RUNNING) row should use, so it's
// indistinguishable in the admin UI from a manually-triggered sync of the
// same kind.
const autoTrackedJobMeta: Partial<Record<SyncJobName, { provider: string; jobType: string }>> = {
  'news-sync': { provider: 'multiple', jobType: JOB_TYPES.NEWS_SYNC },
  'sync:broadcast-schedule': { provider: 'jikan', jobType: JOB_TYPES.BROADCAST_SCHEDULE },
  'sync:airing': { provider: 'anilist', jobType: JOB_TYPES.AIRING },
  'episode-backfill': { provider: 'multi', jobType: JOB_TYPES.EPISODE_BACKFILL },
  'badges:maturation': { provider: 'internal', jobType: JOB_TYPES.BADGE_MATURATION },
  'dead-letter:sweep': { provider: 'internal', jobType: JOB_TYPES.DEAD_LETTER_SWEEP },
};

export async function processSyncJob(job: Job): Promise<unknown> {
  const handler = handlersByName[job.name as SyncJobName];
  if (!handler) {
    throw new Error(`No handler registered for job name "${job.name}"`);
  }

  if (!job.data?.syncJobId) {
    const meta = autoTrackedJobMeta[job.name as SyncJobName];
    if (!meta) {
      throw new Error(`Job "${job.name}" was enqueued without syncJobId and has no auto-tracking fallback`);
    }
    const syncJob = await createPendingSyncJob({ provider: meta.provider, jobType: meta.jobType });
    await attachBullJobId(syncJob.id, job.id);
    await job.updateData({ ...job.data, syncJobId: syncJob.id });
  }

  return handler(job);
}

/**
 * What to write to DeadLetterQueue if this job's retries are exhausted —
 * called from scripts/worker.ts's Worker 'failed' listener, never from a
 * handler directly. `entityType`/`externalId` don't map onto a single
 * external record for every job kind (a catalog crawl or a schedule
 * resync isn't "about" one external id the way a single anime fetch is),
 * so paged/bulk jobs use their SyncJob id as the externalId — enough to
 * find the exact run in the SyncJob table from the DLQ row.
 */
export function describeJobForDeadLetter(job: Job): { provider: string; entityType: string; externalId: string } {
  const syncJobId = job.data?.syncJobId || job.id || 'unknown';
  switch (job.name as SyncJobName) {
    case 'sync:anime':
      return { provider: job.data?.provider || 'anilist', entityType: 'ANIME', externalId: String(job.data?.externalId ?? syncJobId) };
    case 'sync:catalog':
      return { provider: job.data?.provider || 'anilist', entityType: 'ANIME_CATALOG', externalId: String(syncJobId) };
    case 'sync:airing':
      return { provider: 'anilist', entityType: 'AIRING_SCHEDULE', externalId: String(syncJobId) };
    case 'sync:broadcast-schedule':
      return { provider: 'jikan', entityType: 'BROADCAST_SCHEDULE', externalId: String(syncJobId) };
    case 'anime-import':
      return {
        provider: 'jikan',
        entityType: 'ANIME',
        externalId: job.data?.specificId ? String(job.data.specificId) : String(syncJobId),
      };
    case 'news-sync':
      return { provider: 'multiple', entityType: 'NEWS_ARTICLE', externalId: String(syncJobId) };
    case 'episode-backfill':
      return { provider: 'multi', entityType: 'EPISODE', externalId: String(syncJobId) };
    case 'badges:maturation':
      return { provider: 'internal', entityType: 'BADGE_MATURATION', externalId: String(syncJobId) };
    case 'dead-letter:sweep':
      return { provider: 'internal', entityType: 'DEAD_LETTER_SWEEP', externalId: String(syncJobId) };
    default:
      return { provider: 'unknown', entityType: 'UNKNOWN', externalId: String(syncJobId) };
  }
}
