export const COMMISSION_PRODUCTS_PER_ANIME = 4;

function hashKey(value: string): number {
  let hash = 2166136261;
  for (let index = 0; index < value.length; index += 1) {
    hash = Math.imul(hash ^ value.charCodeAt(index), 16777619);
  }
  return hash >>> 0;
}

function rotationOffset(key: string, poolSize: number): number {
  if (/^\d+$/.test(key)) return Number(BigInt(key) % BigInt(poolSize));
  return hashKey(key) % poolSize;
}

export function selectCommissionProducts<T extends { id: string }>(
  animeKey: string,
  sharedPool: T[],
  pinnedProducts: T[] = [],
  limit = COMMISSION_PRODUCTS_PER_ANIME,
): T[] {
  const selected = pinnedProducts.slice(0, limit);
  if (selected.length >= limit || sharedPool.length === 0) return selected;

  const selectedIds = new Set(selected.map((product) => product.id));
  const available = sharedPool.filter((product) => !selectedIds.has(product.id));
  if (available.length === 0) return selected;

  const count = Math.min(limit - selected.length, available.length);
  const offset = rotationOffset(animeKey, available.length);
  return selected.concat(
    Array.from({ length: count }, (_, index) => available[(offset + index) % available.length]),
  );
}
