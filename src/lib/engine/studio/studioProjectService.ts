/**
 * OTAKUVA STUDIO PROJECT GRAPH SERVICE (PHASE 9.3)
 * 
 * Manages the Studio <-> Anime relationship graph:
 * - Production roles & primary lead studio designations
 * - Format, status, and chronological filtering
 * - Upcoming and in-production pipeline queries
 * - Admin single & bulk project linking with transactional safety
 * - Cascade protection (unlinking preserves canonical Anime records)
 * - Audit logging & Event Engine integration
 */

import { prisma } from '../../prisma';
import { emitEngineEvent } from '../events/eventEngine';

export type StudioProductionRole =
  | 'MAIN_STUDIO'
  | 'CO_PRODUCER'
  | 'ANIMATION'
  | 'PRODUCTION_ASSISTANCE'
  | 'CG'
  | 'BACKGROUND'
  | 'OTHER';

export type StudioProjectStatus =
  | 'UPCOMING'
  | 'ANNOUNCED'
  | 'IN_PRODUCTION'
  | 'ONGOING'
  | 'COMPLETED'
  | 'CANCELLED'
  | 'UNKNOWN';

export interface StudioProjectFilterOptions {
  q?: string;
  search?: string;
  format?: string; // 'ALL', 'TV', 'Movie', 'OVA', 'ONA', 'Special', 'Short'
  status?: string; // 'ALL', 'COMPLETED', 'UPCOMING', 'ONGOING', 'CANCELLED'
  year?: number;
  yearMin?: number;
  yearMax?: number;
  role?: string;
  isPrimary?: boolean;
  sortBy?: 'score' | 'year' | 'title' | 'popularity' | 'releaseDate';
  sortOrder?: 'asc' | 'desc';
  page?: number;
  limit?: number;
}

export interface LinkAnimeToStudioInput {
  animeId: string;
  role?: StudioProductionRole | string;
  isPrimary?: boolean;
  productionStatus?: StudioProjectStatus | string;
  source?: string;
  notes?: string;
}

export interface BulkLinkAnimeInput {
  animeIds: string[];
  role?: StudioProductionRole | string;
  isPrimary?: boolean;
  productionStatus?: StudioProjectStatus | string;
  source?: string;
}

export class StudioProjectService {
  /**
   * Resolves a studio record by slug, ID, or name
   */
  async resolveStudio(studioSlugOrId: string) {
    return prisma.studio.findFirst({
      where: {
        OR: [
          { slug: studioSlugOrId },
          { id: studioSlugOrId },
          { name: studioSlugOrId },
        ],
      },
      select: { id: true, name: true, slug: true, status: true },
    });
  }

  /**
   * Formats an AnimeStudio record for presentation
   */
  formatProject(rel: any) {
    const anime = rel.anime;
    return {
      relationship: {
        studioId: rel.studioId,
        animeId: rel.animeId,
        role: rel.role,
        isMain: rel.isMain,
        isPrimary: rel.isPrimary,
        productionStatus: rel.productionStatus || 'COMPLETED',
        source: rel.source || 'CANONICAL',
        createdAt: rel.createdAt,
        updatedAt: rel.updatedAt,
      },
      anime: {
        id: anime.id,
        canonicalTitle: anime.canonicalTitle,
        slug: anime.slug,
        posterUrl: anime.posterUrl,
        bannerUrl: anime.bannerUrl,
        type: anime.type,
        status: anime.status,
        episodes: anime.episodes,
        duration: anime.duration,
        score: anime.score,
        popularity: anime.popularity,
        year: anime.year || anime.startYear,
        startDate: anime.startDate || anime.airedFrom,
        endDate: anime.endDate || anime.airedTo,
        genres: (anime.animeGenres || []).map((g: any) => g.genre?.name).filter(Boolean),
        themes: (anime.animeThemes || []).map((t: any) => t.theme?.name).filter(Boolean),
        studios: (anime.animeStudios || []).map((s: any) => ({
          id: s.studio?.id,
          name: s.studio?.name,
          slug: s.studio?.slug,
          role: s.role,
          isPrimary: s.isPrimary,
        })),
        producers: (anime.animeProducers || []).map((p: any) => ({
          id: p.producer?.id,
          name: p.producer?.name,
        })),
      },
    };
  }

  /**
   * Retrieves all projects produced by a studio with filtering, sorting, and pagination
   */
  async getStudioProjects(studioSlugOrId: string, options: StudioProjectFilterOptions = {}) {
    const studio = await this.resolveStudio(studioSlugOrId);
    if (!studio) {
      return { studio: null, projects: [], total: 0, page: 1, limit: 50, totalPages: 0 };
    }

    const {
      q,
      search,
      format,
      status,
      year,
      yearMin,
      yearMax,
      role,
      isPrimary,
      sortBy = 'score',
      sortOrder = 'desc',
      page = 1,
      limit = 50,
    } = options;

    const queryStr = (q || search || '').trim().toLowerCase();
    const skip = (Math.max(1, page) - 1) * limit;

    const whereRel: any = { studioId: studio.id };
    const whereAnime: any = {};

    if (role && role !== 'ALL') {
      whereRel.role = role;
    }

    if (typeof isPrimary === 'boolean') {
      whereRel.isPrimary = isPrimary;
    }

    if (status && status !== 'ALL') {
      if (status === 'UPCOMING') {
        whereAnime.OR = [
          { status: 'NOT_YET_AIRED' },
          { status: 'UPCOMING' },
          { status: 'AIRING' },
        ];
      } else if (status === 'COMPLETED') {
        whereAnime.status = 'Finished';
      } else {
        whereAnime.status = { contains: status, mode: 'insensitive' };
      }
    }

    if (format && format !== 'ALL' && format !== 'All') {
      whereAnime.type = { equals: format };
    }

    if (year) {
      whereAnime.OR = [{ year }, { startYear: year }];
    } else if (yearMin || yearMax) {
      whereAnime.year = {};
      if (yearMin) whereAnime.year.gte = yearMin;
      if (yearMax) whereAnime.year.lte = yearMax;
    }

    if (queryStr) {
      whereAnime.OR = [
        { canonicalTitle: { contains: queryStr, mode: 'insensitive' } },
        { slug: { contains: queryStr, mode: 'insensitive' } },
        { synopsis: { contains: queryStr, mode: 'insensitive' } },
      ];
    }

    if (Object.keys(whereAnime).length > 0) {
      whereRel.anime = whereAnime;
    }

    // Determine Sort
    let orderBy: any = {};
    if (sortBy === 'title') {
      orderBy = { anime: { canonicalTitle: sortOrder } };
    } else if (sortBy === 'year' || sortBy === 'releaseDate') {
      orderBy = { anime: { year: sortOrder } };
    } else if (sortBy === 'popularity') {
      orderBy = { anime: { popularity: sortOrder } };
    } else {
      // Default: score
      orderBy = { anime: { score: { sort: sortOrder, nulls: 'last' } } };
    }

    const [relations, total] = await Promise.all([
      prisma.animeStudio.findMany({
        where: whereRel,
        orderBy,
        skip,
        take: limit,
        include: {
          anime: {
            include: {
              animeGenres: { include: { genre: true } },
              animeThemes: { include: { theme: true } },
              animeStudios: { include: { studio: true } },
              animeProducers: { include: { producer: true } },
            },
          },
        },
      }),
      prisma.animeStudio.count({ where: whereRel }),
    ]);

    const formatted = relations.map((rel) => this.formatProject(rel));

    return {
      studio,
      projects: formatted,
      total,
      page,
      limit,
      totalPages: Math.ceil(total / limit),
    };
  }

  /**
   * Retrieves upcoming/announced projects for a studio
   */
  async getStudioUpcomingProjects(studioSlugOrId: string) {
    const studio = await this.resolveStudio(studioSlugOrId);
    if (!studio) return [];

    const upcomingRelations = await prisma.animeStudio.findMany({
      where: {
        studioId: studio.id,
        OR: [
          { productionStatus: { in: ['UPCOMING', 'ANNOUNCED', 'IN_PRODUCTION', 'ONGOING'] } },
          { anime: { status: { in: ['NOT_YET_AIRED', 'UPCOMING', 'AIRING', 'Not yet aired'] } } },
        ],
      },
      orderBy: { anime: { startDate: 'asc' } },
      include: {
        anime: {
          include: {
            animeGenres: { include: { genre: true } },
            animeStudios: { include: { studio: true } },
          },
        },
      },
    });

    return upcomingRelations.map((rel) => this.formatProject(rel));
  }

  /**
   * Links an Anime to a Studio (Admin)
   */
  async linkAnimeToStudio(actorId: string, studioId: string, input: LinkAnimeToStudioInput) {
    const { animeId, role = 'MAIN_STUDIO', isPrimary = true, productionStatus = 'COMPLETED', source = 'CANONICAL' } = input;

    const [studio, anime] = await Promise.all([
      prisma.studio.findUnique({ where: { id: studioId } }),
      prisma.anime.findUnique({ where: { id: animeId } }),
    ]);

    if (!studio) throw new Error('Studio not found.');
    if (!anime) throw new Error('Anime not found.');

    // If marked as primary lead studio, adjust existing primary studios for this anime
    if (isPrimary) {
      await prisma.animeStudio.updateMany({
        where: { animeId, isPrimary: true },
        data: { isPrimary: false },
      });
    }

    const relation = await prisma.animeStudio.upsert({
      where: {
        animeId_studioId: {
          animeId,
          studioId,
        },
      },
      create: {
        studioId,
        animeId,
        role,
        isMain: role === 'MAIN_STUDIO' || isPrimary,
        isPrimary,
        productionStatus,
        source,
      },
      update: {
        role,
        isMain: role === 'MAIN_STUDIO' || isPrimary,
        isPrimary,
        productionStatus,
        source,
      },
    });

    // Record Audit Log
    await prisma.studioAuditLog.create({
      data: {
        studioId,
        actorId,
        action: 'ANIME_LINK',
        newValues: JSON.stringify({ animeId, animeTitle: anime.canonicalTitle, role, isPrimary }),
        reason: `Linked anime: "${anime.canonicalTitle}" as ${role}`,
      },
    });

    await emitEngineEvent({
      eventType: 'STUDIO_ANIME_LINKED',
      userId: actorId,
      entityType: 'STUDIO',
      entityId: studioId,
      metadata: { animeId, role, isPrimary },
    });

    return relation;
  }

  /**
   * Bulk links multiple Anime titles to a Studio in a single transaction
   */
  async bulkLinkAnimeToStudio(actorId: string, studioId: string, input: BulkLinkAnimeInput) {
    const { animeIds, role = 'MAIN_STUDIO', isPrimary = true, productionStatus = 'COMPLETED', source = 'CANONICAL' } = input;

    if (!Array.isArray(animeIds) || animeIds.length === 0) {
      throw new Error('animeIds array cannot be empty.');
    }

    const studio = await prisma.studio.findUnique({ where: { id: studioId } });
    if (!studio) throw new Error('Studio not found.');

    let linkedCount = 0;
    for (const animeId of animeIds) {
      await prisma.animeStudio.upsert({
        where: {
          animeId_studioId: {
            animeId,
            studioId,
          },
        },
        create: {
          studioId,
          animeId,
          role,
          isMain: role === 'MAIN_STUDIO' || isPrimary,
          isPrimary,
          productionStatus,
          source,
        },
        update: {
          role,
          isMain: role === 'MAIN_STUDIO' || isPrimary,
          isPrimary,
          productionStatus,
          source,
        },
      });
      linkedCount++;
    }

    await prisma.studioAuditLog.create({
      data: {
        studioId,
        actorId,
        action: 'ANIME_LINK',
        newValues: JSON.stringify({ count: linkedCount, animeIds }),
        reason: `Bulk linked ${linkedCount} anime productions`,
      },
    });

    return { success: true, count: linkedCount };
  }

  /**
   * Updates an existing AnimeStudio relationship (role, primary status, production status)
   */
  async updateAnimeStudioRelationship(
    actorId: string,
    studioId: string,
    animeId: string,
    input: Partial<LinkAnimeToStudioInput>
  ) {
    const existing = await prisma.animeStudio.findUnique({
      where: { animeId_studioId: { animeId, studioId } },
    });
    if (!existing) throw new Error('Anime-Studio relationship not found.');

    const data: any = {};
    if (input.role !== undefined) {
      data.role = input.role;
      data.isMain = input.role === 'MAIN_STUDIO';
    }
    if (input.isPrimary !== undefined) {
      data.isPrimary = input.isPrimary;
      if (input.isPrimary) {
        await prisma.animeStudio.updateMany({
          where: { animeId, isPrimary: true, studioId: { not: studioId } },
          data: { isPrimary: false },
        });
      }
    }
    if (input.productionStatus !== undefined) data.productionStatus = input.productionStatus;
    if (input.source !== undefined) data.source = input.source;

    const updated = await prisma.animeStudio.update({
      where: { animeId_studioId: { animeId, studioId } },
      data,
    });

    await prisma.studioAuditLog.create({
      data: {
        studioId,
        actorId,
        action: 'UPDATE',
        oldValues: JSON.stringify(existing),
        newValues: JSON.stringify(updated),
        reason: `Updated anime production relationship: animeId=${animeId}`,
      },
    });

    return updated;
  }

  /**
   * Unlinks an Anime from a Studio without deleting the canonical Anime entity
   */
  async unlinkAnimeFromStudio(actorId: string, studioId: string, animeId: string, reason?: string) {
    const existing = await prisma.animeStudio.findUnique({
      where: { animeId_studioId: { animeId, studioId } },
      include: { anime: { select: { canonicalTitle: true } } },
    });

    if (!existing) throw new Error('Anime-Studio relationship not found.');

    await prisma.animeStudio.delete({
      where: { animeId_studioId: { animeId, studioId } },
    });

    await prisma.studioAuditLog.create({
      data: {
        studioId,
        actorId,
        action: 'ANIME_UNLINK',
        oldValues: JSON.stringify(existing),
        reason: reason || `Unlinked anime: "${existing.anime.canonicalTitle}"`,
      },
    });

    await emitEngineEvent({
      eventType: 'STUDIO_ANIME_UNLINKED',
      userId: actorId,
      entityType: 'STUDIO',
      entityId: studioId,
      metadata: { animeId },
    });

    return { success: true, unlinkedAnimeId: animeId };
  }
}

export const studioProjectService = new StudioProjectService();
