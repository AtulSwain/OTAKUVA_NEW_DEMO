import {
  AnimeProvider,
  ProviderAnime,
  ProviderEpisode,
  ProviderCharacter,
  ProviderStaff,
  ProviderRelation,
  ProviderVideo,
  ProviderStatistics,
  ProviderPagination,
  ProviderAnimeTitle,
  ProviderDate,
  ProviderTag,
  ProviderStreamingLink,
} from './animeProvider.interface';
import { providerTrailerUrl } from '../media/trailer';

// [FLAGGED 2026-09-16 — see docs/production/THIRD_PARTY_DATA_COMPLIANCE.md
// §2] AniList's terms of use prohibit "using the AniList API as a backup
// or data storage service" and "hoarding or mass collection of data",
// and separately prohibit use within "competing noncomplementary
// services... including... Anime/Manga list/tracker services" unless the
// app provides "significant sustained integration/syncing with... AniList
// user accounts" — which this app doesn't have. OTAKUVA's whole
// architecture permanently ingests this data into its own canonical DB
// and is itself an anime tracking platform, which is in obvious tension
// with both clauses. This is a business/legal question, not something
// fixable in this file — see the linked doc before treating AniList as
// this app's default/primary catalog source at real scale.
const ANILIST_GRAPHQL = process.env.ANILIST_BASE_URL || 'https://graphql.anilist.co';
const ANILIST_TOKEN = process.env.ANILIST_TOKEN || '';

export interface AniListAiringItem {
  id: number;
  airingAt: number; // Unix timestamp
  timeUntilAiring: number; // seconds
  episode: number;
  media: {
    id: number;
    idMal?: number;
    title: {
      romaji?: string;
      english?: string;
      native?: string;
    };
    format?: string;
    status?: string;
    episodes?: number;
    coverImage?: {
      large?: string;
      extraLarge?: string;
    };
    bannerImage?: string;
    isAdult?: boolean;
    genres?: string[];
    averageScore?: number;
  };
}

// [FLAGGED 2026-09-16 — see docs/production/THIRD_PARTY_DATA_COMPLIANCE.md
// §1/§3] This 700ms interval is sized against AniList's *normal* 90
// req/min cap only. AniList's own docs have at times stated a temporary
// reduction to 30 req/min during a "degraded" period — this class has no
// way to know which cap is currently live, since it never reads the
// X-RateLimit-Limit/X-RateLimit-Remaining response headers AniList sends;
// it only reacts to Retry-After after already getting a 429 (see
// graphql() below). It's also a plain read-then-write timestamp check,
// not serialized across concurrent callers — jikanService.ts's throttle()
// had the identical race and had to move to a chained-promise queue for
// exactly this reason (see that file's header comment). Neither fixed
// here — flagging so whoever tunes this reads the linked doc first rather
// than just bumping the constant.
class RateLimiter {
  private lastRequest = 0;
  private minIntervalMs = 700; // ~85 req/min, safe under 90 req/min limit — NOT safe under a 30 req/min degraded cap, see comment above

  async throttle(): Promise<void> {
    const now = Date.now();
    const elapsed = now - this.lastRequest;
    if (elapsed < this.minIntervalMs) {
      await new Promise((r) => setTimeout(r, this.minIntervalMs - elapsed));
    }
    this.lastRequest = Date.now();
  }
}

const rateLimiter = new RateLimiter();

// Unlike src/lib/jikanService.ts's jikanFetch() (24h in-memory response
// cache), every call here is always live — no local caching in front of
// this. Flagged in docs/production/THIRD_PARTY_DATA_COMPLIANCE.md §1/§3
// as one of the things that would help both the rate-limit margin and
// AniList's own "don't hammer us" expectations.
async function graphql(query: string, variables: any = {}, retries = 3) {
  for (let attempt = 1; attempt <= retries; attempt++) {
    try {
      await rateLimiter.throttle();
      const headers: any = {
        'Content-Type': 'application/json',
        'Accept': 'application/json',
        'User-Agent': 'OTAKUVA/1.0 (Anime Culture & Knowledge Platform)',
      };
      if (ANILIST_TOKEN) headers['Authorization'] = `Bearer ${ANILIST_TOKEN}`;

      const res = await fetch(ANILIST_GRAPHQL, {
        method: 'POST',
        headers,
        body: JSON.stringify({ query, variables }),
      });

      if (res.status === 429) {
        const retryAfter = parseInt(res.headers.get('Retry-After') || '2', 10);
        console.warn(`AniList rate limited (429). Backing off for ${retryAfter}s (attempt ${attempt}/${retries})`);
        await new Promise((r) => setTimeout(r, (retryAfter + 1) * 1000));
        continue;
      }

      if (!res.ok) {
        if (res.status >= 500 && attempt < retries) {
          await new Promise((r) => setTimeout(r, attempt * 1500));
          continue;
        }
        throw new Error(`AniList GraphQL error ${res.status}`);
      }

      const json = await res.json();
      if (json.errors && json.errors.length > 0) {
        throw new Error(json.errors.map((e: any) => e.message).join('; '));
      }
      return json.data;
    } catch (err: any) {
      if (attempt === retries) throw err;
      await new Promise((r) => setTimeout(r, attempt * 1000));
    }
  }
}

function parseFuzzyDate(dateObj: any): ProviderDate | null {
  if (!dateObj || (!dateObj.year && !dateObj.month && !dateObj.day)) return null;
  const year = dateObj.year || null;
  const month = dateObj.month || null;
  const day = dateObj.day || null;

  let precision: 'YEAR' | 'MONTH' | 'DAY' | 'UNKNOWN' = 'UNKNOWN';
  if (year && month && day) {
    precision = 'DAY';
  } else if (year && month) {
    precision = 'MONTH';
  } else if (year) {
    precision = 'YEAR';
  }

  let date: Date | null = null;
  if (year) {
    date = new Date(Date.UTC(year, (month || 1) - 1, day || 1));
  }

  return { year, month, day, date, precision };
}

function mapTitles(media: any): ProviderAnimeTitle[] {
  const titles: ProviderAnimeTitle[] = [];
  if (media.title?.romaji) titles.push({ type: 'romaji', title: media.title.romaji, language: 'ja' });
  if (media.title?.english) titles.push({ type: 'english', title: media.title.english, language: 'en' });
  if (media.title?.native) titles.push({ type: 'japanese', title: media.title.native, language: 'ja' });
  if (Array.isArray(media.synonyms)) {
    media.synonyms.forEach((s: string) => {
      if (s && !titles.some((t) => t.title === s)) {
        titles.push({ type: 'synonym', title: s });
      }
    });
  }
  if (!titles.some((t) => t.type === 'official')) {
    const primary = media.title?.english || media.title?.romaji || media.title?.native;
    if (primary) titles.unshift({ type: 'official', title: primary });
  }
  return titles;
}

function mapFormat(format: string): string {
  switch (format) {
    case 'TV_SHORT':
    case 'TV':
      return 'TV';
    case 'MOVIE':
      return 'Movie';
    case 'OVA':
      return 'OVA';
    case 'ONA':
      return 'ONA';
    case 'SPECIAL':
      return 'Special';
    case 'MUSIC':
      return 'Music';
    default:
      return 'TV';
  }
}

function mapStatus(status: string): string {
  switch (status) {
    case 'FINISHED':
      return 'Finished';
    case 'RELEASING':
      return 'Airing';
    case 'NOT_YET_RELEASED':
      return 'Not Yet Aired';
    case 'CANCELLED':
      return 'Cancelled';
    case 'HIATUS':
      return 'Hiatus';
    default:
      return 'Finished';
  }
}

function mapSource(source: string): string {
  switch (source) {
    case 'MANGA':
      return 'Manga';
    case 'LIGHT_NOVEL':
      return 'Light Novel';
    case 'VISUAL_NOVEL':
      return 'Visual Novel';
    case 'VIDEO_GAME':
      return 'Video Game';
    case 'ORIGINAL':
      return 'Original';
    case 'NOVEL':
      return 'Novel';
    case 'WEB_NOVEL':
      return 'Web Novel';
    default:
      return source ? source.replace(/_/g, ' ') : 'Original';
  }
}

function mapStudiosAndProducers(media: any): {
  studios: { name: string; isMain?: boolean }[];
  producers: string[];
} {
  const studios: { name: string; isMain?: boolean }[] = [];
  const producers: string[] = [];

  if (media.studios?.edges && Array.isArray(media.studios.edges)) {
    media.studios.edges.forEach((edge: any) => {
      const name = edge.node?.name;
      if (!name) return;
      const isAnimationStudio = Boolean(edge.node?.isAnimationStudio || edge.isMain);
      if (isAnimationStudio) {
        studios.push({ name, isMain: Boolean(edge.isMain) });
      } else {
        producers.push(name);
      }
    });
  }

  // Fallback: If no animation studio was marked as main, take the first studio
  if (studios.length === 0 && producers.length > 0) {
    studios.push({ name: producers.shift()!, isMain: true });
  }

  return { studios, producers };
}

function mapTags(media: any): ProviderTag[] {
  if (!Array.isArray(media.tags)) return [];
  return media.tags.map((t: any) => ({
    name: t.name,
    description: t.description || null,
    rank: t.rank || 0,
    isMediaSpoiler: t.isMediaSpoiler || false,
  }));
}

export interface ProviderStaffDetails {
  anilistId: number;
  name: string | null;
  nameNative: string | null;
  imageUrl: string | null;
  about: string | null;
  occupations: string[];
  /** "YYYY-MM-DD", "YYYY-MM", "YYYY" or "--MM-DD" (no year), else null. */
  dateOfBirth: string | null;
  dateOfDeath: string | null;
  homeTown: string | null;
  yearsActive: string | null;
  /** Other names they're credited under (AniList name.alternative). */
  alternativeNames: string[];
  gender: string | null;
  bloodType: string | null;
  /** Primary language, e.g. "Japanese". */
  language: string | null;
  /** AniList members who favourited them. */
  favourites: number | null;
}

function fuzzyDateString(d: { year?: number | null; month?: number | null; day?: number | null } | null | undefined): string | null {
  if (!d) return null;
  const pad = (n: number) => String(n).padStart(2, '0');
  if (d.year && d.month && d.day) return `${d.year}-${pad(d.month)}-${pad(d.day)}`;
  if (d.year && d.month) return `${d.year}-${pad(d.month)}`;
  if (d.year) return String(d.year);
  if (d.month && d.day) return `--${pad(d.month)}-${pad(d.day)}`;
  return null;
}

// A markdown link; its label may hold one level of brackets ("[YouTube [ano]](…)").
const MD_LINK = /\[(?:[^[\]]|\[[^\]]*\])*\]\([^)]*\)/g;
const SITE_WORDS = /\b(?:official|website|site|homepage|blog|wiki|wikipedia|twitter|x|instagram|tiktok|youtube|facebook|pixiv|bluesky|threads|weibo|spotify|line|jp|en|ja)\b/gi;

/**
 * "[Wiki (jp)](…) | [Twitter](…)" or "Website | Twitter | [YouTube [ano]](…)":
 * a reference list, not prose. True only when the line has a link and,
 * once links, site names and separators are removed, nothing is left.
 */
function isLinkListLine(raw: string): boolean {
  const line = raw.replace(/\*\*|__|(?<![\w])[*_]|[*_](?![\w])/g, ''); // "__[Website](…)__" bold/italic wrappers
  const hasLink = MD_LINK.test(line);
  MD_LINK.lastIndex = 0;
  if (hasLink) {
    const rest = line.replace(MD_LINK, '').replace(/\([^)]*\)/g, '').replace(SITE_WORDS, '').replace(/[|,·•/\-\s]/g, '');
    if (rest.length === 0) return true;
  }
  // HTML links arrive as bare labels once tags are stripped:
  // "Website | Twitter | Instagram (run by staff)". Short pieces separated
  // by "|", at least one a site name or link — prose rarely looks like that.
  const pieces = line.replace(MD_LINK, 'link').split(/\s*[|·•]\s*/).map((p) => p.replace(/\([^)]*\)/g, '').trim()).filter(Boolean);
  if (pieces.length < 2 || !pieces.every((p) => p.split(/\s+/).length <= 4)) return false;
  return pieces.some((p) => p === 'link' || new RegExp(`^(?:${SITE_WORDS.source.replace(/\\b/g, '')})$`, 'i').test(p));
}

/** AniList staff descriptions are markdown with HTML bits; keep plain text, drop spoilers. */
export function plainTextBio(raw: string | null | undefined): string | null {
  if (!raw || typeof raw !== 'string') return null;
  const text = raw
    .replace(/~!([\s\S]*?)!~/g, '') // spoiler blocks
    .replace(/<br\s*\/?>/gi, '\n')
    .replace(/<[^>]+>/g, '')
    .replace(/!\[[^\]]*\]\([^)]*\)/g, '') // images
    .split('\n').filter((line) => !isLinkListLine(line)).join('\n')
    .replace(/\[((?:[^[\]]|\[[^\]]*\])+)\]\([^)]*\)/g, '$1') // links -> text
    .replace(/(\*\*|__)(.*?)\1/g, '$2')
    .replace(/(\*|_)(\S(?:.*?\S)?)\1/g, '$2')
    .replace(/^#+\s*/gm, '')
    .replace(/&nbsp;/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/[ \t]+\n/g, '\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
  return text || null;
}

function mapAniListAnime(media: any): ProviderAnime {
  const titles = mapTitles(media);
  const canonicalTitle = media.title?.english || media.title?.romaji || media.title?.native || 'Untitled Anime';
  const startDate = parseFuzzyDate(media.startDate);
  const endDate = parseFuzzyDate(media.endDate);
  const { studios, producers } = mapStudiosAndProducers(media);

  return {
    externalId: String(media.id),
    externalSource: 'anilist',
    malId: media.idMal || null,
    anilistId: media.id,
    title: canonicalTitle,
    titles,
    synopsis: media.description ? media.description.replace(/<[^>]*>?/gm, '').trim() : 'No synopsis available.',
    type: mapFormat(media.format),
    source: mapSource(media.source),
    status: mapStatus(media.status),
    country: media.countryOfOrigin || 'JP',
    isAdult: media.isAdult || false,
    episodes: media.episodes || null,
    duration: media.duration ? `${media.duration} mins` : null,
    startDate,
    endDate,
    season: media.season ? media.season.charAt(0) + media.season.slice(1).toLowerCase() : null,
    year: media.seasonYear || (startDate?.year ?? null),
    score: typeof media.averageScore === 'number' ? media.averageScore / 10 : null,
    popularity: media.popularity || null,
    favorites: media.favourites || null,
    // extraLarge (~460px wide) first: `large` is ~230px and looked soft and
    // grainy once scaled to card/hero sizes on high-density screens.
    posterUrl: media.coverImage?.extraLarge || media.coverImage?.large || media.coverImage?.medium || '',
    largePosterUrl: media.coverImage?.extraLarge || media.coverImage?.large || null,
    bannerUrl: media.bannerImage || null,
    trailerUrl: providerTrailerUrl(media.trailer?.site, media.trailer?.id),
    genres: Array.isArray(media.genres) ? media.genres : [],
    themes: [],
    tags: mapTags(media),
    studios,
    producers,
    licensors: [],
  };
}

const MEDIA_FIELDS = `
  id
  idMal
  title {
    romaji
    english
    native
  }
  synonyms
  description
  format
  status
  source
  countryOfOrigin
  isAdult
  episodes
  duration
  startDate {
    year
    month
    day
  }
  endDate {
    year
    month
    day
  }
  season
  seasonYear
  averageScore
  popularity
  favourites
  coverImage {
    extraLarge
    large
    medium
  }
  bannerImage
  trailer {
    id
    site
  }
  genres
  tags {
    name
    description
    rank
    isMediaSpoiler
  }
  studios {
    edges {
      isMain
      node {
        id
        name
        isAnimationStudio
      }
    }
  }
`;

export class AniListProvider implements AnimeProvider {
  public name: 'anilist' = 'anilist';

  async searchAnime(query: string, page = 1, limit = 20): Promise<{ items: ProviderAnime[]; pagination: ProviderPagination }> {
    const gql = `
      query ($query: String, $page: Int, $perPage: Int) {
        Page(page: $page, perPage: $perPage) {
          pageInfo {
            currentPage
            lastPage
            hasNextPage
            total
          }
          media(search: $query, type: ANIME, sort: SEARCH_MATCH) {
            ${MEDIA_FIELDS}
          }
        }
      }
    `;
    const data = await graphql(gql, { query, page, perPage: limit });
    const pageInfo = data?.Page?.pageInfo || {};
    const media = data?.Page?.media || [];

    return {
      items: media.map(mapAniListAnime),
      pagination: {
        currentPage: pageInfo.currentPage || page,
        lastVisiblePage: pageInfo.lastPage || page,
        hasNextPage: Boolean(pageInfo.hasNextPage),
        totalItems: pageInfo.total || 0,
      },
    };
  }

  async getAnime(externalId: string): Promise<ProviderAnime | null> {
    const id = parseInt(externalId, 10);
    if (isNaN(id)) return null;

    const gql = `
      query ($id: Int) {
        Media(id: $id, type: ANIME) {
          ${MEDIA_FIELDS}
        }
      }
    `;
    try {
      const data = await graphql(gql, { id });
      if (!data?.Media) return null;
      return mapAniListAnime(data.Media);
    } catch {
      return null;
    }
  }

  async getAnimeList(page = 1, limit = 50): Promise<{ items: ProviderAnime[]; pagination: ProviderPagination }> {
    const gql = `
      query ($page: Int, $perPage: Int) {
        Page(page: $page, perPage: $perPage) {
          pageInfo {
            currentPage
            lastPage
            hasNextPage
            total
          }
          media(type: ANIME, sort: POPULARITY_DESC) {
            ${MEDIA_FIELDS}
          }
        }
      }
    `;
    const data = await graphql(gql, { page, perPage: limit });
    const pageInfo = data?.Page?.pageInfo || {};
    const media = data?.Page?.media || [];

    return {
      items: media.map(mapAniListAnime),
      pagination: {
        currentPage: pageInfo.currentPage || page,
        lastVisiblePage: pageInfo.lastPage || page,
        hasNextPage: Boolean(pageInfo.hasNextPage),
        totalItems: pageInfo.total || 0,
      },
    };
  }

  /** Most popular non-adult anime in one AniList genre (e.g. "Thriller"). */
  async getAnimeByGenre(genre: string, page = 1, limit = 50): Promise<{ items: ProviderAnime[]; pagination: ProviderPagination }> {
    const gql = `
      query ($genre: String, $page: Int, $perPage: Int) {
        Page(page: $page, perPage: $perPage) {
          pageInfo {
            currentPage
            lastPage
            hasNextPage
            total
          }
          media(genre: $genre, type: ANIME, isAdult: false, sort: POPULARITY_DESC) {
            ${MEDIA_FIELDS}
          }
        }
      }
    `;
    const data = await graphql(gql, { genre, page, perPage: limit });
    const pageInfo = data?.Page?.pageInfo || {};
    const media = data?.Page?.media || [];

    return {
      items: media.map(mapAniListAnime),
      pagination: {
        currentPage: pageInfo.currentPage || page,
        lastVisiblePage: pageInfo.lastPage || page,
        hasNextPage: Boolean(pageInfo.hasNextPage),
        totalItems: pageInfo.total || 0,
      },
    };
  }

  async getTopAnime(page = 1, limit = 50): Promise<{ items: ProviderAnime[]; pagination: ProviderPagination }> {
    return this.getAnimeList(page, limit);
  }

  async getSeasonalAnime(year: number, season: string, page = 1, limit = 50): Promise<{ items: ProviderAnime[]; pagination: ProviderPagination }> {
    const gql = `
      query ($seasonYear: Int, $season: MediaSeason, $page: Int, $perPage: Int) {
        Page(page: $page, perPage: $perPage) {
          pageInfo {
            currentPage
            lastPage
            hasNextPage
            total
          }
          media(seasonYear: $seasonYear, season: $season, type: ANIME, sort: POPULARITY_DESC) {
            ${MEDIA_FIELDS}
          }
        }
      }
    `;
    const seasonUpper = season.toUpperCase();
    const data = await graphql(gql, { seasonYear: year, season: seasonUpper, page, perPage: limit });
    const pageInfo = data?.Page?.pageInfo || {};
    const media = data?.Page?.media || [];

    return {
      items: media.map(mapAniListAnime),
      pagination: {
        currentPage: pageInfo.currentPage || page,
        lastVisiblePage: pageInfo.lastPage || page,
        hasNextPage: Boolean(pageInfo.hasNextPage),
        totalItems: pageInfo.total || 0,
      },
    };
  }

  async getUpcomingAnime(page = 1, limit = 50): Promise<{ items: ProviderAnime[]; pagination: ProviderPagination }> {
    const gql = `
      query ($page: Int, $perPage: Int) {
        Page(page: $page, perPage: $perPage) {
          pageInfo {
            currentPage
            lastPage
            hasNextPage
            total
          }
          media(status: NOT_YET_RELEASED, type: ANIME, sort: POPULARITY_DESC) {
            ${MEDIA_FIELDS}
          }
        }
      }
    `;
    const data = await graphql(gql, { page, perPage: limit });
    const pageInfo = data?.Page?.pageInfo || {};
    const media = data?.Page?.media || [];

    return {
      items: media.map(mapAniListAnime),
      pagination: {
        currentPage: pageInfo.currentPage || page,
        lastVisiblePage: pageInfo.lastPage || page,
        hasNextPage: Boolean(pageInfo.hasNextPage),
        totalItems: pageInfo.total || 0,
      },
    };
  }

  async getHistoricalAnime(startYear: number, endYear: number, page = 1, limit = 50): Promise<{ items: ProviderAnime[]; pagination: ProviderPagination }> {
    const startDateGreater = startYear * 10000;
    const startDateLesser = (endYear + 1) * 10000;

    const gql = `
      query ($startDate_greater: FuzzyDateInt, $startDate_lesser: FuzzyDateInt, $page: Int, $perPage: Int) {
        Page(page: $page, perPage: $perPage) {
          pageInfo {
            currentPage
            lastPage
            hasNextPage
            total
          }
          media(startDate_greater: $startDate_greater, startDate_lesser: $startDate_lesser, type: ANIME, sort: POPULARITY_DESC) {
            ${MEDIA_FIELDS}
          }
        }
      }
    `;
    const data = await graphql(gql, { startDate_greater: startDateGreater, startDate_lesser: startDateLesser, page, perPage: limit });
    const pageInfo = data?.Page?.pageInfo || {};
    const media = data?.Page?.media || [];

    return {
      items: media.map(mapAniListAnime),
      pagination: {
        currentPage: pageInfo.currentPage || page,
        lastVisiblePage: pageInfo.lastPage || page,
        hasNextPage: Boolean(pageInfo.hasNextPage),
        totalItems: pageInfo.total || 0,
      },
    };
  }

  /**
   * Every anime whose start date falls in one calendar year, in stable id
   * order (so paging through a whole year never skips or repeats a title).
   * Year-only dates are stored as YYYY0000, hence the `- 1` on the lower
   * bound — getHistoricalAnime's `> YYYY0000` misses exactly those.
   */
  async getAnimeByStartYear(year: number, page = 1, limit = 50): Promise<{ items: ProviderAnime[]; pagination: ProviderPagination }> {
    const gql = `
      query ($gt: FuzzyDateInt, $lt: FuzzyDateInt, $page: Int, $perPage: Int) {
        Page(page: $page, perPage: $perPage) {
          pageInfo { currentPage lastPage hasNextPage total }
          media(startDate_greater: $gt, startDate_lesser: $lt, type: ANIME, sort: ID) {
            ${MEDIA_FIELDS}
          }
        }
      }
    `;
    const data = await graphql(gql, { gt: year * 10000 - 1, lt: (year + 1) * 10000, page, perPage: limit });
    const pageInfo = data?.Page?.pageInfo || {};
    return {
      items: (data?.Page?.media || []).map(mapAniListAnime),
      pagination: {
        currentPage: pageInfo.currentPage || page,
        lastVisiblePage: pageInfo.lastPage || page,
        hasNextPage: Boolean(pageInfo.hasNextPage),
        totalItems: pageInfo.total || 0,
      },
    };
  }

  /**
   * Newest announcements first: not-yet-released, non-adult anime in
   * descending AniList id order. AniList creates an entry when a show is
   * announced, so the highest ids are the latest announcements.
   */
  async getRecentlyAnnouncedAnime(page = 1, limit = 50): Promise<{ items: ProviderAnime[]; pagination: ProviderPagination }> {
    const gql = `
      query ($page: Int, $perPage: Int) {
        Page(page: $page, perPage: $perPage) {
          pageInfo { currentPage lastPage hasNextPage total }
          media(status: NOT_YET_RELEASED, type: ANIME, isAdult: false, sort: ID_DESC) {
            ${MEDIA_FIELDS}
          }
        }
      }
    `;
    const data = await graphql(gql, { page, perPage: limit });
    const pageInfo = data?.Page?.pageInfo || {};
    return {
      items: (data?.Page?.media || []).map(mapAniListAnime),
      pagination: {
        currentPage: pageInfo.currentPage || page,
        lastVisiblePage: pageInfo.lastPage || page,
        hasNextPage: Boolean(pageInfo.hasNextPage),
        totalItems: pageInfo.total || 0,
      },
    };
  }

  /** Not-yet-released anime (many have no start date at all), stable id order. */
  async getUnreleasedAnime(page = 1, limit = 50): Promise<{ items: ProviderAnime[]; pagination: ProviderPagination }> {
    const gql = `
      query ($page: Int, $perPage: Int) {
        Page(page: $page, perPage: $perPage) {
          pageInfo { currentPage lastPage hasNextPage total }
          media(status: NOT_YET_RELEASED, type: ANIME, sort: ID) {
            ${MEDIA_FIELDS}
          }
        }
      }
    `;
    const data = await graphql(gql, { page, perPage: limit });
    const pageInfo = data?.Page?.pageInfo || {};
    return {
      items: (data?.Page?.media || []).map(mapAniListAnime),
      pagination: {
        currentPage: pageInfo.currentPage || page,
        lastVisiblePage: pageInfo.lastPage || page,
        hasNextPage: Boolean(pageInfo.hasNextPage),
        totalItems: pageInfo.total || 0,
      },
    };
  }

  async getAnimeEpisodes(externalId: string, page = 1): Promise<{ episodes: ProviderEpisode[]; pagination: ProviderPagination }> {
    const id = parseInt(externalId, 10);
    if (isNaN(id)) return { episodes: [], pagination: { currentPage: 1, lastVisiblePage: 1, hasNextPage: false } };

    const gql = `
      query ($id: Int) {
        Media(id: $id, type: ANIME) {
          episodes
          streamingEpisodes {
            title
            thumbnail
            url
            site
          }
        }
      }
    `;
    try {
      const data = await graphql(gql, { id });
      const media = data?.Media;
      const episodes: ProviderEpisode[] = [];
      const streaming = media?.streamingEpisodes || [];

      if (streaming.length > 0) {
        streaming.forEach((s: any, idx: number) => {
          episodes.push({
            number: idx + 1,
            title: s.title || `Episode ${idx + 1}`,
            imageUrl: s.thumbnail || null,
            externalUrl: s.url || null,
            filler: false,
            recap: false,
          });
        });
      } else if (media?.episodes) {
        for (let i = 1; i <= media.episodes; i++) {
          episodes.push({
            number: i,
            title: `Episode ${i}`,
            filler: false,
            recap: false,
          });
        }
      }

      return {
        episodes,
        pagination: { currentPage: 1, lastVisiblePage: 1, hasNextPage: false, totalItems: episodes.length },
      };
    } catch {
      return { episodes: [], pagination: { currentPage: 1, lastVisiblePage: 1, hasNextPage: false } };
    }
  }

  async getAnimeCharacters(externalId: string): Promise<ProviderCharacter[]> {
    const id = parseInt(externalId, 10);
    if (isNaN(id)) return [];

    const gql = `
      query ($id: Int) {
        Media(id: $id, type: ANIME) {
          characters(perPage: 25, sort: [ROLE, RELEVANCE]) {
            edges {
              role
              node {
                id
                name {
                  full
                  native
                }
                description
                image {
                  large
                }
              }
              voiceActors(language: JAPANESE) {
                id
                name {
                  full
                  native
                }
                image {
                  large
                }
                language
              }
            }
          }
        }
      }
    `;
    try {
      const data = await graphql(gql, { id });
      const edges = data?.Media?.characters?.edges || [];

      return edges.map((edge: any) => ({
        externalId: String(edge.node.id),
        name: edge.node.name?.full || 'Unknown Character',
        nameKanji: edge.node.name?.native || null,
        about: edge.node.description || null,
        imageUrl: edge.node.image?.large || null,
        role: edge.role === 'MAIN' ? 'Main' : 'Supporting',
        voiceActors: (edge.voiceActors || []).map((va: any) => ({
          personExternalId: String(va.id),
          personName: va.name?.full || 'Unknown Voice Actor',
          personKanji: va.name?.native || null,
          personImage: va.image?.large || null,
          language: 'Japanese',
        })),
      }));
    } catch {
      return [];
    }
  }

  async getAnimeStaff(externalId: string): Promise<ProviderStaff[]> {
    const id = parseInt(externalId, 10);
    if (isNaN(id)) return [];

    const gql = `
      query ($id: Int) {
        Media(id: $id, type: ANIME) {
          staff(perPage: 25) {
            edges {
              role
              node {
                id
                name {
                  full
                  native
                }
                image {
                  large
                }
              }
            }
          }
        }
      }
    `;
    try {
      const data = await graphql(gql, { id });
      const edges = data?.Media?.staff?.edges || [];

      return edges.map((edge: any) => ({
        personExternalId: String(edge.node.id),
        personName: edge.node.name?.full || 'Unknown Staff',
        personKanji: edge.node.name?.native || null,
        personImage: edge.node.image?.large || null,
        positions: edge.role ? [edge.role] : ['Staff'],
      }));
    } catch {
      return [];
    }
  }

  async getAnimeRelations(externalId: string): Promise<ProviderRelation[]> {
    const id = parseInt(externalId, 10);
    if (isNaN(id)) return [];

    const gql = `
      query ($id: Int) {
        Media(id: $id, type: ANIME) {
          relations {
            edges {
              relationType
              node {
                id
                title {
                  romaji
                  english
                  native
                }
                format
              }
            }
          }
        }
      }
    `;
    try {
      const data = await graphql(gql, { id });
      const edges = data?.Media?.relations?.edges || [];

      return edges.map((edge: any) => ({
        relationType: edge.relationType ? edge.relationType.replace(/_/g, ' ') : 'Other',
        relatedExternalId: String(edge.node.id),
        relatedTitle: edge.node.title?.english || edge.node.title?.romaji || edge.node.title?.native || 'Unknown Title',
        format: edge.node.format || null,
      }));
    } catch {
      return [];
    }
  }

  /**
   * Anime-to-anime relations for up to 50 anime at once, looked up by MAL
   * id. relationType is AniList's enum (SEQUEL, PREQUEL, SIDE_STORY, ...).
   */
  /** Staff credits for up to 25 anime per request, keyed by AniList anime id. */
  async getStaffByAnilistIds(anilistIds: number[]): Promise<Map<number, ProviderStaff[]>> {
    const out = new Map<number, ProviderStaff[]>();
    const ids = anilistIds.slice(0, 25);
    if (ids.length === 0) return out;
    const gql = `
      query ($ids: [Int], $perPage: Int) {
        Page(perPage: $perPage) {
          media(id_in: $ids, type: ANIME) {
            id
            staff(perPage: 25, sort: [RELEVANCE, ID]) {
              edges { role node { id name { full native } image { large } } }
            }
          }
        }
      }
    `;
    const data = await graphql(gql, { ids, perPage: ids.length });
    for (const m of data?.Page?.media || []) {
      if (!m?.id) continue;
      out.set(
        m.id,
        (m.staff?.edges || [])
          .filter((e: any) => e?.node?.id && e.node.name?.full)
          .map((e: any) => ({
            personExternalId: String(e.node.id),
            personName: e.node.name.full,
            personKanji: e.node.name.native || null,
            personImage: e.node.image?.large || null,
            positions: e.role ? [e.role] : ['Staff'],
          }))
      );
    }
    return out;
  }

  /**
   * Characters (main first, up to 50 per anime) with their Japanese voice
   * actors, plus the animation studios, for up to 6 anime per request
   * (kept small so the query stays under AniList's complexity limit).
   * Used by scripts/import_characters_studios_anilist.ts. Missing fields stay
   * null; nothing is invented.
   */
  async getCharactersAndStudiosByAnilistIds(anilistIds: number[]): Promise<
    Map<
      number,
      {
        characters: {
          id: number;
          name: string;
          native: string | null;
          image: string | null;
          role: string;
          voiceActors: { id: number; name: string; native: string | null; image: string | null }[];
        }[];
        hasMoreCharacters: boolean;
        studios: { id: number; name: string; isMain: boolean; isAnimationStudio: boolean }[];
      }
    >
  > {
    const out = new Map();
    const ids = anilistIds.slice(0, 6);
    if (ids.length === 0) return out;
    const gql = `
      query ($ids: [Int], $perPage: Int) {
        Page(perPage: $perPage) {
          media(id_in: $ids, type: ANIME) {
            id
            characters(perPage: 50, sort: [ROLE, RELEVANCE, ID]) {
              pageInfo { hasNextPage }
              edges {
                role
                node { id name { full native } image { large } }
                voiceActors(language: JAPANESE, sort: [RELEVANCE, ID]) { id name { full native } image { large } }
              }
            }
            studios { edges { isMain node { id name isAnimationStudio } } }
          }
        }
      }
    `;
    const data = await graphql(gql, { ids, perPage: ids.length });
    for (const m of data?.Page?.media || []) {
      if (!m?.id) continue;
      out.set(m.id, {
        characters: (m.characters?.edges || [])
          .filter((e: any) => e?.node?.id && e.node.name?.full)
          .map((e: any) => ({
            id: e.node.id,
            name: e.node.name.full,
            native: e.node.name.native || null,
            image: e.node.image?.large || null,
            role: e.role || 'SUPPORTING',
            voiceActors: (e.voiceActors || [])
              .filter((v: any) => v?.id && v.name?.full)
              .map((v: any) => ({ id: v.id, name: v.name.full, native: v.name.native || null, image: v.image?.large || null })),
          })),
        hasMoreCharacters: Boolean(m.characters?.pageInfo?.hasNextPage),
        studios: (m.studios?.edges || [])
          .filter((e: any) => e?.node?.id && e.node.name)
          .map((e: any) => ({ id: e.node.id, name: e.node.name, isMain: Boolean(e.isMain), isAnimationStudio: Boolean(e.node.isAnimationStudio) })),
      });
    }
    return out;
  }

  /**
   * Profile details for up to 50 AniList staff (people) per request. The
   * bio is reduced to plain text: AniList markdown/HTML is stripped and
   * spoiler blocks are dropped entirely. Missing fields stay null.
   */
  async getStaffDetails(staffIds: number[]): Promise<Map<number, ProviderStaffDetails>> {
    const out = new Map<number, ProviderStaffDetails>();
    const ids = staffIds.slice(0, 50);
    if (ids.length === 0) return out;
    const gql = `
      query ($ids: [Int], $perPage: Int) {
        Page(perPage: $perPage) {
          staff(id_in: $ids) {
            id
            name { full native alternative }
            image { large }
            description(asHtml: false)
            primaryOccupations
            gender
            bloodType
            languageV2
            favourites
            dateOfBirth { year month day }
            dateOfDeath { year month day }
            homeTown
            yearsActive
          }
        }
      }
    `;
    const data = await graphql(gql, { ids, perPage: ids.length });
    for (const s of data?.Page?.staff || []) {
      if (!s?.id) continue;
      const years: number[] = Array.isArray(s.yearsActive) ? s.yearsActive.filter((y: any) => Number.isInteger(y)) : [];
      out.set(s.id, {
        anilistId: s.id,
        name: s.name?.full || null,
        nameNative: s.name?.native || null,
        imageUrl: s.image?.large && !/\/default\.jpg$/.test(s.image.large) ? s.image.large : null,
        about: plainTextBio(s.description),
        occupations: Array.isArray(s.primaryOccupations) ? s.primaryOccupations.filter(Boolean) : [],
        dateOfBirth: fuzzyDateString(s.dateOfBirth),
        dateOfDeath: fuzzyDateString(s.dateOfDeath),
        homeTown: typeof s.homeTown === 'string' && s.homeTown.trim() ? s.homeTown.trim() : null,
        // [start] = still active; [start, end] = active range.
        yearsActive: years.length === 0 ? null : years.length === 1 ? `${years[0]}–present` : `${years[0]}–${years[1]}`,
        alternativeNames: Array.isArray(s.name?.alternative)
          ? Array.from(new Set<string>(s.name.alternative.filter((n: unknown): n is string => typeof n === 'string' && n.trim() !== '').map((n: string) => n.trim()))).slice(0, 8)
          : [],
        gender: typeof s.gender === 'string' && s.gender.trim() ? s.gender.trim() : null,
        bloodType: typeof s.bloodType === 'string' && s.bloodType.trim() ? s.bloodType.trim() : null,
        language: typeof s.languageV2 === 'string' && s.languageV2.trim() ? s.languageV2.trim() : null,
        favourites: Number.isInteger(s.favourites) ? s.favourites : null,
      });
    }
    return out;
  }

  async getRelationsByMalIds(malIds: number[]) {
    return this.getRelationsByIds(malIds, 'mal');
  }

  /** Relations for up to 50 anime, keyed by the id kind asked for (AniList id or MAL id). */
  async getRelationsByIds(ids: number[], by: 'anilist' | 'mal'): Promise<
    Map<number, Array<{ relationType: string; anilistId: number; malId: number | null; format: string | null; isAdult: boolean }>>
  > {
    const out = new Map<number, Array<{ relationType: string; anilistId: number; malId: number | null; format: string | null; isAdult: boolean }>>();
    if (ids.length === 0) return out;
    const filter = by === 'anilist' ? 'id_in' : 'idMal_in';
    const gql = `
      query ($ids: [Int], $perPage: Int) {
        Page(perPage: $perPage) {
          media(${filter}: $ids, type: ANIME) {
            id
            idMal
            relations { edges { relationType node { id idMal type format isAdult } } }
          }
        }
      }
    `;
    const data = await graphql(gql, { ids: ids.slice(0, 50), perPage: 50 });
    for (const m of data?.Page?.media || []) {
      const key = by === 'anilist' ? m?.id : m?.idMal;
      if (!key) continue;
      const edges = (m.relations?.edges || [])
        .filter((e: any) => e?.node?.type === 'ANIME' && e.relationType)
        .map((e: any) => ({
          relationType: String(e.relationType),
          anilistId: e.node.id,
          malId: e.node.idMal ?? null,
          format: e.node.format ?? null,
          isAdult: Boolean(e.node.isAdult),
        }));
      out.set(key, edges);
    }
    return out;
  }

  /**
   * Banner images for up to 50 anime at once, looked up by MAL id. Only
   * entries AniList actually has a banner for are returned.
   */
  async getBannersByMalIds(malIds: number[]): Promise<Map<number, { bannerUrl: string; anilistId: number }>> {
    const out = new Map<number, { bannerUrl: string; anilistId: number }>();
    if (malIds.length === 0) return out;
    const gql = `
      query ($ids: [Int], $perPage: Int) {
        Page(perPage: $perPage) {
          media(idMal_in: $ids, type: ANIME) { id idMal bannerImage }
        }
      }
    `;
    const data = await graphql(gql, { ids: malIds.slice(0, 50), perPage: 50 });
    for (const m of data?.Page?.media || []) {
      if (m?.idMal && typeof m.bannerImage === 'string' && m.bannerImage) {
        out.set(m.idMal, { bannerUrl: m.bannerImage, anilistId: m.id });
      }
    }
    return out;
  }

  /**
   * Largest cover art (`coverImage.extraLarge`, ~460px wide) for up to 50
   * anime, by AniList id or MAL id. Keyed by the id kind asked for; a missing
   * key means AniList returned nothing for it.
   */
  async getCoversByIds(
    ids: number[],
    by: 'anilist' | 'mal'
  ): Promise<Map<number, { anilistId: number; extraLarge: string; large: string | null }>> {
    const out = new Map<number, { anilistId: number; extraLarge: string; large: string | null }>();
    if (ids.length === 0) return out;
    const filter = by === 'anilist' ? 'id_in' : 'idMal_in';
    const gql = `
      query ($ids: [Int], $perPage: Int) {
        Page(perPage: $perPage) {
          media(${filter}: $ids, type: ANIME) { id idMal coverImage { extraLarge large } }
        }
      }
    `;
    const data = await graphql(gql, { ids: ids.slice(0, 50), perPage: 50 });
    for (const m of data?.Page?.media || []) {
      const key = by === 'anilist' ? m?.id : m?.idMal;
      const xl = m?.coverImage?.extraLarge;
      if (key && typeof xl === 'string' && xl && !/\/default\.(?:jpg|png)$/i.test(xl)) {
        out.set(key, { anilistId: m.id, extraLarge: xl, large: m.coverImage?.large || null });
      }
    }
    return out;
  }

  /**
   * Official streaming links (AniList `externalLinks` of type STREAMING —
   * Crunchyroll, Netflix, …) for up to 50 anime, looked up by AniList id or
   * by MAL id. Only media AniList actually returned appear in the map, so a
   * missing key means "no answer", never "no streaming".
   */
  async getStreamingLinks(
    ids: number[],
    by: 'anilist' | 'mal'
  ): Promise<Map<number, { anilistId: number; links: ProviderStreamingLink[] }>> {
    const out = new Map<number, { anilistId: number; links: ProviderStreamingLink[] }>();
    if (ids.length === 0) return out;
    const filter = by === 'anilist' ? 'id_in' : 'idMal_in';
    const gql = `
      query ($ids: [Int], $perPage: Int) {
        Page(perPage: $perPage) {
          media(${filter}: $ids, type: ANIME) {
            id
            idMal
            externalLinks { site url type language }
          }
        }
      }
    `;
    const data = await graphql(gql, { ids: ids.slice(0, 50), perPage: 50 });
    for (const m of data?.Page?.media || []) {
      const key = by === 'anilist' ? m?.id : m?.idMal;
      if (!key) continue;
      const links: ProviderStreamingLink[] = (m.externalLinks || [])
        .filter((l: any) => l?.type === 'STREAMING' && typeof l.site === 'string' && typeof l.url === 'string' && /^https?:\/\//.test(l.url))
        .map((l: any) => ({ name: l.site, url: l.url, language: l.language || null }));
      out.set(key, { anilistId: m.id, links });
    }
    return out;
  }

  /**
   * Every streaming site AniList knows, with its official icon and brand
   * colour (ExternalLinkSourceCollection). One request; used for the logos
   * in "Where to Watch".
   */
  async getStreamingSources(): Promise<Array<{ id: number; site: string; icon: string | null; color: string | null }>> {
    const gql = `
      query {
        ExternalLinkSourceCollection(type: STREAMING, mediaType: ANIME) { id site icon color }
      }
    `;
    const data = await graphql(gql, {});
    return (data?.ExternalLinkSourceCollection || [])
      .filter((x: any) => typeof x?.site === 'string' && x.site.trim())
      .map((x: any) => ({
        id: Number(x.id),
        site: String(x.site).trim(),
        icon: typeof x.icon === 'string' && /^https:\/\//.test(x.icon) ? x.icon : null,
        color: typeof x.color === 'string' && /^#[0-9a-f]{3,8}$/i.test(x.color) ? x.color : null,
      }));
  }

  async getAiringSchedule(
    airingAtGreater: number,
    airingAtLesser: number,
    page = 1,
    perPage = 50
  ): Promise<{ items: AniListAiringItem[]; pagination: ProviderPagination }> {
    const gql = `
      query ($airingAt_greater: Int, $airingAt_lesser: Int, $page: Int, $perPage: Int) {
        Page(page: $page, perPage: $perPage) {
          pageInfo {
            currentPage
            lastPage
            hasNextPage
            total
          }
          airingSchedules(
            airingAt_greater: $airingAt_greater,
            airingAt_lesser: $airingAt_lesser,
            sort: TIME
          ) {
            id
            airingAt
            timeUntilAiring
            episode
            media {
              id
              idMal
              title {
                romaji
                english
                native
              }
              format
              status
              episodes
              coverImage {
                extraLarge
                large
              }
              bannerImage
              genres
              averageScore
              isAdult
            }
          }
        }
      }
    `;
    const data = await graphql(gql, {
      airingAt_greater: airingAtGreater,
      airingAt_lesser: airingAtLesser,
      page,
      perPage,
    });
    const pageInfo = data?.Page?.pageInfo || {};
    const items = data?.Page?.airingSchedules || [];

    return {
      items,
      pagination: {
        currentPage: pageInfo.currentPage || page,
        lastVisiblePage: pageInfo.lastPage || page,
        hasNextPage: Boolean(pageInfo.hasNextPage),
        totalItems: pageInfo.total || 0,
      },
    };
  }
}

export const anilistProvider = new AniListProvider();
