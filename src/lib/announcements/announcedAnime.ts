/**
 * The Announced section (2026-11-01): anime that have been announced but
 * haven't premiered yet, newest announcement first.
 *
 * "Newest" uses AniList ids: AniList creates an entry when a show is
 * announced, so a higher id is a later announcement. Anime an admin added by
 * hand (no AniList id) in the last 30 days lead the list. We never invent an
 * announcement date: a card shows when the first linked news story reported
 * it, or nothing.
 *
 * Kept off this list: adult titles, music videos, and "Not yet aired" rows
 * whose exact premiere date has already passed (stale status, not an
 * announcement any more).
 *
 * Every field comes from stored rows; missing facts stay missing.
 */

import { Prisma } from '@prisma/client';
import { prisma } from '../prisma';
import { resolveMediaUrl } from '../mediaResolver';
import { sanitizePublicEntityName } from '../normalizers';

export type AnnouncedStudio = { id: string; slug: string | null; name: string; logoUrl: string | null; isMain: boolean };

export type AnnouncedAnime = {
  id: string;
  slug: string;
  title: string;
  englishTitle: string | null;
  nativeTitle: string | null;
  posterUrl: string | null;
  bannerUrl: string | null;
  trailerUrl: string | null;
  type: string;
  source: string | null;
  episodes: number | null;
  duration: string | null;
  /** "Apr 12, 2027", "Apr 2027", "Spring 2027", "2027" — or null (date not announced). */
  premiere: string | null;
  /** ISO date only when the day is known (for countdowns). */
  premiereDate: string | null;
  synopsis: string | null;
  genres: string[];
  studios: AnnouncedStudio[];
  /** "Sequel to …" / "Side story of …", from stored relations. */
  continues: { label: string; slug: string; title: string } | null;
  hyped: number;
  news: { count: number; latest: { slug: string; title: string; sourceName: string; publishedAt: string } | null };
  /** When the story was first reported (earliest linked news), else null. */
  reportedAt: string | null;
  /** First appeared on OTAKUVA within the last 7 days. */
  isNew: boolean;
  firstSeenAt: string;
};

export type AnnouncedQuery = {
  limit?: number;
  offset?: number;
  /** Only anime this studio is credited on. */
  studioId?: string;
  /** TV | Movie | ONA | OVA | Special */
  format?: string;
};

export const ANNOUNCED_FORMATS = ['TV', 'Movie', 'ONA', 'OVA', 'Special'] as const;

const MAX_LIMIT = 60;
const NEW_FOR_MS = 7 * 86_400_000;
const PLACEHOLDER_SYNOPSIS = new Set(['no synopsis available.', 'no synopsis available', '']);
const MONTH = new Intl.DateTimeFormat('en-US', { month: 'short', year: 'numeric', timeZone: 'UTC' });
const DAY = new Intl.DateTimeFormat('en-US', { month: 'short', day: 'numeric', year: 'numeric', timeZone: 'UTC' });

/** SQL condition for "announced, not premiered yet" on alias `a`. */
function announcedWhere(q: AnnouncedQuery): Prisma.Sql {
  const conds: Prisma.Sql[] = [
    Prisma.sql`(lower(replace(a.status, '_', ' ')) LIKE '%not yet%' OR lower(a.status) = 'upcoming')`,
    Prisma.sql`a."isAdult" = false`,
    Prisma.sql`a.type <> 'Music'`,
    Prisma.sql`NOT (a."datePrecision" = 'DAY' AND a."startDate" IS NOT NULL AND a."startDate" < now() - interval '1 day')`,
  ];
  if (q.studioId) conds.push(Prisma.sql`EXISTS (SELECT 1 FROM "AnimeStudio" s WHERE s."animeId" = a.id AND s."studioId" = ${q.studioId})`);
  if (q.format && (ANNOUNCED_FORMATS as readonly string[]).includes(q.format)) conds.push(Prisma.sql`a.type = ${q.format}`);
  return Prisma.join(conds, ' AND ');
}

export async function countAnnouncedAnime(q: AnnouncedQuery = {}): Promise<number> {
  const rows = await prisma.$queryRaw<{ c: number }[]>`SELECT count(*)::int AS c FROM "Anime" a WHERE ${announcedWhere(q)}`;
  return rows[0]?.c ?? 0;
}

/** Format counts for the filter chips (only formats that have anything). */
export async function announcedFormatCounts(): Promise<{ format: string; count: number }[]> {
  const rows = await prisma.$queryRaw<{ format: string; c: number }[]>`
    SELECT a.type AS format, count(*)::int AS c FROM "Anime" a WHERE ${announcedWhere({})} GROUP BY 1 ORDER BY 2 DESC`;
  return rows.filter((r) => (ANNOUNCED_FORMATS as readonly string[]).includes(r.format)).map((r) => ({ format: r.format, count: r.c }));
}

function premiereLabel(a: {
  startDate: Date | null;
  datePrecision: string;
  startYear: number | null;
  startMonth: number | null;
  season: string | null;
  seasonYear: number | null;
  year: number | null;
}): { label: string | null; day: string | null } {
  if (a.startDate && a.datePrecision === 'DAY') return { label: DAY.format(a.startDate), day: a.startDate.toISOString() };
  if (a.startYear && a.startMonth) return { label: MONTH.format(new Date(Date.UTC(a.startYear, a.startMonth - 1, 1))), day: null };
  const sy = a.seasonYear ?? a.year ?? a.startYear;
  if (a.season && sy) return { label: `${a.season.charAt(0).toUpperCase()}${a.season.slice(1).toLowerCase()} ${sy}`, day: null };
  if (a.startYear ?? a.year) return { label: String(a.startYear ?? a.year), day: null };
  return { label: null, day: null };
}

// Stored relations read either way round: this anime → its prequel, or the
// earlier anime → this one as its sequel (see INVERSE_RELATION in animeData).
const CONTINUES: Record<string, string> = { Prequel: 'Sequel to', PREQUEL: 'Sequel to', 'Parent story': 'Side story of' };
const CONTINUED_BY: Record<string, string> = { Sequel: 'Sequel to', SEQUEL: 'Sequel to', 'Side story': 'Side story of' };

export async function getAnnouncedAnime(q: AnnouncedQuery = {}): Promise<AnnouncedAnime[]> {
  const limit = Math.min(Math.max(1, Math.floor(q.limit ?? 24)), MAX_LIMIT);
  const offset = Math.max(0, Math.floor(q.offset ?? 0));
  const idRows = await prisma.$queryRaw<{ id: string }[]>`
    SELECT a.id FROM "Anime" a
    WHERE ${announcedWhere(q)}
    ORDER BY CASE WHEN a."anilistId" IS NULL AND a."firstImportedAt" > now() - interval '30 days' THEN 0 ELSE 1 END,
             a."anilistId" DESC NULLS LAST, a."firstImportedAt" DESC, a.id
    LIMIT ${limit} OFFSET ${offset}`;
  const ids = idRows.map((r) => r.id);
  if (ids.length === 0) return [];

  const [rows, hype, news] = await Promise.all([
    prisma.anime.findMany({
      where: { id: { in: ids } },
      select: {
        id: true,
        slug: true,
        canonicalTitle: true,
        posterUrl: true,
        largePosterUrl: true,
        bannerUrl: true,
        trailerUrl: true,
        type: true,
        source: true,
        episodes: true,
        duration: true,
        synopsis: true,
        startDate: true,
        datePrecision: true,
        startYear: true,
        startMonth: true,
        season: true,
        seasonYear: true,
        year: true,
        firstImportedAt: true,
        titles: { where: { type: { in: ['english', 'japanese'] } }, select: { type: true, title: true } },
        animeGenres: { select: { genre: { select: { name: true } } }, take: 4 },
        animeStudios: {
          select: {
            isMain: true,
            studio: { select: { id: true, slug: true, name: true, adminOverrideName: true, imageUrl: true, adminOverrideImageUrl: true } },
          },
        },
        relationsFrom: {
          where: { relationType: { in: Object.keys(CONTINUES) } },
          select: { relationType: true, targetAnime: { select: { slug: true, canonicalTitle: true, isAdult: true } } },
          take: 3,
        },
        relationsTo: {
          where: { relationType: { in: Object.keys(CONTINUED_BY) } },
          select: { relationType: true, sourceAnime: { select: { slug: true, canonicalTitle: true, isAdult: true } } },
          take: 3,
        },
      },
    }),
    prisma.animeHype.groupBy({ by: ['animeId'], where: { animeId: { in: ids }, level: 'HYPED' }, _count: { _all: true } }),
    prisma.newsArticleAnime.findMany({
      where: {
        animeId: { in: ids },
        status: 'CONFIRMED',
        article: { status: 'PUBLISHED', deletedAt: null },
      },
      select: { animeId: true, article: { select: { slug: true, title: true, adminOverrideTitle: true, sourceName: true, publishedAt: true } } },
      orderBy: { article: { publishedAt: 'desc' } },
    }),
  ]);

  const hypeBy = new Map(hype.map((h) => [h.animeId, h._count._all]));
  const newsBy = new Map<string, typeof news>();
  for (const n of news) {
    const list = newsBy.get(n.animeId) ?? [];
    list.push(n);
    newsBy.set(n.animeId, list);
  }
  const byId = new Map(rows.map((r) => [r.id, r]));
  const now = Date.now();

  return ids
    .map((id) => byId.get(id))
    .filter((a): a is NonNullable<typeof a> => Boolean(a))
    .map((a) => {
      const english = a.titles.find((t) => t.type === 'english')?.title ?? null;
      const native = a.titles.find((t) => t.type === 'japanese')?.title ?? null;
      const { label, day } = premiereLabel(a);
      const synopsis = a.synopsis && !PLACEHOLDER_SYNOPSIS.has(a.synopsis.trim().toLowerCase()) ? a.synopsis.trim() : null;
      const fwd = a.relationsFrom.find((r) => !r.targetAnime.isAdult);
      const back = a.relationsTo.find((r) => !r.sourceAnime.isAdult);
      const continues = fwd
        ? { label: CONTINUES[fwd.relationType], slug: fwd.targetAnime.slug, title: fwd.targetAnime.canonicalTitle }
        : back
          ? { label: CONTINUED_BY[back.relationType], slug: back.sourceAnime.slug, title: back.sourceAnime.canonicalTitle }
          : null;
      const articles = newsBy.get(a.id) ?? [];
      const latest = articles[0];
      const earliest = articles[articles.length - 1];
      const studios = a.animeStudios
        .map((s) => {
          const logo = s.studio.adminOverrideImageUrl || s.studio.imageUrl;
          return {
            id: s.studio.id,
            slug: s.studio.slug,
            name: sanitizePublicEntityName(s.studio.adminOverrideName || s.studio.name) || s.studio.name,
            logoUrl: logo ? resolveMediaUrl(logo) || logo : null,
            isMain: s.isMain,
          };
        })
        .sort((x, y) => Number(y.isMain) - Number(x.isMain));
      return {
        id: a.id,
        slug: a.slug,
        title: a.canonicalTitle,
        englishTitle: english && english !== a.canonicalTitle ? english : null,
        nativeTitle: native,
        posterUrl: a.largePosterUrl || a.posterUrl || null,
        bannerUrl: a.bannerUrl || null,
        trailerUrl: a.trailerUrl || null,
        type: a.type,
        source: a.source,
        episodes: a.episodes,
        duration: a.duration,
        premiere: label,
        premiereDate: day,
        synopsis,
        genres: a.animeGenres.map((g) => g.genre.name),
        studios,
        continues,
        hyped: hypeBy.get(a.id) ?? 0,
        news: {
          count: articles.length,
          latest: latest
            ? {
                slug: latest.article.slug,
                title: latest.article.adminOverrideTitle || latest.article.title,
                sourceName: latest.article.sourceName,
                publishedAt: latest.article.publishedAt.toISOString(),
              }
            : null,
        },
        reportedAt: earliest ? earliest.article.publishedAt.toISOString() : null,
        isNew: now - a.firstImportedAt.getTime() < NEW_FOR_MS,
        firstSeenAt: a.firstImportedAt.toISOString(),
      };
    });
}
