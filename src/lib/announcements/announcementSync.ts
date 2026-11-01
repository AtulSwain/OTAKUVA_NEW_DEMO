/**
 * Announced anime sync (2026-11-01).
 *
 * AniList lists a new anime within hours of its announcement. This walks
 * AniList's newest not-yet-released entries (highest ids first) and:
 *   1. adds the ones we don't have yet, through `syncEngine.ingestAnime` —
 *      which also links their studios, genres, titles and provenance, so a
 *      new announcement shows on its studio's page straight away;
 *   2. refreshes announced titles we already got from AniList when their
 *      stored copy is older than a day (premiere dates, posters, trailers and
 *      studios are often filled in after the first announcement). Editorial
 *      overrides are respected by ingestAnime;
 *   3. links their prequels/parents (stored relations, upsert only);
 *   4. links recent news stories whose headline names the anime exactly.
 *
 * Rules kept from the catalog importer: add-only by provider id, no adult
 * titles, no music videos, and a same title + format + year under different
 * ids is held for review instead of added. Nothing is ever deleted — a failed
 * or empty fetch just ends the run.
 */

import { prisma } from '../prisma';
import { logger } from '../logger';
import { syncEngine } from '../syncEngine';
import { anilistProvider } from '../providers/anilistProvider';
import type { ProviderAnime, ProviderPagination } from '../providers/animeProvider.interface';

type FetchPage = (page: number) => Promise<{ items: ProviderAnime[]; pagination: ProviderPagination }>;

export type AnnouncementSyncOptions = {
  /** AniList pages of 50 to read (newest first). */
  pages?: number;
  maxNew?: number;
  maxRefresh?: number;
  /** Test seam; defaults to AniList. */
  fetchPage?: FetchPage;
  /** Test seam; defaults to AniList relations. */
  linkRelations?: boolean;
};

export type AnnouncementSyncResult = {
  ran: boolean;
  fetched: number;
  added: string[];
  refreshed: number;
  alreadyKnown: number;
  excluded: number;
  heldForReview: string[];
  failed: number;
  relationsLinked: number;
  newsLinked: number;
  newsQueuedForReview: number;
};

const JOB = { provider: 'anilist', jobType: 'ANNOUNCEMENTS' } as const;
const REFRESH_AFTER_MS = 24 * 60 * 60 * 1000;
const NEWS_WINDOW_DAYS = 45;

const RELATION_TYPES: Record<string, string> = {
  SEQUEL: 'Sequel',
  PREQUEL: 'Prequel',
  SIDE_STORY: 'Side story',
  PARENT: 'Parent story',
  SPIN_OFF: 'Spin-off',
  ALTERNATIVE: 'Alternative',
  SUMMARY: 'Summary',
  COMPILATION: 'Summary',
  CHARACTER: 'Character',
  OTHER: 'Other',
};

export function excludedReason(a: Pick<ProviderAnime, 'isAdult' | 'genres' | 'type'>): string | null {
  const genres = (a.genres || []).map((g) => String(g).toLowerCase());
  if (a.isAdult || genres.includes('hentai') || genres.includes('erotica')) return 'adult';
  if (String(a.type || '').toLowerCase() === 'music') return 'music video';
  return null;
}

/** One run at a time across processes: a lease on the checkpoint row. */
async function acquireLease(): Promise<boolean> {
  await prisma.syncCheckpoint.upsert({
    where: { provider_jobType: { ...JOB } },
    create: { ...JOB },
    update: {},
  });
  const n = await prisma.$executeRaw`
    UPDATE "SyncCheckpoint" SET cursor = ${`running:${new Date().toISOString()}`}, "updatedAt" = now()
    WHERE provider = ${JOB.provider} AND "jobType" = ${JOB.jobType}
      AND (cursor IS NULL OR cursor NOT LIKE 'running:%' OR "updatedAt" < now() - interval '20 minutes')`;
  return n === 1;
}

async function releaseLease(result: AnnouncementSyncResult | null, error?: string) {
  const prev = await prisma.syncCheckpoint.findUnique({ where: { provider_jobType: { ...JOB } }, select: { metadata: true } });
  let meta: Record<string, unknown> = {};
  try {
    meta = prev?.metadata ? JSON.parse(prev.metadata) : {};
  } catch {
    meta = {};
  }
  const now = new Date().toISOString();
  meta.lastRunAt = now;
  if (result) {
    meta.lastSuccessAt = now;
    meta.lastResult = { ...result, added: result.added.length, heldForReview: result.heldForReview };
  }
  if (error) meta.lastError = error;
  await prisma.syncCheckpoint.update({
    where: { provider_jobType: { ...JOB } },
    data: {
      cursor: null,
      metadata: JSON.stringify(meta),
      ...(result
        ? {
            processedCount: { increment: result.fetched },
            createdCount: { increment: result.added.length },
            updatedCount: { increment: result.refreshed },
            failedCount: { increment: result.failed },
          }
        : {}),
    },
  });
}

export async function getAnnouncementSyncState(): Promise<{ lastRunAt: string | null; lastSuccessAt: string | null; running: boolean }> {
  const row = await prisma.syncCheckpoint.findUnique({ where: { provider_jobType: { ...JOB } }, select: { metadata: true, cursor: true } });
  let meta: { lastRunAt?: string; lastSuccessAt?: string } = {};
  try {
    meta = row?.metadata ? JSON.parse(row.metadata) : {};
  } catch {
    meta = {};
  }
  return { lastRunAt: meta.lastRunAt ?? null, lastSuccessAt: meta.lastSuccessAt ?? null, running: Boolean(row?.cursor?.startsWith('running:')) };
}

export async function syncAnnouncedAnime(opts: AnnouncementSyncOptions = {}): Promise<AnnouncementSyncResult> {
  const pages = Math.max(1, opts.pages ?? 4);
  const maxNew = Math.max(0, opts.maxNew ?? 60);
  const maxRefresh = Math.max(0, opts.maxRefresh ?? 40);
  const fetchPage: FetchPage = opts.fetchPage ?? ((p) => anilistProvider.getRecentlyAnnouncedAnime(p, 50));
  const result: AnnouncementSyncResult = {
    ran: false,
    fetched: 0,
    added: [],
    refreshed: 0,
    alreadyKnown: 0,
    excluded: 0,
    heldForReview: [],
    failed: 0,
    relationsLinked: 0,
    newsLinked: 0,
    newsQueuedForReview: 0,
  };

  if (!(await acquireLease())) return result;
  result.ran = true;

  try {
    const touched: { id: string; anilistId: number | null }[] = [];

    for (let page = 1; page <= pages; page++) {
      let res: Awaited<ReturnType<FetchPage>>;
      try {
        res = await fetchPage(page);
      } catch (err) {
        // Provider trouble ends the run; nothing stored is touched.
        logger.warn('announced sync: page fetch failed', { page, error: err instanceof Error ? err.message : String(err) });
        result.failed++;
        break;
      }
      const items = res.items || [];
      if (items.length === 0) break;
      let newOnPage = 0;

      for (const a of items) {
        result.fetched++;
        if (excludedReason(a)) {
          result.excluded++;
          continue;
        }
        const known = await prisma.anime.findFirst({
          where: {
            OR: [
              ...(a.anilistId ? [{ anilistId: a.anilistId }] : []),
              ...(a.malId ? [{ malId: a.malId }] : []),
              { externalIds: { some: { provider: 'anilist', externalId: String(a.externalId) } } },
            ],
          },
          select: { id: true, anilistId: true, externalSource: true, lastSyncedAt: true },
        });

        if (known) {
          result.alreadyKnown++;
          const stale = Date.now() - known.lastSyncedAt.getTime() > REFRESH_AFTER_MS;
          // Same-provider refresh only: a Jikan/manual row is never rewritten with AniList data here.
          if (stale && known.externalSource === 'anilist' && result.refreshed < maxRefresh) {
            try {
              await syncEngine.ingestAnime(a, 'anilist');
              result.refreshed++;
              touched.push({ id: known.id, anilistId: known.anilistId });
            } catch (err) {
              result.failed++;
              logger.warn('announced sync: refresh failed', { anilistId: a.anilistId, error: err instanceof Error ? err.message : String(err) });
            }
          }
          continue;
        }

        newOnPage++;
        if (result.added.length >= maxNew) continue;

        // Same title + format + year already stored under other ids → review, not a second row.
        const year = a.startDate?.year ?? a.year ?? null;
        const sameTitle = await prisma.anime.findFirst({
          where: {
            canonicalTitle: { equals: a.title, mode: 'insensitive' },
            type: a.type,
            ...(year ? { OR: [{ year }, { startYear: year }] } : { year: null, startYear: null }),
          },
          select: { slug: true },
        });
        if (sameTitle) {
          result.heldForReview.push(`${a.title} (${a.type} ${year ?? '?'}, anilist ${a.anilistId}) ~ /anime/${sameTitle.slug}`);
          continue;
        }

        try {
          const r = await syncEngine.ingestAnime(a, 'anilist');
          if (r.isNew) {
            result.added.push(r.slug);
            touched.push({ id: r.animeId, anilistId: a.anilistId ?? null });
          } else {
            result.alreadyKnown++;
          }
        } catch (err) {
          result.failed++;
          logger.warn('announced sync: ingest failed', { anilistId: a.anilistId, error: err instanceof Error ? err.message : String(err) });
        }
      }

      // Newest first: once a whole page is already known, older pages are too.
      if (newOnPage === 0 && page >= 2) break;
      if (!res.pagination?.hasNextPage) break;
    }

    if (opts.linkRelations !== false) {
      result.relationsLinked = await linkRelations(touched.filter((t) => t.anilistId).map((t) => t.anilistId as number)).catch((err) => {
        logger.warn('announced sync: relations failed', { error: err instanceof Error ? err.message : String(err) });
        return 0;
      });
    }

    // News for every announced anime, not only this run's additions — stories
    // often arrive after the AniList entry. (linkAnnouncementNews keeps only
    // not-yet-aired titles.)
    const recent = await prisma.anime.findMany({
      where: { OR: [{ id: { in: touched.map((t) => t.id) } }, { status: { contains: 'not yet', mode: 'insensitive' } }], isAdult: false },
      select: { id: true },
      take: 1500,
    });
    const news = await linkAnnouncementNews(recent.map((r) => r.id));
    result.newsLinked = news.linked;
    result.newsQueuedForReview = news.queued;

    await releaseLease(result);
    if (result.added.length || result.heldForReview.length) {
      logger.info('announced sync finished', { added: result.added.length, refreshed: result.refreshed, held: result.heldForReview.length, news: result.newsLinked });
    }
    return result;
  } catch (err) {
    await releaseLease(null, err instanceof Error ? err.message : String(err)).catch(() => undefined);
    throw err;
  }
}

/** Prequels / parents etc. between catalog anime, from AniList. Upsert only. */
async function linkRelations(anilistIds: number[]): Promise<number> {
  if (anilistIds.length === 0) return 0;
  let linked = 0;
  for (let i = 0; i < anilistIds.length; i += 50) {
    const batch = anilistIds.slice(i, i + 50);
    const rels = await anilistProvider.getRelationsByIds(batch, 'anilist');
    const targetIds = [...new Set([...rels.values()].flat().map((e) => e.anilistId))];
    const sources = await prisma.anime.findMany({ where: { anilistId: { in: batch } }, select: { id: true, anilistId: true } });
    const targets = await prisma.anime.findMany({ where: { anilistId: { in: targetIds } }, select: { id: true, anilistId: true } });
    const src = new Map(sources.map((s) => [s.anilistId as number, s.id]));
    const tgt = new Map(targets.map((t) => [t.anilistId as number, t.id]));
    for (const [sourceKey, edges] of rels.entries()) {
      const sourceId = src.get(sourceKey);
      if (!sourceId) continue;
      for (const e of edges) {
        const relationType = RELATION_TYPES[e.relationType];
        const targetId = tgt.get(e.anilistId);
        if (!relationType || !targetId || targetId === sourceId) continue;
        await prisma.animeRelation.upsert({
          where: { sourceAnimeId_targetAnimeId_relationType: { sourceAnimeId: sourceId, targetAnimeId: targetId, relationType } },
          update: {},
          create: { sourceAnimeId: sourceId, targetAnimeId: targetId, relationType },
        });
        linked++;
      }
    }
  }
  return linked;
}

const escapeRe = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

// Text right after the title that means the headline is about a different
// entry of the franchise ("X Season 2", "X: The Movie", "X Part 2", "X 2nd").
const OTHER_ENTRY = /^\s*(?:[:\-–—(]|(?:season|part|cour|movie|film|ova|oad|special|arc|ii|iii|iv|zero|final|2nd|3rd|\d+(?:st|nd|rd|th)?)\b)/i;

/**
 * Whole-phrase, case-insensitive match (no partial words), and not followed
 * by words that point at a different entry of the same franchise.
 */
export function headlineNames(headline: string, title: string): boolean {
  const t = title.trim();
  if (!t) return false;
  const re = new RegExp(String.raw`(^|[^\p{L}\p{N}])` + escapeRe(t) + String.raw`(?=$|[^\p{L}\p{N}])`, 'giu');
  let m: RegExpExecArray | null;
  while ((m = re.exec(headline))) {
    const rest = headline.slice(m.index + m[0].length).replace(/^['’]s\b/, '');
    if (!OTHER_ENTRY.test(rest)) return true;
  }
  return false;
}

/**
 * Links recent news to announced anime when a headline names the anime's
 * full title. Long titles (12+ characters, 2+ words) are linked straight
 * away; shorter ones go to the news review queue for an admin. Existing
 * links — including ones an admin rejected — are never changed.
 */
export async function linkAnnouncementNews(animeIds: string[]): Promise<{ linked: number; queued: number }> {
  let linked = 0;
  let queued = 0;
  if (animeIds.length === 0) return { linked, queued };
  const since = new Date(Date.now() - NEWS_WINDOW_DAYS * 86_400_000);

  // A handful of queries in total (not one per anime): the serverless
  // function and the database can be far apart.
  // Announced anime only: older entries of a franchise share its name, and
  // a headline about "X Season 2" must not land on X.
  const [anime, articles] = await Promise.all([
    prisma.anime.findMany({
      where: { id: { in: animeIds }, isAdult: false, status: { contains: 'not yet', mode: 'insensitive' } },
      select: { id: true, canonicalTitle: true, titles: { where: { type: { in: ['english', 'romaji', 'official'] } }, select: { title: true } } },
    }),
    prisma.newsArticle.findMany({
      where: { publishedAt: { gte: since }, status: 'PUBLISHED', deletedAt: null },
      select: { id: true, title: true },
      orderBy: { publishedAt: 'desc' },
      take: 5000,
    }),
  ]);
  if (anime.length === 0 || articles.length === 0) return { linked, queued };

  // Candidate pairs: headline contains a title (cheap check), then the strict match.
  const pairs: { articleId: string; animeId: string; hit: string }[] = [];
  for (const a of anime) {
    const titles = [...new Set([a.canonicalTitle, ...a.titles.map((t) => t.title)].map((t) => t.trim()).filter((t) => t.length >= 8))];
    if (titles.length === 0) continue;
    const lower = titles.map((t) => t.toLowerCase());
    for (const art of articles) {
      const h = art.title.toLowerCase();
      if (!lower.some((t) => h.includes(t))) continue;
      const hit = titles.filter((t) => headlineNames(art.title, t)).sort((x, y) => y.length - x.length)[0];
      if (hit) pairs.push({ articleId: art.id, animeId: a.id, hit });
    }
  }
  if (pairs.length === 0) return { linked, queued };

  // Existing links (incl. ones an admin rejected) and earlier review items are left alone.
  const pairAnime = [...new Set(pairs.map((p) => p.animeId))];
  const pairArticles = [...new Set(pairs.map((p) => p.articleId))];
  const hits = [...new Set(pairs.map((p) => p.hit))];
  const [existing, reviewed, sharedRows] = await Promise.all([
    prisma.newsArticleAnime.findMany({ where: { animeId: { in: pairAnime }, articleId: { in: pairArticles } }, select: { articleId: true, animeId: true } }),
    prisma.newsReviewQueue.findMany({
      where: { entityType: 'ANIME', matchedEntityId: { in: pairAnime }, articleId: { in: pairArticles } },
      select: { articleId: true, matchedEntityId: true },
    }),
    // Titles another anime also uses are ambiguous → review queue.
    prisma.$queryRaw<{ t: string; n: number }[]>`
      SELECT lower(x.t) AS t, count(DISTINCT x.id)::int AS n FROM (
        SELECT a.id, a."canonicalTitle" AS t FROM "Anime" a WHERE lower(a."canonicalTitle") = ANY(${hits.map((h) => h.toLowerCase())})
        UNION ALL
        SELECT t."animeId", t.title FROM "AnimeTitle" t WHERE lower(t.title) = ANY(${hits.map((h) => h.toLowerCase())})
      ) x GROUP BY 1`,
  ]);
  const skip = new Set([...existing.map((e) => `${e.articleId}|${e.animeId}`), ...reviewed.map((r) => `${r.articleId}|${r.matchedEntityId}`)]);
  const usedBy = new Map(sharedRows.map((r) => [r.t, r.n]));

  const confirmed: { articleId: string; animeId: string }[] = [];
  const review: { articleId: string; animeId: string; hit: string }[] = [];
  for (const p of pairs) {
    if (skip.has(`${p.articleId}|${p.animeId}`)) continue;
    const ambiguous = (usedBy.get(p.hit.toLowerCase()) ?? 1) > 1;
    const confident = !ambiguous && p.hit.length >= 12 && p.hit.split(/\s+/).length >= 2;
    (confident ? confirmed : review).push(p);
  }
  if (confirmed.length) {
    const r = await prisma.newsArticleAnime.createMany({
      data: confirmed.map((c) => ({ articleId: c.articleId, animeId: c.animeId, confidenceScore: 0.95, matchMethod: 'EXACT_TITLE', status: 'CONFIRMED', relationType: 'PRIMARY' })),
      skipDuplicates: true,
    });
    linked = r.count;
  }
  if (review.length) {
    await prisma.newsReviewQueue.createMany({
      data: review.map((c) => ({ articleId: c.articleId, entityType: 'ANIME', entityName: c.hit, matchedEntityId: c.animeId, confidenceScore: 0.7 })),
    });
    queued = review.length;
  }
  return { linked, queued };
}

// ── Background freshness (same pattern as ensureFreshSchedule) ─────────────

const REFRESH_INTERVAL_MS = Number(process.env.ANNOUNCED_REFRESH_INTERVAL_MS) || 3 * 60 * 60 * 1000;
const RETRY_BACKOFF_MS = 15 * 60 * 1000;
let lastAttemptAt = 0;
let inFlight = false;

/**
 * Called from pages/routes that show announcements: starts a sync in the
 * background when the last run is older than the interval, and returns at
 * once — a request never waits on AniList.
 */
export function ensureFreshAnnouncements(): void {
  if (process.env.NODE_ENV === 'test') return;
  const now = Date.now();
  if (inFlight || now - lastAttemptAt < RETRY_BACKOFF_MS) return;
  inFlight = true;
  lastAttemptAt = now;
  (async () => {
    const state = await getAnnouncementSyncState();
    if (state.running) return;
    if (state.lastRunAt && now - new Date(state.lastRunAt).getTime() < REFRESH_INTERVAL_MS) return;
    await syncAnnouncedAnime({ pages: 3, maxNew: 40, maxRefresh: 20 });
  })()
    .catch((err: unknown) => logger.warn('announced refresh failed', { error: err instanceof Error ? err.message : String(err) }))
    .finally(() => {
      inFlight = false;
    });
}
