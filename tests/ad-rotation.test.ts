import { test } from 'node:test';
import assert from 'node:assert/strict';
import { itemsForTurn } from '../src/lib/monetization/rotation';

const ads = Array.from({ length: 10 }, (_, i) => `ad${i}`);

test('one ad per view: every ad is shown equally over a full cycle', () => {
  const shown = new Map<string, number>();
  for (let turn = 0; turn < 30; turn++) {
    const [ad] = itemsForTurn(ads, turn);
    shown.set(ad, (shown.get(ad) ?? 0) + 1);
  }
  assert.equal(shown.size, 10);
  assert.ok([...shown.values()].every((n) => n === 3), 'each of 10 ads shown exactly 3 times in 30 views');
});

test('four per view: equal exposure, no duplicates within a view', () => {
  const shown = new Map<string, number>();
  for (let turn = 0; turn < 10; turn++) {
    const picked = itemsForTurn(ads, turn, 4);
    assert.equal(new Set(picked).size, 4);
    picked.forEach((ad) => shown.set(ad, (shown.get(ad) ?? 0) + 1));
  }
  assert.ok([...shown.values()].every((n) => n === 4));
});

test('handles fewer ads than slots, empty lists and odd turns', () => {
  assert.deepEqual(itemsForTurn(['a', 'b'], 5, 4), ['b', 'a']);
  assert.deepEqual(itemsForTurn([], 3, 4), []);
  assert.deepEqual(itemsForTurn(['a', 'b', 'c'], -1), ['c']);
});
