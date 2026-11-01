/**
 * CRUNCHYROLL NEWS REAL-WORLD PROVIDER ADAPTER
 * 
 * Production Real-World Integration:
 * - Directly ingests real anime news from Crunchyroll News RSS / XML feeds
 * - Extracts canonical Storyblok CDN high-resolution production visuals
 * - Preserves original publisher URLs & author attributions
 * - Emits SOURCE_METADATA and editorial excerpts
 * - Fallback resilience & health check probes
 */

import { newsProviderClient } from '../newsProviderClient';
import { NewsProviderAdapter } from '../newsProvider.interface';
import { ProviderHealthStatus, RawNewsArticle } from '../newsTypes';
import { EXCERPT_CONTENT_TYPE, excerptFromFeedBody } from '../articleExcerpt';

function unescapeXml(str: string): string {
  if (!str) return '';
  return str
    .replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g, '$1')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#039;/g, "'")
    .replace(/&#x27;/g, "'")
    .replace(/&#x201C;/g, '“')
    .replace(/&#x201D;/g, '”')
    .replace(/&#x2018;/g, '‘')
    .replace(/&#x2019;/g, '’')
    .replace(/&#x2013;/g, '–')
    .replace(/&#x2014;/g, '—')
    .replace(/&hellip;/g, '…')
    .replace(/&nbsp;/g, ' ')
    .replace(/&mdash;/g, '—')
    .replace(/&ndash;/g, '–')
    .replace(/&rsquo;/g, '’')
    .replace(/&lsquo;/g, '‘')
    .replace(/&rdquo;/g, '”')
    .replace(/&ldquo;/g, '“')
    .replace(/&#(\d+);/g, (_, code) => String.fromCharCode(parseInt(code, 10)))
    .replace(/&#x([0-9a-fA-F]+);/g, (_, hex) => String.fromCharCode(parseInt(hex, 16)))
    .trim();
}

export class CrunchyrollNewsAdapter implements NewsProviderAdapter {
  public readonly id = 'crunchyroll';
  public readonly name = 'Crunchyroll News';
  public readonly baseUrl = 'https://www.crunchyroll.com/news';

  private getFeedUrl(): string {
    return (
      process.env.CRUNCHYROLL_NEWS_FEED_URL ||
      'https://cr-news-api-service.prd.crunchyrollsvc.com/v1/en-US/rss'
    );
  }

  /**
   * Fetches latest legitimate real-world anime news articles from Crunchyroll News RSS
   */
  async fetchLatest(limit = 40): Promise<RawNewsArticle[]> {
    const xmlText = await newsProviderClient.get<string>(this.getFeedUrl(), this.name, {
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36 (compatible; OTAKUVA-NewsBot/2.0; +https://otakuva.com)',
        Accept: 'application/rss+xml, application/xml, text/xml, */*',
      },
      timeoutMs: 12000,
    });

    const parsedArticles = this.parseRssXml(xmlText);
    return parsedArticles.slice(0, limit);
  }

  /**
   * Parses standard RSS 2.0 XML payload into structured RawNewsArticle array
   */
  private parseRssXml(xmlText: string): RawNewsArticle[] {
    const articles: RawNewsArticle[] = [];
    if (!xmlText) return articles;

    const itemBlocks = xmlText.split(/<\/?item>/i);

    for (let i = 1; i < itemBlocks.length; i += 2) {
      const block = itemBlocks[i];
      if (!block || !block.includes('<title>')) continue;

      // 1. Headline / Title
      const titleMatch = block.match(/<title>([\s\S]*?)<\/title>/i);
      const title = titleMatch ? unescapeXml(titleMatch[1]) : '';
      if (!title || title.length < 3) continue;

      // 2. Canonical Link
      const linkMatch = block.match(/<link>([\s\S]*?)<\/link>/i);
      const sourceUrl = linkMatch ? unescapeXml(linkMatch[1]) : '';
      if (!sourceUrl || (!sourceUrl.startsWith('http://') && !sourceUrl.startsWith('https://'))) continue;

      // 3. Unique GUID / External ID
      const guidMatch = block.match(/<guid[^>]*>([\s\S]*?)<\/guid>/i);
      const rawGuid = guidMatch ? unescapeXml(guidMatch[1]) : sourceUrl;
      const guidSlug = rawGuid.replace(/^https?:\/\/[^/]+\//, '').replace(/[^a-zA-Z0-9_-]/g, '-');
      const externalId = `cr-${guidSlug}`.slice(0, 100);

      // 4. Description / Synopsis
      const descMatch = block.match(/<description>([\s\S]*?)<\/description>/i);
      let summary = descMatch ? unescapeXml(descMatch[1]) : '';
      summary = summary.replace(/<[^>]*>/g, ' ').replace(/\s+/g, ' ').trim();
      if (!summary || summary.length < 5) {
        summary = title;
      }

      // 5. Publication Date
      const pubDateMatch = block.match(/<pubDate>([\s\S]*?)<\/pubDate>/i);
      const pubDateStr = pubDateMatch ? unescapeXml(pubDateMatch[1]) : '';
      const publishedAt = pubDateStr ? new Date(pubDateStr) : new Date();

      // 6. Categories
      const categories: string[] = [];
      const catMatches = block.matchAll(/<category[^>]*>([\s\S]*?)<\/category>/gi);
      for (const cm of catMatches) {
        categories.push(unescapeXml(cm[1]));
      }

      const category = this.mapCategoryFromContent(title, summary, categories);

      // 7. Author Attribution
      const authorMatch =
        block.match(/<dc:creator>([\s\S]*?)<\/dc:creator>/i) ||
        block.match(/<author>([\s\S]*?)<\/author>/i);
      const author = authorMatch ? unescapeXml(authorMatch[1]) : 'Crunchyroll News Staff';

      // 8. Image extraction (extracts real Storyblok CDN production imagery from media:content or enclosure)
      const mediaMatch =
        block.match(/<media:content[^>]*url=["']([^"']+)["']/i) ||
        block.match(/<enclosure[^>]*url=["']([^"']+)["']/i) ||
        block.match(/<media:thumbnail[^>]*url=["']([^"']+)["']/i) ||
        block.match(/<img[^>]+src=["']([^"']+)["']/i);
      const imageUrl = mediaMatch ? mediaMatch[1] : null;

      // Opening paragraphs of the story (the feed carries the body; only the start is kept).
      const bodyMatch = block.match(/<content:encoded>([\s\S]*?)<\/content:encoded>/i);
      const excerpt = excerptFromFeedBody(bodyMatch?.[1]);

      articles.push({
        externalId,
        provider: 'CRUNCHYROLL',
        title,
        summary,
        content: excerpt,
        contentType: excerpt ? EXCERPT_CONTENT_TYPE : 'SOURCE_METADATA',
        sourceName: 'Crunchyroll News',
        sourceUrl,
        canonicalUrl: sourceUrl,
        imageUrl,
        author,
        category,
        publishedAt: isNaN(publishedAt.getTime()) ? new Date() : publishedAt,
      });
    }

    return articles;
  }

  /**
   * Infers standardized category from title, summary, and RSS categories
   */
  private mapCategoryFromContent(title: string, summary: string, rawCategories: string[]): string {
    const text = `${title} ${summary} ${rawCategories.join(' ')}`.toLowerCase();

    if (text.includes('trailer') || text.includes('teaser') || text.includes(' promo') || text.includes(' pv')) {
      return 'TRAILER';
    }
    if (text.includes('cast') || text.includes('voice actor') || text.includes('starring') || text.includes('voices')) {
      return 'CAST';
    }
    if (text.includes('director') || text.includes('animator') || text.includes('composer') || text.includes('character design') || text.includes('staff')) {
      return 'STAFF';
    }
    if (text.includes('manga') || text.includes('light novel') || text.includes('webtoon') || text.includes('comic')) {
      return 'MANGA';
    }
    if (text.includes('box office') || text.includes('ranking') || text.includes('industry') || text.includes('sales') || text.includes('earnings')) {
      return 'INDUSTRY';
    }
    if (text.includes('film') || text.includes('movie') || text.includes('theatrical') || text.includes('season') || text.includes('broadcast') || text.includes('production') || text.includes('animates')) {
      return 'PRODUCTION';
    }
    if (text.includes('reveals') || text.includes('announces') || text.includes('announced') || text.includes('unveils') || text.includes('gets')) {
      return 'ANNOUNCEMENT';
    }

    return 'ANIME';
  }

  async fetchByDate(startDate: Date, endDate: Date = new Date()): Promise<RawNewsArticle[]> {
    const all = await this.fetchLatest(80);
    return all.filter((a) => a.publishedAt >= startDate && a.publishedAt <= endDate);
  }

  async fetchById(externalId: string): Promise<RawNewsArticle | null> {
    const all = await this.fetchLatest(80);
    return all.find((a) => a.externalId === externalId) || null;
  }

  async search(query: string, limit = 20): Promise<RawNewsArticle[]> {
    const q = query.toLowerCase();
    const all = await this.fetchLatest(80);
    return all
      .filter((a) => a.title.toLowerCase().includes(q) || (a.summary && a.summary.toLowerCase().includes(q)))
      .slice(0, limit);
  }

  async healthCheck(): Promise<{ status: ProviderHealthStatus; latencyMs: number; error?: string }> {
    return await newsProviderClient.probeHealth(this.getFeedUrl(), this.name);
  }
}

export const crunchyrollNewsAdapter = new CrunchyrollNewsAdapter();
