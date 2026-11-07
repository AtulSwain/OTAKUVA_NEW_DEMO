import './helpers/setupTestDb';

import { after, describe, test } from 'node:test';
import assert from 'node:assert/strict';
import { prisma } from '../src/lib/prisma';
import { request } from './helpers/http';
import { createUser, createAnime } from './helpers/fixtures';
import { PUT as reorderPUT } from '../src/app/api/lists/[id]/items/route';

after(async () => {
  await prisma.$disconnect();
});

async function listWith(userId: string, n: number) {
  const anime = [];
  for (let i = 0; i < n; i++) anime.push(await createAnime());
  const list = await prisma.userList.create({
    data: { userId, name: 'Mine', visibility: 'PRIVATE', items: { create: anime.map((a, i) => ({ animeId: a.id, position: i + 1 })) } },
  });
  return { list, ids: anime.map((a) => a.id) };
}

describe('PUT /api/lists/:id/items (reorder)', () => {
  test('the owner can set a new order', async () => {
    const me = await createUser();
    const { list, ids } = await listWith(me.id, 3);
    const order = [ids[2], ids[0], ids[1]];
    const res = await reorderPUT(request('PUT', `/api/lists/${list.id}/items`, { as: me, body: { order } }), { params: { id: list.id } });
    assert.equal(res.status, 200);
    const items = await prisma.userListItem.findMany({ where: { listId: list.id }, orderBy: { position: 'asc' } });
    assert.deepEqual(items.map((i) => i.animeId), order);
  });

  test('an order that drops or adds anime is refused', async () => {
    const me = await createUser();
    const { list, ids } = await listWith(me.id, 3);
    const res = await reorderPUT(request('PUT', `/api/lists/${list.id}/items`, { as: me, body: { order: [ids[0], ids[1]] } }), { params: { id: list.id } });
    assert.equal(res.status, 409);
  });

  test("someone else's list can't be reordered", async () => {
    const owner = await createUser();
    const other = await createUser();
    const { list, ids } = await listWith(owner.id, 2);
    const res = await reorderPUT(request('PUT', `/api/lists/${list.id}/items`, { as: other, body: { order: [ids[1], ids[0]] } }), { params: { id: list.id } });
    assert.equal(res.status, 404);
  });
});
