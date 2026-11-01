/**
 * OTAKUVA PRODUCTION NEWS ENGINE
 * 
 * Master Provider-Independent News System:
 * - Centralized canonical queries with pagination and server-side filtering
 * - Display data priority: ADMIN OVERRIDE > NORMALIZED DATA > RAW DATA
 * - Manual news creation & editorial overrides
 * - Entity relation traversal (Anime, Studios, People, Clusters)
 * - Multi-provider sync orchestration & health monitoring
 */

import { prisma } from '../../prisma';
import { generateSlug } from '../../normalizers';
import { emitEngineEvent } from '../events/eventEngine';
import { annNewsAdapter } from './adapters/annNewsAdapter';
import { crunchyrollNewsAdapter } from './adapters/crunchyrollNewsAdapter';
import { officialSourceAdapter } from './adapters/officialSourceAdapter';
import { myAnimeListNewsAdapter } from './adapters/myAnimeListNewsAdapter';
import { animeCornerNewsAdapter } from './adapters/animeCornerNewsAdapter';
import { animeHeraldNewsAdapter } from './adapters/animeHeraldNewsAdapter';
import { animeUkNewsAdapter, animeFeministNewsAdapter, honeysAnimeNewsAdapter } from './adapters/moreRssAdapters';
import { newsIngestionService } from './newsIngestionService';
import { enrichMissingExcerpts } from './newsExcerptService';
import { logger } from '../../logger';
import { NewsProviderAdapter } from './newsProvider.interface';
import { PUBLIC_RELEVANCE_WHERE } from './newsRelevanceService';
import {
  AdminOverrideInput,
  CreateManualArticleInput,
  NewsQueryOptions,
} from './newsTypes';

export class NewsEngine {
  private adapters: Map<string, NewsProviderAdapter> = new Map();

  constructor() {
    this.registerAdapter(annNewsAdapter);
    this.registerAdapter(crunchyrollNewsAdapter);
    this.registerAdapter(officialSourceAdapter);
    this.registerAdapter(myAnimeListNewsAdapter);
    this.registerAdapter(animeCornerNewsAdapter);
    this.registerAdapter(animeHeraldNewsAdapter);
    this.registerAdapter(animeUkNewsAdapter);
    this.registerAdapter(animeFeministNewsAdapter);
    this.registerAdapter(honeysAnimeNewsAdapter);
  }

  registerAdapter(adapter: NewsProviderAdapter) {
    this.adapters.set(adapter.id.toLowerCase(), adapter);
  }

  getAdapter(id: string): NewsProviderAdapter | undefined {
    return this.adapters.get(id.toLowerCase());
  }

  getAllAdapters(): NewsProviderAdapter[] {
    return Array.from(this.adapters.values());
  }

  /**
   * Primary Paginated News Retrieval
   */
  async getNews(options: NewsQueryOptions = {}) {
    const {
      category,
      status = 'PUBLISHED',
      provider,
      sourceName,
      animeId,
      studioId,
      personId,
      clusterId,
      query,
      search,
      startDate,
      endDate,
      dateRange,
      sortBy = 'latest',
      page = 1,
      limit = 20,
      offset,
      includeOffTopic = false,
    } = options;

    const skip = offset !== undefined ? offset : (Math.max(1, page) - 1) * limit;

    const where: any = {
      status,
    };

    // Keep general gaming/entertainment coverage out of the anime feed.
    // OFF_TOPIC rows are retained in the DB and remain reachable through admin
    // tooling, they are just not surfaced publicly. REVIEW stays visible: an
    // unclassifiable article is better shown than silently hidden.
    if (!includeOffTopic) {
      where.relevance = PUBLIC_RELEVANCE_WHERE;
    }

    if (category && category.toUpperCase() !== 'ALL') {
      where.category = category.toUpperCase();
    }

    if (provider) {
      where.provider = provider.toUpperCase();
    }

    if (sourceName) {
      where.sourceName = { contains: sourceName };
    }

    if (clusterId) {
      where.clusterId = clusterId;
    }

    // Date Range Filtering
    if (dateRange && dateRange !== 'all') {
      const now = new Date();
      if (dateRange === 'today') {
        const start = new Date(now.setHours(0, 0, 0, 0));
        where.publishedAt = { gte: start };
      } else if (dateRange === 'week') {
        const start = new Date(Date.now() - 7 * 86400000);
        where.publishedAt = { gte: start };
      } else if (dateRange === 'month') {
        const start = new Date(Date.now() - 30 * 86400000);
        where.publishedAt = { gte: start };
      }
    } else if (startDate || endDate) {
      where.publishedAt = {};
      if (startDate) where.publishedAt.gte = startDate;
      if (endDate) where.publishedAt.lte = endDate;
    }

    // Entity Relation Filters
    if (animeId) {
      where.animeRelations = {
        some: {
          animeId,
          status: 'CONFIRMED',
        },
      };
    }

    if (studioId) {
      where.studioRelations = {
        some: {
          studioId,
          status: 'CONFIRMED',
        },
      };
    }

    if (personId) {
      where.personRelations = {
        some: {
          personId,
        },
      };
    }

    // Search query
    const searchQuery = query || search;
    if (searchQuery && searchQuery.trim()) {
      const q = searchQuery.trim().toLowerCase();
      where.OR = [
        { title: { contains: q } },
        { summary: { contains: q } },
        { author: { contains: q } },
        { sourceName: { contains: q } },
        { animeRelations: { some: { anime: { canonicalTitle: { contains: q } } } } },
        { studioRelations: { some: { studio: { name: { contains: q } } } } },
      ];
    }

    let orderBy: any = { publishedAt: 'desc' };
    if (sortBy === 'oldest') {
      orderBy = { publishedAt: 'asc' };
    }

    const [articles, total] = await Promise.all([
      prisma.newsArticle.findMany({
        where,
        include: {
          animeRelations: {
            where: { status: 'CONFIRMED' },
            include: {
              anime: {
                select: {
                  id: true,
                  canonicalTitle: true,
                  slug: true,
                  posterUrl: true,
                  bannerUrl: true,
                  score: true,
                },
              },
            },
          },
          studioRelations: {
            where: { status: 'CONFIRMED' },
            include: {
              studio: {
                select: { id: true, name: true, slug: true, imageUrl: true },
              },
            },
          },
          personRelations: {
            include: {
              person: {
                select: { id: true, name: true, nameKanji: true, imageUrl: true },
              },
            },
          },
          cluster: {
            select: { id: true, topicTitle: true, slug: true },
          },
        },
        orderBy,
        skip,
        take: limit,
      }),
      prisma.newsArticle.count({ where }),
    ]);

    // Apply Admin Override priority for presentation
    const formatted = articles.map((article) => this.formatArticleWithOverrides(article));

    return {
      articles: formatted,
      total,
      page,
      limit,
      totalPages: Math.ceil(total / limit),
    };
  }

  /**
   * Retrieves a single news article by ID or Slug
   */
  async getNewsById(idOrSlug: string) {
    const article = await prisma.newsArticle.findFirst({
      where: {
        OR: [{ id: idOrSlug }, { slug: idOrSlug }],
        status: { notIn: ['REMOVED'] },
      },
      include: {
        animeRelations: {
          where: { status: 'CONFIRMED' },
          include: {
            anime: {
              select: {
                id: true,
                canonicalTitle: true,
                slug: true,
                posterUrl: true,
                bannerUrl: true,
                score: true,
              },
            },
          },
        },
        studioRelations: {
          where: { status: 'CONFIRMED' },
          include: {
            studio: {
              select: { id: true, name: true, slug: true, imageUrl: true },
            },
          },
        },
        personRelations: {
          include: {
            person: {
              select: { id: true, name: true, nameKanji: true, imageUrl: true },
            },
          },
        },
        cluster: {
          include: {
            articles: {
              where: { id: { not: idOrSlug }, status: 'PUBLISHED' },
              select: {
                id: true,
                title: true,
                slug: true,
                sourceName: true,
                sourceUrl: true,
                publishedAt: true,
                imageUrl: true,
              },
            },
          },
        },
      },
    });

    if (!article) return null;

    return this.formatArticleWithOverrides(article);
  }

  /**
   * Quick retrieval of latest news
   */
  async getLatestNews(limit = 10) {
    const res = await this.getNews({ limit, sortBy: 'latest' });
    return res.articles;
  }

  /**
   * Search News
   */
  async searchNews(query: string, options: NewsQueryOptions = {}) {
    return this.getNews({ ...options, search: query });
  }

  /**
   * Manual News Entry (OTAKUVA Editorial)
   */
  async createManualNewsArticle(userId: string, input: CreateManualArticleInput) {
    const {
      title,
      subtitle,
      summary,
      content,
      contentType = 'OTAKUVA_SUMMARY',
      sourceName = 'OTAKUVA Editorial',
      sourceUrl = 'https://otakuva.com/editorial',
      canonicalUrl,
      imageUrl,
      author = 'OTAKUVA Editorial Desk',
      category = 'ANIME',
      status = 'PUBLISHED',
      publishedAt = new Date(),
      mentionedAnimeIds = [],
      mentionedStudioIds = [],
    } = input;

    if (!title || title.trim().length < 5) {
      throw new Error('Title must be at least 5 characters');
    }

    const baseSlug = generateSlug(title);
    let uniqueSlug = baseSlug;
    let counter = 1;
    while (await prisma.newsArticle.findUnique({ where: { slug: uniqueSlug } })) {
      uniqueSlug = `${baseSlug}-${counter}`;
      counter++;
    }

    const externalId = `internal-editorial-${Date.now()}`;

    const created = await prisma.newsArticle.create({
      data: {
        title: title.trim(),
        subtitle: subtitle?.trim() || null,
        slug: uniqueSlug,
        summary: summary?.trim() || null,
        content: content?.trim() || null,
        contentType,
        sourceName,
        sourceUrl,
        canonicalUrl: canonicalUrl?.trim() || sourceUrl,
        imageUrl: imageUrl?.trim() || null,
        author,
        category,
        status,
        provider: 'INTERNAL',
        externalId,
        publishedAt,
        animeRelations: mentionedAnimeIds.length > 0 ? {
          create: mentionedAnimeIds.map((animeId) => ({
            animeId,
            confidenceScore: 1.0,
            matchMethod: 'MANUAL',
            status: 'CONFIRMED',
          })),
        } : undefined,
        studioRelations: mentionedStudioIds.length > 0 ? {
          create: mentionedStudioIds.map((studioId) => ({
            studioId,
            confidenceScore: 1.0,
            matchMethod: 'MANUAL',
            status: 'CONFIRMED',
          })),
        } : undefined,
      },
      include: {
        animeRelations: { include: { anime: true } },
        studioRelations: { include: { studio: true } },
      },
    });

    await emitEngineEvent({
      eventType: 'NEWS_INGESTED',
      userId,
      entityType: 'NEWS',
      entityId: created.id,
      metadata: { title: created.title, provider: 'INTERNAL' },
    });

    return created;
  }

  /**
   * Admin Override System: Overrides take display precedence without destroying raw provider data
   */
  async applyAdminOverride(userId: string, articleId: string, overrides: AdminOverrideInput) {
    const article = await prisma.newsArticle.findUnique({ where: { id: articleId } });
    if (!article) {
      throw new Error('News article not found');
    }

    const updated = await prisma.newsArticle.update({
      where: { id: articleId },
      data: {
        adminOverrideTitle: overrides.title ? overrides.title.trim() : null,
        adminOverrideSummary: overrides.summary ? overrides.summary.trim() : null,
        adminOverrideCategory: overrides.category || null,
      },
    });

    await prisma.moderationAction.create({
      data: {
        moderatorId: userId,
        targetType: 'NEWS_ARTICLE',
        targetId: articleId,
        action: 'EDITORIAL_OVERRIDE',
        reason: overrides.overrideReason || 'Admin editorial override applied',
      },
    });

    await emitEngineEvent({
      eventType: 'NEWS_UPDATED',
      userId,
      entityType: 'NEWS',
      entityId: articleId,
      metadata: { overrideReason: overrides.overrideReason },
    });

    return updated;
  }

  /**
   * Syncs a specific provider adapter
   */
  async syncProvider(providerSlug: string, limit = 30) {
    const adapter = this.getAdapter(providerSlug);
    if (!adapter) {
      throw new Error(`Provider adapter "${providerSlug}" is not registered`);
    }

    return newsIngestionService.ingestFromProvider(adapter, { limit });
  }

  /**
   * Syncs all registered provider adapters
   */
  async syncAllProviders(limit = 30) {
    const results = [];
    for (const adapter of this.adapters.values()) {
      const res = await newsIngestionService.ingestFromProvider(adapter, { limit });
      results.push(res);
    }
    // Opening paragraphs for new stories whose feed didn't carry them.
    // Best-effort: a failure here never affects the stored articles.
    try {
      await enrichMissingExcerpts({ limit: 10 });
    } catch (err) {
      logger.warn('news excerpt enrichment failed', { error: err instanceof Error ? err.message : String(err) });
    }
    return results;
  }

  /**
   * Provider Health Status
   */
  async getProviderHealth(providerSlug?: string) {
    if (providerSlug) {
      const adapter = this.getAdapter(providerSlug);
      if (!adapter) throw new Error(`Provider "${providerSlug}" not found`);
      const check = await adapter.healthCheck();
      const record = await prisma.newsProvider.findUnique({ where: { slug: providerSlug } });
      return { ...check, record };
    }

    const statuses = [];
    for (const adapter of this.adapters.values()) {
      const check = await adapter.healthCheck();
      const record = await prisma.newsProvider.findUnique({ where: { slug: adapter.id } });
      statuses.push({ provider: adapter.name, slug: adapter.id, ...check, record });
    }
    return statuses;
  }

  /**
   * Admin Review Queue for low-confidence entity matches
   */
  async getAdminReviewQueue(status: string = 'PENDING', page = 1, limit = 20) {
    const skip = (Math.max(1, page) - 1) * limit;
    const [items, total] = await Promise.all([
      prisma.newsReviewQueue.findMany({
        where: { status },
        include: {
          article: {
            select: { id: true, title: true, slug: true, sourceName: true, publishedAt: true },
          },
        },
        orderBy: { createdAt: 'desc' },
        skip,
        take: limit,
      }),
      prisma.newsReviewQueue.count({ where: { status } }),
    ]);

    return { items, total, page, totalPages: Math.ceil(total / limit) };
  }

  /**
   * Approves a pending entity match from the admin review queue
   */
  async approveReviewQueueItem(adminUserId: string, queueItemId: string) {
    const queueItem = await prisma.newsReviewQueue.findUnique({
      where: { id: queueItemId },
    });

    if (!queueItem) {
      throw new Error('Review queue item not found');
    }

    await prisma.$transaction(async (tx) => {
      // Update queue item
      await tx.newsReviewQueue.update({
        where: { id: queueItemId },
        data: {
          status: 'APPROVED',
          reviewedAt: new Date(),
          reviewedBy: adminUserId,
        },
      });

      // Link confirmed relationship
      if (queueItem.entityType === 'ANIME' && queueItem.matchedEntityId) {
        await tx.newsArticleAnime.upsert({
          where: {
            articleId_animeId: {
              articleId: queueItem.articleId,
              animeId: queueItem.matchedEntityId,
            },
          },
          update: { status: 'CONFIRMED' },
          create: {
            articleId: queueItem.articleId,
            animeId: queueItem.matchedEntityId,
            confidenceScore: 1.0,
            matchMethod: 'MANUAL',
            status: 'CONFIRMED',
          },
        });
      } else if (queueItem.entityType === 'STUDIO' && queueItem.matchedEntityId) {
        await tx.newsArticleStudio.upsert({
          where: {
            articleId_studioId: {
              articleId: queueItem.articleId,
              studioId: queueItem.matchedEntityId,
            },
          },
          update: { status: 'CONFIRMED' },
          create: {
            articleId: queueItem.articleId,
            studioId: queueItem.matchedEntityId,
            confidenceScore: 1.0,
            matchMethod: 'MANUAL',
            status: 'CONFIRMED',
          },
        });
      }
    });

    await emitEngineEvent({
      eventType: 'NEWS_ENTITY_MATCHED',
      userId: adminUserId,
      entityType: 'NEWS',
      entityId: queueItem.articleId,
      metadata: {
        entityType: queueItem.entityType,
        entityId: queueItem.matchedEntityId,
        approvedBy: adminUserId,
      },
    });

    return { success: true, queueItemId, status: 'APPROVED' };
  }

  /**
   * Dismisses an ambiguous entity match
   */
  async dismissReviewQueueItem(adminUserId: string, queueItemId: string) {
    const queueItem = await prisma.newsReviewQueue.findUnique({
      where: { id: queueItemId },
    });

    if (!queueItem) {
      throw new Error('Review queue item not found');
    }

    await prisma.newsReviewQueue.update({
      where: { id: queueItemId },
      data: {
        status: 'DISMISSED',
        reviewedAt: new Date(),
        reviewedBy: adminUserId,
      },
    });

    return { success: true, queueItemId, status: 'DISMISSED' };
  }

  /**
   * Helper that resolves fields following the DATA PRIORITY RULE:
   * ADMIN OVERRIDE > NORMALIZED PROVIDER DATA > RAW DATA
   */
  private formatArticleWithOverrides(article: any) {
    const displayTitle = article.adminOverrideTitle || article.title;
    const displaySummary = article.adminOverrideSummary || article.summary;
    const displayCategory = article.adminOverrideCategory || article.category;

    return {
      ...article,
      displayTitle,
      displaySummary,
      displayCategory,
      hasAdminOverride: Boolean(
        article.adminOverrideTitle || article.adminOverrideSummary || article.adminOverrideCategory
      ),
      relatedAnime: (article.animeRelations || []).map((r: any) => r.anime),
      relatedStudios: (article.studioRelations || []).map((r: any) => r.studio),
      relatedPeople: (article.personRelations || []).map((r: any) => r.person),
      syndicatedReports: article.cluster?.articles || [],
    };
  }
}

export const newsEngine = new NewsEngine();
