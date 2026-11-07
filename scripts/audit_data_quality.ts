/**
 * OTAKUVA — DATA QUALITY AUDIT (read-only, 2026-11-06)
 * Usage: npx tsx scripts/audit_data_quality.ts [--json]
 *
 * Lists rows that look wrong and need a person to decide — it never edits
 * anything (charter: missing/suspicious data goes to review, not a guess).
 *   1. Anime with an adult genre (Hentai/Erotica) but isAdult = false
 *   2. Status strings outside the known vocabulary (mixed "Finished" /
 *      "Finished Airing" etc. are fine — they're mapped for display; this
 *      lists anything that isn't)
 *   3. Finished shows whose stored episode rows exceed the declared total
 *   4. People with unsigned MyAnimeList photo URLs (the old sequential-id
 *      seed pattern — most 404)
 *   5. Studios with more than one Wikidata match left for review in
 *      metadataJson (see scripts/enrich_studios_wikidata.ts)
 * With --json the full lists are printed; otherwise counts + first 15 each.
 */
import { prisma } from '../src/lib/prisma';
import { classifyAnimeStatus } from '../src/lib/anime/animeStatus';

const SHOW = process.argv.includes('--json') ? Infinity : 15;

function section(title: string, rows: string[]) {
  console.log(`\n## ${title} — ${rows.length}`);
  rows.slice(0, SHOW).forEach((r) => console.log(`  - ${r}`));
  if (rows.length > SHOW) console.log(`  … and ${rows.length - SHOW} more (run with --json for all)`);
}

async function main() {
  const adult = await prisma.anime.findMany({
    where: { isAdult: false, animeGenres: { some: { genre: { name: { in: ['Hentai', 'Erotica'] } } } } },
    select: { slug: true, canonicalTitle: true, year: true, externalSource: true },
    take: 5000,
  });
  section(
    'Adult genre but not marked adult (still shown on the public site until fixed)',
    adult.map((a) => `${a.slug} — ${a.canonicalTitle} (${a.year ?? '?'}, ${a.externalSource ?? 'unknown source'})`)
  );

  const statuses = await prisma.anime.groupBy({ by: ['status'], _count: { _all: true } });
  section(
    'Status values the site does not recognise',
    statuses
      .filter((s) => s.status && s.status !== 'MERGED' && classifyAnimeStatus(s.status) === null)
      .map((s) => `"${s.status}" × ${s._count._all}`)
  );

  const overfull = await prisma.$queryRaw<{ slug: string; title: string; declared: number; stored: number }[]>`
    SELECT a.slug, a."canonicalTitle" AS title, a.episodes AS declared, COUNT(e.id)::int AS stored
    FROM "Anime" a JOIN "Episode" e ON e."animeId" = a.id
    WHERE a.episodes IS NOT NULL AND a.episodes > 0
    GROUP BY a.id HAVING COUNT(e.id) > a.episodes
    ORDER BY COUNT(e.id) - a.episodes DESC LIMIT 5000`;
  section(
    'More stored episodes than the declared total',
    overfull.map((r) => `${r.slug} — ${r.title}: ${r.stored} stored vs ${r.declared} declared`)
  );

  const unsigned = await prisma.person.findMany({
    where: { imageUrl: { contains: 'myanimelist.net' }, NOT: { imageUrl: { contains: '?s=' } } },
    select: { slug: true, name: true, imageUrl: true },
    take: 5000,
  });
  section(
    'People with unsigned MyAnimeList photo URLs (likely dead; scripts/cleanup_dead_person_images.ts checks and clears)',
    unsigned.map((p) => `${p.slug ?? '(no slug)'} — ${p.name}: ${p.imageUrl}`)
  );

  const studios = await prisma.studio.findMany({
    where: { metadataJson: { contains: 'ambiguous' } },
    select: { slug: true, name: true },
    take: 500,
  });
  section('Studios with an ambiguous Wikidata match noted', studios.map((s) => `${s.slug ?? '?'} — ${s.name}`));

  console.log('\nNothing was changed. Fix rows through Control Center or the matching script after review.');
}

main()
  .catch((e) => {
    console.error(e);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
