import crypto from 'node:crypto';
import { prisma } from '../prisma';
import { notifyFollowersOfCollection } from '../social/followService';
import { sanitizePublicEntityName } from '../normalizers';
import { isWideBanner } from '../media/heroArt';

/**
 * Custom lists ("libraries" a user builds, like playlists): a named folder
 * of anime that's private by default and can be shared by link.
 *
 * Visibility:
 *   PRIVATE — only the owner (default for new lists)
 *   LINK    — anyone with the share link (/l/<shareToken>); not listed anywhere
 *   PUBLIC  — anyone with the link, and listed on the owner's profile
 * (FOLLOWERS_ONLY is a legacy value; it's treated as private here.)
 *
 * Share links use a random token, never the list id. Making a list PRIVATE
 * clears the token, so an old link stops working; sharing again issues a new
 * one.
 *
 * Collections (2026-10-22): the same lists, presented as "collections" with a
 * banner: the owner's uploaded image (MediaAsset LIST_BANNER, theirs only)
 * or the AniList banner of one of its anime. PUBLIC collections are listed on
 * the homepage and /collections (getPublicCollections).
 */
export const LIST_VISIBILITIES = ['PRIVATE', 'LINK', 'PUBLIC'] as const;
export type ListVisibility = (typeof LIST_VISIBILITIES)[number];

export const MAX_LISTS_PER_USER = 100;
export const MAX_ITEMS_PER_LIST = 500;
export const MAX_NAME_LENGTH = 60;
export const MAX_DESCRIPTION_LENGTH = 500;

export class ListError extends Error {
  constructor(public readonly status: number, message: string, public readonly code?: string) {
    super(message);
  }
}

const isShared = (visibility: string) => visibility === 'LINK' || visibility === 'PUBLIC';
const newShareToken = () => crypto.randomBytes(16).toString('base64url');

export function parseVisibility(value: unknown): ListVisibility | null {
  return typeof value === 'string' && (LIST_VISIBILITIES as readonly string[]).includes(value) ? (value as ListVisibility) : null;
}

function cleanName(value: unknown): string {
  if (typeof value !== 'string' || !value.trim()) throw new ListError(400, 'Give the list a name.', 'NAME_REQUIRED');
  const name = value.trim().replace(/\s+/g, ' ');
  if (name.length > MAX_NAME_LENGTH) throw new ListError(400, `List names can be at most ${MAX_NAME_LENGTH} characters.`, 'NAME_TOO_LONG');
  return name;
}

function cleanDescription(value: unknown): string | null {
  if (value === undefined || value === null) return null;
  if (typeof value !== 'string') throw new ListError(400, 'Description must be text.');
  const d = value.trim();
  if (d.length > MAX_DESCRIPTION_LENGTH) throw new ListError(400, `Descriptions can be at most ${MAX_DESCRIPTION_LENGTH} characters.`, 'DESCRIPTION_TOO_LONG');
  return d || null;
}

async function resolveAnimeId(idOrSlug: unknown): Promise<string> {
  if (typeof idOrSlug !== 'string' || !idOrSlug.trim()) throw new ListError(400, 'Missing anime.', 'ANIME_REQUIRED');
  const anime = await prisma.anime.findFirst({
    where: { OR: [{ id: idOrSlug }, { slug: idOrSlug }], status: { not: 'MERGED' } },
    select: { id: true },
  });
  if (!anime) throw new ListError(404, 'Anime not found.', 'ANIME_NOT_FOUND');
  return anime.id;
}

async function requireOwnedList(userId: string, listId: string) {
  const list = await prisma.userList.findUnique({ where: { id: listId }, select: { id: true, userId: true, visibility: true, shareToken: true } });
  // Same response whether the list doesn't exist or belongs to someone else.
  if (!list || list.userId !== userId) throw new ListError(404, 'List not found.', 'LIST_NOT_FOUND');
  return list;
}

export interface ListSummary {
  id: string;
  name: string;
  description: string | null;
  visibility: ListVisibility;
  shareToken: string | null;
  count: number;
  /** Up to four posters for the folder cover, in list order. */
  covers: string[];
  /** Chosen banner, else the first wide AniList banner among its anime, else null. */
  bannerUrl: string | null;
  updatedAt: string;
  /** Only set when asked about a specific anime (the "add to list" picker). */
  containsAnime?: boolean;
}

const asVisibility = (v: string): ListVisibility => (v === 'LINK' || v === 'PUBLIC' ? v : 'PRIVATE');

export async function getMyLists(userId: string, containsAnimeId?: string): Promise<ListSummary[]> {
  const lists = await prisma.userList.findMany({
    where: { userId },
    orderBy: { updatedAt: 'desc' },
    take: MAX_LISTS_PER_USER,
    select: {
      id: true,
      name: true,
      description: true,
      visibility: true,
      shareToken: true,
      updatedAt: true,
      bannerUrl: true,
      _count: { select: { items: true } },
      items: { orderBy: { position: 'asc' }, take: 4, select: { anime: { select: { posterUrl: true, bannerUrl: true } } } },
    },
  });

  let containing = new Set<string>();
  if (containsAnimeId) {
    const rows = await prisma.userListItem.findMany({
      where: { list: { userId }, anime: { OR: [{ id: containsAnimeId }, { slug: containsAnimeId }] } },
      select: { listId: true },
    });
    containing = new Set(rows.map((r) => r.listId));
  }

  return lists.map((l) => ({
    id: l.id,
    name: l.name,
    description: l.description,
    visibility: asVisibility(l.visibility),
    shareToken: isShared(l.visibility) ? l.shareToken : null,
    count: l._count.items,
    covers: l.items.map((i) => i.anime.posterUrl).filter(Boolean),
    bannerUrl: l.bannerUrl || l.items.map((i) => i.anime.bannerUrl).find(isWideBanner) || null,
    updatedAt: l.updatedAt.toISOString(),
    ...(containsAnimeId ? { containsAnime: containing.has(l.id) } : {}),
  }));
}

export interface ListAnime {
  id: string;
  slug: string;
  title: string;
  posterUrl: string;
  /** The anime's own wide AniList banner, if it has one (banner picker). */
  bannerUrl: string | null;
  year: number | null;
  type: string | null;
  episodes: number | null;
  /** OTAKUVA members' average (null until someone rates it). */
  otakuvaScore: number | null;
  genres: string[];
  addedAt: string;
}

export interface ListDetail {
  id: string;
  name: string;
  description: string | null;
  visibility: ListVisibility;
  shareToken: string | null;
  /** The chosen banner, else the first wide banner among its anime, else null. */
  bannerUrl: string | null;
  /** True when the owner picked/uploaded the banner (vs. derived). */
  bannerChosen: boolean;
  updatedAt: string;
  createdAt: string;
  owner: { username: string; avatarUrl: string | null };
  items: ListAnime[];
}

const detailSelect = {
  id: true,
  name: true,
  description: true,
  visibility: true,
  shareToken: true,
  bannerUrl: true,
  createdAt: true,
  updatedAt: true,
  userId: true,
  user: { select: { username: true, avatarUrl: true } },
  items: {
    orderBy: { position: 'asc' as const },
    take: MAX_ITEMS_PER_LIST,
    select: {
      addedAt: true,
      anime: {
        select: {
          id: true,
          slug: true,
          canonicalTitle: true,
          posterUrl: true,
          bannerUrl: true,
          year: true,
          startYear: true,
          type: true,
          episodes: true,
          status: true,
          ratingAggregate: { select: { rawAverage: true, ratingCount: true } },
          animeGenres: { select: { genre: { select: { name: true } } }, take: 3 },
        },
      },
    },
  },
};

function toDetail(l: any): ListDetail {
  const derived = l.items.map((i: any) => i.anime.bannerUrl).find(isWideBanner) || null;
  return {
    id: l.id,
    name: l.name,
    description: l.description,
    visibility: asVisibility(l.visibility),
    shareToken: isShared(l.visibility) ? l.shareToken : null,
    bannerUrl: l.bannerUrl || derived,
    bannerChosen: Boolean(l.bannerUrl),
    createdAt: l.createdAt.toISOString(),
    updatedAt: l.updatedAt.toISOString(),
    owner: { username: l.user.username, avatarUrl: l.user.avatarUrl },
    items: l.items
      .filter((i: any) => i.anime.status !== 'MERGED')
      .map((i: any) => ({
        id: i.anime.id,
        slug: i.anime.slug,
        title: sanitizePublicEntityName(i.anime.canonicalTitle),
        posterUrl: i.anime.posterUrl,
        bannerUrl: isWideBanner(i.anime.bannerUrl) ? i.anime.bannerUrl : null,
        year: i.anime.year ?? i.anime.startYear ?? null,
        type: i.anime.type || null,
        episodes: i.anime.episodes ?? null,
        otakuvaScore:
          i.anime.ratingAggregate?.ratingCount > 0 && typeof i.anime.ratingAggregate.rawAverage === 'number'
            ? i.anime.ratingAggregate.rawAverage
            : null,
        genres: i.anime.animeGenres.map((g: any) => g.genre.name),
        addedAt: i.addedAt.toISOString(),
      })),
  };
}

/** The owner's view of one list (null if it isn't theirs). */
export async function getListForOwner(userId: string, listId: string): Promise<ListDetail | null> {
  const l = await prisma.userList.findUnique({ where: { id: listId }, select: detailSelect });
  if (!l || l.userId !== userId) return null;
  return toDetail(l);
}

/** The shared view: only lists whose owner shared them (LINK or PUBLIC). */
export async function getSharedList(token: string): Promise<ListDetail | null> {
  if (typeof token !== 'string' || token.length < 16 || token.length > 64) return null;
  const l = await prisma.userList.findUnique({ where: { shareToken: token }, select: detailSelect });
  if (!l || !isShared(l.visibility)) return null;
  return toDetail(l);
}

/**
 * A banner request -> a URL we trust, or null to clear.
 *   { bannerAssetId } an image this user uploaded (POST /api/lists/banner)
 *   { bannerAnimeId } the AniList banner of one of the collection's anime
 *   { banner: null }  clear (fall back to the anime's banners)
 * Anything else is refused; a client-sent URL is never stored as-is.
 */
async function resolveBanner(
  userId: string,
  input: { bannerAssetId?: unknown; bannerAnimeId?: unknown; banner?: unknown },
  animeIdsInCollection: string[]
): Promise<string | null | undefined> {
  if (input.banner === null) return null;
  if (typeof input.bannerAssetId === 'string' && input.bannerAssetId) {
    const asset = await prisma.mediaAsset.findUnique({
      where: { id: input.bannerAssetId },
      select: { userId: true, type: true, storedUrl: true, sourceUrl: true },
    });
    if (!asset || asset.userId !== userId || asset.type !== 'LIST_BANNER') {
      throw new ListError(400, 'That banner image could not be used.', 'INVALID_BANNER');
    }
    return asset.storedUrl || asset.sourceUrl;
  }
  if (typeof input.bannerAnimeId === 'string' && input.bannerAnimeId) {
    const anime = await prisma.anime.findFirst({
      where: { OR: [{ id: input.bannerAnimeId }, { slug: input.bannerAnimeId }] },
      select: { id: true, bannerUrl: true },
    });
    if (!anime || !animeIdsInCollection.includes(anime.id) || !isWideBanner(anime.bannerUrl)) {
      throw new ListError(400, 'Pick a banner from an anime in this collection.', 'INVALID_BANNER');
    }
    return anime.bannerUrl;
  }
  return undefined; // unchanged
}

export async function createList(
  userId: string,
  input: {
    name: unknown;
    description?: unknown;
    visibility?: unknown;
    animeId?: unknown;
    /** More anime to start with (the collection builder). */
    animeIds?: unknown;
    bannerAssetId?: unknown;
    bannerAnimeId?: unknown;
  }
): Promise<ListSummary> {
  const name = cleanName(input.name);
  const description = cleanDescription(input.description);
  const visibility = parseVisibility(input.visibility) ?? 'PRIVATE';
  const animeId = input.animeId !== undefined ? await resolveAnimeId(input.animeId) : null;
  const extra: string[] = [];
  if (input.animeIds !== undefined) {
    if (!Array.isArray(input.animeIds)) throw new ListError(400, 'animeIds must be a list.', 'INVALID_ANIME_IDS');
    if (input.animeIds.length > 100) throw new ListError(400, 'A new collection can start with at most 100 anime.', 'TOO_MANY_ANIME');
    for (const a of input.animeIds) extra.push(await resolveAnimeId(a));
  }
  const startIds = Array.from(new Set([...(animeId ? [animeId] : []), ...extra]));
  const bannerUrl = (await resolveBanner(userId, input, startIds)) ?? null;

  const owned = await prisma.userList.count({ where: { userId } });
  if (owned >= MAX_LISTS_PER_USER) throw new ListError(400, `You can have up to ${MAX_LISTS_PER_USER} lists.`, 'TOO_MANY_LISTS');

  const list = await prisma.$transaction(async (tx) => {
    const created = await tx.userList.create({
      data: { userId, name, description, visibility, bannerUrl, shareToken: isShared(visibility) ? newShareToken() : null },
    });
    if (startIds.length > 0) {
      await tx.userListItem.createMany({ data: startIds.map((id, i) => ({ listId: created.id, animeId: id, position: i + 1 })) });
    }
    await tx.activity.create({
      data: { userId, type: 'LIST_CREATED', metadata: JSON.stringify({ listId: created.id, listName: created.name }) },
    });
    return created;
  });

  // A public collection with anime in it is "published" — followers hear once.
  if (visibility === 'PUBLIC' && startIds.length > 0) await notifyFollowersOfCollection(userId, list.id);

  const [summary] = (await getMyLists(userId, animeId ?? undefined)).filter((l) => l.id === list.id);
  return summary;
}

export async function updateList(
  userId: string,
  listId: string,
  input: {
    name?: unknown;
    description?: unknown;
    visibility?: unknown;
    regenerateLink?: unknown;
    bannerAssetId?: unknown;
    bannerAnimeId?: unknown;
    banner?: unknown;
  }
): Promise<ListDetail> {
  const list = await requireOwnedList(userId, listId);
  const data: Record<string, unknown> = {};
  if (input.name !== undefined) data.name = cleanName(input.name);
  if (input.description !== undefined) data.description = cleanDescription(input.description);
  if (input.banner !== undefined || input.bannerAssetId !== undefined || input.bannerAnimeId !== undefined) {
    const items = await prisma.userListItem.findMany({ where: { listId }, select: { animeId: true } });
    const banner = await resolveBanner(userId, input, items.map((i) => i.animeId));
    if (banner !== undefined) data.bannerUrl = banner;
  }

  let visibility = list.visibility;
  if (input.visibility !== undefined) {
    const v = parseVisibility(input.visibility);
    if (!v) throw new ListError(400, 'Visibility must be PRIVATE, LINK or PUBLIC.', 'INVALID_VISIBILITY');
    visibility = v;
    data.visibility = v;
  }
  if (!isShared(visibility)) {
    data.shareToken = null; // revoke any existing link
  } else if (!list.shareToken || input.regenerateLink === true) {
    data.shareToken = newShareToken();
  }

  await prisma.userList.update({ where: { id: listId }, data });
  if (visibility === 'PUBLIC' && list.visibility !== 'PUBLIC') await notifyFollowersOfCollection(userId, listId);
  return (await getListForOwner(userId, listId))!;
}

export async function deleteList(userId: string, listId: string): Promise<void> {
  await requireOwnedList(userId, listId);
  await prisma.userList.delete({ where: { id: listId } });
}

export async function addAnimeToList(userId: string, listId: string, animeIdOrSlug: unknown): Promise<{ added: boolean; count: number }> {
  await requireOwnedList(userId, listId);
  const animeId = await resolveAnimeId(animeIdOrSlug);

  const existing = await prisma.userListItem.findUnique({ where: { listId_animeId: { listId, animeId } }, select: { id: true } });
  if (existing) return { added: false, count: await prisma.userListItem.count({ where: { listId } }) };

  const count = await prisma.userListItem.count({ where: { listId } });
  if (count >= MAX_ITEMS_PER_LIST) throw new ListError(400, `A list can hold up to ${MAX_ITEMS_PER_LIST} anime.`, 'LIST_FULL');
  const last = await prisma.userListItem.aggregate({ where: { listId }, _max: { position: true } });

  try {
    await prisma.$transaction([
      prisma.userListItem.create({ data: { listId, animeId, position: (last._max.position ?? 0) + 1 } }),
      prisma.userList.update({ where: { id: listId }, data: { updatedAt: new Date() } }),
    ]);
  } catch (e: any) {
    // A concurrent add of the same anime hit the unique constraint first.
    if (e?.code !== 'P2002') throw e;
    return { added: false, count: await prisma.userListItem.count({ where: { listId } }) };
  }
  // A public collection that was empty becomes worth announcing with its first anime.
  if (count === 0) await notifyFollowersOfCollection(userId, listId);
  return { added: true, count: count + 1 };
}

export async function removeAnimeFromList(userId: string, listId: string, animeIdOrSlug: unknown): Promise<{ removed: boolean; count: number }> {
  await requireOwnedList(userId, listId);
  const animeId = await resolveAnimeId(animeIdOrSlug);
  const { count: removedCount } = await prisma.userListItem.deleteMany({ where: { listId, animeId } });
  if (removedCount > 0) await prisma.userList.update({ where: { id: listId }, data: { updatedAt: new Date() } });
  return { removed: removedCount > 0, count: await prisma.userListItem.count({ where: { listId } }) };
}

/**
 * Sets the order of a list's anime (2026-11-06, drag to reorder). `order` must
 * name exactly the anime already in the list (ids), each once — anything else
 * is refused, so a stale or tampered request can't drop or add items.
 */
export async function reorderListItems(userId: string, listId: string, order: unknown): Promise<{ count: number }> {
  await requireOwnedList(userId, listId);
  if (!Array.isArray(order) || order.length > MAX_ITEMS_PER_LIST || !order.every((v) => typeof v === 'string')) {
    throw new ListError(400, 'Send the new order as a list of anime ids.', 'BAD_ORDER');
  }
  const ids = order as string[];
  const current = await prisma.userListItem.findMany({ where: { listId }, select: { animeId: true } });
  const have = new Set(current.map((c) => c.animeId));
  if (ids.length !== have.size || new Set(ids).size !== ids.length || !ids.every((id) => have.has(id))) {
    throw new ListError(409, 'The list changed. Reload and try again.', 'ORDER_MISMATCH');
  }
  await prisma.$transaction([
    ...ids.map((animeId, i) => prisma.userListItem.update({ where: { listId_animeId: { listId, animeId } }, data: { position: i + 1 } })),
    prisma.userList.update({ where: { id: listId }, data: { updatedAt: new Date() } }),
  ]);
  return { count: ids.length };
}

export interface PublicCollection {
  id: string;
  name: string;
  description: string | null;
  /** /l/<token>: public collections always have one. */
  shareToken: string;
  bannerUrl: string | null;
  covers: string[];
  count: number;
  updatedAt: string;
  owner: { username: string; avatarUrl: string | null };
}

/**
 * PUBLIC collections with at least one anime, most recently updated first:
 * the homepage rail and /collections. Private and link-only ones never appear.
 */
export async function getPublicCollections(
  opts: { limit?: number; before?: string | null; username?: string | null } = {}
): Promise<{ items: PublicCollection[]; nextCursor: string | null }> {
  const limit = Math.min(48, Math.max(1, opts.limit ?? 12));
  const before = opts.before ? new Date(opts.before) : null;
  const rows = await prisma.userList.findMany({
    where: {
      // One member's collections (their profile), or everyone's.
      ...(opts.username ? { user: { username: opts.username } } : {}),
      visibility: 'PUBLIC',
      shareToken: { not: null },
      items: { some: {} },
      ...(before && !Number.isNaN(before.getTime()) ? { updatedAt: { lt: before } } : {}),
    },
    orderBy: { updatedAt: 'desc' },
    take: limit + 1,
    select: {
      id: true,
      name: true,
      description: true,
      shareToken: true,
      bannerUrl: true,
      updatedAt: true,
      user: { select: { username: true, avatarUrl: true } },
      _count: { select: { items: true } },
      items: { orderBy: { position: 'asc' }, take: 8, select: { anime: { select: { posterUrl: true, bannerUrl: true } } } },
    },
  });
  const page = rows.slice(0, limit);
  return {
    items: page.map((l) => ({
      id: l.id,
      name: l.name,
      description: l.description,
      shareToken: l.shareToken!,
      bannerUrl: l.bannerUrl || l.items.map((i) => i.anime.bannerUrl).find(isWideBanner) || null,
      covers: l.items.map((i) => i.anime.posterUrl).filter(Boolean).slice(0, 4),
      count: l._count.items,
      updatedAt: l.updatedAt.toISOString(),
      owner: { username: l.user.username, avatarUrl: l.user.avatarUrl },
    })),
    nextCursor: rows.length > limit ? page[page.length - 1].updatedAt.toISOString() : null,
  };
}
