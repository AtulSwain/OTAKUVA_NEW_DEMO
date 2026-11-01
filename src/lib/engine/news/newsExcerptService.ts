/**
 * Fills NewsArticle.content with the source's opening paragraphs for stories
 * that don't have them yet (see articleExcerpt.ts for the rules).
 *
 * Only touches provider stories whose content is still empty — OTAKUVA's own
 * stories (provider INTERNAL) and anything that already has text are never
 * rewritten. A failed fetch leaves the row exactly as it was.
 */
import { prisma } from '../../prisma';
import { logger } from '../../logger';
import { EXCERPT_CONTENT_TYPE, excerptFromText, fetchArticleExcerpt, isFetchableSourceUrl } from './articleExcerpt';

/** Stories tried in this process — so a page with no usable text isn't fetched every sync. */
const triedThisProcess = new Set<string>();

type Candidate = { id: string; summary: string | null; sourceUrl: string; canonicalUrl: string | null };

/** Excerpt for one story, or null. Long feed summaries are used before any page fetch. */
export async function buildExcerpt(article: Candidate): Promise<string | null> {
  if (article.summary && article.summary.length >= 300) {
    const fromSummary = excerptFromText(article.summary);
    if (fromSummary) return fromSummary;
  }
  const url = article.canonicalUrl || article.sourceUrl;
  if (url && isFetchableSourceUrl(url)) return fetchArticleExcerpt(url);
  return null;
}

export async function enrichMissingExcerpts(opts: { limit?: number; sinceDays?: number; delayMs?: number; apply?: boolean } = {}) {
  const { limit = 10, sinceDays = 7, delayMs = 800, apply = true } = opts;
  const since = sinceDays > 0 ? new Date(Date.now() - sinceDays * 24 * 60 * 60 * 1000) : undefined;

  const rows = await prisma.newsArticle.findMany({
    where: {
      content: null,
      provider: { not: 'INTERNAL' },
      status: 'PUBLISHED',
      relevance: { not: 'OFF_TOPIC' },
      deletedAt: null,
      ...(since ? { publishedAt: { gte: since } } : {}),
      ...(triedThisProcess.size ? { id: { notIn: Array.from(triedThisProcess) } } : {}),
    },
    orderBy: { publishedAt: 'desc' },
    take: limit,
    select: { id: true, title: true, provider: true, summary: true, sourceUrl: true, canonicalUrl: true },
  });

  let written = 0;
  const results: Array<{ id: string; title: string; provider: string; excerpt: string | null }> = [];
  for (const row of rows) {
    triedThisProcess.add(row.id);
    const needsFetch = !(row.summary && row.summary.length >= 300);
    const excerpt = await buildExcerpt(row);
    results.push({ id: row.id, title: row.title, provider: row.provider, excerpt });
    if (excerpt && apply) {
      // Guarded on content still being empty, so a concurrent run can't overwrite.
      const res = await prisma.newsArticle.updateMany({
        where: { id: row.id, content: null },
        data: { content: excerpt, contentType: EXCERPT_CONTENT_TYPE },
      });
      written += res.count;
    }
    if (needsFetch && delayMs > 0) await new Promise((r) => setTimeout(r, delayMs));
  }
  if (rows.length) logger.info('news excerpts', { checked: rows.length, written });
  return { checked: rows.length, written, results };
}
