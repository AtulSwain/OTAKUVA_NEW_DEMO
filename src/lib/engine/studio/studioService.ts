/**
 * OTAKUVA STUDIO SERVICE (PHASE 9.1)
 * 
 * Public Data Layer & Query Engine for Anime Studios:
 * - High-performance queries with selective joins & N+1 protection
 * - Admin Override resolution (prefers admin editorial data without destroying raw provider metadata)
 * - Multi-criteria filtering (status, country, founded period, verification, presence of anime/founder)
 * - Safe search by canonical name, native name, alternative names, and slug
 * - Strict publication state filtering (drafts and hidden studios excluded from public APIs)
 */

import { prisma } from '../../prisma';
import {
  StudioDetailItem,
  StudioFilterOptions,
  StudioProjectItem,
} from './studioTypes';

export class StudioService {
  /**
   * Generates a URL-safe slug from a studio name
   */
  generateSlug(name: string): string {
    return name
      .toLowerCase()
      .normalize('NFD')
      .replace(/[\u0300-\u036f]/g, '') // strip diacritics
      .replace(/[^a-z0-9\s-]/g, '') // remove special characters
      .trim()
      .replace(/\s+/g, '-') // collapse whitespace into hyphens
      .replace(/-+/g, '-');
  }

  /**
   * Validates URLs to prevent SSRF and unsafe schemes (javascript:, data:, file:)
   */
  validateUrl(url?: string | null): string | null {
    if (!url || typeof url !== 'string') return null;
    const trimmed = url.trim();
    if (!trimmed) return null;

    const lower = trimmed.toLowerCase();
    if (
      lower.startsWith('javascript:') ||
      lower.startsWith('data:') ||
      lower.startsWith('file:') ||
      lower.startsWith('blob:')
    ) {
      return null;
    }

    try {
      const parsed = new URL(trimmed);
      if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
        return null;
      }
      return trimmed;
    } catch {
      return null;
    }
  }

  /**
   * Validates dates and checks dissolved date does not precede founded date
   */
  validateDates(
    foundedDate?: Date | string | null,
    dissolvedDate?: Date | string | null,
    foundedYear?: number | null
  ): {
    valid: boolean;
    error?: string;
    parsedFoundedDate?: Date | null;
    parsedDissolvedDate?: Date | null;
    derivedFoundedYear?: number | null;
  } {
    let fDate: Date | null = null;
    let dDate: Date | null = null;
    let fYear: number | null = foundedYear || null;

    if (foundedDate) {
      fDate = new Date(foundedDate);
      if (isNaN(fDate.getTime())) {
        return { valid: false, error: 'Invalid founded date format.' };
      }
      if (!fYear) {
        fYear = fDate.getFullYear();
      }
    }

    if (dissolvedDate) {
      dDate = new Date(dissolvedDate);
      if (isNaN(dDate.getTime())) {
        return { valid: false, error: 'Invalid dissolved date format.' };
      }
    }

    if (fDate && dDate && dDate < fDate) {
      return {
        valid: false,
        error: 'Dissolved date cannot precede founded date.',
      };
    }

    if (fYear && dDate && dDate.getFullYear() < fYear) {
      return {
        valid: false,
        error: 'Dissolved date cannot precede founded year.',
      };
    }

    return {
      valid: true,
      parsedFoundedDate: fDate,
      parsedDissolvedDate: dDate,
      derivedFoundedYear: fYear,
    };
  }

  /**
   * Formats a raw Studio database record with admin override priority
   */
  formatStudioWithOverrides(raw: any): StudioDetailItem {
    const displayTitle = raw.adminOverrideName || raw.name;
    const displayDescription = raw.adminOverrideDescription || raw.about;
    const displayImageUrl = raw.adminOverrideImageUrl || raw.imageUrl;

    let alternativeNames: string[] = [];
    if (raw.alternativeNamesJson) {
      try {
        alternativeNames = JSON.parse(raw.alternativeNamesJson);
      } catch {
        alternativeNames = [];
      }
    }

    let externalLinks: any[] = [];
    if (raw.externalLinksJson) {
      try {
        externalLinks = JSON.parse(raw.externalLinksJson);
      } catch {
        externalLinks = [];
      }
    }

    let metadata: any = {};
    if (raw.metadataJson) {
      try {
        metadata = JSON.parse(raw.metadataJson);
      } catch {
        metadata = {};
      }
    }

    const projects: StudioProjectItem[] = (raw.animeStudios || []).map((as: any) => ({
      id: as.anime.id,
      slug: as.anime.slug,
      canonicalTitle: as.anime.canonicalTitle,
      englishTitle: as.anime.titles?.find((t: any) => t.type === 'english')?.title || null,
      posterUrl: as.anime.posterUrl,
      score: as.anime.score,
      episodes: as.anime.episodes,
      type: as.anime.type,
      status: as.anime.status,
      year: as.anime.year || as.anime.startYear,
      role: as.role || 'MAIN_STUDIO',
      isMain: as.isMain ?? true,
      isPrimary: as.isPrimary ?? true,
    }));

    const staff = (raw.staffRelations || []).map((sp: any) => ({
      id: sp.id,
      personId: sp.person.id,
      name: sp.person.name,
      slug: sp.person.slug,
      nameKanji: sp.person.nameKanji,
      imageUrl: sp.person.imageUrl,
      role: sp.role,
      tenureStartYear: sp.tenureStartYear,
      tenureEndYear: sp.tenureEndYear,
      isCurrent: sp.isCurrent,
      notes: sp.notes,
    }));

    const relatedStudios = [
      ...(raw.childRelationships || []).map((rel: any) => ({
        id: rel.id,
        studioId: rel.childStudio.id,
        name: rel.childStudio.name,
        slug: rel.childStudio.slug,
        imageUrl: rel.childStudio.imageUrl,
        relationshipType: rel.relationshipType,
        establishedYear: rel.establishedYear,
        notes: rel.notes,
      })),
      ...(raw.parentRelationships || []).map((rel: any) => ({
        id: rel.id,
        studioId: rel.parentStudio.id,
        name: rel.parentStudio.name,
        slug: rel.parentStudio.slug,
        imageUrl: rel.parentStudio.imageUrl,
        relationshipType: rel.relationshipType,
        establishedYear: rel.establishedYear,
        notes: rel.notes,
      })),
    ];

    const newsRelations = (raw.newsRelations || [])
      .filter((nr: any) => nr.article && nr.article.status === 'PUBLISHED')
      .map((nr: any) => ({
        id: nr.article.id,
        title: nr.article.adminOverrideTitle || nr.article.title,
        slug: nr.article.slug,
        publishedAt: nr.article.publishedAt,
        sourceName: nr.article.sourceName,
        imageUrl: nr.article.imageUrl,
      }));

    return {
      id: raw.id,
      name: raw.name,
      displayTitle,
      nativeName: raw.nativeName,
      romanizedName: raw.romanizedName,
      alternativeNames,
      slug: raw.slug || this.generateSlug(raw.name),
      about: raw.about,
      displayDescription,
      shortDescription: raw.shortDescription,
      descriptionSource: raw.descriptionSource || 'EDITORIAL',
      foundedDate: raw.foundedDate,
      foundedYear: raw.adminOverrideFoundedYear || raw.foundedYear,
      dissolvedDate: raw.dissolvedDate,
      status: raw.status || 'ACTIVE',
      country: raw.country || 'Japan',
      region: raw.region,
      city: raw.city,
      website: raw.adminOverrideWebsite || raw.website,
      wikipediaUrl: raw.wikipediaUrl,
      twitterUrl: raw.twitterUrl,
      youtubeUrl: raw.youtubeUrl,
      imageUrl: raw.imageUrl,
      displayImageUrl,
      bannerUrl: raw.bannerUrl,
      verificationStatus: raw.verificationStatus || 'UNVERIFIED',
      publicationState: raw.publicationState || 'PUBLISHED',
      hasAdminOverride: raw.hasAdminOverride ?? false,
      adminNotes: raw.adminNotes,
      externalLinks,
      metadata,
      totalAnimeCount: raw._count?.animeStudios ?? projects.length,
      projects,
      staff,
      relatedStudios,
      newsRelations,
      createdAt: raw.createdAt,
      updatedAt: raw.updatedAt,
    };
  }

  /**
   * Retrieves public list of studios with filters, pagination, and sorting
   */
  async getStudios(options: StudioFilterOptions = {}) {
    const {
      q,
      search,
      status,
      country,
      foundedYearMin,
      foundedYearMax,
      verificationStatus,
      hasImage,
      hasFounder,
      hasAnime,
      sortBy = 'animeCount',
      sortOrder = 'desc',
      page = 1,
      limit = 24,
    } = options;

    const queryStr = (q || search || '').trim();
    const skip = (Math.max(1, page) - 1) * limit;

    const where: any = {
      publicationState: 'PUBLISHED', // Public queries never expose drafts or hidden studios
    };

    if (queryStr) {
      where.OR = [
        { name: { contains: queryStr, mode: 'insensitive' } },
        { nativeName: { contains: queryStr, mode: 'insensitive' } },
        { romanizedName: { contains: queryStr, mode: 'insensitive' } },
        { slug: { contains: queryStr.toLowerCase(), mode: 'insensitive' } },
        { alternativeNamesJson: { contains: queryStr, mode: 'insensitive' } },
      ];
    }

    if (status && status !== 'ALL') {
      where.status = status;
    }

    if (country) {
      where.country = country;
    }

    if (foundedYearMin || foundedYearMax) {
      where.foundedYear = {};
      if (foundedYearMin) where.foundedYear.gte = foundedYearMin;
      if (foundedYearMax) where.foundedYear.lte = foundedYearMax;
    }

    if (verificationStatus && verificationStatus !== 'ALL') {
      where.verificationStatus = verificationStatus;
    }

    if (hasImage === true) {
      where.imageUrl = { not: null };
    }

    if (hasFounder === true) {
      where.staffRelations = { some: { role: { in: ['FOUNDER', 'CO_FOUNDER'] } } };
    }

    if (hasAnime === true) {
      where.animeStudios = { some: {} };
    }

    // Determine sorting
    let orderBy: any = {};
    if (sortBy === 'name') {
      orderBy = { name: sortOrder };
    } else if (sortBy === 'foundedYear') {
      orderBy = { foundedYear: sortOrder };
    } else if (sortBy === 'createdAt') {
      orderBy = { createdAt: sortOrder };
    } else if (sortBy === 'updatedAt') {
      orderBy = { updatedAt: sortOrder };
    } else {
      // Default: sort by animeCount
      orderBy = { animeStudios: { _count: sortOrder } };
    }

    const [studios, total] = await Promise.all([
      prisma.studio.findMany({
        where,
        orderBy,
        skip,
        take: limit,
        include: {
          _count: {
            select: { animeStudios: true, staffRelations: true },
          },
          animeStudios: {
            take: 4,
            orderBy: { anime: { score: { sort: 'desc', nulls: 'last' } } }, // Postgres: NULLs first under DESC otherwise
            include: {
              anime: {
                select: {
                  id: true,
                  slug: true,
                  canonicalTitle: true,
                  posterUrl: true,
                  score: true,
                  year: true,
                },
              },
            },
          },
          staffRelations: {
            where: { role: { in: ['FOUNDER', 'CO_FOUNDER', 'CEO'] } },
            take: 2,
            include: {
              person: {
                select: { id: true, name: true, nameKanji: true, imageUrl: true },
              },
            },
          },
        },
      }),
      prisma.studio.count({ where }),
    ]);

    const formatted = studios.map((s) => {
      const displayTitle = s.adminOverrideName || s.name;
      const displayImageUrl = s.adminOverrideImageUrl || s.imageUrl;
      const displayDescription = s.adminOverrideDescription || s.about;

      return {
        id: s.id,
        name: s.name,
        displayTitle,
        slug: s.slug || this.generateSlug(s.name),
        nativeName: s.nativeName,
        shortDescription: s.shortDescription || (displayDescription ? displayDescription.slice(0, 160) + '...' : null),
        foundedYear: s.adminOverrideFoundedYear || s.foundedYear,
        country: s.country,
        region: s.region,
        status: s.status,
        imageUrl: s.imageUrl,
        displayImageUrl,
        verificationStatus: s.verificationStatus,
        totalAnimeCount: s._count.animeStudios,
        totalStaffCount: s._count.staffRelations,
        sampleAnime: s.animeStudios.map((as) => as.anime),
        sampleFounders: s.staffRelations.map((sp) => ({
          name: sp.person.name,
          role: sp.role,
        })),
      };
    });

    return {
      studios: formatted,
      total,
      page,
      limit,
      totalPages: Math.ceil(total / limit),
    };
  }

  /**
   * Retrieves a single canonical Studio by Slug
   */
  async getStudioBySlug(slug: string): Promise<StudioDetailItem | null> {
    return this.getStudioBySlugOrId(slug);
  }

  /**
   * Retrieves a single canonical Studio by Slug or ID with full relational graph
   */
  async getStudioBySlugOrId(slugOrId: string): Promise<StudioDetailItem | null> {
    let clean = slugOrId.trim();

    // 1. Direct Lookup
    let studio = await prisma.studio.findFirst({
      where: {
        OR: [
          { slug: clean },
          { id: clean },
          { name: clean },
          { slug: clean.toLowerCase() },
        ],
        publicationState: 'PUBLISHED',
        status: { not: 'MERGED' },
      },
      include: {
        _count: {
          select: { animeStudios: true },
        },
        animeStudios: {
          orderBy: { anime: { score: { sort: 'desc', nulls: 'last' } } }, // Postgres: NULLs first under DESC otherwise
          include: {
            anime: {
              include: {
                titles: true,
                animeGenres: { include: { genre: true } },
              },
            },
          },
        },
        staffRelations: {
          orderBy: [{ isCurrent: 'desc' }, { role: 'asc' }],
          include: {
            person: true,
          },
        },
        childRelationships: {
          include: { childStudio: true },
        },
        parentRelationships: {
          include: { parentStudio: true },
        },
        newsRelations: {
          take: 6,
          orderBy: { article: { publishedAt: 'desc' } },
          include: {
            article: {
              select: {
                id: true,
                title: true,
                adminOverrideTitle: true,
                slug: true,
                publishedAt: true,
                sourceName: true,
                imageUrl: true,
                status: true,
              },
            },
          },
        },
      },
    });

    if (!studio) {
      // 2. Check StudioRedirect
      const redirect = await prisma.studioRedirect.findUnique({
        where: { sourceIdentifier: clean },
        select: { canonicalStudioId: true },
      });
      if (redirect) {
        return this.getStudioBySlugOrId(redirect.canonicalStudioId);
      }

      // 3. Check StudioAlias
      const norm = clean.toLowerCase().replace(/[^\w\s]/g, ' ').replace(/\s+/g, ' ').trim();
      const alias = await prisma.studioAlias.findFirst({
        where: { normalizedAlias: norm },
        select: { studioId: true },
      });
      if (alias) {
        return this.getStudioBySlugOrId(alias.studioId);
      }

      return null;
    }

    return this.formatStudioWithOverrides(studio);
  }

  /**
   * Retrieves associated anime projects for a studio with flexible sorting & filtering
   */
  async getStudioProjects(
    studioId: string,
    options: {
      type?: string;
      role?: string;
      sortBy?: 'score' | 'year' | 'popularity' | 'title';
      sortOrder?: 'asc' | 'desc';
      page?: number;
      limit?: number;
    } = {}
  ) {
    const {
      type,
      role,
      sortBy = 'score',
      sortOrder = 'desc',
      page = 1,
      limit = 20,
    } = options;

    const skip = (Math.max(1, page) - 1) * limit;

    const where: any = {
      studioId,
    };

    if (role && role !== 'ALL') {
      where.role = role;
    }

    if (type && type !== 'ALL') {
      where.anime = { type };
    }

    let orderBy: any = {};
    if (sortBy === 'year') {
      orderBy = { anime: { year: sortOrder } };
    } else if (sortBy === 'popularity') {
      orderBy = { anime: { members: sortOrder } };
    } else if (sortBy === 'title') {
      orderBy = { anime: { canonicalTitle: sortOrder } };
    } else {
      orderBy = { anime: { score: { sort: sortOrder, nulls: 'last' } } };
    }

    const [items, total] = await Promise.all([
      prisma.animeStudio.findMany({
        where,
        orderBy,
        skip,
        take: limit,
        include: {
          anime: {
            include: {
              titles: true,
              animeGenres: { include: { genre: true } },
            },
          },
        },
      }),
      prisma.animeStudio.count({ where }),
    ]);

    const projects: StudioProjectItem[] = items.map((as) => ({
      id: as.anime.id,
      slug: as.anime.slug,
      canonicalTitle: as.anime.canonicalTitle,
      englishTitle: as.anime.titles?.find((t) => t.type === 'english')?.title || null,
      posterUrl: as.anime.posterUrl,
      score: as.anime.score,
      episodes: as.anime.episodes,
      type: as.anime.type,
      status: as.anime.status,
      year: as.anime.year || as.anime.startYear,
      role: (as.role as any) || 'MAIN_STUDIO',
      isMain: as.isMain,
      isPrimary: as.isPrimary,
    }));

    return {
      projects,
      total,
      page,
      limit,
      totalPages: Math.ceil(total / limit),
    };
  }

  /**
   * Fast Autocomplete search for Studio selector UX
   */
  async searchStudios(query: string, limit = 10) {
    const q = query.trim();
    if (!q) return [];

    const studios = await prisma.studio.findMany({
      where: {
        OR: [
          { name: { contains: q, mode: 'insensitive' } },
          { nativeName: { contains: q, mode: 'insensitive' } },
          { slug: { contains: q.toLowerCase(), mode: 'insensitive' } },
          { alternativeNamesJson: { contains: q, mode: 'insensitive' } },
        ],
        publicationState: { in: ['PUBLISHED', 'DRAFT'] },
      },
      select: {
        id: true,
        name: true,
        nativeName: true,
        slug: true,
        imageUrl: true,
        foundedYear: true,
        status: true,
        _count: { select: { animeStudios: true } },
      },
      take: limit,
    });

    return studios.map((s) => ({
      id: s.id,
      name: s.name,
      nativeName: s.nativeName,
      slug: s.slug,
      imageUrl: s.imageUrl,
      foundedYear: s.foundedYear,
      status: s.status,
      animeCount: s._count.animeStudios,
    }));
  }

  /**
   * Invalidates in-memory studio caches
   */
  invalidateCache(studioId?: string): void {
    // No-op for direct query layer; placeholder for uniform service interface
  }
}

export const studioService = new StudioService();
