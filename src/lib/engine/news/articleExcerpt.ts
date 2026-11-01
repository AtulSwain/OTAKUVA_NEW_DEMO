/**
 * News excerpts (2026-11-01, owner): a story page shows the headline, the
 * first one or two paragraphs of the source's own article, then a link to
 * read the rest on the source's site.
 *
 * The paragraphs are copied word for word from the publisher — never
 * rewritten or summarised — and stored as plain text in NewsArticle.content
 * with contentType SOURCE_EXCERPT (paragraphs separated by a blank line).
 * Only the opening is kept, never the full article.
 *
 * Where the text comes from, in order:
 *   1. the feed itself, when the publisher puts the body in it
 *      (`content:encoded` — Crunchyroll, Anime Herald);
 *   2. a long feed summary, which is already the story's lead
 *      (MyAnimeList, Honey's Anime);
 *   3. the article page on the source's own site (ANN, Anime Corner, …),
 *      only for hosts in SOURCE_HOSTS.
 * Nothing found → content stays null and the page shows the summary as before.
 */

export const EXCERPT_CONTENT_TYPE = 'SOURCE_EXCERPT' as const;

const MAX_PARAGRAPH = 700;
const MAX_TOTAL = 1100;
const MIN_PARAGRAPH = 80;

/** Hosts whose article pages may be fetched for an excerpt. */
const SOURCE_HOSTS = [
  'animenewsnetwork.com',
  'animecorner.me',
  'animefeminist.com',
  'animeherald.com',
  'honeysanime.com',
  'animeuknews.net',
];

// Site furniture, not reporting. Phrases only — single words like
// "affiliate" or "subscribers" turn up in real news ("TBS affiliate networks").
const BOILERPLATE =
  /(ad-free|patreon|ko-fi|support us\b|support the site|subscribe to\b|our newsletter|we use cookies|cookie (policy|settings)|privacy policy|\bsign in\b|\bsign up\b|\blog in\b|all rights reserved|advertisement|affiliate links?\b|click here|follow us\b|share this\b|related posts|you may also like|comments? (are|is) closed|leave a (comment|reply)|this post (may )?contains?|terms of (use|service))/i;
const CREDIT_LINE = /^(source|sources|image|images|via|credit|credits|photo|featured image|thanks to)\s*[:：]/i;

const ENTITIES: Record<string, string> = {
  amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", nbsp: ' ', hellip: '…', mdash: '—', ndash: '–',
  lsquo: '‘', rsquo: '’', ldquo: '“', rdquo: '”', laquo: '«', raquo: '»', middot: '·', eacute: 'é',
};

export function decodeEntities(s: string): string {
  return s
    .replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g, '$1')
    .replace(/&#(\d+);/g, (_, n) => safeChar(Number(n)))
    .replace(/&#x([0-9a-f]+);/gi, (_, n) => safeChar(parseInt(n, 16)))
    .replace(/&([a-z]+);/gi, (m, name) => ENTITIES[name.toLowerCase()] ?? m);
}

function safeChar(code: number): string {
  try {
    return Number.isFinite(code) && code > 0 && code < 0x110000 ? String.fromCodePoint(code) : '';
  } catch {
    return '';
  }
}

const INLINE_TAGS = /<\/?(a|em|strong|i|b|span|cite|abbr|small|sup|sub|u|mark|time|q)\b[^>]*>/gi;

function clean(text: string): string {
  return decodeEntities(text.replace(INLINE_TAGS, '').replace(/<[^>]*>/g, ' '))
    .replace(/\s+/g, ' ')
    .replace(/\s+([,.;:!?’”)\]])/g, '$1')
    .replace(/([(\[“‘])\s+/g, '$1')
    .trim();
}

/** WordPress shortcodes ([sourceLink …]) and non-English [es]…[/es] blocks some feeds leave in. */
function stripShortcodes(text: string): string {
  return text
    .replace(/\[(?!en\])([a-z]{2})\][\s\S]*?\[\/\1\]/gi, ' ')
    .replace(/\[\/?[a-z][^\]]*\]/gi, ' ')
    .replace(/^\s*What You Need to Know:\s*/i, '');
}

/** Split text into sentences, keeping the punctuation. A boundary needs a capital/number/quote after it. */
const ABBREVIATION = /(?:^|[\s(])(Mr|Mrs|Ms|Dr|St|Jr|Sr|Prof|vs|No|Vol|Ep|Ch|ft|feat|Inc|Ltd|Co|Corp|approx|etc|[A-Z])\.$/;

function sentences(text: string): string[] {
  const parts = text
    .split(/(?<=[.!?。…]["'”’)\]]*)\s+(?=["“‘'(\[]?[A-Z0-9])/)
    .map((s) => s.trim())
    .filter(Boolean);
  // "Mr. Sato", "Vol. 3", "J. R. R." are not sentence ends — glue them back.
  const out: string[] = [];
  for (const p of parts) {
    if (out.length && ABBREVIATION.test(out[out.length - 1])) out[out.length - 1] += ' ' + p;
    else out.push(p);
  }
  return out;
}

/** Feeds cut long descriptions with "…" — never show a half sentence. */
function isComplete(sentence: string): boolean {
  return /[.!?。"”’)]$/.test(sentence) && !/(\.\.\.|…)$/.test(sentence);
}

/** Cut a too-long paragraph at a sentence boundary. */
function trimParagraph(p: string, max = MAX_PARAGRAPH): string {
  if (p.length <= max) return p;
  let out = '';
  for (const s of sentences(p)) {
    if ((out + ' ' + s).trim().length > max) break;
    out = (out + ' ' + s).trim();
  }
  return out || p.slice(0, max).replace(/\s+\S*$/, '') + '…';
}

function isProse(p: string): boolean {
  if (p.length < MIN_PARAGRAPH) return false;
  if (p.split(/\s+/).length < 12) return false;
  if (!/[.!?。"”’)]$/.test(p) && !/[.!?。]\s/.test(p)) return false;
  if (/:\s*$/.test(p)) return false; // a lead-in to a list or quote that isn't included
  if ((p.match(/\|/g) || []).length >= 3) return false;
  if (BOILERPLATE.test(p) || CREDIT_LINE.test(p)) return false;
  return true;
}

/** First one or two paragraphs, within the length limits. */
function pick(paragraphs: string[]): string[] {
  const out: string[] = [];
  for (const raw of paragraphs) {
    const p = trimParagraph(raw);
    if (!out.length) {
      out.push(p);
      if (p.length >= MAX_PARAGRAPH - 50) break; // one long paragraph is enough
      continue;
    }
    if (out[0].length + p.length <= MAX_TOTAL) out.push(p);
    break;
  }
  return out;
}

/** Excerpt from HTML that has real <p> paragraphs (an article page or a feed body). */
export function excerptFromHtml(html: string): string | null {
  if (!html) return null;
  const body = html
    .replace(/<script\b[\s\S]*?<\/script>/gi, ' ')
    .replace(/<style\b[\s\S]*?<\/style>/gi, ' ')
    .replace(/<(nav|header|footer|aside|form|figure|figcaption|noscript)\b[\s\S]*?<\/\1>/gi, ' ');

  // Start reading where the article body begins, when the page marks it.
  const markers = [/itemprop=["']articleBody["']/i, /class=["'][^"']*\bentry-content\b/i, /class=["'][^"']*\bmeat\b/i, /class=["'][^"']*\b(post|article)-(content|body)\b/i, /<article\b/i];
  let start = 0;
  for (const m of markers) {
    const i = body.search(m);
    if (i >= 0) {
      start = i;
      break;
    }
  }

  const paragraphs: string[] = [];
  for (const m of body.slice(start).matchAll(/<p\b[^>]*>([\s\S]*?)<\/p>/gi)) {
    const inner = m[1];
    const text = clean(inner);
    // Mostly link text → a menu or a "read more" list, not prose.
    const linkText = clean((inner.match(/<a\b[\s\S]*?<\/a>/gi) || []).join(' '));
    if (text && linkText.length > text.length * 0.5) continue;
    if (isProse(text)) paragraphs.push(text);
    if (paragraphs.length >= 2) break;
  }
  const out = pick(paragraphs);
  return out.length ? out.join('\n\n') : null;
}

/** Excerpt from flat text with no paragraph markup (some feeds strip it). */
export function excerptFromText(text: string): string | null {
  const flat = clean(stripShortcodes(text));
  if (flat.length < 150) return null;
  // Copied in order, never with sentences skipped: stop at the first credit
  // line / site furniture or at a sentence the feed cut off.
  const parts: string[] = [];
  for (const s of sentences(flat)) {
    if (CREDIT_LINE.test(s) || BOILERPLATE.test(s) || !isComplete(s)) break;
    parts.push(s);
  }
  const paragraphs: string[] = [];
  let current = '';
  for (const s of parts) {
    current = (current + ' ' + s).trim();
    if (current.length >= 280) {
      paragraphs.push(current);
      current = '';
      if (paragraphs.length >= 2) break;
    }
  }
  if (current && paragraphs.length < 2) paragraphs.push(current);
  const out = pick(paragraphs.filter((p) => p.length >= MIN_PARAGRAPH));
  return out.length ? out.join('\n\n') : null;
}

/** Excerpt from a feed item's body (`content:encoded`), with or without <p> markup. */
export function excerptFromFeedBody(body: string | null | undefined): string | null {
  if (!body) return null;
  const decoded = decodeEntities(body);
  if (/<p\b/i.test(decoded)) {
    const fromHtml = excerptFromHtml(decoded);
    if (fromHtml) return fromHtml;
  }
  return excerptFromText(decoded);
}

export function isFetchableSourceUrl(url: string): boolean {
  try {
    const u = new URL(url);
    if (u.protocol !== 'https:' && u.protocol !== 'http:') return false;
    const host = u.hostname.toLowerCase();
    return SOURCE_HOSTS.some((h) => host === h || host.endsWith('.' + h));
  } catch {
    return false;
  }
}

const MAX_PAGE_BYTES = 2_000_000;

/** Fetch the source's article page and take its opening paragraphs. Never throws. */
export async function fetchArticleExcerpt(url: string, timeoutMs = 10_000): Promise<string | null> {
  if (!isFetchableSourceUrl(url)) return null;
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const res = await fetch(url, {
      signal: controller.signal,
      redirect: 'follow',
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36 (compatible; OTAKUVA-NewsBot/2.0; +https://otakuva.com)',
        Accept: 'text/html,application/xhtml+xml',
      },
    });
    if (!res.ok || (res.url && !isFetchableSourceUrl(res.url))) return null;
    if (!(res.headers.get('content-type') || '').includes('html')) return null;
    const html = await res.text();
    return excerptFromHtml(html.length > MAX_PAGE_BYTES ? html.slice(0, MAX_PAGE_BYTES) : html);
  } catch {
    return null;
  } finally {
    clearTimeout(timer);
  }
}

/** Paragraphs of a stored excerpt, for display. */
export function excerptParagraphs(content: string | null | undefined): string[] {
  return (content || '').split(/\n{2,}/).map((p) => p.trim()).filter(Boolean);
}
