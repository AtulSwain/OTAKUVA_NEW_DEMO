import assert from 'node:assert/strict';
import test from 'node:test';
import { COMMISSION_PRODUCTS_PER_ANIME, selectCommissionProducts } from '../src/lib/monetization/commissionDistribution';

test('shared products rotate evenly across consecutive anime provider IDs', () => {
  const pool = Array.from({ length: 10 }, (_, index) => ({ id: `product-${index}` }));
  const exposureCounts = new Map(pool.map((product) => [product.id, 0]));

  for (let animeId = 0; animeId < pool.length; animeId += 1) {
    const products = selectCommissionProducts(String(animeId), pool);
    assert.equal(products.length, COMMISSION_PRODUCTS_PER_ANIME);
    assert.equal(new Set(products.map((product) => product.id)).size, products.length);
    products.forEach((product) => exposureCounts.set(product.id, (exposureCounts.get(product.id) || 0) + 1));
  }

  assert.deepEqual([...exposureCounts.values()], Array(10).fill(COMMISSION_PRODUCTS_PER_ANIME));
});

test('anime-pinned products appear first and are not duplicated from the shared pool', () => {
  const pinned = [{ id: 'pinned' }];
  const pool = [{ id: 'pinned' }, { id: 'shared-1' }, { id: 'shared-2' }];

  const selected = selectCommissionProducts('42', pool, pinned);

  assert.deepEqual(selected.map((product) => product.id), ['pinned', 'shared-1', 'shared-2']);
});
