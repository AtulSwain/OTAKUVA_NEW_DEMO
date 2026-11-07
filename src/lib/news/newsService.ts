import { prisma } from '../prisma';
import { annNewsProvider } from './annNewsProvider';
import { ProviderNewsArticle } from './newsProvider.interface';

export class NewsService {
  /**
   * Syncs latest news from registered providers into PostgreSQL
   */
  async syncLatestNews(): Promise<{ createdCount: number; updatedCount: number }> {
    const rawArticles = await annNewsProvider.fetchLatest(30);
    let createdCount = 0;
    let updatedCount = 0;

    for (const raw of rawArticles) {
      try {
        const existing = await prisma.newsArticle.findFirst({
          where: {
            OR: [
              { provider: 'ANN', externalId: raw.externalId },
              { slug: raw.slug },
              { sourceUrl: raw.sourceUrl },
            ],
          },
        });

        let articleId: string;

        if (!existing) {
          const created = await prisma.newsArticle.create({
            data: {
              externalId: raw.externalId,
              provider: 'ANN',
              title: raw.title,
              slug: raw.slug,
              summary: raw.summary,
              sourceName: raw.sourceName,
              sourceUrl: raw.sourceUrl,
              canonicalUrl: raw.canonicalUrl,
              imageUrl: raw.imageUrl,
              author: raw.author,
              category: raw.category,
              publishedAt: raw.publishedAt,
            },
          });
          articleId = created.id;
          createdCount++;
        } else {
          await prisma.newsArticle.update({
            where: { id: existing.id },
            data: {
              title: raw.title,
              summary: raw.summary,
              imageUrl: raw.imageUrl || existing.imageUrl,
              category: raw.category,
            },
          });
          articleId = existing.id;
          updatedCount++;
        }

        // Entity Matching & Automatic Relationship Resolution
        await this.matchAndLinkEntities(articleId, raw);
      } catch (err) {
        console.error(`Failed to ingest article ${raw.externalId}:`, err);
      }
    }

    return { createdCount, updatedCount };
  }

  /**
   * Matches article mentions against Anime, Studios, and People in canonical PostgreSQL
   */
  private async matchAndLinkEntities(articleId: string, raw: ProviderNewsArticle): Promise<void> {
    // 1. Match Anime
    if (raw.mentionedAnimeTitles && raw.mentionedAnimeTitles.length > 0) {
      for (const title of raw.mentionedAnimeTitles) {
        const matchedAnime = await prisma.anime.findFirst({
          where: {
            OR: [
              { canonicalTitle: { contains: title } },
              { slug: { contains: title.toLowerCase().replace(/[^a-z0-9]+/g, '-') } },
            ],
          },
          select: { id: true },
        });

        if (matchedAnime) {
          await prisma.newsArticleAnime.upsert({
            where: {
              articleId_animeId: {
                articleId,
                animeId: matchedAnime.id,
              },
            },
            create: {
              articleId,
              animeId: matchedAnime.id,
            },
            update: {},
          }).catch(() => {});
        }
      }
    }

    // 2. Match Studios
    if (raw.mentionedStudioNames && raw.mentionedStudioNames.length > 0) {
      for (const studioName of raw.mentionedStudioNames) {
        const matchedStudio = await prisma.studio.findFirst({
          where: {
            OR: [
              { name: { equals: studioName } },
              { slug: { equals: studioName.toLowerCase().replace(/[^a-z0-9]+/g, '-') } },
            ],
          },
          select: { id: true },
        });

        if (matchedStudio) {
          await prisma.newsArticleStudio.upsert({
            where: {
              articleId_studioId: {
                articleId,
                studioId: matchedStudio.id,
              },
            },
            create: {
              articleId,
              studioId: matchedStudio.id,
            },
            update: {},
          }).catch(() => {});
        }
      }
    }

    // 3. Match People
    if (raw.mentionedPeopleNames && raw.mentionedPeopleNames.length > 0) {
      for (const personName of raw.mentionedPeopleNames) {
        const matchedPerson = await prisma.person.findFirst({
          where: {
            OR: [
              { name: { equals: personName } },
              { slug: { equals: personName.toLowerCase().replace(/[^a-z0-9]+/g, '-') } },
            ],
          },
          select: { id: true },
        });

        if (matchedPerson) {
          await prisma.newsArticlePerson.upsert({
            where: {
              articleId_personId: {
                articleId,
                personId: matchedPerson.id,
              },
            },
            create: {
              articleId,
              personId: matchedPerson.id,
            },
            update: {},
          }).catch(() => {});
        }
      }
    }
  }

  /**
   * Retrieves news articles with filtering, search, and pagination
   */
  async getNews(params: {
    category?: string;
    animeId?: string;
    studioId?: string;
    search?: string;
    limit?: number;
    offset?: number;
  }) {
    const { category, animeId, studioId, search, limit = 20, offset = 0 } = params;

    // Trigger on-demand bootstrap sync if table is empty
    const count = await prisma.newsArticle.count();
    if (count === 0) {
      await this.syncLatestNews();
    }

    const where: any = {};

    if (category && category !== 'ALL') {
      where.category = category.toUpperCase();
    }

    if (search && search.trim()) {
      const q = search.trim();
      where.OR = [
        { title: { contains: q, mode: 'insensitive' } },
        { summary: { contains: q, mode: 'insensitive' } },
      ];
    }

    if (animeId) {
      where.animeRelations = {
        some: { animeId },
      };
    }

    if (studioId) {
      where.studioRelations = {
        some: { studioId },
      };
    }

    const [articles, totalCount] = await Promise.all([
      prisma.newsArticle.findMany({
        where,
        take: limit,
        skip: offset,
        orderBy: { publishedAt: 'desc' },
        include: {
          animeRelations: {
            include: {
              anime: {
                select: { id: true, canonicalTitle: true, slug: true, posterUrl: true },
              },
            },
          },
          studioRelations: {
            include: {
              studio: {
                select: { id: true, name: true, slug: true },
              },
            },
          },
        },
      }),
      prisma.newsArticle.count({ where }),
    ]);

    return {
      articles: articles.map((a) => ({
        id: a.id,
        title: a.title,
        slug: a.slug,
        summary: a.summary,
        sourceName: a.sourceName,
        sourceUrl: a.sourceUrl,
        canonicalUrl: a.canonicalUrl,
        imageUrl: a.imageUrl,
        author: a.author,
        category: a.category,
        publishedAt: a.publishedAt.toISOString(),
        relatedAnime: a.animeRelations.map((r) => r.anime),
        relatedStudios: a.studioRelations.map((r) => r.studio),
      })),
      totalCount,
      hasMore: offset + limit < totalCount,
    };
  }

  /**
   * Retrieves full editorial article details by slug with all connected knowledge entities
   */
  async getArticleBySlug(slug: string) {
    // Ensure table has data
    const count = await prisma.newsArticle.count();
    if (count === 0) {
      await this.syncLatestNews();
    }

    const article = await prisma.newsArticle.findFirst({
      where: {
        OR: [{ slug }, { id: slug }],
      },
      include: {
        animeRelations: {
          include: {
            anime: {
              select: {
                id: true,
                canonicalTitle: true,
                slug: true,
                posterUrl: true,
                score: true,
                year: true,
                type: true,
                episodes: true,
                status: true,
                synopsis: true,
              },
            },
          },
        },
        studioRelations: {
          include: {
            studio: {
              select: {
                id: true,
                name: true,
                slug: true,
                about: true,
                imageUrl: true,
                website: true,
              },
            },
          },
        },
        personRelations: {
          include: {
            person: {
              select: {
                id: true,
                name: true,
                slug: true,
                about: true,
                imageUrl: true,
              },
            },
          },
        },
      },
    });

    if (!article) return null;

    // Fetch adjacent articles for sequential reading navigation
    const [prevArticle, nextArticle, relatedStories] = await Promise.all([
      prisma.newsArticle.findFirst({
        where: { publishedAt: { gt: article.publishedAt } },
        orderBy: { publishedAt: 'asc' },
        select: { id: true, title: true, slug: true, category: true },
      }),
      prisma.newsArticle.findFirst({
        where: { publishedAt: { lt: article.publishedAt } },
        orderBy: { publishedAt: 'desc' },
        select: { id: true, title: true, slug: true, category: true },
      }),
      prisma.newsArticle.findMany({
        where: {
          id: { not: article.id },
          category: article.category,
        },
        take: 3,
        orderBy: { publishedAt: 'desc' },
        select: {
          id: true,
          title: true,
          slug: true,
          imageUrl: true,
          sourceName: true,
          publishedAt: true,
          category: true,
        },
      }),
    ]);

    // Calculate reading time
    const wordCount = ((article.summary || '') + ' ' + article.title).split(/\s+/).length + 150;
    const readingTimeMinutes = Math.max(1, Math.ceil(wordCount / 180));

    return {
      id: article.id,
      title: article.title,
      slug: article.slug,
      summary: article.summary,
      sourceName: article.sourceName,
      sourceUrl: article.sourceUrl,
      canonicalUrl: article.canonicalUrl || article.sourceUrl,
      imageUrl: article.imageUrl,
      author: article.author || 'Editorial Intelligence Desk',
      category: article.category,
      publishedAt: article.publishedAt.toISOString(),
      readingTime: `${readingTimeMinutes} min read`,
      relatedAnime: article.animeRelations.map((r) => r.anime),
      relatedStudios: article.studioRelations.map((r) => r.studio),
      relatedPeople: article.personRelations.map((r) => r.person),
      prevArticle,
      nextArticle,
      relatedStories: relatedStories.map((s) => ({
        ...s,
        publishedAt: s.publishedAt.toISOString(),
      })),
    };
  }
}

export const newsService = new NewsService();

