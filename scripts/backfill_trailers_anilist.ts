/**
 * OTAKUVA — add official trailers from AniList to anime that have none
 * (2026-11-01, owner). Dry run by default.
 *
 *   npx tsx scripts/backfill_trailers_anilist.ts           # dry run: counts + examples
 *   npx tsx scripts/backfill_trailers_anilist.ts --apply   # write
 *
 * Asks AniList (50 anime per request, by AniList id) for the trailer it
 * records for that exact anime — YouTube or Dailymotion. Writes `trailerUrl`
 * only when it's empty, never where an EditorialOverride owns the field, and
 * never clears or replaces a trailer. Each write is logged to
 * AnimeMetadataHistory (source `trailer-anilist`). Anime AniList has no
 * trailer for stay empty, and their page says "This anime doesn't have a
 * trailer."
 */
import { prisma } from '../src/lib/prisma';
import { providerTrailerUrl } from '../src/lib/media/trailer';

const APPLY = process.argv.includes('--apply');
const QUERY = 'query($ids:[Int]){Page(perPage:50){media(id_in:$ids,type:ANIME){id trailer{id site}}}}';

async function fetchTrailers(ids: number[], attempt = 1): Promise<Map<number, string>> {
  const res = await fetch('https://graphql.anilist.co', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
    body: JSON.stringify({ query: QUERY, variables: { ids } }),
  });
  if (res.status === 429 && attempt <= 5) {
    const wait = (Number(res.headers.get('retry-after')) || 30) * 1000;
    console.log(`  rate limited — waiting ${wait / 1000}s`);
    await new Promise((r) => setTimeout(r, wait));
    return fetchTrailers(ids, attempt + 1);
  }
  if (!res.ok) throw new Error(`AniList ${res.status}`);
  const json: any = await res.json();
  const out = new Map<number, string>();
  for (const m of json.data?.Page?.media || []) {
    const url = providerTrailerUrl(m.trailer?.site, m.trailer?.id);
    if (url) out.set(m.id, url);
  }
  return out;
}

async function main() {
  const candidates = await prisma.anime.findMany({
    where: { anilistId: { not: null }, OR: [{ trailerUrl: null }, { trailerUrl: '' }], status: { not: 'MERGED' } },
    select: { id: true, anilistId: true, canonicalTitle: true },
    orderBy: { popularity: 'desc' },
  });
  const overridden = new Set(
    (
      await prisma.editorialOverride.findMany({
        where: { entityType: 'ANIME', field: { in: ['trailerUrl', 'trailer'] } },
        select: { entityId: true },
      })
    ).map((o) => o.entityId)
  );
  const todo = candidates.filter((a) => !overridden.has(a.id));
  console.log(`${todo.length} anime without a trailer to check (${candidates.length - todo.length} skipped: editorial override).`);

  let found = 0;
  let written = 0;
  const examples: string[] = [];
  for (let i = 0; i < todo.length; i += 50) {
    const batch = todo.slice(i, i + 50);
    let trailers: Map<number, string>;
    try {
      trailers = await fetchTrailers(batch.map((a) => a.anilistId as number));
    } catch (err) {
      console.log(`  batch at ${i} failed (${(err as Error).message}) — skipped, re-run to retry`);
      continue;
    }
    for (const a of batch) {
      const url = trailers.get(a.anilistId as number);
      if (!url) continue;
      found++;
      if (examples.length < 10) examples.push(`${a.canonicalTitle} → ${url}`);
      if (APPLY) {
        const res = await prisma.anime.updateMany({
          where: { id: a.id, OR: [{ trailerUrl: null }, { trailerUrl: '' }] },
          data: { trailerUrl: url },
        });
        if (res.count) {
          await prisma.animeMetadataHistory.create({
            data: { animeId: a.id, field: 'trailerUrl', oldValue: null, newValue: url, source: 'trailer-anilist' },
          });
          written++;
        }
      }
    }
    if ((i / 50) % 20 === 0 || i + 50 >= todo.length) console.log(`  ${Math.min(i + 50, todo.length)}/${todo.length} checked — ${found} trailers found`);
    await new Promise((r) => setTimeout(r, 1500)); // stay well under AniList's rate limit
  }
  console.log('\nExamples:\n  ' + examples.join('\n  '));
  console.log(APPLY ? `\nDone: ${written} trailers written.` : `\nDry run: ${found} trailers would be written. Re-run with --apply.`);
}

main()
  .catch((e) => {
    console.error(e);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
