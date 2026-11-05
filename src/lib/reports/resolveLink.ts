import { prisma } from '../prisma';

/**
 * Turns a link someone pasted ("https://otakuva…/anime/frieren", "/profile/x",
 * or just a path) into what it points at, for reports and corrections
 * (2026-11-05). Only the path is used — the host is ignored, so links from
 * the live site, a preview or localhost all work. Unknown paths come back as
 * type PAGE with the path itself, so a report about any page still lands in
 * the inbox with somewhere to look.
 */

export type LinkedType =
  | 'ANIME'
  | 'PERSON'
  | 'CHARACTER'
  | 'STUDIO'
  | 'NEWS'
  | 'USER'
  | 'COMMUNITY'
  | 'ARTICLE'
  | 'DISCUSSION'
  | 'PAGE';

export interface LinkedTarget {
  type: LinkedType;
  id: string;
  /** Human name for the inbox ("Frieren", "@someone"). */
  label: string;
  path: string;
}

/** The path part of a pasted link, or null if it isn't a link/path at all. */
export function linkPath(raw: unknown): string | null {
  if (typeof raw !== 'string') return null;
  const v = raw.trim();
  if (!v || v.length > 500) return null;
  let pathname: string;
  try {
    pathname = v.startsWith('/') ? new URL(v, 'https://x.invalid').pathname : new URL(/^https?:\/\//i.test(v) ? v : `https://${v}`).pathname;
  } catch {
    return null;
  }
  const clean = decodeURIComponent(pathname).replace(/\/+$/, '') || '/';
  return clean.includes('..') ? null : clean.slice(0, 300);
}

export async function resolveLink(raw: unknown): Promise<LinkedTarget | null> {
  const path = linkPath(raw);
  if (!path) return null;
  const [, section = '', key = ''] = path.split('/');
  const page: LinkedTarget = { type: 'PAGE', id: path, label: path, path };
  if (!key) return page;

  switch (section) {
    case 'anime': {
      const a = await prisma.anime.findFirst({ where: { OR: [{ slug: key }, { id: key }] }, select: { id: true, canonicalTitle: true } });
      return a ? { type: 'ANIME', id: a.id, label: a.canonicalTitle, path } : page;
    }
    case 'person':
    case 'people':
    case 'creator': {
      const p = await prisma.person.findFirst({ where: { OR: [{ slug: key }, { id: key }] }, select: { id: true, name: true } });
      return p ? { type: 'PERSON', id: p.id, label: p.name, path } : page;
    }
    case 'character':
    case 'characters': {
      const c = await prisma.character.findFirst({ where: { OR: [{ slug: key }, { id: key }] }, select: { id: true, name: true } });
      return c ? { type: 'CHARACTER', id: c.id, label: c.name, path } : page;
    }
    case 'studio':
    case 'studios': {
      const s = await prisma.studio.findFirst({ where: { OR: [{ slug: key }, { id: key }] }, select: { id: true, name: true } });
      return s ? { type: 'STUDIO', id: s.id, label: s.name, path } : page;
    }
    case 'news': {
      const n = await prisma.newsArticle.findFirst({ where: { OR: [{ slug: key }, { id: key }] }, select: { id: true, title: true } });
      return n ? { type: 'NEWS', id: n.id, label: n.title, path } : page;
    }
    case 'profile': {
      const u = await prisma.user.findFirst({ where: { username: { equals: key, mode: 'insensitive' } }, select: { id: true, username: true } });
      return u ? { type: 'USER', id: u.id, label: `@${u.username}`, path } : page;
    }
    case 'community': {
      const c = await prisma.community.findUnique({ where: { slug: key }, select: { id: true, name: true } });
      return c ? { type: 'COMMUNITY', id: c.id, label: c.name, path } : page;
    }
    case 'articles': {
      const a = await prisma.userArticle.findFirst({ where: { slug: key, status: 'PUBLISHED' }, select: { id: true, title: true } });
      return a ? { type: 'ARTICLE', id: a.id, label: a.title, path } : page;
    }
    case 'discussions': {
      const d = await prisma.discussion.findUnique({ where: { id: key }, select: { id: true, title: true } });
      return d ? { type: 'DISCUSSION', id: d.id, label: d.title, path } : page;
    }
    default:
      return page;
  }
}
