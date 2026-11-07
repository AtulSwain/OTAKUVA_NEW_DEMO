/**
 * OTAKUVA SOURCE REGISTRY SERVICE
 * 
 * Strict Source Management:
 * - Only approved sources allowed
 * - Trust tiers (HIGH, MEDIUM, LOW)
 * - Metadata tracking: domain, feedUrl, sourceType, trustLevel, active
 * - Pre-seeded with Anime News Network and Crunchyroll News
 */

import { prisma } from '../../prisma';

export interface SourceRegistryItem {
  name: string;
  slug: string;
  baseUrl: string;
  domain: string;
  feedUrl: string;
  sourceType: 'OFFICIAL' | 'NEWS_PUBLICATION' | 'STUDIO' | 'CREATOR' | 'ORGANIZER' | 'LOCAL_MEDIA';
  trustLevel: 'HIGH' | 'MEDIUM' | 'LOW';
  language: string;
  country?: string;
  active: boolean;
}

export const CANONICAL_SOURCES: SourceRegistryItem[] = [
  {
    name: 'Anime News Network',
    slug: 'ann',
    baseUrl: 'https://www.animenewsnetwork.com',
    domain: 'animenewsnetwork.com',
    feedUrl: 'https://www.animenewsnetwork.com/news/rss.xml?tab=news',
    sourceType: 'NEWS_PUBLICATION',
    trustLevel: 'HIGH',
    language: 'en',
    country: 'US',
    active: true,
  },
  {
    name: 'Crunchyroll News',
    slug: 'crunchyroll',
    baseUrl: 'https://www.crunchyroll.com/news',
    domain: 'crunchyroll.com',
    feedUrl: 'https://cr-news-api-service.prd.crunchyrollsvc.com/v1/en-US/rss',
    sourceType: 'OFFICIAL',
    trustLevel: 'HIGH',
    language: 'en',
    country: 'US',
    active: true,
  },
];

export class SourceRegistryService {
  /**
   * Ensures default canonical sources are registered in the database
   */
  async ensureCanonicalSources() {
    for (const src of CANONICAL_SOURCES) {
      await prisma.newsProvider.upsert({
        where: { slug: src.slug },
        update: {
          name: src.name,
          baseUrl: src.baseUrl,
          domain: src.domain,
          feedUrl: src.feedUrl,
          sourceType: src.sourceType,
          trustLevel: src.trustLevel,
          language: src.language,
          country: src.country,
          active: src.active,
        },
        create: {
          slug: src.slug,
          name: src.name,
          baseUrl: src.baseUrl,
          domain: src.domain,
          feedUrl: src.feedUrl,
          sourceType: src.sourceType,
          trustLevel: src.trustLevel,
          language: src.language,
          country: src.country,
          active: src.active,
          status: 'HEALTHY',
        },
      });
    }
  }

  /**
   * Retrieves all registered active sources
   */
  async getActiveSources() {
    return await prisma.newsProvider.findMany({
      where: { active: true },
      orderBy: { name: 'asc' },
    });
  }

  /**
   * Validates whether a domain is approved
   */
  async isDomainApproved(domain: string): Promise<boolean> {
    const cleanDomain = domain.toLowerCase().replace(/^www\./, '');
    const provider = await prisma.newsProvider.findFirst({
      where: {
        domain: { contains: cleanDomain, mode: 'insensitive' },
        active: true,
      },
    });
    return !!provider;
  }
}

export const sourceRegistryService = new SourceRegistryService();
