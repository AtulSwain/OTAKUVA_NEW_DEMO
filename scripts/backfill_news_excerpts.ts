/**
 * OTAKUVA — add the source's opening paragraphs to stored news stories
 * (2026-11-01, owner). See src/lib/engine/news/articleExcerpt.ts for the rules.
 *
 *   npx tsx scripts/backfill_news_excerpts.ts                    # dry run: shows what it would write
 *   npx tsx scripts/backfill_news_excerpts.ts --apply            # write
 *   options: --limit=N (stories to check in step 2, default 2000)
 *            --days=N  (only stories published in the last N days; default all)
 *
 * 1. Re-reads every news feed; stories whose feed carries the body get their
 *    excerpt from it (Crunchyroll, Anime Herald, Honey's, MyAnimeList).
 * 2. The rest: a long stored summary, else the article page on the source's
 *    site, about one request a second.
 * Only stories with empty content are touched; OTAKUVA's own stories never.
 * New stories get this automatically on every news sync.
 */
import { prisma } from '../src/lib/prisma';
import { annNewsAdapter } from '../src/lib/engine/news/adapters/annNewsAdapter';
import { crunchyrollNewsAdapter } from '../src/lib/engine/news/adapters/crunchyrollNewsAdapter';
import { myAnimeListNewsAdapter } from '../src/lib/engine/news/adapters/myAnimeListNewsAdapter';
import { animeCornerNewsAdapter } from '../src/lib/engine/news/adapters/animeCornerNewsAdapter';
import { animeHeraldNewsAdapter } from '../src/lib/engine/news/adapters/animeHeraldNewsAdapter';
import { animeUkNewsAdapter, animeFeministNewsAdapter, honeysAnimeNewsAdapter } from '../src/lib/engine/news/adapters/moreRssAdapters';
import { EXCERPT_CONTENT_TYPE } from '../src/lib/engine/news/articleExcerpt';
import { enrichMissingExcerpts } from '../src/lib/engine/news/newsExcerptService';

const APPLY = process.argv.includes('--apply');
const arg = (name: string) => process.argv.find((a) => a.startsWith(`--${name}=`))?.split('=')[1];
const LIMIT = Number(arg('limit')) || 2000;
const DAYS = Number(arg('days')) || 0;

const ADAPTERS = [
  annNewsAdapter,
  crunchyrollNewsAdapter,
  myAnimeListNewsAdapter,
  animeCornerNewsAdapter,
  animeHeraldNewsAdapter,
  animeUkNewsAdapter,
  animeFeministNewsAdapter,
  honeysAnimeNewsAdapter,
];

function host(): string {
  try {
    const u = new URL(process.env.DATABASE_URL || '');
    return `${u.hostname}${u.pathname}`;
  } catch {
    return '(unparseable DATABASE_URL)';
  }
}

async function main() {
  console.log(`Database: ${host()} — ${APPLY ? 'WRITING' : 'dry run'}`);
  const before = await prisma.newsArticle.count({ where: { content: null, provider: { not: 'INTERNAL' } } });
  console.log(`Stories without an excerpt: ${before}`);

  // 1. From the feeds.
  let fromFeeds = 0;
  for (const adapter of ADAPTERS) {
    let items: Awaited<ReturnType<typeof adapter.fetchLatest>> = [];
    try {
      items = await adapter.fetchLatest(200);
    } catch (err) {
      console.log(`  ${adapter.name}: feed unreachable (${(err as Error).message})`);
      continue;
    }
    let n = 0;
    for (const raw of items) {
      if (!raw.content) continue;
      const where = { provider: (raw.provider || '').toUpperCase(), externalId: raw.externalId.trim(), content: null };
      if (APPLY) {
        n += (await prisma.newsArticle.updateMany({ where, data: { content: raw.content, contentType: EXCERPT_CONTENT_TYPE } })).count;
      } else {
        n += await prisma.newsArticle.count({ where });
      }
    }
    fromFeeds += n;
    console.log(`  ${adapter.name}: ${items.length} in feed, ${n} stored stories ${APPLY ? 'filled' : 'would be filled'}`);
  }

  // 2. Long summaries and article pages.
  const res = await enrichMissingExcerpts({ limit: LIMIT, sinceDays: DAYS, delayMs: 1000, apply: APPLY });
  const found = res.results.filter((r) => r.excerpt).length;
  console.log(`  Pages/summaries: checked ${res.checked}, excerpt found for ${found}, ${APPLY ? `written ${res.written}` : 'nothing written (dry run)'}`);
  const byProvider: Record<string, { found: number; none: number }> = {};
  for (const r of res.results) {
    const b = (byProvider[r.provider] ||= { found: 0, none: 0 });
    if (r.excerpt) b.found++;
    else b.none++;
  }
  console.table(byProvider);
  for (const r of res.results.filter((x) => x.excerpt).slice(0, 3)) {
    console.log(`\n— ${r.title}\n  ${r.excerpt!.replace(/\n\n/g, '\n  ¶ ')}`);
  }

  const after = await prisma.newsArticle.count({ where: { content: null, provider: { not: 'INTERNAL' } } });
  console.log(`\nFrom feeds: ${fromFeeds}. Stories still without an excerpt: ${after} (they keep showing the summary + link).`);
}

main()
  .catch((err) => {
    console.error(err);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
