import './helpers/setupTestDb';

import { after, describe, test } from 'node:test';
import assert from 'node:assert/strict';
import { prisma } from '../src/lib/prisma';
import { read, request } from './helpers/http';
import { createAnime, createCommunity, createDiscussion, createUser } from './helpers/fixtures';
import { linkPath, resolveLink } from '../src/lib/reports/resolveLink';
import { listInbox, updateInboxItem } from '../Control Center/lib/inbox';

import { POST as reportsPOST } from '../src/app/api/reports/route';
import { POST as correctionsPOST } from '../src/app/api/corrections/route';

after(async () => {
  await prisma.$disconnect();
});

describe('Report page: categories, links, inbox', () => {
  test('links resolve to what they show; anything else stays a page path', async () => {
    const anime = await createAnime();
    assert.equal(linkPath('https://otakuva-demo.vercel.app/anime/x/?a=1'), '/anime/x');
    assert.equal(linkPath('/anime/../../etc'), '/etc'); // dot-segments are normalised away, never kept
    assert.equal(linkPath('not a link at all with spaces'), null);
    const a = await resolveLink(`https://otakuva-demo.vercel.app/anime/${anime.slug}`);
    assert.equal(a?.type, 'ANIME');
    assert.equal(a?.id, anime.id);
    const p = await resolveLink('/schedule');
    assert.deepEqual([p?.type, p?.id], ['PAGE', '/schedule']);
    assert.equal(await resolveLink(''), null);
  });

  test('a misinformation report from a pasted link lands in the inbox with the link', async () => {
    const user = await createUser();
    const anime = await createAnime();
    const res = await read(
      await reportsPOST(request('POST', '/api/reports', { as: user, body: { link: `/anime/${anime.slug}`, reason: 'MISINFORMATION', description: 'fake claim' } })),
    );
    assert.equal(res.status, 201, JSON.stringify(res.body));
    const row = await prisma.report.findUniqueOrThrow({ where: { id: res.body.reportId } });
    assert.equal(row.targetType, 'ANIME');
    assert.equal(row.targetId, anime.id);

    const { items } = await listInbox('open');
    const item = items.find((i) => i.id === row.id);
    assert.ok(item);
    assert.equal(item.href, `/anime/${anime.slug}`);
    assert.equal(item.category, 'Misinformation');
    assert.equal(item.text, 'fake claim');

    await updateInboxItem('report', row.id, 'ACTIONED', user.id);
    assert.equal((await prisma.report.findUniqueOrThrow({ where: { id: row.id } })).status, 'ACTIONED');
  });

  test('new categories are accepted; unknown reasons and bad links are refused', async () => {
    const user = await createUser();
    const ok = await reportsPOST(request('POST', '/api/reports', { as: user, body: { link: '/some/page', reason: 'BROKEN' } }));
    assert.equal(ok.status, 201);
    const bad = await reportsPOST(request('POST', '/api/reports', { as: user, body: { link: '/x', reason: 'NOPE' } }));
    assert.equal(bad.status, 400);
    const noLink = await reportsPOST(request('POST', '/api/reports', { as: user, body: { link: '', reason: 'SPAM' } }));
    assert.equal(noLink.status, 400);
  });

  test('a private community thread can’t be reported by link from outside', async () => {
    const owner = await createUser();
    const outsider = await createUser();
    const community = await createCommunity(owner, 'PRIVATE');
    const d = await createDiscussion(owner, community.id);
    const res = await reportsPOST(request('POST', '/api/reports', { as: outsider, body: { link: `/discussions/${d.id}`, reason: 'SPAM' } }));
    assert.equal(res.status, 404);
  });

  test('wrong information becomes a pending correction, never a data change', async () => {
    const user = await createUser();
    const anime = await createAnime({ episodes: 24 });
    const res = await read(
      await correctionsPOST(
        request('POST', '/api/corrections', {
          as: user,
          body: { link: `/anime/${anime.slug}`, field: 'Episodes or runtime', suggestedValue: 'It has 28 episodes', source: 'https://example.com/ep' },
        }),
      ),
    );
    assert.equal(res.status, 201, JSON.stringify(res.body));
    const row = await prisma.dataCorrectionRequest.findUniqueOrThrow({ where: { id: res.body.id } });
    assert.deepEqual([row.entityType, row.entityId, row.status], ['ANIME', anime.id, 'PENDING']);
    assert.equal((await prisma.anime.findUniqueOrThrow({ where: { id: anime.id } })).episodes, 24);

    const item = (await listInbox('open')).items.find((i) => i.id === row.id);
    assert.equal(item?.kind, 'correction');
    assert.equal(item?.href, `/anime/${anime.slug}`);
    await updateInboxItem('correction', row.id, 'APPROVED', user.id);
    assert.equal((await prisma.dataCorrectionRequest.findUniqueOrThrow({ where: { id: row.id } })).status, 'APPROVED');

    const missing = await correctionsPOST(request('POST', '/api/corrections', { as: user, body: { link: `/anime/${anime.slug}`, suggestedValue: '' } }));
    assert.equal(missing.status, 400);
    const signedOut = await correctionsPOST(request('POST', '/api/corrections', { body: { link: '/anime/x', suggestedValue: 'abc' } }));
    assert.equal(signedOut.status, 401);
  });
});
