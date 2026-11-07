import './helpers/setupTestDb';

import { after, describe, test } from 'node:test';
import assert from 'node:assert/strict';
import { prisma } from '../src/lib/prisma';
import { resolveCharacter } from '../src/lib/characters/characterResolver';

after(async () => {
  await prisma.$disconnect();
});

describe('characters are matched by provider id, not name', () => {
  test('two different characters with the same name stay separate', async () => {
    const a = await resolveCharacter({ externalId: '9001', name: 'Levi', imageUrl: 'https://img/a.jpg' }, 'anilist');
    const b = await resolveCharacter({ externalId: '9002', name: 'Levi', imageUrl: 'https://img/b.jpg' }, 'anilist');
    assert.ok(a && b);
    assert.notEqual(a, b);
    const rowA = await prisma.character.findUnique({ where: { id: a! } });
    assert.equal(rowA?.imageUrl, 'https://img/a.jpg', 'the second Levi did not overwrite the first');
  });

  test('the same provider id resolves to one row, and filled fields are kept', async () => {
    const first = await resolveCharacter({ externalId: '9100', name: 'Frieren', imageUrl: 'https://img/old.jpg' }, 'anilist');
    const again = await resolveCharacter({ externalId: '9100', name: 'Frieren', imageUrl: 'https://img/new.jpg', about: 'Elf mage' }, 'anilist');
    assert.equal(first, again);
    const row = await prisma.character.findUnique({ where: { id: first! } });
    assert.equal(row?.imageUrl, 'https://img/old.jpg');
    assert.equal(row?.about, 'Elf mage', 'empty fields are filled');
  });

  test('AniList and MAL ids with the same number are different characters', async () => {
    const al = await resolveCharacter({ externalId: '9200', name: 'Alpha' }, 'anilist');
    const mal = await resolveCharacter({ externalId: '9200', name: 'Beta' }, 'jikan');
    assert.notEqual(al, mal);
  });
});
