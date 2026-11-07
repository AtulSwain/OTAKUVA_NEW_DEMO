/**
 * Character search (2026-11-06). Typo-tolerant name match from
 * fuzzySearch.ts (pg_trgm index on Character.name), best match first. Each
 * result names the anime the character is best known from — a Main role
 * first, then the most popular show. Characters who only appear in adult
 * titles are left out, like everywhere else on the public site.
 */
import { prisma } from '../prisma';
import { searchCharacterIdsByName } from '../fuzzySearch';

export interface CharacterSearchItem {
  id: string;
  slug: string | null;
  name: string;
  nameKanji: string | null;
  imageUrl: string | null;
  anime: { slug: string; title: string; role: string } | null;
}

export async function searchCharacters(term: string, limit = 20): Promise<CharacterSearchItem[]> {
  const q = term.trim();
  if (q.length < 2) return [];
  const take = Math.min(Math.max(limit, 1), 50);
  const matches = await searchCharacterIdsByName(q, take * 2);
  if (!matches.length) return [];

  const rows = await prisma.character.findMany({
    where: { id: { in: matches.map((m) => m.id) }, animeRoles: { some: { anime: { isAdult: false } } } },
    select: {
      id: true,
      slug: true,
      name: true,
      nameKanji: true,
      imageUrl: true,
      animeRoles: {
        where: { anime: { isAdult: false } },
        select: { role: true, anime: { select: { slug: true, canonicalTitle: true, members: true } } },
      },
    },
  });

  const rank = new Map(matches.map((m) => [m.id, m.rank]));
  return rows
    .sort((a, b) => (rank.get(b.id) ?? 0) - (rank.get(a.id) ?? 0))
    .slice(0, take)
    .map((c) => {
      const best = [...c.animeRoles].sort(
        (x, y) => Number(y.role === 'Main') - Number(x.role === 'Main') || (y.anime.members ?? 0) - (x.anime.members ?? 0)
      )[0];
      return {
        id: c.id,
        slug: c.slug,
        name: c.name,
        nameKanji: c.nameKanji,
        imageUrl: c.imageUrl,
        anime: best?.anime.slug ? { slug: best.anime.slug, title: best.anime.canonicalTitle, role: best.role } : null,
      };
    });
}
