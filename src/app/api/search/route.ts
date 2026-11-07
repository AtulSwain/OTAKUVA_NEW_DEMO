import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '../../../lib/prisma';
import { searchCharacters } from '../../../lib/characters/characterSearch';
import { logger } from '../../../lib/logger';
import { sanitizePublicEntityName } from '../../../lib/normalizers';
import { matchKind, searchAnimeIdsByTitle, searchPersonIdsByName } from '../../../lib/fuzzySearch';

// Search box (2026-11-02): best title matches first (exact title on top),
// then up to RELATED_LIMIT more shows whose tags/genres name the word.
const TITLE_LIMIT = 12;
const RELATED_LIMIT = 8;
const ANIME_SELECT = { id: true, slug: true, canonicalTitle: true, posterUrl: true, bannerUrl: true, year: true, type: true, score: true, episodes: true, status: true } as const;

export const dynamic = 'force-dynamic';

function animeItem(a: { id: string; slug: string; canonicalTitle: string; posterUrl: string | null; bannerUrl: string | null; year: number | null; type: string; score: number | null; episodes: number | null; status: string }) {
  return {
    id: a.id,
    slug: a.slug,
    title: sanitizePublicEntityName(a.canonicalTitle),
    posterUrl: a.posterUrl,
    bannerUrl: a.bannerUrl ?? null,
    year: a.year,
    type: a.type,
    score: a.score,
    episodes: a.episodes,
    status: a.status,
  };
}

export async function GET(request: NextRequest) {
  try {
    const { searchParams } = new URL(request.url);
    const rawQuery = searchParams.get('q')?.trim() || '';

    if (!rawQuery) {
      // Default top suggestions
      const [topAnime, topStudios, recentNews, topFranchises] = await Promise.all([
        prisma.anime.findMany({
          where: { status: { not: 'MERGED' } },
          orderBy: { score: { sort: 'desc', nulls: 'last' } },
          take: 5,
          select: {
            id: true,
            slug: true,
            canonicalTitle: true,
            posterUrl: true,
            bannerUrl: true,
            year: true,
            type: true,
            score: true,
          },
        }),
        prisma.studio.findMany({
          take: 4,
          select: { id: true, slug: true, name: true, imageUrl: true },
        }),
        prisma.newsArticle.findMany({
          take: 3,
          orderBy: { publishedAt: 'desc' },
          select: { id: true, slug: true, title: true, imageUrl: true, category: true },
        }),
        prisma.franchise.findMany({
          take: 3,
          select: { id: true, slug: true, name: true },
        }),
      ]);

      return NextResponse.json({
        anime: topAnime.map((a) => ({
          id: a.id,
          slug: a.slug,
          title: sanitizePublicEntityName(a.canonicalTitle),
          posterUrl: a.posterUrl,
          bannerUrl: a.bannerUrl ?? null,
          year: a.year,
          type: a.type,
          score: a.score,
        })),
        studios: topStudios.map((s) => ({
          id: s.id,
          slug: s.slug,
          name: sanitizePublicEntityName(s.name),
          logoUrl: s.imageUrl,
        })),
        people: [],
        characters: [],
        news: recentNews.map((n) => ({
          id: n.id,
          slug: n.slug,
          title: sanitizePublicEntityName(n.title),
          imageUrl: n.imageUrl,
          category: n.category,
        })),
        communities: [],
        franchises: topFranchises.map((f) => ({
          id: f.id,
          slug: f.slug,
          name: sanitizePublicEntityName(f.name),
        })),
      });
    }

    const cleanQuery = sanitizePublicEntityName(rawQuery) || rawQuery;

    // Anime/person matching is now fuzzy/typo-tolerant (Postgres full-text
    // + pg_trgm — see src/lib/fuzzySearch.ts), replacing a plain `contains`
    // that missed anything misspelled. These need to resolve before the
    // anime/person findMany calls below (which just fetch the already-
    // ranked ids), so they run ahead of the rest of the Promise.all.
    const [animeMatches, personMatches, characterResults] = await Promise.all([
      searchAnimeIdsByTitle(cleanQuery, TITLE_LIMIT * 2),
      searchPersonIdsByName(cleanQuery, 4),
      // Characters (2026-11-06): best match first, with the anime they're from.
      searchCharacters(cleanQuery, 4).catch(() => []),
    ]);

    // Search across 5 distinct canonical entity domains concurrently
    const [animeResults, studioResults, peopleResults, newsResults, communityResults, franchiseResults] = await Promise.all([
      // No adult-content gate on the public site, so adult titles never surface here.
      prisma.anime.findMany({
        where: { id: { in: animeMatches.map((m) => m.id) }, isAdult: false },
        select: ANIME_SELECT,
      }),

      prisma.studio.findMany({
        where: {
          OR: [
            { name: { contains: cleanQuery, mode: 'insensitive' } },
            { slug: { contains: cleanQuery.toLowerCase(), mode: 'insensitive' } },
          ],
        },
        take: 4,
        select: {
          id: true,
          slug: true,
          name: true,
          imageUrl: true,
        },
      }),

      prisma.person.findMany({
        where: { id: { in: personMatches.map((m) => m.id) } },
        select: {
          id: true,
          slug: true,
          name: true,
          imageUrl: true,
          nameKanji: true,
        },
      }),

      prisma.newsArticle.findMany({
        where: {
          OR: [
            { title: { contains: cleanQuery, mode: 'insensitive' } },
            { slug: { contains: cleanQuery.toLowerCase(), mode: 'insensitive' } },
          ],
        },
        take: 4,
        select: {
          id: true,
          slug: true,
          title: true,
          imageUrl: true,
          category: true,
          publishedAt: true,
        },
      }),

      prisma.community.findMany({
        where: {
          status: 'ACTIVE',
          visibility: 'PUBLIC',
          OR: [
            { name: { contains: cleanQuery, mode: 'insensitive' } },
            { slug: { contains: cleanQuery.toLowerCase(), mode: 'insensitive' } },
          ],
        },
        take: 4,
        select: {
          id: true,
          slug: true,
          name: true,
          iconUrl: true,
          memberCount: true,
          category: true,
        },
      }),

      prisma.franchise.findMany({
        where: {
          OR: [
            { name: { contains: cleanQuery, mode: 'insensitive' } },
            { slug: { contains: cleanQuery.toLowerCase(), mode: 'insensitive' } },
          ],
        },
        take: 4,
        select: { id: true, slug: true, name: true },
      }),
    ]);

    // Keep the match order from fuzzySearch (exact title → starts with →
    // contains → typo matches; popular first within each).
    const animeRank = new Map(animeMatches.map((m) => [m.id, Number(m.rank)]));
    const titleAnime = [...animeResults]
      .sort((a, b) => animeMatches.findIndex((m) => m.id === a.id) - animeMatches.findIndex((m) => m.id === b.id))
      .slice(0, TITLE_LIMIT);

    // "Related": shows tagged/genred with the word (e.g. "monster" → the
    // "Monster Girl" tag), most popular first, not already listed.
    const related =
      cleanQuery.length >= 3
        ? await prisma.anime.findMany({
            where: {
              isAdult: false,
              status: { not: 'MERGED' },
              id: { notIn: titleAnime.map((a) => a.id) },
              OR: [
                { animeTags: { some: { name: { contains: cleanQuery, mode: 'insensitive' }, isMediaSpoiler: false } } },
                { animeGenres: { some: { genre: { name: { equals: cleanQuery, mode: 'insensitive' } } } } },
                { animeThemes: { some: { theme: { name: { equals: cleanQuery, mode: 'insensitive' } } } } },
              ],
            },
            orderBy: [{ members: { sort: 'desc', nulls: 'last' } }, { scoredBy: { sort: 'desc', nulls: 'last' } }],
            take: RELATED_LIMIT,
            select: ANIME_SELECT,
          })
        : [];

    // Prisma's `id: { in: [...] }` doesn't preserve the ids' input order,
    // so re-sort people by fuzzy-match rank (best match first) — anime
    // deliberately keeps its own `orderBy: score desc` above instead,
    // matching this endpoint's prior behavior of ranking anime results by
    // popularity/score rather than match strength.
    const personRankById = new Map(personMatches.map((m) => [m.id, m.rank]));
    const rankedPeopleResults = [...peopleResults].sort(
      (a, b) => (personRankById.get(b.id) ?? 0) - (personRankById.get(a.id) ?? 0)
    );

    return NextResponse.json({
      anime: [
        ...titleAnime.map((a) => ({ ...animeItem(a), match: matchKind(animeRank.get(a.id) ?? 0) })),
        ...related.map((a) => ({ ...animeItem(a), match: 'related' as const })),
      ],
      studios: studioResults.map((s) => ({
        id: s.id,
        slug: s.slug,
        name: sanitizePublicEntityName(s.name),
        logoUrl: s.imageUrl,
      })),
      people: rankedPeopleResults.map((p) => ({
        id: p.id,
        slug: p.slug,
        name: sanitizePublicEntityName(p.name),
        imageUrl: p.imageUrl,
        primaryRole: p.nameKanji || 'Staff & Cast',
      })),
      news: newsResults.map((n) => ({
        id: n.id,
        slug: n.slug,
        title: sanitizePublicEntityName(n.title),
        imageUrl: n.imageUrl,
        category: n.category,
        publishedAt: n.publishedAt,
      })),
      communities: communityResults.map((c) => ({
        id: c.id,
        slug: c.slug,
        name: sanitizePublicEntityName(c.name),
        iconUrl: c.iconUrl,
        memberCount: c.memberCount,
        category: c.category,
      })),
      franchises: franchiseResults.map((f) => ({
        id: f.id,
        slug: f.slug,
        name: sanitizePublicEntityName(f.name),
      })),
      characters: characterResults.map((c) => ({ ...c, name: sanitizePublicEntityName(c.name) })),
    });
  } catch (error) {
    logger.error('Search failed', { error: error as Error, component: 'api/search' });
    return NextResponse.json({ error: 'Search failed' }, { status: 500 });
  }
}
