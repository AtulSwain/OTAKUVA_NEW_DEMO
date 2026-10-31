/**
 * Even ad rotation for anime pages (owner, 2026-10-31): with N ads in a
 * placement, every page view shows the next one(s) in turn, so over N views
 * each ad is shown the same number of times. Each visitor starts at a random
 * point, so different people see different ads at the same moment while the
 * overall exposure stays equal.
 */

/** `count` consecutive items starting at `turn` (wrapping). Never repeats an item. */
export function itemsForTurn<T>(items: T[], turn: number, count = 1): T[] {
  if (items.length === 0 || count <= 0) return [];
  const n = items.length;
  const start = ((Math.floor(turn) % n) + n) % n;
  return Array.from({ length: Math.min(count, n) }, (_, i) => items[(start + i) % n]);
}

/**
 * This visitor's next turn for a placement, kept in localStorage. The first
 * turn is random; each later call moves on by one. Falls back to a random turn
 * when storage is unavailable (private mode), which is still even on average.
 */
export function nextTurn(placementKey: string): number {
  const key = `otakuva-ad-turn:${placementKey}`;
  const random = Math.floor(Math.random() * 1_000_000);
  try {
    const stored = Number(localStorage.getItem(key));
    const turn = Number.isFinite(stored) && localStorage.getItem(key) !== null ? stored + 1 : random;
    localStorage.setItem(key, String(turn % 1_000_000));
    return turn;
  } catch {
    return random;
  }
}
