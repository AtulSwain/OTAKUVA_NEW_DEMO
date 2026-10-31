import './helpers/setupTestDb';
// These tests exercise the 1–10 star rating, which is switched off by default (2026-10-25).
process.env.STAR_RATINGS_ENABLED = 'true';

import { after, describe, test } from 'node:test';
import assert from 'node:assert/strict';
import { prisma } from '../src/lib/prisma';
import { request, read } from './helpers/http';
import { createAnime, createUser } from './helpers/fixtures';

import { POST as followPOST, GET as followGET } from '../src/app/api/users/[username]/follow/route';
import { POST as ratePOST } from '../src/app/api/anime/[id]/rating/route';
import { POST as hypePOST } from '../src/app/api/anime/[id]/hype/route';
import { GET as creatorsGET } from '../src/app/api/anime/[id]/creators/route';
import { GET as dashboardGET } from '../src/app/api/creator/dashboard/route';
import { GET as reviewsGET, POST as reviewsPOST } from '../src/app/api/reviews/route';
import { POST as creatorReviewPOST } from '../src/app/api/creator/reviews/route';
import { GET as creatorsDirGET } from '../src/app/api/creators/route';
import { GET as followersGET } from '../src/app/api/users/[username]/followers/route';

after(async () => {
  await prisma.$disconnect();
});

const makeCreator = async (channel = 'Night Shift Anime') => {
  const u = await createUser('CREATOR');
  await prisma.user.update({ where: { id: u.id }, data: { creatorSince: new Date(), creatorChannelName: channel } });
  return u;
};
const follow = (as: any, target: any) => followPOST(request('POST', '/x', { as }), { params: { username: target.username } });
const rate = (as: any, animeId: string, score: number) =>
  ratePOST(request('POST', `/api/anime/${animeId}/rating`, { as, body: { score } }), { params: { id: animeId } });
const hype = (as: any, animeId: string) => hypePOST(request('POST', '/x', { as, body: { level: 'HYPED' } }), { params: { id: animeId } });
const inbox = (u: { id: string }, type: string) => prisma.notification.findMany({ where: { userId: u.id, type } });
const BODY = 'A careful look at the pacing, the direction and why the finale works as well as it does.';

describe('creators and their followers', () => {
  test("a creator's rating notifies followers once; a member's rating notifies nobody", async () => {
    const creator = await makeCreator();
    const member = await createUser();
    const fan = await createUser();
    await follow(fan, creator);
    await follow(fan, member);
    const anime = await createAnime({ status: 'Finished Airing', episodes: 12 });

    assert.equal((await rate(creator, anime.id, 9.1)).status, 200);
    await rate(creator, anime.id, 8.7); // re-rating: no second notification
    const got = await inbox(fan, 'FOLLOWING_RATING');
    assert.equal(got.length, 1);
    assert.match(got[0].body!, /9\.1\/10/);
    assert.match(got[0].linkUrl!, new RegExp(`creator=${creator.username}#creators$`));

    await rate(member, anime.id, 7.2);
    assert.equal((await inbox(fan, 'FOLLOWING_RATING')).length, 1, 'members stay quiet');
  });

  test("a creator's hype notifies followers; a member's does not", async () => {
    const creator = await makeCreator();
    const member = await createUser();
    const fan = await createUser();
    await follow(fan, creator);
    await follow(fan, member);
    const upcoming = await createAnime({ status: 'Not yet aired', episodes: 12 });
    assert.equal((await hype(creator, upcoming.id)).status, 200);
    await hype(member, upcoming.id);
    const got = await inbox(fan, 'FOLLOWING_HYPE');
    assert.equal(got.length, 1);
    assert.match(got[0].title, /is hyped for/);
  });

  test('the anime page lists creators (not members), biggest audience first, with follow state', async () => {
    const small = await makeCreator('Small Channel');
    const big = await makeCreator('Big Channel');
    const member = await createUser();
    const viewer = await createUser();
    const anime = await createAnime({ status: 'Finished Airing', episodes: 12 });
    for (const f of await Promise.all([createUser(), createUser()])) await follow(f, big);
    await follow(viewer, small);

    await rate(small, anime.id, 6.5);
    await rate(member, anime.id, 9.9);
    const pub = await read(await creatorReviewPOST(request('POST', '/api/creator/reviews', { as: big, body: { animeId: anime.slug, title: 'Big take', body: BODY, publish: true } })));
    assert.equal(pub.status, 201, JSON.stringify(pub.body));

    const list = await read(await creatorsGET(request('GET', '/x', { as: viewer }), { params: { id: anime.slug } }));
    assert.equal(list.status, 200);
    assert.deepEqual(list.body.creators.map((c: any) => c.username), [big.username, small.username], 'members excluded; most followers first');
    const [b, s] = list.body.creators;
    assert.equal(b.followerCount, 2);
    assert.equal(b.review.title, 'Big take');
    assert.equal(b.channelName, 'Big Channel');
    assert.equal(s.rating, 6.5);
    assert.equal(s.viewerFollows, true);
    assert.equal(b.viewerFollows, false);
    const anon = await read(await creatorsGET(request('GET', '/x'), { params: { id: anime.slug } }));
    assert.equal(anon.body.creators.length, 2, 'public — no follow needed to see it');
    assert.equal(anon.body.creators[0].viewerFollows, null);
  });

  test('profiles say who is a creator; the dashboard counts followers', async () => {
    const creator = await makeCreator('Studio Lofi');
    const member = await createUser();
    const s = await read(await followGET(request('GET', '/x'), { params: { username: creator.username } }));
    assert.equal(s.body.isCreator, true);
    assert.equal(s.body.channelName, 'Studio Lofi');
    const m = await read(await followGET(request('GET', '/x'), { params: { username: member.username } }));
    assert.equal(m.body.isCreator, false);
    assert.equal(m.body.channelName, null);
    const admin = await createUser('ADMIN');
    assert.equal((await read(await followGET(request('GET', '/x'), { params: { username: admin.username } }))).body.isCreator, false, 'admins are not labelled creators');

    const fans = await Promise.all([createUser(), createUser(), createUser()]);
    for (const f of fans) await follow(f, creator);
    await follow(creator, fans[0]);
    const d = await read(await dashboardGET(request('GET', '/api/creator/dashboard', { as: creator })));
    assert.equal(d.status, 200);
    assert.equal(d.body.stats.followers, 3);
    assert.equal(d.body.followers.thisWeek, 3);
    assert.equal(d.body.followers.recent.length, 3);
    assert.equal(d.body.followers.recent.find((f: any) => f.username === fans[0].username).youFollowBack, true);
    assert.ok(d.body.activity.some((a: any) => a.kind === 'FOLLOW'));
  });

  test('homepage creators: creator accounts only, most followed first, with their recent activity', async () => {
    const quiet = await makeCreator('Quiet Channel');
    const popular = await makeCreator('Popular Channel');
    const member = await createUser();
    for (const f of await Promise.all([createUser(), createUser()])) await follow(f, popular);
    const anime = await createAnime({ status: 'Finished Airing', episodes: 12 });
    const adult = await createAnime({ status: 'Finished Airing', episodes: 12, isAdult: true });
    await rate(popular, anime.id, 8.8);
    await rate(popular, adult.id, 7);
    await rate(member, anime.id, 9);
    const retentionRatedAnime = [anime];
    for (let i = 0; i < 3; i++) retentionRatedAnime.push(await createAnime({ status: 'Finished Airing', episodes: 12 }));
    for (const [index, ratedAnime] of retentionRatedAnime.entries()) {
      await prisma.episodeRating.create({
        data: {
          userId: popular.id,
          animeId: ratedAnime.id,
          episodeNumber: 1,
          retention: 85,
          updatedAt: new Date(Date.UTC(2026, 0, index + 1)),
        },
      });
    }
    await prisma.user.update({ where: { id: popular.id }, data: { lastSeenAt: new Date() } });
    const reviewBody = 'A careful look at this story that is intentionally long enough to verify the compact preview stays clipped in the creator spotlight without exposing the full review.';
    assert.equal((await creatorReviewPOST(request('POST', '/api/creator/reviews', {
      as: popular,
      body: { animeId: anime.slug, title: 'A thoughtful review', body: reviewBody, publish: true },
    }))).status, 201);

    const r = await read(await creatorsDirGET(request('GET', '/api/creators?limit=60&feed=30') as any));
    assert.equal(r.status, 200);
    const names = r.body.creators.map((c: any) => c.username);
    assert.ok(names.includes(quiet.username) && names.includes(popular.username));
    assert.ok(!names.includes(member.username), 'members are not listed');
    assert.ok(names.indexOf(popular.username) < names.indexOf(quiet.username), 'most followed first');
    const mine = r.body.feed.filter((f: any) => f.creator.username === popular.username);
    assert.ok(mine.some((f: any) => f.kind === 'JOINED'), 'creator joins are shown');
    const review = mine.find((f: any) => f.kind === 'REVIEWED');
    assert.ok(review, 'published creator reviews are shown');
    assert.equal(review.review.title, 'A thoughtful review');
    assert.ok(review.review.excerpt.length <= 110, 'review preview stays compact');
    assert.ok(!mine.some((f: any) => f.anime?.slug === adult.slug), 'adult titles stay out of the feed');
    const popularCard = r.body.creators.find((c: any) => c.username === popular.username);
    assert.equal(popularCard.latestActivity, 'REVIEWED');
    assert.equal(popularCard.isOnline, true);
    assert.equal(popularCard.ratedAnime.length, 3, 'shows only three related anime');
    assert.deepEqual(
      popularCard.ratedAnime.map((a: any) => a.slug),
      retentionRatedAnime.slice(1).reverse().map((a) => a.slug),
      'a newly rated fourth anime replaces the oldest item',
    );
    assert.equal(popularCard.latestReview.title, 'A thoughtful review');
    assert.equal(popularCard.latestReview.animeSlug, anime.slug);
    assert.ok(popularCard.latestReview.excerpt.length <= 110);
    assert.equal(r.body.creators.find((c: any) => c.username === quiet.username).isOnline, false);
    assert.ok(!r.body.feed.some((f: any) => f.creator.username === member.username));
  });

  test('follower lists and the new-follower note say when someone is a creator', async () => {
    const creator = await makeCreator('Lofi Reviews');
    const member = await createUser();
    await follow(creator, member);
    const note = await prisma.notification.findFirst({ where: { userId: member.id, type: 'NEW_FOLLOWER' } });
    assert.equal(note!.title, 'A creator followed you');
    assert.match(note!.body!, /a creator \(Lofi Reviews\)/);
    const list = await read(await followersGET(request('GET', '/x'), { params: { username: member.username } }));
    assert.equal(list.body.items[0].isCreator, true);
    assert.equal(list.body.items[0].channelName, 'Lofi Reviews');
    const plain = await createUser();
    await follow(plain, member);
    const again = await read(await followersGET(request('GET', '/x'), { params: { username: member.username } }));
    assert.equal(again.body.items.find((i: any) => i.username === plain.username).isCreator, false);
  });

  test('creator reviews lead the default review order', async () => {
    const anime = await createAnime({ status: 'Finished Airing', episodes: 12 });
    const members = await Promise.all([createUser(), createUser()]);
    for (const m of members) {
      assert.equal((await reviewsPOST(request('POST', '/api/reviews', { as: m, body: { animeId: anime.id, body: BODY } }))).status, 200);
    }
    const creator = await makeCreator();
    await creatorReviewPOST(request('POST', '/api/creator/reviews', { as: creator, body: { animeId: anime.slug, title: 'Creator take', body: BODY, publish: true } }));
    const list = await read(await reviewsGET(request('GET', `/api/reviews?animeId=${anime.slug}`)));
    assert.equal(list.body.reviews[0].isCreatorReview, true);
    assert.equal(list.body.reviews.length, 3);
  });
});
