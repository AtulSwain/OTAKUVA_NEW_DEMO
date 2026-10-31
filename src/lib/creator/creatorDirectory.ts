/**
 * Creators on the homepage: every creator account, with their latest review
 * and three most recently retention-rated anime, plus a feed of what
 * creators recently did — rated an anime, published a Creator Review, or
 * got hyped for an upcoming one. Public data only (ratings, published
 * reviews and hype are already public); nothing is invented — no creators
 * means the section doesn't render.
 */
import { Prisma } from '@prisma/client';
import { unstable_cache } from 'next/cache';
import { prisma } from '../prisma';
import { resolveAvatarUrl } from '../mediaResolver';
import { getAnimeDisplayTitle } from '../animeTitleResolver';

export interface CreatorCard {
  username: string;
  displayName: string | null;
  channelName: string | null;
  avatarUrl: string | null;
  followerCount: number;
  /** When they last rated / reviewed / hyped anything (drives the "new" ring). */
  lastActiveAt: string | null;
  latestActivity: 'JOINED' | 'RATED' | 'REVIEWED' | 'HYPED' | null;
  isOnline: boolean;
  ratedAnime: Array<{ id: string; slug: string; title: string; posterUrl: string | null }>;
  latestReview: {
    id: string;
    title: string;
    excerpt: string | null;
    animeSlug: string;
    animeTitle: string;
  } | null;
}

export interface CreatorFeedItem {
  kind: 'JOINED' | 'RATED' | 'REVIEWED' | 'HYPED';
  at: string;
  creator: { username: string; name: string; avatarUrl: string | null };
  anime: { id: string; slug: string; title: string; posterUrl: string | null } | null;
  score: number | null;
  review: { id: string; title: string; excerpt: string | null } | null;
}

export interface CreatorDirectoryData {
  creators: CreatorCard[];
  feed: CreatorFeedItem[];
}

const ANIME = { select: { id: true, slug: true, canonicalTitle: true, posterUrl: true, titles: true, isAdult: true } } as const;
const USER = { select: { id: true, username: true, displayName: true, avatarUrl: true, creatorChannelName: true } } as const;
const NEW_CREATOR_WINDOW_MS = 30 * 24 * 60 * 60 * 1000;
const ONLINE_WINDOW_MS = 7 * 60 * 1000;

function reviewExcerpt(body: string) {
  const text = body.replace(/\s+/g, ' ').trim();
  return text.length > 110 ? `${text.slice(0, 109).trimEnd()}…` : text;
}

async function buildCreatorDirectory(opts: { limit?: number; feedLimit?: number } = {}): Promise<CreatorDirectoryData> {
  const limit = opts.limit == null ? Number.POSITIVE_INFINITY : Math.min(Math.max(opts.limit, 1), 500);
  const feedLimit = Math.min(Math.max(opts.feedLimit ?? 8, 0), 30);
  const creatorOnly = { role: 'CREATOR' };

  const creators = await prisma.user.findMany({
    where: creatorOnly,
    select: {
      id: true,
      username: true,
      displayName: true,
      avatarUrl: true,
      creatorChannelName: true,
      creatorSince: true,
      lastSeenAt: true,
    },
  });
  if (creators.length === 0) return { creators: [] as CreatorCard[], feed: [] as CreatorFeedItem[] };
  const ids = creators.map((c) => c.id);
  const creatorById = new Map(creators.map((creator) => [creator.id, creator]));

  const [followerCounts, recentRatings, reviews, hypes] = await Promise.all([
    prisma.follow.groupBy({ by: ['followingId'], where: { followingId: { in: ids } }, _count: { _all: true } }),
    prisma.$queryRaw<Array<{ userId: string; updatedAt: Date; id: string; slug: string; canonicalTitle: string; posterUrl: string | null }>>`
      SELECT recent."userId", recent."updatedAt", recent.id, recent.slug,
        recent."canonicalTitle", recent."posterUrl"
      FROM "User" creator
      CROSS JOIN LATERAL (
        SELECT er."userId", MAX(er."updatedAt") AS "updatedAt",
          a.id, a.slug, a."canonicalTitle", a."posterUrl"
        FROM "EpisodeRating" er
        JOIN "Anime" a ON a.id = er."animeId" AND a."isAdult" = false
        WHERE er."userId" = creator.id
          AND er.retention BETWEEN 1 AND 100
        GROUP BY er."userId", a.id, a.slug, a."canonicalTitle", a."posterUrl"
        ORDER BY MAX(er."updatedAt") DESC, a.id DESC
        LIMIT 3
      ) recent
      WHERE creator.id IN (${Prisma.join(ids)})
      ORDER BY recent."userId", recent."updatedAt" DESC, recent.id DESC
    `,
    prisma.$queryRaw<Array<{
      userId: string;
      id: string;
      reviewTitle: string;
      body: string;
      spoilerLevel: string;
      containsSpoiler: boolean;
      createdAt: Date;
      animeId: string;
      slug: string;
      canonicalTitle: string;
      posterUrl: string | null;
    }>>`
      SELECT recent."userId", recent.id, recent."reviewTitle", recent.body,
        recent."spoilerLevel", recent."containsSpoiler", recent."createdAt",
        recent."animeId", recent.slug, recent."canonicalTitle", recent."posterUrl"
      FROM "User" creator
      CROSS JOIN LATERAL (
        SELECT r."userId", r.id, r.title AS "reviewTitle", LEFT(r.body, 256) AS body,
          r."spoilerLevel", r."containsSpoiler", r."createdAt",
          a.id AS "animeId", a.slug, a."canonicalTitle", a."posterUrl"
        FROM "Review" r
        JOIN "Anime" a ON a.id = r."animeId" AND a."isAdult" = false
        WHERE r."userId" = creator.id
          AND r.status = 'PUBLISHED'
          AND r."deletedAt" IS NULL
          AND r."isCreatorReview" = true
        ORDER BY r."createdAt" DESC, r.id DESC
        LIMIT 1
      ) recent
      WHERE creator.id IN (${Prisma.join(ids)})
    `,
    prisma.animeHype.findMany({
      where: { userId: { in: ids }, level: 'HYPED', anime: { isAdult: false } },
      orderBy: { createdAt: 'desc' },
      take: 30,
      select: { createdAt: true, user: USER, anime: ANIME },
    }),
  ]);

  const followers = new Map(followerCounts.map((f) => [f.followingId, f._count._all]));
  const reviewByCreator = new Map(reviews.map((review) => [review.userId, review]));
  const ratedAnimeByCreator = new Map<string, CreatorCard['ratedAnime']>();
  recentRatings.forEach((rating) => {
    const anime = ratedAnimeByCreator.get(rating.userId) ?? [];
    anime.push({
      id: rating.id,
      slug: rating.slug,
      title: getAnimeDisplayTitle(rating as any),
      posterUrl: rating.posterUrl,
    });
    ratedAnimeByCreator.set(rating.userId, anime);
  });
  const lastActivity = new Map<string, { at: Date; kind: CreatorCard['latestActivity'] }>();
  const bump = (id: string, at: Date, kind: NonNullable<CreatorCard['latestActivity']>) => {
    const prev = lastActivity.get(id);
    if (!prev || at > prev.at) lastActivity.set(id, { at, kind });
  };
  creators.forEach((c) => {
    if (c.creatorSince) bump(c.id, c.creatorSince, 'JOINED');
  });
  recentRatings.forEach((r) => bump(r.userId, r.updatedAt, 'RATED'));
  reviews.forEach((r) => bump(r.userId, r.createdAt, 'REVIEWED'));
  hypes.forEach((h) => bump(h.user.id, h.createdAt, 'HYPED'));

  const cards: CreatorCard[] = creators
    .map((c) => ({
      username: c.username,
      displayName: c.displayName,
      channelName: c.creatorChannelName,
      avatarUrl: resolveAvatarUrl(c.avatarUrl),
      followerCount: followers.get(c.id) ?? 0,
      lastActiveAt: lastActivity.get(c.id)?.at.toISOString() ?? null,
      latestActivity: lastActivity.get(c.id)?.kind ?? null,
      isOnline: Boolean(c.lastSeenAt && Date.now() - c.lastSeenAt.getTime() <= ONLINE_WINDOW_MS),
      ratedAnime: ratedAnimeByCreator.get(c.id) ?? [],
      latestReview: (() => {
        const review = reviewByCreator.get(c.id);
        if (!review) return null;
        return {
          id: review.id,
          title: review.reviewTitle,
          excerpt: review.spoilerLevel === 'SPOILER_FREE' && !review.containsSpoiler ? reviewExcerpt(review.body) : null,
          animeSlug: review.slug,
          animeTitle: getAnimeDisplayTitle(review as any),
        };
      })(),
    }))
    .sort((a, b) => b.followerCount - a.followerCount || (b.lastActiveAt ?? '').localeCompare(a.lastActiveAt ?? '') || a.username.localeCompare(b.username))
    .slice(0, limit);

  type U = { username: string; displayName: string | null; avatarUrl: string | null; creatorChannelName: string | null };
  type A = { id: string; slug: string; canonicalTitle: string; posterUrl: string | null; titles?: unknown };
  const who = (u: U) => ({ username: u.username, name: u.creatorChannelName || u.displayName || u.username, avatarUrl: resolveAvatarUrl(u.avatarUrl) });
  const what = (a: A) => ({ id: a.id, slug: a.slug, title: getAnimeDisplayTitle(a as any), posterUrl: a.posterUrl || null });
  // A review already shows its score — skip the matching rating row.
  const reviewed = new Set(reviews.map((r) => {
    const creator = creatorById.get(r.userId);
    return creator ? `${creator.username}|${r.slug}` : '';
  }));

  const feed: CreatorFeedItem[] = [
    ...creators
      .filter((c) => c.creatorSince && Date.now() - c.creatorSince.getTime() <= NEW_CREATOR_WINDOW_MS)
      .map((c) => ({
        kind: 'JOINED' as const,
        at: c.creatorSince!.toISOString(),
        creator: who(c),
        anime: null,
        score: null,
        review: null,
      })),
    ...reviews.map((r) => {
      const creator = creatorById.get(r.userId)!;
      return {
      kind: 'REVIEWED' as const,
      at: r.createdAt.toISOString(),
      creator: who(creator),
      anime: what(r),
      score: null,
      review: {
        id: r.id,
        title: r.reviewTitle,
        excerpt: r.spoilerLevel === 'SPOILER_FREE' && !r.containsSpoiler ? reviewExcerpt(r.body) : null,
      },
    };
    }),
    ...recentRatings
      .filter((r) => {
        const creator = creatorById.get(r.userId);
        return creator && !reviewed.has(`${creator.username}|${r.slug}`);
      })
      .map((r) => {
        const creator = creatorById.get(r.userId)!;
        return {
          kind: 'RATED' as const,
          at: r.updatedAt.toISOString(),
          creator: who(creator),
          anime: what(r),
          score: null,
          review: null,
        };
      }),
    ...hypes.map((h) => ({ kind: 'HYPED' as const, at: h.createdAt.toISOString(), creator: who(h.user), anime: what(h.anime), score: null, review: null })),
  ]
    .sort((a, b) => b.at.localeCompare(a.at))
    .slice(0, feedLimit);

  return { creators: cards, feed };
}

export async function getCreatorDirectory(opts: { limit?: number; feedLimit?: number } = {}) {
  return buildCreatorDirectory(opts);
}

export async function getCachedCreatorDirectory(opts: { limit?: number; feedLimit?: number } = {}) {
  if (process.env.NODE_ENV === 'test') return getCreatorDirectory(opts);
  const limit = opts.limit ?? 0;
  const feedLimit = Math.min(Math.max(opts.feedLimit ?? 8, 0), 30);
  const load = unstable_cache(
    () => buildCreatorDirectory({ limit: limit || undefined, feedLimit }),
    ['creator-directory-v1', String(limit), String(feedLimit)],
    { revalidate: 30, tags: ['creator-directory'] },
  );
  return load();
}

export async function getFollowedCreatorUsernames(userId: string) {
  const follows = await prisma.follow.findMany({
    where: { followerId: userId, following: { role: 'CREATOR' } },
    select: { following: { select: { username: true } } },
  });
  return follows.map((follow) => follow.following.username);
}
