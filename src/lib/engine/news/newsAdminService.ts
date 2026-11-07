/**
 * OTAKUVA ADMIN NEWS MANAGEMENT SERVICE (PHASE 8.11)
 * 
 * Core Administrative & Editorial Engine:
 * - News CRUD & manual editorial content creation
 * - Explicit admin override tracking & override reset to provider values
 * - Lifecycle state management (Draft, Publish, Schedule, Unpublish, Archive, Soft Delete, Feature)
 * - Safe duplicate review & story merge
 * - Controlled bulk operations with confirmation and audit trails
 * - Entity relation management & review queue resolution
 * - Provider sync controls & failed job retry
 */

import { prisma } from '../../prisma';
import { emitEngineEvent } from '../events/eventEngine';
import { generateSlug } from '../../normalizers';
import { newsNormalizationService } from './newsNormalizationService';
import { newsTrendingService } from './newsTrendingService';

export interface AdminNewsQueryOptions {
  status?: string;
  category?: string;
  provider?: string;
  sourceName?: string;
  animeId?: string;
  studioId?: string;
  isFeatured?: boolean;
  search?: string;
  sortBy?: 'newest' | 'oldest' | 'updated' | 'published' | 'views' | 'trending';
  page?: number;
  limit?: number;
}

export interface CreateArticleInput {
  title: string;
  subtitle?: string;
  summary?: string;
  content?: string;
  contentType?: string;
  sourceName?: string;
  sourceUrl?: string;
  canonicalUrl?: string;
  imageUrl?: string;
  author?: string;
  language?: string;
  category?: string;
  status?: 'DRAFT' | 'PUBLISHED' | 'SCHEDULED';
  publishedAt?: Date | string;
  scheduledPublishAt?: Date | string;
  isFeatured?: boolean;
  featuredPriority?: number;
  featuredUntil?: Date | string;
  animeIds?: Array<{ animeId: string; relationType?: string }>;
  studioIds?: Array<{ studioId: string; relationType?: string }>;
  personIds?: string[];
}

export interface UpdateArticleInput {
  title?: string;
  subtitle?: string;
  summary?: string;
  content?: string;
  imageUrl?: string;
  category?: string;
  status?: string;
  isFeatured?: boolean;
  featuredPriority?: number;
  featuredUntil?: Date | string | null;
  scheduledPublishAt?: Date | string | null;
  publishedAt?: Date | string;
  author?: string;
  sourceName?: string;
  sourceUrl?: string;
  canonicalUrl?: string;
  animeIds?: Array<{ animeId: string; relationType?: string }>;
  studioIds?: Array<{ studioId: string; relationType?: string }>;
  personIds?: string[];
}

export class NewsAdminService {
  /**
   * Retrieves paginated articles for admin management table
   */
  async getArticles(options: AdminNewsQueryOptions = {}) {
    const {
      status,
      category,
      provider,
      sourceName,
      animeId,
      studioId,
      isFeatured,
      search,
      sortBy = 'newest',
      page = 1,
      limit = 20,
    } = options;

    const skip = (Math.max(1, page) - 1) * limit;
    const where: any = {
      deletedAt: null, // Exclude soft-deleted articles by default
    };

    if (status && status.toUpperCase() !== 'ALL') {
      where.status = status.toUpperCase();
    }
    if (category && category.toUpperCase() !== 'ALL') {
      where.category = category.toUpperCase();
    }
    if (provider && provider.toUpperCase() !== 'ALL') {
      where.provider = provider.toUpperCase();
    }
    if (sourceName) {
      where.sourceName = { contains: sourceName, mode: 'insensitive' };
    }
    if (isFeatured !== undefined) {
      where.isFeatured = isFeatured;
    }
    if (animeId) {
      where.animeRelations = { some: { animeId } };
    }
    if (studioId) {
      where.studioRelations = { some: { studioId } };
    }

    if (search && search.trim()) {
      const q = search.trim();
      where.OR = [
        { title: { contains: q, mode: 'insensitive' } },
        { adminOverrideTitle: { contains: q, mode: 'insensitive' } },
        { summary: { contains: q, mode: 'insensitive' } },
        { id: q },
        { externalId: q },
        { sourceName: { contains: q, mode: 'insensitive' } },
      ];
    }

    // Determine sorting
    let orderBy: any = { createdAt: 'desc' };
    if (sortBy === 'newest') orderBy = { createdAt: 'desc' };
    else if (sortBy === 'oldest') orderBy = { createdAt: 'asc' };
    else if (sortBy === 'published') orderBy = { publishedAt: 'desc' };
    else if (sortBy === 'updated') orderBy = { updatedAt: 'desc' };

    const [articles, total] = await Promise.all([
      prisma.newsArticle.findMany({
        where,
        include: {
          animeRelations: {
            include: { anime: { select: { id: true, canonicalTitle: true, slug: true, posterUrl: true } } },
          },
          studioRelations: {
            include: { studio: { select: { id: true, name: true, slug: true, imageUrl: true } } },
          },
          personRelations: {
            include: { person: { select: { id: true, name: true, nameKanji: true } } },
          },
          reviewQueueItems: { where: { status: 'PENDING' } },
        },
        orderBy,
        skip,
        take: limit,
      }),
      prisma.newsArticle.count({ where }),
    ]);

    // Overview counts for dashboard header
    const [publishedCount, draftCount, scheduledCount, archivedCount, pendingReviewCount, duplicatesCount] =
      await Promise.all([
        prisma.newsArticle.count({ where: { status: 'PUBLISHED', deletedAt: null } }),
        prisma.newsArticle.count({ where: { status: 'DRAFT', deletedAt: null } }),
        prisma.newsArticle.count({ where: { status: 'SCHEDULED', deletedAt: null } }),
        prisma.newsArticle.count({ where: { status: 'ARCHIVED', deletedAt: null } }),
        prisma.newsReviewQueue.count({ where: { status: 'PENDING' } }),
        prisma.newsArticle.count({ where: { clusterId: { not: null }, deletedAt: null } }),
      ]);

    return {
      articles: articles.map((a) => ({
        ...a,
        displayTitle: a.adminOverrideTitle || a.title,
        displaySummary: a.adminOverrideSummary || a.summary,
        displayCategory: a.adminOverrideCategory || a.category,
        hasAdminOverride: Boolean(a.adminOverrideTitle || a.adminOverrideSummary || a.adminOverrideCategory),
        pendingReviewsCount: a.reviewQueueItems.length,
      })),
      total,
      page,
      limit,
      totalPages: Math.ceil(total / limit),
      metrics: {
        totalNews: total,
        published: publishedCount,
        draft: draftCount,
        scheduled: scheduledCount,
        archived: archivedCount,
        pendingReview: pendingReviewCount,
        duplicates: duplicatesCount,
      },
    };
  }

  /**
   * Retrieves a single article with full editorial history and entity links
   */
  async getArticleById(id: string) {
    const article = await prisma.newsArticle.findUnique({
      where: { id },
      include: {
        animeRelations: {
          include: { anime: { select: { id: true, canonicalTitle: true, slug: true, posterUrl: true } } },
        },
        studioRelations: {
          include: { studio: { select: { id: true, name: true, slug: true, imageUrl: true } } },
        },
        personRelations: {
          include: { person: { select: { id: true, name: true, nameKanji: true } } },
        },
        cluster: {
          include: {
            articles: {
              where: { id: { not: id }, deletedAt: null },
              select: { id: true, title: true, slug: true, sourceName: true, publishedAt: true },
            },
          },
        },
        reviewQueueItems: true,
      },
    });

    if (!article) return null;

    return {
      ...article,
      displayTitle: article.adminOverrideTitle || article.title,
      displaySummary: article.adminOverrideSummary || article.summary,
      displayCategory: article.adminOverrideCategory || article.category,
      hasAdminOverride: Boolean(
        article.adminOverrideTitle || article.adminOverrideSummary || article.adminOverrideCategory
      ),
      syndicatedReports: article.cluster?.articles || [],
    };
  }

  /**
   * Creates a manual editorial or custom news article
   */
  async createArticle(input: CreateArticleInput, actorId: string) {
    if (!input.title || !input.title.trim()) {
      throw new Error('Article title is required');
    }

    const title = input.title.trim();
    const slug = `${generateSlug(title)}-${Date.now().toString().slice(-4)}`;
    const category = input.category ? input.category.toUpperCase() : 'ANIME';
    const status = input.status || 'DRAFT';
    const contentType = input.contentType || 'OTAKUVA_EDITORIAL';
    const sourceName = input.sourceName || 'OTAKUVA Editorial';
    const sourceUrl = input.sourceUrl || `/news/${slug}`;
    const canonicalUrl = input.canonicalUrl || sourceUrl;

    const publishedAt = input.publishedAt ? new Date(input.publishedAt) : new Date();
    const scheduledPublishAt = input.scheduledPublishAt ? new Date(input.scheduledPublishAt) : null;

    const article = await prisma.$transaction(async (tx) => {
      const created = await tx.newsArticle.create({
        data: {
          title,
          subtitle: input.subtitle?.trim() || null,
          slug,
          summary: input.summary?.trim() || null,
          content: input.content?.trim() || null,
          contentType,
          sourceName,
          sourceUrl,
          canonicalUrl,
          imageUrl: input.imageUrl?.trim() || null,
          author: input.author?.trim() || 'OTAKUVA Editorial Desk',
          language: input.language || 'en',
          category,
          status,
          publishedAt,
          scheduledPublishAt,
          isFeatured: input.isFeatured || false,
          featuredPriority: input.featuredPriority || 0,
          featuredUntil: input.featuredUntil ? new Date(input.featuredUntil) : null,
          provider: 'INTERNAL',
          externalId: `editorial-${Date.now()}`,
        },
      });

      // Link Anime Entities
      if (input.animeIds && input.animeIds.length > 0) {
        for (const item of input.animeIds) {
          await tx.newsArticleAnime.create({
            data: {
              articleId: created.id,
              animeId: item.animeId,
              confidenceScore: 1.0,
              matchMethod: 'MANUAL',
              status: 'CONFIRMED',
              relationType: item.relationType || 'PRIMARY',
            },
          });
        }
      }

      // Link Studio Entities
      if (input.studioIds && input.studioIds.length > 0) {
        for (const item of input.studioIds) {
          await tx.newsArticleStudio.create({
            data: {
              articleId: created.id,
              studioId: item.studioId,
              confidenceScore: 1.0,
              matchMethod: 'MANUAL',
              status: 'CONFIRMED',
              relationType: item.relationType || 'PRODUCED_BY',
            },
          });
        }
      }

      // Link Person Entities
      if (input.personIds && input.personIds.length > 0) {
        for (const personId of input.personIds) {
          await tx.newsArticlePerson.create({
            data: {
              articleId: created.id,
              personId,
            },
          });
        }
      }

      // Record Audit Log
      await tx.auditLog.create({
        data: {
          actorId,
          action: 'NEWS_ARTICLE_CREATED',
          entityType: 'NEWS_ARTICLE',
          entityId: created.id,
          afterJson: JSON.stringify({ title: created.title, status: created.status, category: created.category }),
        },
      });

      return created;
    });

    newsTrendingService.invalidateCache();

    await emitEngineEvent({
      eventType: status === 'PUBLISHED' ? 'NEWS_PUBLISHED' : 'NEWS_INGESTED',
      userId: actorId,
      entityType: 'NEWS',
      entityId: article.id,
      metadata: { title: article.title, status: article.status },
    });

    return article;
  }

  /**
   * Updates an existing article and records explicit admin overrides
   */
  async updateArticle(id: string, input: UpdateArticleInput, actorId: string) {
    const existing = await prisma.newsArticle.findUnique({ where: { id } });
    if (!existing) {
      throw new Error(`News article not found: ${id}`);
    }

    const dataToUpdate: any = {};

    // Check for explicit admin overrides
    if (input.title !== undefined) {
      dataToUpdate.adminOverrideTitle = input.title.trim();
    }
    if (input.summary !== undefined) {
      dataToUpdate.adminOverrideSummary = input.summary.trim();
    }
    if (input.category !== undefined) {
      dataToUpdate.adminOverrideCategory = input.category.toUpperCase();
    }
    if (input.subtitle !== undefined) dataToUpdate.subtitle = input.subtitle.trim();
    if (input.content !== undefined) dataToUpdate.content = input.content.trim();
    if (input.imageUrl !== undefined) dataToUpdate.imageUrl = input.imageUrl.trim();
    if (input.author !== undefined) dataToUpdate.author = input.author.trim();
    if (input.status !== undefined) dataToUpdate.status = input.status.toUpperCase();
    if (input.isFeatured !== undefined) dataToUpdate.isFeatured = input.isFeatured;
    if (input.featuredPriority !== undefined) dataToUpdate.featuredPriority = input.featuredPriority;
    if (input.featuredUntil !== undefined) {
      dataToUpdate.featuredUntil = input.featuredUntil ? new Date(input.featuredUntil) : null;
    }
    if (input.scheduledPublishAt !== undefined) {
      dataToUpdate.scheduledPublishAt = input.scheduledPublishAt ? new Date(input.scheduledPublishAt) : null;
    }
    if (input.publishedAt !== undefined) {
      dataToUpdate.publishedAt = new Date(input.publishedAt);
    }
    if (input.sourceName !== undefined) dataToUpdate.sourceName = input.sourceName.trim();
    if (input.sourceUrl !== undefined) dataToUpdate.sourceUrl = input.sourceUrl.trim();
    if (input.canonicalUrl !== undefined) dataToUpdate.canonicalUrl = input.canonicalUrl.trim();

    const updated = await prisma.$transaction(async (tx) => {
      const article = await tx.newsArticle.update({
        where: { id },
        data: dataToUpdate,
      });

      // Update Entity Relations if passed
      if (input.animeIds) {
        await tx.newsArticleAnime.deleteMany({ where: { articleId: id } });
        for (const item of input.animeIds) {
          await tx.newsArticleAnime.create({
            data: {
              articleId: id,
              animeId: item.animeId,
              confidenceScore: 1.0,
              matchMethod: 'MANUAL',
              status: 'CONFIRMED',
              relationType: item.relationType || 'PRIMARY',
            },
          });
        }
      }

      if (input.studioIds) {
        await tx.newsArticleStudio.deleteMany({ where: { articleId: id } });
        for (const item of input.studioIds) {
          await tx.newsArticleStudio.create({
            data: {
              articleId: id,
              studioId: item.studioId,
              confidenceScore: 1.0,
              matchMethod: 'MANUAL',
              status: 'CONFIRMED',
              relationType: item.relationType || 'PRODUCED_BY',
            },
          });
        }
      }

      // Record Audit Log
      await tx.auditLog.create({
        data: {
          actorId,
          action: 'NEWS_ARTICLE_UPDATED',
          entityType: 'NEWS_ARTICLE',
          entityId: id,
          beforeJson: JSON.stringify({
            title: existing.adminOverrideTitle || existing.title,
            status: existing.status,
            category: existing.adminOverrideCategory || existing.category,
          }),
          afterJson: JSON.stringify(dataToUpdate),
        },
      });

      return article;
    });

    newsTrendingService.invalidateCache();

    await emitEngineEvent({
      eventType: 'NEWS_UPDATED',
      userId: actorId,
      entityType: 'NEWS',
      entityId: id,
      metadata: dataToUpdate,
    });

    return updated;
  }

  /**
   * Resets admin overrides, restoring normalized provider values
   */
  async resetOverride(id: string, fields: Array<'title' | 'summary' | 'category'> = ['title', 'summary', 'category'], actorId: string) {
    const existing = await prisma.newsArticle.findUnique({ where: { id } });
    if (!existing) throw new Error(`Article not found: ${id}`);

    const resetData: any = {};
    if (fields.includes('title')) resetData.adminOverrideTitle = null;
    if (fields.includes('summary')) resetData.adminOverrideSummary = null;
    if (fields.includes('category')) resetData.adminOverrideCategory = null;

    const updated = await prisma.$transaction(async (tx) => {
      const article = await tx.newsArticle.update({
        where: { id },
        data: resetData,
      });

      await tx.auditLog.create({
        data: {
          actorId,
          action: 'NEWS_OVERRIDE_RESET',
          entityType: 'NEWS_ARTICLE',
          entityId: id,
          afterJson: JSON.stringify({ resetFields: fields, effectiveTitle: article.title }),
        },
      });

      return article;
    });

    newsTrendingService.invalidateCache();
    return updated;
  }

  /**
   * Transitions lifecycle state (PUBLISH, UNPUBLISH, ARCHIVE, DELETE, FEATURE, UNFEATURE)
   */
  async changeStatus(id: string, action: 'PUBLISH' | 'UNPUBLISH' | 'ARCHIVE' | 'DELETE' | 'FEATURE' | 'UNFEATURE', actorId: string) {
    const existing = await prisma.newsArticle.findUnique({ where: { id } });
    if (!existing) throw new Error(`Article not found: ${id}`);

    const updateData: any = {};
    let auditAction = 'NEWS_STATUS_CHANGED';

    switch (action) {
      case 'PUBLISH':
        updateData.status = 'PUBLISHED';
        updateData.publishedAt = existing.publishedAt || new Date();
        auditAction = 'NEWS_ARTICLE_PUBLISHED';
        break;
      case 'UNPUBLISH':
        updateData.status = 'DRAFT';
        auditAction = 'NEWS_ARTICLE_UNPUBLISHED';
        break;
      case 'ARCHIVE':
        updateData.status = 'ARCHIVED';
        auditAction = 'NEWS_ARTICLE_ARCHIVED';
        break;
      case 'DELETE':
        updateData.status = 'REMOVED';
        updateData.deletedAt = new Date();
        auditAction = 'NEWS_ARTICLE_DELETED';
        break;
      case 'FEATURE':
        updateData.isFeatured = true;
        auditAction = 'NEWS_ARTICLE_FEATURED';
        break;
      case 'UNFEATURE':
        updateData.isFeatured = false;
        auditAction = 'NEWS_ARTICLE_UNFEATURED';
        break;
    }

    const updated = await prisma.$transaction(async (tx) => {
      const article = await tx.newsArticle.update({
        where: { id },
        data: updateData,
      });

      await tx.auditLog.create({
        data: {
          actorId,
          action: auditAction,
          entityType: 'NEWS_ARTICLE',
          entityId: id,
          beforeJson: JSON.stringify({ status: existing.status, isFeatured: existing.isFeatured }),
          afterJson: JSON.stringify(updateData),
        },
      });

      return article;
    });

    newsTrendingService.invalidateCache();
    return updated;
  }

  /**
   * Executes safe bulk actions on selected articles
   */
  async bulkAction(
    action: 'ARCHIVE' | 'PUBLISH' | 'CHANGE_CATEGORY' | 'FEATURE' | 'UNFEATURE' | 'DELETE',
    articleIds: string[],
    payload: any = {},
    actorId: string
  ) {
    if (!articleIds || articleIds.length === 0) {
      throw new Error('No article IDs provided for bulk operation');
    }

    const updateData: any = {};
    switch (action) {
      case 'ARCHIVE':
        updateData.status = 'ARCHIVED';
        break;
      case 'PUBLISH':
        updateData.status = 'PUBLISHED';
        break;
      case 'DELETE':
        updateData.status = 'REMOVED';
        updateData.deletedAt = new Date();
        break;
      case 'FEATURE':
        updateData.isFeatured = true;
        break;
      case 'UNFEATURE':
        updateData.isFeatured = false;
        break;
      case 'CHANGE_CATEGORY':
        if (!payload.category) throw new Error('Category required for CHANGE_CATEGORY');
        updateData.category = payload.category.toUpperCase();
        updateData.adminOverrideCategory = payload.category.toUpperCase();
        break;
    }

    const result = await prisma.$transaction(async (tx) => {
      const updateResult = await tx.newsArticle.updateMany({
        where: { id: { in: articleIds } },
        data: updateData,
      });

      await tx.auditLog.create({
        data: {
          actorId,
          action: `NEWS_BULK_${action}`,
          entityType: 'NEWS_ARTICLE',
          entityId: 'BULK_BATCH',
          afterJson: JSON.stringify({ affectedCount: updateResult.count, articleIds, action, payload }),
        },
      });

      return updateResult;
    });

    newsTrendingService.invalidateCache();
    return { success: true, affectedCount: result.count };
  }

  /**
   * Safely merges duplicate articles into a primary article
   */
  async mergeDuplicates(primaryArticleId: string, duplicateArticleId: string, actorId: string) {
    if (primaryArticleId === duplicateArticleId) {
      throw new Error('Cannot merge an article with itself');
    }

    const [primary, duplicate] = await Promise.all([
      prisma.newsArticle.findUnique({
        where: { id: primaryArticleId },
        include: { animeRelations: true, studioRelations: true },
      }),
      prisma.newsArticle.findUnique({
        where: { id: duplicateArticleId },
        include: { animeRelations: true, studioRelations: true },
      }),
    ]);

    if (!primary || !duplicate) {
      throw new Error('One or both articles not found for merge');
    }

    const result = await prisma.$transaction(async (tx) => {
      // 1. Ensure or link NewsStoryCluster
      let clusterId = primary.clusterId || duplicate.clusterId;
      if (!clusterId) {
        const cluster = await tx.newsStoryCluster.create({
          data: {
            topicTitle: primary.title,
            slug: `cluster-${generateSlug(primary.title)}-${Date.now().toString().slice(-4)}`,
            summary: primary.summary || duplicate.summary,
          },
        });
        clusterId = cluster.id;
      }

      await tx.newsArticle.update({
        where: { id: primary.id },
        data: { clusterId },
      });

      // 2. Move Anime relations
      for (const rel of duplicate.animeRelations) {
        const exists = await tx.newsArticleAnime.findUnique({
          where: { articleId_animeId: { articleId: primary.id, animeId: rel.animeId } },
        });
        if (!exists) {
          await tx.newsArticleAnime.create({
            data: {
              articleId: primary.id,
              animeId: rel.animeId,
              confidenceScore: rel.confidenceScore,
              matchMethod: rel.matchMethod,
              status: rel.status,
              relationType: rel.relationType,
            },
          });
        }
      }

      // 3. Move Studio relations
      for (const rel of duplicate.studioRelations) {
        const exists = await tx.newsArticleStudio.findUnique({
          where: { articleId_studioId: { articleId: primary.id, studioId: rel.studioId } },
        });
        if (!exists) {
          await tx.newsArticleStudio.create({
            data: {
              articleId: primary.id,
              studioId: rel.studioId,
              confidenceScore: rel.confidenceScore,
              matchMethod: rel.matchMethod,
              status: rel.status,
              relationType: rel.relationType,
            },
          });
        }
      }

      // 4. Soft-delete duplicate and link to cluster
      await tx.newsArticle.update({
        where: { id: duplicate.id },
        data: {
          status: 'ARCHIVED',
          deletedAt: new Date(),
          clusterId,
        },
      });

      // 5. Audit Log
      await tx.auditLog.create({
        data: {
          actorId,
          action: 'NEWS_DUPLICATE_MERGED',
          entityType: 'NEWS_ARTICLE',
          entityId: primary.id,
          beforeJson: JSON.stringify({ primaryId: primary.id, duplicateId: duplicate.id }),
          afterJson: JSON.stringify({ clusterId, mergedDuplicateId: duplicate.id }),
        },
      });

      return { primaryId: primary.id, mergedDuplicateId: duplicate.id, clusterId };
    });

    newsTrendingService.invalidateCache();
    return result;
  }
}

export const newsAdminService = new NewsAdminService();
