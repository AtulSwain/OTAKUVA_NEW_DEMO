import './helpers/setupTestDb';

import { after, describe, test } from 'node:test';
import assert from 'node:assert/strict';
import { prisma } from '../src/lib/prisma';
import { createAnime } from './helpers/fixtures';
import { countAnnouncedAnime, getAnnouncedAnime } from '../src/lib/announcements/announcedAnime';
import { headlineNames, linkAnnouncementNews, syncAnnouncedAnime } from '../src/lib/announcements/announcementSync';
import { GET as announcedGET } from '../src/app/api/announced/route';
import { request, read } from './helpers/http';
import type { ProviderAnime } from '../src/lib/providers/animeProvider.interface';

after(async () => {
  await prisma.$disconnect();
});

const DAY = 86_400_000;

function providerAnime(over: Partial<ProviderAnime>): ProviderAnime {
  return {
    externalId: '1',
    externalSource: 'anilist',
    malId: null,
    anilistId: null,
    title: 'Announced Show',
    titles: [],
    synopsis: 'Just announced.',
    type: 'TV',
    status: 'Not Yet Aired',
    year: 2027,
    posterUrl: 'https://example.com/p.jpg',
    genres: ['Action'],
    themes: [],
    studios: [],
    producers: [],
    licensors: [],
    ...over,
  };
}

describe('Announced section', () => {
  test('lists announced, not-yet-premiered anime newest first, per studio, with real facts only', async () => {
    const studio = await prisma.studio.create({ data: { name: 'Announce Studio', slug: 'announce-studio' } });
    const older = await createAnime({ status: 'Not Yet Aired', anilistId: 500001, canonicalTitle: 'Older Announcement', year: 2027 });
    const newer = await createAnime({ status: 'Not Yet Aired', anilistId: 500002, canonicalTitle: 'Newer Announcement', synopsis: 'No synopsis available.' });
    const prequel = await createAnime({ status: 'Finished', anilistId: 400000, canonicalTitle: 'The First Season' });
    await createAnime({ status: 'Not Yet Aired', anilistId: 500003, isAdult: true });
    await createAnime({ status: 'Not Yet Aired', anilistId: 500004, type: 'Music' });
    await createAnime({ status: 'Finished', anilistId: 500005 });
    // Stale status: the exact premiere day passed long ago.
    await createAnime({ status: 'Not Yet Aired', anilistId: 500006, datePrecision: 'DAY', startDate: new Date(Date.now() - 20 * DAY) });
    await prisma.animeStudio.create({ data: { animeId: newer.id, studioId: studio.id, isMain: true } });
    await prisma.animeRelation.create({ data: { sourceAnimeId: newer.id, targetAnimeId: prequel.id, relationType: 'Prequel' } });

    const all = await getAnnouncedAnime({ limit: 60 });
    const ids = all.map((a) => a.id);
    assert.ok(ids.indexOf(newer.id) < ids.indexOf(older.id), 'higher AniList id = later announcement = first');
    assert.equal(all.filter((a) => [newer.id, older.id].includes(a.id)).length, 2);
    assert.equal(all.length, await countAnnouncedAnime(), 'adult, music, finished and stale-dated rows are left out');

    const n = all.find((a) => a.id === newer.id)!;
    assert.equal(n.synopsis, null, 'placeholder synopsis is not shown');
    assert.equal(n.premiere, null, 'no date stored → no date shown');
    assert.deepEqual(n.continues, { label: 'Sequel to', slug: prequel.slug, title: 'The First Season' });
    assert.equal(n.studios[0].name, 'Announce Studio');
    assert.equal(all.find((a) => a.id === older.id)!.premiere, '2027');

    const byStudio = await getAnnouncedAnime({ studioId: studio.id });
    assert.deepEqual(byStudio.map((a) => a.id), [newer.id]);

    const api = await read(await announcedGET(request('GET', '/api/announced?studio=announce-studio')));
    assert.equal(api.status, 200);
    assert.equal(api.body.total, 1);
    assert.equal((await read(await announcedGET(request('GET', '/api/announced?studio=nope')))).status, 404);
  });

  test('sync adds new announcements with their studio, skips adult/music/same-title, never deletes', async () => {
    const existing = await createAnime({ status: 'Not Yet Aired', anilistId: 610000, externalSource: 'anilist', canonicalTitle: 'Kept As Is' });
    await createAnime({ status: 'Not Yet Aired', anilistId: 690000, canonicalTitle: 'Taken Title', type: 'TV', year: 2027 });
    const page = [
      providerAnime({ externalId: '610005', anilistId: 610005, title: 'Brand New Show', studios: [{ name: 'Fresh Studio', isMain: true }] }),
      providerAnime({ externalId: '610004', anilistId: 610004, title: 'Adult Show', isAdult: true }),
      providerAnime({ externalId: '610003', anilistId: 610003, title: 'A Song', type: 'Music' }),
      providerAnime({ externalId: '610002', anilistId: 610002, title: 'Taken Title', type: 'TV', year: 2027 }),
      providerAnime({ externalId: '610000', anilistId: 610000, title: 'Kept As Is' }),
    ];
    const res = await syncAnnouncedAnime({
      fetchPage: async (p) => ({ items: p === 1 ? page : [], pagination: { currentPage: p, lastVisiblePage: 1, hasNextPage: false } }),
      linkRelations: false,
    });
    assert.equal(res.ran, true);
    assert.equal(res.added.length, 1);
    assert.equal(res.excluded, 2);
    assert.equal(res.heldForReview.length, 1);

    const added = await prisma.anime.findFirst({ where: { anilistId: 610005 }, include: { animeStudios: { include: { studio: true } } } });
    assert.ok(added);
    assert.equal(added.animeStudios[0].studio.name, 'Fresh Studio', 'the new announcement is on its studio');
    assert.equal(await prisma.anime.count({ where: { anilistId: { in: [610004, 610003, 610002] } } }), 0);
    assert.ok(await prisma.anime.findUnique({ where: { id: existing.id } }), 'existing row kept');

    // A failing provider ends the run without touching anything.
    const before = await prisma.anime.count();
    const failed = await syncAnnouncedAnime({ fetchPage: async () => { throw new Error('down'); }, linkRelations: false });
    assert.equal(failed.failed, 1);
    assert.equal(await prisma.anime.count(), before);
  });

  test('news is linked only when a headline names the announced title itself', async () => {
    assert.equal(headlineNames('Sasaki and Peeps Season 2 Anime Shares Video', 'Sasaki and Peeps'), false);
    assert.equal(headlineNames('Made in Abyss: Awakening Mystery New Images', 'Made in Abyss'), false);
    assert.equal(headlineNames('Dr. Stone: Terraforming Anime Announced', 'Dr. Stone: Terraforming'), true);
    assert.equal(headlineNames('Overlordship returns', 'Overlord'), false, 'whole words only');

    const show = await createAnime({ status: 'Not Yet Aired', canonicalTitle: 'Moonlit Harbor Chronicle' });
    const finished = await createAnime({ status: 'Finished', canonicalTitle: 'Glass Lantern Stories' });
    const mk = (title: string) =>
      prisma.newsArticle.create({ data: { title, slug: `n-${Math.random().toString(36).slice(2)}`, sourceName: 'Test', sourceUrl: 'https://example.com' } });
    const good = await mk('Moonlit Harbor Chronicle Anime Announced for 2027');
    const sequel = await mk('Moonlit Harbor Chronicle Season 2 Announced');
    const old = await mk('Glass Lantern Stories Gets New Visual');
    const res = await linkAnnouncementNews([show.id, finished.id]);
    assert.equal(res.linked, 1);
    const links = await prisma.newsArticleAnime.findMany({ select: { articleId: true, animeId: true, status: true } });
    assert.ok(links.some((l) => l.articleId === good.id && l.animeId === show.id && l.status === 'CONFIRMED'));
    assert.ok(!links.some((l) => l.articleId === sequel.id), 'a later season is a different entry');
    assert.ok(!links.some((l) => l.articleId === old.id), 'only announced anime are linked here');

    // Re-running changes nothing.
    assert.equal((await linkAnnouncementNews([show.id])).linked, 0);
    const [item] = await getAnnouncedAnime({ limit: 60 }).then((xs) => xs.filter((x) => x.id === show.id));
    assert.equal(item.news.count, 1);
    assert.equal(item.news.latest?.slug, good.slug);
  });
});
