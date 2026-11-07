import './helpers/setupTestDb';

import { after, describe, test } from 'node:test';
import assert from 'node:assert/strict';
import { prisma } from '../src/lib/prisma';
import { request, read } from './helpers/http';
import { createUser, createAnime, createCommunity, createDiscussion } from './helpers/fixtures';
import { GET as feedGET } from '../src/app/api/feed/following/route';

after(async () => {
  await prisma.$disconnect();
});

describe('GET /api/feed/following', () => {
  test('signed-out callers are refused', async () => {
    const res = await feedGET(request('GET', '/api/feed/following'));
    assert.equal(res.status, 401);
  });

  test('shows only public things from people you follow', async () => {
    const me = await createUser();
    const followed = await createUser();
    const stranger = await createUser();
    const anime = await createAnime();
    const anime2 = await createAnime();
    const anime3 = await createAnime();
    await prisma.follow.create({ data: { followerId: me.id, followingId: followed.id } });

    await prisma.review.create({ data: { userId: followed.id, animeId: anime.id, title: 'Great', body: 'Loved every episode of this.', status: 'PUBLISHED' } });
    await prisma.review.create({ data: { userId: followed.id, animeId: anime2.id, title: 'Spoilery', body: 'The ending reveals the twist.', status: 'PUBLISHED', spoilerLevel: 'SPOILERS' } });
    await prisma.review.create({ data: { userId: followed.id, animeId: anime3.id, title: 'Draft', body: 'Not ready yet at all.', status: 'DRAFT' } });
    await prisma.review.create({ data: { userId: stranger.id, animeId: anime.id, title: 'Stranger', body: 'Someone I do not follow.', status: 'PUBLISHED' } });
    await prisma.userList.create({ data: { userId: followed.id, name: 'Secret list', visibility: 'PRIVATE', items: { create: { animeId: anime.id } } } });
    const priv = await createCommunity(followed, 'PRIVATE');
    await createDiscussion(followed, priv.id, { title: 'Private thread' });

    const { status, body } = await read(await feedGET(request('GET', '/api/feed/following', { as: me })));
    assert.equal(status, 200);
    const titles = body.items.map((i: any) => i.title);
    assert.ok(titles.includes('Great'));
    assert.ok(!titles.includes('Draft'), 'drafts never appear');
    assert.ok(!titles.includes('Stranger'), 'only people you follow');
    assert.ok(!titles.includes('Secret list'), 'private collections stay private');
    assert.ok(!titles.includes('Private thread'), 'private-community threads stay private');
    const spoiler = body.items.find((i: any) => i.title === 'Spoilery');
    assert.equal(spoiler?.excerpt, null, 'spoiler reviews show no text');
  });
});
