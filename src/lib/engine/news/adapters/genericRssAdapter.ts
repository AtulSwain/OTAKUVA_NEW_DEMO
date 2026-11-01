/**
 * SHARED RSS PARSING/ADAPTER BASE FOR ADDITIONAL REAL-WORLD NEWS SOURCES
 *
 * annNewsAdapter.ts and crunchyrollNewsAdapter.ts each hand-roll an
 * identical RSS 2.0 regex parser + category heuristic. Rather than
 * quadruple that duplication for every additional source, new adapters
 * extend `GenericRssNewsAdapter` and only specify their feed URL, id
 * prefix, and provider code — same parsing behavior, one place to fix a
 * bug in it. (The two existing adapters are left as-is rather than
 * refactored onto this, to avoid touching working, already-verified code
 * for a cosmetic dedup win.)
 */

import { newsProviderClient } from '../newsProviderClient';
import { NewsProviderAdapter } from '../newsProvider.interface';
import { ProviderHealthStatus, RawNewsArticle } from '../newsTypes';
import { EXCERPT_CONTENT_TYPE, excerptFromFeedBody, excerptFromText } from '../articleExcerpt';

export function unescapeXml(str: string): string {
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
    // Named entities beyond the handful above — common in WordPress-style
    // feeds (Anime Corner, Anime Herald) even when they never showed up in
    // ANN/Crunchyroll's feeds. Left un-decoded, these render as literal
    // "&hellip;" etc. in the UI instead of the character they represent.
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

/**
 * Same category heuristic as the ANN/Crunchyroll adapters — kept in sync
 * with those by construction, since all three parse the same style of
 * headline/summary text.
 */
export function categorizeFromContent(title: string, summary: string, rawCategories: string[] = []): string {
  const text = `${title} ${summary} ${rawCategories.join(' ')}`.toLowerCase();

  if (text.includes('trailer') || text.includes('teaser') || text.includes(' promo') || text.includes(' pv')) return 'TRAILER';
  if (text.includes('cast') || text.includes('voice actor') || text.includes('starring') || text.includes('voices')) return 'CAST';
  if (text.includes('director') || text.includes('animator') || text.includes('composer') || text.includes('character design') || text.includes('staff')) return 'STAFF';
  if (text.includes('manga') || text.includes('light novel') || text.includes('webtoon') || text.includes('comic')) return 'MANGA';
  if (text.includes('box office') || text.includes('ranking') || text.includes('industry') || text.includes('sales') || text.includes('earnings')) return 'INDUSTRY';
  if (text.includes('film') || text.includes('movie') || text.includes('theatrical') || text.includes('season') || text.includes('broadcast') || text.includes('production') || text.includes('animates')) return 'PRODUCTION';
  if (text.includes('reveals') || text.includes('announces') || text.includes('announced') || text.includes('unveils') || text.includes('gets')) return 'ANNOUNCEMENT';

  return 'ANIME';
}

export interface RssFeedConfig {
  idPrefix: string;       // e.g. "mal" -> externalId "mal-12345"
  providerCode: string;   // e.g. "MYANIMELIST" stored on RawNewsArticle.provider
  sourceName: string;     // human-readable, e.g. "MyAnimeList News"
  defaultAuthor: string;
}

/**
 * Parses a standard RSS 2.0 payload into RawNewsArticle[]. Skips any item
 * missing a title or a real http(s) link rather than guessing — a partial
 * RSS item is not something to fill in with invented fields.
 */
export function parseRssFeed(xmlText: string, cfg: RssFeedConfig): RawNewsArticle[] {
  const articles: RawNewsArticle[] = [];
  if (!xmlText) return articles;

  const itemBlocks = xmlText.split(/<\/?item>/i);

  for (let i = 1; i < itemBlocks.length; i += 2) {
    const block = itemBlocks[i];
    if (!block || !block.includes('<title>')) continue;

    const titleMatch = block.match(/<title>([\s\S]*?)<\/title>/i);
    const title = titleMatch ? unescapeXml(titleMatch[1]) : '';
    if (!title || title.length < 3) continue;

    const linkMatch = block.match(/<link>([\s\S]*?)<\/link>/i);
    const sourceUrl = linkMatch ? unescapeXml(linkMatch[1]) : '';
    if (!sourceUrl || (!sourceUrl.startsWith('http://') && !sourceUrl.startsWith('https://'))) continue;

    const guidMatch = block.match(/<guid[^>]*>([\s\S]*?)<\/guid>/i);
    const rawGuid = guidMatch ? unescapeXml(guidMatch[1]) : sourceUrl;
    const guidSlug = rawGuid.replace(/^https?:\/\/[^/]+\//, '').replace(/[^a-zA-Z0-9_-]/g, '-');
    const externalId = `${cfg.idPrefix}-${guidSlug}`.slice(0, 120);

    const descMatch = block.match(/<description>([\s\S]*?)<\/description>/i);
    let summary = descMatch ? unescapeXml(descMatch[1]) : '';
    summary = summary.replace(/<[^>]*>/g, ' ').replace(/\s+/g, ' ').trim();
    if (!summary || summary.length < 5) summary = title;

    const pubDateMatch = block.match(/<pubDate>([\s\S]*?)<\/pubDate>/i);
    const pubDateStr = pubDateMatch ? unescapeXml(pubDateMatch[1]) : '';
    const publishedAt = pubDateStr ? new Date(pubDateStr) : new Date();

    const categories: string[] = [];
    for (const cm of block.matchAll(/<category[^>]*>([\s\S]*?)<\/category>/gi)) {
      categories.push(unescapeXml(cm[1]));
    }
    const category = categorizeFromContent(title, summary, categories);

    const authorMatch =
      block.match(/<dc:creator>([\s\S]*?)<\/dc:creator>/i) ||
      block.match(/<author>([\s\S]*?)<\/author>/i);
    const author = authorMatch ? unescapeXml(authorMatch[1]) : cfg.defaultAuthor;

    const mediaMatch =
      block.match(/<media:content[^>]*url=["']([^"']+)["']/i) ||
      block.match(/<enclosure[^>]*url=["']([^"']+)["']/i) ||
      block.match(/<media:thumbnail[^>]*url=["']([^"']+)["']/i) ||
      block.match(/<img[^>]+src=["']([^"']+)["']/i);
    const imageUrl = mediaMatch ? mediaMatch[1] : null;

    // Opening paragraphs: from the feed's body when it has one, else from a
    // long description (some feeds put the whole story there). Only the start is kept.
    const bodyMatch = block.match(/<content:encoded>([\s\S]*?)<\/content:encoded>/i);
    const excerpt = excerptFromFeedBody(bodyMatch?.[1]) ?? (summary.length >= 300 ? excerptFromText(summary) : null);

    articles.push({
      externalId,
      provider: cfg.providerCode,
      title,
      summary,
      content: excerpt,
      contentType: excerpt ? EXCERPT_CONTENT_TYPE : 'SOURCE_METADATA',
      sourceName: cfg.sourceName,
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
 * Base class for a single-feed RSS news source. Subclasses set the four
 * `readonly` identity fields and implement `getFeedUrl()`; everything else
 * (fetch/parse/search/health-check) comes from here.
 */
export abstract class GenericRssNewsAdapter implements NewsProviderAdapter {
  abstract readonly id: string;
  abstract readonly name: string;
  abstract readonly baseUrl: string;
  protected abstract readonly idPrefix: string;
  protected abstract readonly providerCode: string;
  protected abstract readonly defaultAuthor: string;

  protected abstract getFeedUrl(): string;

  async fetchLatest(limit = 40): Promise<RawNewsArticle[]> {
    const xmlText = await newsProviderClient.get<string>(this.getFeedUrl(), this.name, {
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36 (compatible; OTAKUVA-NewsBot/2.0; +https://otakuva.com)',
        Accept: 'application/rss+xml, application/xml, text/xml, */*',
      },
      timeoutMs: 12000,
    });

    return parseRssFeed(xmlText, {
      idPrefix: this.idPrefix,
      providerCode: this.providerCode,
      sourceName: this.name,
      defaultAuthor: this.defaultAuthor,
    }).slice(0, limit);
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
    return newsProviderClient.probeHealth(this.getFeedUrl(), this.name);
  }
}
