/**
 * "Following" feed (2026-11-06): what the people you follow have published
 * lately — reviews, articles, public collections and discussions — newest
 * first. Only things anyone could already see on their profile: published
 * reviews (spoiler ones show no text), published articles, PUBLIC non-empty
 * collections, and threads outside private communities (unless the viewer
 * belongs there — same `readableDiscussionsFilter` as everywhere).
 */
import { prisma } from '../prisma';
import { readableDiscussionsFilter } from '../engine/community/communityEngine';

export type FollowingFeedKind = 'REVIEW' | 'ARTICLE' | 'COLLECTION' | 'DISCUSSION';

export interface FollowingFeedItem {
  id: string;
  kind: FollowingFeedKind;
  at: string;
  user: { username: string; displayName: string | null; avatarUrl: string | null };
  title: string;
  /** Short text: the review/article opening. Null for spoiler reviews. */
  excerpt: string | null;
  href: string;
  anime: { slug: string; title: string; posterUrl: string | null } | null;
  spoiler?: boolean;
}

const USER = { select: { username: true, displayName: true, avatarUrl: true } } as const;
const ANIME = { select: { slug: true, canonicalTitle: true, posterUrl: true } } as const;

const cut = (s: string | null | undefined, n = 220) => {
  const t = (s || '').replace(/\s+/g, ' ').trim();
  return t ? (t.length > n ? `${t.slice(0, n - 1).trimEnd()}…` : t) : null;
};

const animeOf = (a: { slug: string | null; canonicalTitle: string; posterUrl: string | null } | null | undefined) =>
  a?.slug ? { slug: a.slug, title: a.canonicalTitle, posterUrl: a.posterUrl } : null;

export async function getFollowingFeed(
  viewerId: string,
  opts: { before?: Date | null; limit?: number } = {}
): Promise<{ items: FollowingFeedItem[]; nextCursor: string | null; followingCount: number }> {
  const limit = Math.min(Math.max(opts.limit ?? 30, 1), 60);
  const follows = await prisma.follow.findMany({ where: { followerId: viewerId }, select: { followingId: true } });
  const ids = follows.map((f) => f.followingId);
  if (!ids.length) return { items: [], nextCursor: null, followingCount: 0 };
  const before = opts.before ?? undefined;

  const [reviews, articles, collections, discussions] = await Promise.all([
    prisma.review.findMany({
      where: { userId: { in: ids }, status: 'PUBLISHED', deletedAt: null, ...(before ? { createdAt: { lt: before } } : {}) },
      orderBy: { createdAt: 'desc' },
      take: limit,
      select: { id: true, title: true, body: true, spoilerLevel: true, createdAt: true, user: USER, anime: ANIME },
    }),
    prisma.userArticle.findMany({
      where: { authorId: { in: ids }, status: 'PUBLISHED', deletedAt: null, ...(before ? { createdAt: { lt: before } } : {}) },
      orderBy: { createdAt: 'desc' },
      take: limit,
      select: { id: true, slug: true, title: true, summary: true, body: true, createdAt: true, author: USER, anime: ANIME },
    }),
    prisma.userList.findMany({
      where: {
        userId: { in: ids },
        visibility: 'PUBLIC',
        shareToken: { not: null },
        items: { some: {} },
        ...(before ? { createdAt: { lt: before } } : {}),
      },
      orderBy: { createdAt: 'desc' },
      take: limit,
      select: { id: true, name: true, description: true, shareToken: true, createdAt: true, user: USER, _count: { select: { items: true } } },
    }),
    prisma.discussion.findMany({
      where: {
        authorId: { in: ids },
        status: { notIn: ['HIDDEN', 'REMOVED', 'DELETED'] },
        ...readableDiscussionsFilter(viewerId),
        ...(before ? { createdAt: { lt: before } } : {}),
      },
      orderBy: { createdAt: 'desc' },
      take: limit,
      select: { id: true, title: true, body: true, createdAt: true, author: USER, anime: ANIME },
    }),
  ]);

  const items: FollowingFeedItem[] = [
    ...reviews.map((r) => {
      const spoiler = Boolean(r.spoilerLevel && r.spoilerLevel !== 'SPOILER_FREE');
      return {
        id: `review:${r.id}`,
        kind: 'REVIEW' as const,
        at: r.createdAt.toISOString(),
        user: r.user,
        title: r.title || (r.anime ? `Reviewed ${r.anime.canonicalTitle}` : 'Wrote a review'),
        excerpt: spoiler ? null : cut(r.body),
        href: r.anime?.slug ? `/anime/${r.anime.slug}#review-${r.id}` : '#',
        anime: animeOf(r.anime),
        spoiler,
      };
    }),
    ...articles.map((a) => ({
      id: `article:${a.id}`,
      kind: 'ARTICLE' as const,
      at: a.createdAt.toISOString(),
      user: a.author,
      title: a.title,
      excerpt: cut(a.summary || a.body),
      href: `/articles/${a.slug}`,
      anime: animeOf(a.anime),
    })),
    ...collections.map((l) => ({
      id: `collection:${l.id}`,
      kind: 'COLLECTION' as const,
      at: l.createdAt.toISOString(),
      user: l.user,
      title: l.name,
      excerpt: cut(l.description) ?? `${l._count.items} anime`,
      href: `/l/${l.shareToken}`,
      anime: null,
    })),
    ...discussions.map((d) => ({
      id: `discussion:${d.id}`,
      kind: 'DISCUSSION' as const,
      at: d.createdAt.toISOString(),
      user: d.author,
      title: d.title,
      excerpt: cut(d.body),
      href: `/discussions/${d.id}`,
      anime: animeOf(d.anime),
    })),
  ]
    .sort((a, b) => (a.at < b.at ? 1 : a.at > b.at ? -1 : 0))
    .slice(0, limit);

  // Each source returned up to `limit` rows, so a full page means more may exist.
  const nextCursor = items.length === limit ? items[items.length - 1].at : null;
  return { items, nextCursor, followingCount: ids.length };
}
