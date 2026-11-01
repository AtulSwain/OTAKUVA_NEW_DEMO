/**
 * OTAKUVA — pull newly announced anime from AniList (2026-11-01).
 *
 *   npx tsx scripts/sync_announced_anime.ts                 # 4 pages (200 newest)
 *   npx tsx scripts/sync_announced_anime.ts --pages=10 --max-new=200 --max-refresh=100
 *
 * Same work the site does by itself every few hours (ensureFreshAnnouncements):
 * adds announcements we don't have (with their studios), refreshes stale
 * AniList copies, links prequels and matching news. Add-only; never deletes.
 * Writes directly — there's nothing destructive to dry-run.
 */
import { prisma } from '../src/lib/prisma';
import { syncAnnouncedAnime } from '../src/lib/announcements/announcementSync';

const arg = (name: string, fallback: number) => {
  const hit = process.argv.find((a) => a.startsWith(`--${name}=`));
  const n = hit ? parseInt(hit.split('=')[1], 10) : NaN;
  return Number.isFinite(n) && n >= 0 ? n : fallback;
};

async function main() {
  const res = await syncAnnouncedAnime({ pages: arg('pages', 4), maxNew: arg('max-new', 100), maxRefresh: arg('max-refresh', 60) });
  if (!res.ran) {
    console.log('Another announcement sync is running — try again in a few minutes.');
    return;
  }
  console.log(`Fetched ${res.fetched} · added ${res.added.length} · refreshed ${res.refreshed} · already known ${res.alreadyKnown} · excluded ${res.excluded} · failed ${res.failed}`);
  console.log(`Relations linked ${res.relationsLinked} · news linked ${res.newsLinked} · news held for review ${res.newsQueuedForReview}`);
  if (res.added.length) console.log(`Added:\n  ${res.added.map((s) => `/anime/${s}`).join('\n  ')}`);
  if (res.heldForReview.length) console.log(`Held for review (same title + format + year already stored):\n  ${res.heldForReview.join('\n  ')}`);
}

main()
  .catch((err) => {
    console.error(err);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
