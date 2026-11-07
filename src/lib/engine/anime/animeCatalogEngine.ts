/**
 * OTAKUVA CANONICAL ANIME CATALOG ENGINE — PHASE 3
 * 
 * Central engine for querying, filtering, sorting, and retrieving canonical
 * anime records with rich relational facets, caching, and fallback ingestion.
 */

import { prisma } from '../../prisma';
import { getPlatformArt } from '../../catalog/streamingPlatforms';
import { AnimeFilterParams, AnimeCardDto, AnimeDetailDto, PaginationMeta } from '../../contracts/apiContracts';
import { CacheManager } from '../../performance/cacheManager';
import { normalizeSearchTitle } from '../../normalizers';
import { getAnimeDisplayTitle } from '../../animeTitleResolver';
import { defaultAnimeProvider } from '../../providers';
import { syncEngine } from '../../syncEngine';
import { searchAnimeIdsByTitle } from '../../fuzzySearch';

// See src/lib/search.ts's identical constant for the rationale — same
// generous-but-bounded cap on fuzzy title matches before the rest of
// this query's filters/sort/pagination apply.
const MAX_TITLE_MATCHES = 500;

export class AnimeCatalogEngine {
  private static CACHE_TTL_CATALOG = 300; // 5 minutes
  private static CACHE_TTL_DETAIL = 600;  // 10 minutes

  /**
   * Queries anime catalog with multi-facet filters, search, sorting, and pagination
   */
  static async queryAnimeCatalog(
    filters: AnimeFilterParams,
    authUserId?: string
  ): Promise<{ items: AnimeCardDto[]; pagination: PaginationMeta; cached: boolean }> {
    const page = filters.page || 1;
    const limit = Math.min(filters.limit || 50, 100);
    const skip = (page - 1) * limit;

    // Build Cache Key (excluding authUserId for public catalog cache)
    const cacheKey = `anime:catalog:${JSON.stringify(filters)}`;

    // Try in-memory cache if no search text
    if (!filters.q) {
      const cached = CacheManager.get<{ items: AnimeCardDto[]; pagination: PaginationMeta }>(cacheKey);
      if (cached) {
        return { ...cached, cached: true };
      }
    }

    const andClauses: any[] = [
      { status: { not: 'MERGED' } },
    ];

    // 1. Text Search across title (fuzzy/typo-tolerant — see
    // fuzzySearch.ts), localized/alternate titles, studio, genre, tag.
    // Was a plain `contains` with no `mode: 'insensitive'` — silently
    // case-sensitive on Postgres (unlike SQLite's case-insensitive LIKE
    // this app used to run on), so a lowercase query against a
    // properly-capitalized title returned nothing. Replaced with
    // Postgres full-text + pg_trgm search, which is case-insensitive by
    // construction and also tolerates typos.
    if (filters.q) {
      const titleMatches = await searchAnimeIdsByTitle(filters.q, MAX_TITLE_MATCHES);
      andClauses.push({
        OR: [
          { id: { in: titleMatches.map((m) => m.id) } },
          { slug: { contains: normalizeSearchTitle(filters.q), mode: 'insensitive' } },
          { animeStudios: { some: { studio: { name: { contains: filters.q, mode: 'insensitive' } } } } },
          { animeGenres: { some: { genre: { name: { contains: filters.q, mode: 'insensitive' } } } } },
          { animeTags: { some: { name: { contains: filters.q, mode: 'insensitive' } } } },
        ],
      });
    }

    // 2. Genre Filter
    if (filters.genre && filters.genre !== 'All') {
      andClauses.push({
        animeGenres: {
          some: {
            genre: { name: { contains: filters.genre, mode: 'insensitive' } },
          },
        },
      });
    }

    // 3. Theme Filter
    if (filters.theme && filters.theme !== 'All') {
      andClauses.push({
        animeThemes: {
          some: {
            theme: { name: { contains: filters.theme, mode: 'insensitive' } },
          },
        },
      });
    }

    // 4. Studio Filter
    if (filters.studio && filters.studio !== 'All') {
      andClauses.push({
        animeStudios: {
          some: {
            studio: { name: { contains: filters.studio, mode: 'insensitive' } },
          },
        },
      });
    }

    // 5. Type Filter
    if (filters.type && filters.type !== 'All') {
      const tLower = filters.type.toLowerCase();
      let typeVariants = [filters.type];
      if (tLower === 'tv') typeVariants = ['TV', 'TV_SHORT', 'tv'];
      else if (tLower === 'movie') typeVariants = ['Movie', 'MOVIE', 'movie'];
      else if (tLower === 'ona') typeVariants = ['ONA', 'ona'];
      else if (tLower === 'ova') typeVariants = ['OVA', 'ova'];
      else if (tLower === 'special' || tLower === 'specials') typeVariants = ['Special', 'SPECIAL', 'special', 'TV_SPECIAL'];

      andClauses.push({
        type: { in: typeVariants },
      });
    }

    // 6. Status Filter
    if (filters.status && filters.status !== 'All') {
      const sLower = filters.status.toLowerCase();
      let statusVariants = [filters.status];
      if (sLower.includes('finish') || sLower.includes('complete')) {
        // Jikan stores "Finished Airing" (AniList "Finished"); it was missing here, so
        // the Finished filter silently dropped every Jikan-sourced title.
        statusVariants = ['Finished', 'Finished Airing', 'FINISHED', 'Completed', 'COMPLETED'];
      } else if (sLower.includes('air') || sLower.includes('releas')) {
        statusVariants = ['Airing', 'CURRENTLY_AIRING', 'AIRING', 'Currently Airing', 'RELEASING'];
      } else if (sLower.includes('not') || sLower.includes('upcom')) {
        statusVariants = ['NOT_YET_AIRED', 'UPCOMING', 'Not Yet Aired', 'Upcoming', 'Not yet aired'];
      }

      andClauses.push({
        status: { in: statusVariants },
      });
    }

    // 7. Season Filter
    if (filters.season && filters.season !== 'All') {
      // Case-insensitive: the validator upper-cases the param ("FALL") while
      // the catalog stores "Fall"; on Postgres the old exact/UPPER/lower
      // variants never matched, so every season filter returned nothing.
      andClauses.push({ season: { equals: filters.season, mode: 'insensitive' } });
    }

    // 8. Year Filter
    if (filters.year && filters.year > 0) {
      andClauses.push({
        OR: [
          { year: filters.year },
          { startYear: filters.year },
        ],
      });
    }

    // 9. Decade Filter (e.g. "1990s")
    if (filters.decade && filters.decade !== 'All') {
      const startYear = parseInt(filters.decade.replace(/s$/, ''), 10);
      if (!isNaN(startYear)) {
        const endYear = startYear + 9;
        andClauses.push({
          OR: [
            { year: { gte: startYear, lte: endYear } },
            { startYear: { gte: startYear, lte: endYear } },
          ],
        });
      }
    }

    // 10. Score Range Bounds
    if (filters.minScore !== undefined) {
      andClauses.push({ score: { gte: filters.minScore } });
    }
    if (filters.maxScore !== undefined) {
      andClauses.push({ score: { lte: filters.maxScore } });
    }

    const where: any = andClauses.length > 0 ? { AND: andClauses } : {};

    // 11. Multi-Clause Sort Order
    const sortField = filters.sortBy || 'score';
    const direction = filters.sortOrder || 'desc';

    // Postgres sorts NULLs first under DESC (SQLite sorted them last), so
    // without `nulls: 'last'` every unscored/unaired title topped "Highest
    // Score". Missing values always sink, whichever direction is asked for.
    const by = (sort: 'asc' | 'desc') => ({ sort, nulls: 'last' as const });
    let orderBy: any = [{ score: by('desc') }, { popularity: by('desc') }];
    if (sortField === 'popularity') {
      orderBy = [{ popularity: by(direction) }, { score: by('desc') }];
    } else if (sortField === 'title') {
      orderBy = [{ canonicalTitle: direction }];
    } else if (sortField === 'rank') {
      orderBy = [{ rank: by(direction) }, { score: by('desc') }];
    } else if (sortField === 'year') {
      orderBy = [{ year: by(direction) }, { startYear: by(direction) }, { score: by('desc') }];
    } else if (sortField === 'updatedAt') {
      orderBy = [{ updatedAt: direction }];
    } else if (sortField === 'members') {
      orderBy = [{ members: by(direction) }, { score: by('desc') }];
    } else if (sortField === 'episodes') {
      orderBy = [{ episodes: by(direction) }, { score: by('desc') }];
    } else if (sortField === 'score') {
      orderBy = [{ score: by(direction) }, { scoredBy: by('desc') }];
    }

    let [total, animes] = await Promise.all([
      prisma.anime.count({ where }),
      prisma.anime.findMany({
        where,
        orderBy,
        skip,
        take: limit,
        include: {
          animeGenres: { include: { genre: true } },
          animeStudios: { include: { studio: true } },
          animeThemes: { include: { theme: true } },
          titles: true,
        },
      }),
    ]);

    // Fallback: If search yielded 0 results on page 1, query external provider on-demand and ingest into canonical DB
    if (filters.q && animes.length === 0 && page === 1) {
      try {
        const providerResults = await defaultAnimeProvider.searchAnime(filters.q, 1, Math.min(limit, 15));
        for (const item of providerResults.items) {
          try {
            await syncEngine.ingestAnime(item, 'anilist');
          } catch (e) {}
        }

        [total, animes] = await Promise.all([
          prisma.anime.count({ where }),
          prisma.anime.findMany({
            where,
            orderBy,
            skip: 0,
            take: limit,
            include: {
              animeGenres: { include: { genre: true } },
              animeStudios: { include: { studio: true } },
              animeThemes: { include: { theme: true } },
              titles: true,
            },
          }),
        ]);
      } catch (err: any) {
        console.warn('[AnimeCatalogEngine] Fallback provider search failed:', err?.message);
      }
    }

    const items: AnimeCardDto[] = animes.map((a) => {
      const displayTitle = getAnimeDisplayTitle(a);
      return {
        id: a.id,
        externalId: a.externalId || a.id,
        externalSource: a.externalSource,
        malId: a.malId,
        anilistId: a.anilistId,
        slug: a.slug,
        title: displayTitle,
        canonicalTitle: displayTitle,
        englishTitle: a.titles.find((t) => t.type === 'english')?.title || null,
        japaneseTitle: a.titles.find((t) => t.type === 'japanese')?.title || null,
        synopsis: a.synopsis,
        type: a.type,
        status: a.status,
        episodes: a.episodes,
        score: a.score,
        scoredBy: a.scoredBy,
        rank: a.rank,
        popularity: a.popularity,
        members: a.members,
        favorites: a.favoritesCount,
        posterUrl: a.posterUrl,
        largePosterUrl: a.largePosterUrl,
        posterImage: a.posterUrl,
        bannerUrl: a.bannerUrl,
        bannerImage: a.bannerUrl || a.posterUrl,
        trailerUrl: a.trailerUrl,
        season: a.season,
        year: a.year || a.startYear,
        startDate: a.startDate ? a.startDate.toISOString() : null,
        datePrecision: a.datePrecision,
        nextAiringEpisode: a.nextAiringEpisode,
        nextAiringAt: a.nextAiringAt ? a.nextAiringAt.toISOString() : null,
        timeUntilAiring: a.timeUntilAiring,
        genres: a.animeGenres.map((ag) => ag.genre.name),
        themes: a.animeThemes.map((at) => at.theme.name),
        studios: a.animeStudios.map((as) => as.studio.name),
      };
    });

    const pagination: PaginationMeta = {
      page,
      limit,
      total,
      totalPages: Math.ceil(total / limit) || 1,
      hasNextPage: page * limit < total,
      hasPrevPage: page > 1,
    };

    const result = { items, pagination, cached: false };

    // Cache if not a transient search query
    if (!filters.q) {
      CacheManager.set(cacheKey, { items, pagination }, this.CACHE_TTL_CATALOG, ['tag:anime:catalog']);
    }

    return result;
  }

  /**
   * Retrieves complete canonical anime detail with localized titles, studios, characters, staff, relations, franchise hierarchy, and user tracking
   */
  static async getAnimeByIdOrSlug(
    idOrSlug: string,
    authUserId?: string
  ): Promise<AnimeDetailDto | null> {
    const cacheKey = `anime:detail:${idOrSlug}`;
    
    // 1. Fetch from canonical database
    let anime = await prisma.anime.findFirst({
      where: {
        OR: [{ id: idOrSlug }, { slug: idOrSlug }],
      },
      include: {
        titles: true,
        animeGenres: { include: { genre: true } },
        animeThemes: { include: { theme: true } },
        animeTags: { orderBy: { rank: 'desc' } },
        animeStudios: { include: { studio: true } },
        animeProducers: { include: { producer: true } },
        streamingAvailability: { orderBy: { provider: 'asc' } },
        episodesList: { orderBy: { number: 'asc' } },
        seasons: { orderBy: { sortOrder: 'asc' } },
        characters: {
          include: {
            character: {
              include: {
                voiceRoles: {
                  include: { person: true },
                },
              },
            },
          },
        },
        staff: {
          include: { person: true },
        },
        relationsFrom: {
          include: {
            targetAnime: true,
          },
        },
        franchiseItems: {
          include: {
            franchise: {
              include: {
                items: {
                  include: { anime: true },
                  orderBy: { position: 'asc' },
                },
              },
            },
          },
        },
        externalStats: true,
        discussions: {
          take: 5,
          orderBy: { createdAt: 'desc' },
          include: { author: { select: { id: true, username: true, avatarUrl: true } } },
        },
        communities: {
          take: 4,
          orderBy: { memberCount: 'desc' },
        },
      },
    });

    // 2. On-demand ingestion fallback if not present in DB
    if (!anime) {
      try {
        let providerAnime = await defaultAnimeProvider.getAnime(idOrSlug);
        if (!providerAnime) {
          const searchRes = await defaultAnimeProvider.searchAnime(idOrSlug.replace(/-/g, ' '), 1, 1);
          if (searchRes.items.length > 0) {
            providerAnime = searchRes.items[0];
          }
        }

        if (providerAnime) {
          const { animeId } = await syncEngine.ingestAnime(providerAnime, 'anilist');
          await Promise.allSettled([
            syncEngine.syncEpisodes(animeId, providerAnime.externalId, 'jikan'),
            syncEngine.syncCharacters(animeId, providerAnime.externalId, 'anilist'),
            syncEngine.syncStaff(animeId, providerAnime.externalId, 'anilist'),
            syncEngine.syncRelations(animeId, providerAnime.externalId, 'anilist'),
          ]);

          anime = await prisma.anime.findUnique({
            where: { id: animeId },
            include: {
              titles: true,
              animeGenres: { include: { genre: true } },
              animeThemes: { include: { theme: true } },
              animeTags: { orderBy: { rank: 'desc' } },
              animeStudios: { include: { studio: true } },
              animeProducers: { include: { producer: true } },
              streamingAvailability: { orderBy: { provider: 'asc' } },
              episodesList: { orderBy: { number: 'asc' } },
              seasons: { orderBy: { sortOrder: 'asc' } },
              characters: {
                include: {
                  character: {
                    include: {
                      voiceRoles: {
                        include: { person: true },
                      },
                    },
                  },
                },
              },
              staff: {
                include: { person: true },
              },
              relationsFrom: {
                include: {
                  targetAnime: true,
                },
              },
              franchiseItems: {
                include: {
                  franchise: {
                    include: {
                      items: {
                        include: { anime: true },
                        orderBy: { position: 'asc' },
                      },
                    },
                  },
                },
              },
              externalStats: true,
              discussions: {
                take: 5,
                orderBy: { createdAt: 'desc' },
                include: { author: { select: { id: true, username: true, avatarUrl: true } } },
              },
              communities: {
                take: 4,
                orderBy: { memberCount: 'desc' },
              },
            },
          });
        }
      } catch (err: any) {
        console.warn(`[AnimeCatalogEngine] Fallback ingestion for ${idOrSlug} failed:`, err?.message);
      }
    }

    if (!anime) return null;

    // 3. User Tracking Integration
    let userTracking: any = null;
    let watchedEpisodeIds: string[] = [];

    if (authUserId) {
      const [userAnime, progress] = await Promise.all([
        prisma.userAnime.findUnique({
          where: { userId_animeId: { userId: authUserId, animeId: anime.id } },
        }),
        prisma.userEpisodeProgress.findMany({
          where: { userId: authUserId, animeId: anime.id },
          select: { episodeId: true },
        }),
      ]);

      if (userAnime) {
        userTracking = {
          status: userAnime.status,
          episodesWatched: userAnime.episodesWatched,
          score: userAnime.score,
          favorite: userAnime.favorite,
          notes: userAnime.notes,
          startDate: userAnime.startDate ? userAnime.startDate.toISOString() : null,
          finishDate: userAnime.finishDate ? userAnime.finishDate.toISOString() : null,
        };
      }
      watchedEpisodeIds = progress.map((p) => p.episodeId);
    }

    const franchise = anime.franchiseItems[0]?.franchise || null;
    const mainTitle = getAnimeDisplayTitle(anime);
    // Official icon + brand colour per streaming site (AniList), for "Where to Watch".
    const platformArt = await getPlatformArt(anime.streamingAvailability.map((s) => s.provider));

    const detail: AnimeDetailDto = {
      id: anime.id,
      externalId: anime.externalId || anime.id,
      externalSource: anime.externalSource,
      malId: anime.malId,
      anilistId: anime.anilistId,
      slug: anime.slug,
      title: mainTitle,
      canonicalTitle: mainTitle,
      englishTitle: anime.titles.find((t) => t.type === 'english')?.title || null,
      japaneseTitle: anime.titles.find((t) => t.type === 'japanese')?.title || null,
      synopsis: anime.synopsis,
      background: anime.background,
      type: anime.type,
      source: anime.source,
      status: anime.status,
      country: anime.country,
      isAdult: anime.isAdult,
      episodes: anime.episodes,
      duration: anime.duration,
      rating: anime.rating,
      score: anime.score,
      scoredBy: anime.scoredBy,
      rank: anime.rank,
      popularity: anime.popularity,
      members: anime.members,
      favorites: anime.favoritesCount,
      dataCompletenessScore: anime.dataCompletenessScore,
      posterUrl: anime.posterUrl,
      largePosterUrl: anime.largePosterUrl,
      posterImage: anime.posterUrl,
      bannerUrl: anime.bannerUrl,
      bannerImage: anime.bannerUrl || anime.posterUrl,
      trailerUrl: anime.trailerUrl,
      season: anime.season,
      year: anime.year || anime.startYear,
      startDate: anime.startDate ? anime.startDate.toISOString() : null,
      endDate: anime.endDate ? anime.endDate.toISOString() : null,
      datePrecision: anime.datePrecision,
      broadcastDay: anime.broadcastDay,
      broadcastTime: anime.broadcastTime,
      broadcastTimezone: anime.broadcastTimezone,
      nextAiringEpisode: anime.nextAiringEpisode,
      nextAiringAt: anime.nextAiringAt ? anime.nextAiringAt.toISOString() : null,
      timeUntilAiring: anime.timeUntilAiring,
      genres: anime.animeGenres.map((ag) => ag.genre.name),
      themes: anime.animeThemes.map((at) => at.theme.name),
      titles: anime.titles.map((t) => ({ type: t.type, title: t.title, language: t.language, isPrimary: t.isPrimary })),
      tags: anime.animeTags.map((at) => ({ name: at.name, rank: at.rank, description: at.description, isMediaSpoiler: at.isMediaSpoiler })),
      studios: anime.animeStudios.map((as) => ({ id: as.studio.id, name: as.studio.name, slug: as.studio.slug })),
      // Official streaming listings (imported from AniList, or set by an
      // editor). Feeds "Where to Watch"; empty means nothing is recorded.
      streaming: dedupeStreaming(anime.streamingAvailability).map((s) => ({
        ...s,
        iconUrl: platformArt.get(s.name.toLowerCase())?.iconUrl ?? null,
        color: platformArt.get(s.name.toLowerCase())?.color ?? null,
      })),
      producers: anime.animeProducers.map((ap) => ({
        id: ap.producer.id,
        name: ap.producer.name,
        slug: ap.producer.slug || ap.producer.name.toLowerCase().replace(/[^a-z0-9]+/g, '-'),
      })),
      episodesList: anime.episodesList.map((ep) => ({
        id: ep.id,
        animeId: ep.animeId,
        seasonId: ep.seasonId,
        number: ep.number,
        absoluteEpisodeNumber: ep.absoluteEpisodeNumber,
        canonicalOrder: ep.canonicalOrder,
        title: ep.title,
        titleJapanese: ep.titleJapanese,
        synopsis: ep.synopsis,
        airedAt: ep.airedAt ? ep.airedAt.toISOString() : null,
        duration: ep.duration,
        filler: ep.filler,
        recap: ep.recap,
        status: ep.status,
        imageUrl: ep.imageUrl,
        isWatched: watchedEpisodeIds.includes(ep.id),
      })),
      directSeasons: anime.seasons.map((s) => ({
        id: s.id,
        seasonNumber: s.seasonNumber,
        title: s.title,
        slug: s.slug,
        description: s.description,
        coverImage: s.coverImage,
        year: s.year,
        seasonType: s.seasonType,
        startDate: s.startDate ? s.startDate.toISOString() : null,
        endDate: s.endDate ? s.endDate.toISOString() : null,
        episodeCount: s.episodeCount || 0,
        sortOrder: s.sortOrder,
      })),
      characters: anime.characters.map((ac) => ({
        id: ac.character.id,
        slug: ac.character.slug,
        name: ac.character.name,
        nameKanji: ac.character.nameKanji,
        about: ac.character.about,
        imageUrl: ac.character.imageUrl,
        role: ac.role,
        voiceActors: ac.character.voiceRoles.map((vr) => ({
          id: vr.person.id,
          slug: vr.person.slug,
          name: vr.person.name,
          nameKanji: vr.person.nameKanji,
          imageUrl: vr.person.imageUrl,
          language: vr.language,
        })),
      })),
      staff: anime.staff.map((as) => ({
        id: as.person.id,
        slug: as.person.slug,
        name: as.person.name,
        nameKanji: as.person.nameKanji,
        imageUrl: as.person.imageUrl,
        role: as.role,
      })),
      relations: anime.relationsFrom.map((rel) => {
        const relTitle = getAnimeDisplayTitle(rel.targetAnime);
        return {
          relationType: rel.relationType,
          targetAnime: {
            id: rel.targetAnime.id,
            slug: rel.targetAnime.slug,
            title: relTitle,
            canonicalTitle: relTitle,
            type: rel.targetAnime.type,
            posterUrl: rel.targetAnime.posterUrl,
            score: rel.targetAnime.score,
            year: rel.targetAnime.year || rel.targetAnime.startYear,
          },
        };
      }),
      franchise: franchise
        ? {
            id: franchise.id,
            name: franchise.name,
            slug: franchise.slug,
            description: franchise.description,
            productions: franchise.items.map((item) => {
              const itemTitle = getAnimeDisplayTitle(item.anime);
              return {
                id: item.anime.id,
                slug: item.anime.slug,
                title: itemTitle,
                canonicalTitle: itemTitle,
                type: item.anime.type,
                year: item.anime.year || item.anime.startYear,
                relationship: item.relationship,
                posterUrl: item.anime.posterUrl,
                score: item.anime.score,
              };
            }),
          }
        : null,
      discussions: anime.discussions,
      communities: anime.communities,
      userTracking,
      watchedEpisodeIds,
    };

    return detail;
  }
}

function dedupeStreaming(rows: Array<{ provider: string; url: string | null }>) {
  const seen = new Set<string>();
  const out: Array<{ name: string; url: string }> = [];
  for (const r of rows) {
    if (!r.url || seen.has(r.provider)) continue;
    seen.add(r.provider);
    out.push({ name: r.provider, url: r.url });
  }
  return out;
}
