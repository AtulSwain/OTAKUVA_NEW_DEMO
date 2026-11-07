/**
 * OTAKUVA NEWS SEARCH & DISCOVERY SERVICE (PHASE 8.8)
 * 
 * Production Multi-Field Search & Relevance Engine:
 * - Weighted relevance scoring (exact title > tokens > entity match > summary keyword)
 * - Freshness decay weighting
 * - Filter support (category, date range, anime, studio, source, content type)
 * - Fast autocomplete suggestions for search UX
 * - Safe parameterized query execution & injection defenses
 */

import { prisma } from '../../prisma';
import { emitEngineEvent } from '../events/eventEngine';
import { NewsCategory, NewsQueryOptions } from './newsTypes';
import { PUBLIC_RELEVANCE_WHERE } from './newsRelevanceService';

export interface SearchResultItem {
  id: string;
  title: string;
  displayTitle: string;
  slug: string;
  summary: string | null;
  displaySummary: string | null;
  imageUrl: string | null;
  sourceName: string;
  sourceUrl: string;
  canonicalUrl: string | null;
  author: string | null;
  category: string;
  displayCategory: string;
  contentType: string;
  publishedAt: Date;
  relevanceScore: number;
  relatedAnime: Array<{ id: string; canonicalTitle: string; slug: string; posterUrl: string | null }>;
  relatedStudios: Array<{ id: string; name: string; slug: string | null; imageUrl: string | null }>;
  relatedPeople: Array<{ id: string; name: string; nameKanji: string | null }>;
}

export interface AutocompleteSuggestion {
  type: 'NEWS' | 'ANIME' | 'STUDIO';
  id: string;
  title: string;
  slug: string;
  subtitle?: string;
  imageUrl?: string | null;
}

export class NewsSearchService {
  /**
   * Searches news articles using weighted relevance scoring and flexible filters
   */
  async search(query: string, options: NewsQueryOptions = {}, userId?: string): Promise<{
    results: SearchResultItem[];
    total: number;
    page: number;
    limit: number;
    totalPages: number;
    query: string;
  }> {
    const rawQuery = (query || options.query || options.search || '').trim();
    const {
      category,
      animeId,
      studioId,
      dateRange,
      startDate,
      endDate,
      sortBy = 'relevance',
      page = 1,
      limit = 20,
    } = options;

    const skip = (Math.max(1, page) - 1) * limit;
    const normalizedRaw = rawQuery.normalize('NFD').replace(/[\u0300-\u036f]/g, '');
    const tokens = Array.from(
      new Set([
        ...rawQuery.toLowerCase().replace(/[^a-z0-9\s]/g, ' ').split(/\s+/),
        ...normalizedRaw.toLowerCase().replace(/[^a-z0-9\s]/g, ' ').split(/\s+/),
      ])
    ).filter((t) => t.length > 1);

    // Build base filter conditions
    const where: any = {
      status: 'PUBLISHED',
    };

    if (category && category.toUpperCase() !== 'ALL') {
      where.category = category.toUpperCase();
    }

    if (animeId) {
      where.animeRelations = { some: { animeId, status: 'CONFIRMED' } };
    }

    if (studioId) {
      where.studioRelations = { some: { studioId, status: 'CONFIRMED' } };
    }

    if (startDate || endDate || dateRange) {
      where.publishedAt = {};
      if (startDate) where.publishedAt.gte = new Date(startDate);
      if (endDate) where.publishedAt.lte = new Date(endDate);

      if (dateRange && dateRange !== 'all') {
        const now = new Date();
        if (dateRange === 'today') {
          where.publishedAt.gte = new Date(now.setHours(0, 0, 0, 0));
        } else if (dateRange === 'week') {
          where.publishedAt.gte = new Date(Date.now() - 7 * 86400000);
        } else if (dateRange === 'month') {
          where.publishedAt.gte = new Date(Date.now() - 30 * 86400000);
        }
      }
    }

    // Look up matching anime in catalog for entity awareness
    let matchedAnimeIds: string[] = [];
    if (tokens.length > 0) {
      const animeMatches = await prisma.anime.findMany({
        where: {
          OR: [
            { canonicalTitle: { contains: rawQuery, mode: 'insensitive' } },
            ...tokens.map((t) => ({ canonicalTitle: { contains: t, mode: 'insensitive' as const } })),
            ...tokens.map((t) => ({ slug: { contains: t, mode: 'insensitive' as const } })),
          ],
        },
        select: { id: true },
        take: 10,
      });
      matchedAnimeIds = animeMatches.map((a) => a.id);
    }

    // Keyword match conditions
    if (tokens.length > 0) {
      where.OR = [
        { title: { contains: rawQuery, mode: 'insensitive' } },
        { summary: { contains: rawQuery, mode: 'insensitive' } },
        { sourceName: { contains: rawQuery, mode: 'insensitive' } },
        ...(matchedAnimeIds.length > 0
          ? [{ animeRelations: { some: { animeId: { in: matchedAnimeIds } } } }]
          : []),
        ...tokens.map((t) => ({ title: { contains: t, mode: 'insensitive' as const } })),
        ...tokens.map((t) => ({ summary: { contains: t, mode: 'insensitive' as const } })),
      ];
    }

    // Search only within anime-related coverage.
    where.relevance = PUBLIC_RELEVANCE_WHERE;

    // Fetch candidate articles
    const [candidates, total] = await Promise.all([
      prisma.newsArticle.findMany({
        where,
        include: {
          animeRelations: {
            where: { status: 'CONFIRMED' },
            include: { anime: { select: { id: true, canonicalTitle: true, slug: true, posterUrl: true } } },
          },
          studioRelations: {
            where: { status: 'CONFIRMED' },
            include: { studio: { select: { id: true, name: true, slug: true, imageUrl: true } } },
          },
          personRelations: {
            include: { person: { select: { id: true, name: true, nameKanji: true } } },
          },
        },
        take: 100, // retrieve pool for in-memory weighted ranking
      }),
      prisma.newsArticle.count({ where }),
    ]);

    // Score and rank candidates
    const scored: SearchResultItem[] = candidates.map((article) => {
      const displayTitle = article.adminOverrideTitle || article.title;
      const displaySummary = article.adminOverrideSummary || article.summary;
      const displayCategory = article.adminOverrideCategory || article.category;

      let score = 0;
      const titleLower = displayTitle.toLowerCase();
      const titleNormalized = titleLower.normalize('NFD').replace(/[\u0300-\u036f]/g, '');
      const summaryLower = (displaySummary || '').toLowerCase();
      const summaryNormalized = summaryLower.normalize('NFD').replace(/[\u0300-\u036f]/g, '');
      const qLower = rawQuery.toLowerCase();
      const qNormalized = qLower.normalize('NFD').replace(/[\u0300-\u036f]/g, '');

      if (qLower) {
        // Exact full title match
        if (titleLower === qLower || titleNormalized === qNormalized) score += 15;
        // Exact substring match in title
        else if (titleLower.includes(qLower) || titleNormalized.includes(qNormalized)) score += 10;

        // Token matches in title
        for (const token of tokens) {
          if (titleLower.includes(token) || titleNormalized.includes(token)) score += 4;
          if (summaryLower.includes(token) || summaryNormalized.includes(token)) score += 1.5;
        }

        // Entity matches
        for (const rel of article.animeRelations) {
          const aTitle = rel.anime.canonicalTitle.toLowerCase();
          if (aTitle.includes(qLower) || aTitle.normalize('NFD').replace(/[\u0300-\u036f]/g, '').includes(qNormalized)) {
            score += 6;
          }
        }
        for (const rel of article.studioRelations) {
          if (rel.studio.name.toLowerCase().includes(qLower)) score += 5;
        }
      }

      // Freshness boost: decay over 14 days
      const daysOld = Math.max(0, (Date.now() - article.publishedAt.getTime()) / (1000 * 86400));
      const freshnessBoost = Math.max(0, 5 * Math.exp(-daysOld / 7));
      score += freshnessBoost;

      return {
        id: article.id,
        title: article.title,
        displayTitle,
        slug: article.slug,
        summary: article.summary,
        displaySummary,
        imageUrl: article.imageUrl,
        sourceName: article.sourceName,
        sourceUrl: article.sourceUrl,
        canonicalUrl: article.canonicalUrl,
        author: article.author,
        category: article.category,
        displayCategory,
        contentType: article.contentType,
        publishedAt: article.publishedAt,
        relevanceScore: Math.round(score * 100) / 100,
        relatedAnime: article.animeRelations.map((r) => r.anime),
        relatedStudios: article.studioRelations.map((r) => r.studio),
        relatedPeople: article.personRelations.map((r) => r.person),
      };
    });

    // Apply sorting
    if (sortBy === 'relevance' && rawQuery) {
      scored.sort((a, b) => b.relevanceScore - a.relevanceScore);
    } else if (sortBy === 'oldest') {
      scored.sort((a, b) => a.publishedAt.getTime() - b.publishedAt.getTime());
    } else {
      // Default: latest publishedAt
      scored.sort((a, b) => b.publishedAt.getTime() - a.publishedAt.getTime());
    }

    const paginated = scored.slice(skip, skip + limit);

    // Emit search event for discovery intelligence
    if (rawQuery && userId) {
      emitEngineEvent({
        eventType: 'NEWS_SEARCHED',
        userId,
        entityType: 'NEWS',
        entityId: 'search_query',
        metadata: { query: rawQuery, resultsCount: total },
      }).catch(() => {});
    }

    return {
      results: paginated,
      total,
      page,
      limit,
      totalPages: Math.ceil(total / limit),
      query: rawQuery,
    };
  }

  /**
   * Fast autocomplete suggestions for live search boxes
   */
  async autocomplete(query: string, limit = 6): Promise<AutocompleteSuggestion[]> {
    const q = (query || '').trim().toLowerCase();
    if (q.length < 2) return [];

    const suggestions: AutocompleteSuggestion[] = [];

    // 1. Anime suggestions
    const matchingAnime = await prisma.anime.findMany({
      where: {
        OR: [
          { canonicalTitle: { contains: q, mode: 'insensitive' } },
          { slug: { contains: q, mode: 'insensitive' } },
        ],
      },
      select: { id: true, canonicalTitle: true, slug: true, posterUrl: true },
      take: 3,
    });

    matchingAnime.forEach((a) => {
      suggestions.push({
        type: 'ANIME',
        id: a.id,
        title: a.canonicalTitle,
        slug: a.slug,
        subtitle: 'Anime Series',
        imageUrl: a.posterUrl,
      });
    });

    // 2. Studio suggestions
    const matchingStudios = await prisma.studio.findMany({
      where: {
        OR: [
          { name: { contains: q, mode: 'insensitive' } },
          { slug: { contains: q, mode: 'insensitive' } },
        ],
      },
      select: { id: true, name: true, slug: true, imageUrl: true },
      take: 2,
    });

    matchingStudios.forEach((s) => {
      suggestions.push({
        type: 'STUDIO',
        id: s.id,
        title: s.name,
        slug: s.slug || s.id,
        subtitle: 'Animation Studio',
        imageUrl: s.imageUrl,
      });
    });

    // 3. News Headline suggestions
    const matchingNews = await prisma.newsArticle.findMany({
      where: {
        status: 'PUBLISHED',
        relevance: PUBLIC_RELEVANCE_WHERE,
        OR: [{ title: { contains: q, mode: 'insensitive' } }, { summary: { contains: q, mode: 'insensitive' } }],
      },
      select: { id: true, title: true, adminOverrideTitle: true, slug: true, imageUrl: true, sourceName: true },
      take: limit - suggestions.length,
    });

    matchingNews.forEach((n) => {
      suggestions.push({
        type: 'NEWS',
        id: n.id,
        title: n.adminOverrideTitle || n.title,
        slug: n.slug,
        subtitle: n.sourceName,
        imageUrl: n.imageUrl,
      });
    });

    return suggestions.slice(0, limit);
  }
}

export const newsSearchService = new NewsSearchService();
