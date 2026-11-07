/**
 * Characters are matched by provider id, never by name (2026-11-06).
 *
 * Before, syncCharacters keyed characters on a name-only slug ("levi"), so
 * every character called Levi became one row and each sync overwrote the
 * last one's id, picture and bio. Same scheme as
 * scripts/import_characters_studios_anilist.ts:
 *   externalId = "<provider>:<id>", slug = "<name>-c<id>" (AniList) /
 *   "<name>-m<id>" (MyAnimeList).
 * An existing row only gets empty fields filled — never overwritten.
 */
import { prisma } from '../prisma';
import { generateSlug } from '../normalizers';

export type CharacterProvider = 'anilist' | 'jikan';

interface IncomingCharacter {
  externalId: string;
  name: string;
  nameKanji?: string | null;
  about?: string | null;
  imageUrl?: string | null;
}

const isPlaceholder = (url?: string | null) => !url || /\/default\.(jpg|png)$|questionmark/i.test(url);

export function characterKey(provider: CharacterProvider, externalId: string) {
  return `${provider}:${externalId}`;
}

export async function resolveCharacter(c: IncomingCharacter, provider: CharacterProvider): Promise<string | null> {
  const rawId = String(c.externalId || '').trim();
  const name = c.name?.trim();
  if (!rawId || !name) return null;
  const key = characterKey(provider, rawId);
  const image = isPlaceholder(c.imageUrl) ? null : c.imageUrl!;

  let row = await prisma.character.findFirst({
    where: { externalId: key },
    select: { id: true, nameKanji: true, about: true, imageUrl: true },
  });

  // A row the old sync wrote (bare id, name slug): adopt it only when the
  // name agrees too, since AniList and MAL ids are both plain numbers.
  if (!row) {
    const legacy = await prisma.character.findFirst({
      where: { externalId: rawId, name },
      select: { id: true, nameKanji: true, about: true, imageUrl: true },
    });
    if (legacy) {
      await prisma.character.update({ where: { id: legacy.id }, data: { externalId: key } });
      row = legacy;
    }
  }

  if (row) {
    const fill: Record<string, string> = {};
    if (!row.nameKanji && c.nameKanji) fill.nameKanji = c.nameKanji;
    if (!row.about && c.about) fill.about = c.about;
    if (!row.imageUrl && image) fill.imageUrl = image;
    if (Object.keys(fill).length) await prisma.character.update({ where: { id: row.id }, data: fill });
    return row.id;
  }

  const base = generateSlug(name) || 'character';
  const created = await prisma.character.create({
    data: {
      externalId: key,
      name,
      slug: `${base}-${provider === 'anilist' ? 'c' : 'm'}${rawId}`,
      nameKanji: c.nameKanji || null,
      about: c.about || null,
      imageUrl: image,
    },
    select: { id: true },
  });
  return created.id;
}
