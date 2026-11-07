/**
 * Page titles / descriptions / share images for detail pages whose page
 * component runs in the browser (2026-11-02). Each is used from that route's
 * server `layout.tsx`. Stored facts only; private things (private-community
 * threads, unlisted communities) never get their title into metadata.
 */
import type { Metadata } from 'next';
import { notFound } from 'next/navigation';
import { prisma } from '../prisma';
import { readableDiscussionsFilter } from '../engine/community/communityEngine';
import { metaDescription, shareImage } from './site';

const NOT_FOUND: Metadata = { title: 'Not found', robots: { index: false, follow: false } };
const ADULT_GENRES = ['Hentai', 'Erotica'];

function page(path: string, title: string, description: string | null, image?: string | null, type: 'website' | 'article' | 'profile' = 'website'): Metadata {
  const img = shareImage(image);
  return {
    title,
    description: description ?? undefined,
    alternates: { canonical: path },
    openGraph: { type, url: path, title, description: description ?? undefined, images: img ? [{ url: img, alt: title }] : undefined },
    twitter: { card: img ? 'summary_large_image' : 'summary', title, description: description ?? undefined, images: img ? [img] : undefined },
  };
}

const guard = async (fn: () => Promise<Metadata>): Promise<Metadata> => {
  try {
    return await fn();
  } catch (err) {
    if ((err as { digest?: string } | null)?.digest === 'NEXT_NOT_FOUND') throw err;
    return {};
  }
};

/**
 * Missing page → a real 404 status (2026-11-06). Metadata resolves before the
 * loading skeleton streams, so calling notFound() here sets the status; the
 * page component (client-rendered) can't. `pageWouldFind` repeats the page
 * API's own (often looser) lookup, so a page that would still render is
 * never answered with a 404.
 */
const decode = (v: string) => {
  try {
    return decodeURIComponent(v);
  } catch {
    return v;
  }
};

async function missing(pageWouldFind: () => Promise<unknown>): Promise<Metadata> {
  if (!(await pageWouldFind())) notFound();
  return NOT_FOUND;
}

export const newsMetadata = (slug: string) =>
  guard(async () => {
    const n = await prisma.newsArticle.findFirst({
      where: { slug, status: 'PUBLISHED', deletedAt: null },
      select: { slug: true, title: true, summary: true, content: true, imageUrl: true, sourceName: true, publishedAt: true, updatedAt: true },
    });
    if (!n) return missing(() => prisma.newsArticle.findFirst({ where: { OR: [{ id: slug }, { slug }], status: { notIn: ['REMOVED'] } }, select: { id: true } }));
    const desc = metaDescription(n.summary) ?? metaDescription(n.content) ?? `Anime news from ${n.sourceName}.`;
    const m = page(`/news/${n.slug}`, n.title, desc, n.imageUrl, 'article');
    m.openGraph = { ...m.openGraph, type: 'article', publishedTime: n.publishedAt.toISOString(), modifiedTime: n.updatedAt.toISOString() };
    return m;
  });

export const characterMetadata = (slug: string) =>
  guard(async () => {
    const c = await prisma.character.findFirst({
      where: { OR: [{ slug }, { id: slug }] },
      select: { slug: true, name: true, about: true, imageUrl: true, animeRoles: { select: { anime: { select: { canonicalTitle: true, isAdult: true } } }, take: 1 } },
    });
    if (!c) return missing(() => prisma.character.findFirst({ where: { name: { in: [slug, decode(slug)] } }, select: { id: true } }));
    const anime = c.animeRoles[0]?.anime;
    const desc = metaDescription(c.about) ?? (anime ? `${c.name}, a character from ${anime.canonicalTitle}: voice actors, appearances and more.` : null);
    const m = page(`/character/${c.slug ?? slug}`, anime ? `${c.name} (${anime.canonicalTitle})` : c.name, desc, c.imageUrl, 'profile');
    if (anime?.isAdult) m.robots = { index: false, follow: false };
    return m;
  });

export const genreMetadata = (slug: string) =>
  guard(async () => {
    const g = await prisma.genre.findUnique({ where: { slug }, select: { slug: true, name: true } });
    if (!g) return missing(() => prisma.genre.findFirst({ where: { name: { contains: slug, mode: 'insensitive' } }, select: { id: true } }));
    const m = page(`/genre/${g.slug}`, `${g.name} Anime`, `The best ${g.name.toLowerCase()} anime: browse every ${g.name} series and movie, from all-time favourites to this season's new shows.`);
    if (ADULT_GENRES.includes(g.name)) m.robots = { index: false, follow: false };
    return m;
  });

export const themeMetadata = (slug: string) =>
  guard(async () => {
    const t = await prisma.theme.findUnique({ where: { slug }, select: { slug: true, name: true } });
    if (!t) return missing(() => prisma.theme.findFirst({ where: { name: { contains: slug, mode: 'insensitive' } }, select: { id: true } }));
    return page(`/theme/${t.slug}`, `${t.name} Anime`, `Anime with the ${t.name} theme: every series and movie in the catalog, with schedules, reviews and episode ratings.`);
  });

export const producerMetadata = (slug: string) =>
  guard(async () => {
    const p = await prisma.producer.findUnique({ where: { slug }, select: { slug: true, name: true, about: true, imageUrl: true } });
    if (!p) {
      const name = decode(slug).replace(/-/g, ' ');
      return missing(() => prisma.producer.findFirst({ where: { OR: [{ id: slug }, { name: slug }, { name: { contains: name, mode: 'insensitive' } }] }, select: { id: true } }));
    }
    return page(`/producer/${p.slug}`, `${p.name} — Anime Producer`, metaDescription(p.about) ?? `Anime produced by ${p.name}.`, p.imageUrl);
  });

export const franchiseMetadata = (slug: string) =>
  guard(async () => {
    const f = await prisma.franchise.findUnique({ where: { slug }, select: { slug: true, name: true, description: true } });
    if (!f) return missing(() => prisma.franchise.findFirst({ where: { id: slug }, select: { id: true } }));
    return page(`/franchise/${f.slug}`, `${f.name} — Watch Order & Every Series`, metaDescription(f.description) ?? `Every ${f.name} series and movie in order.`);
  });

export const communityMetadata = (slug: string) =>
  guard(async () => {
    const c = await prisma.community.findFirst({
      where: { slug, deletedAt: null, status: { not: 'DELETED' } },
      select: { slug: true, name: true, description: true, visibility: true },
    });
    if (!c) return missing(() => prisma.community.findFirst({ where: { OR: [{ slug }, { id: slug }] }, select: { id: true } }));
    // Private communities: nothing about them goes into metadata.
    if (c.visibility === 'PRIVATE') return { title: 'Community', robots: { index: false, follow: false } };
    return page(`/community/${c.slug}`, `${c.name} — Community`, metaDescription(c.description) ?? `${c.name}: an anime community on OTAKUVA.`);
  });

export const discussionMetadata = (id: string) =>
  guard(async () => {
    const d = await prisma.discussion.findFirst({
      where: { id, status: { notIn: ['REMOVED', 'HIDDEN', 'DELETED'] }, ...readableDiscussionsFilter(null) },
      select: { id: true, title: true, body: true },
    });
    if (!d) return { title: 'Discussion', robots: { index: false, follow: false } };
    return page(`/discussions/${d.id}`, d.title, metaDescription(d.body), null, 'article');
  });

export const profileMetadata = (username: string) =>
  guard(async () => {
    if (username === 'you') return { title: 'Your profile', robots: { index: false, follow: false } };
    const u = await prisma.user.findFirst({
      where: { username: { equals: username, mode: 'insensitive' } },
      select: { username: true, displayName: true, bio: true },
    });
    if (!u) return missing(() => prisma.user.findFirst({ where: { username: { equals: decode(username), mode: 'insensitive' } }, select: { id: true } }));
    const name = u.displayName ? `${u.displayName} (@${u.username})` : `@${u.username}`;
    return page(`/profile/${u.username}`, name, metaDescription(u.bio) ?? `${name}'s anime reviews, episode ratings and collections on OTAKUVA.`, null, 'profile');
  });
