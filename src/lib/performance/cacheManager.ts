/**
 * OTAKUVA PERFORMANCE — PHASE 10.4
 * TWO-TIER (L1 IN-MEMORY + L2 REDIS) CACHE-ASIDE ENGINE
 *
 * - L1: the original in-memory Map, unchanged in behavior for every
 *   existing synchronous caller (`get`/`set`/`invalidate`/`invalidateTag`/
 *   `userKey`/`clearAll`/`getMetrics` all keep their exact signatures and
 *   synchronous, L1-only semantics — no caller of those needs to change).
 * - L2: Redis (the same instance src/lib/queue/** already uses via
 *   `REDIS_URL` — see src/lib/queue/connection.ts — under its own
 *   `cache:v1:` key prefix so cache flushes never touch BullMQ's keys).
 *   Only the async, factory-based methods (`getOrSet`, `getOrSetForUser`,
 *   `getOrSetSWR`/`getOrSetCatalog`) read/write it, since only they can
 *   `await` — reaching L2 is exactly the extra step those methods take on
 *   an L1 miss before falling through to the factory. L2 is best-effort:
 *   every Redis operation is try/caught and logged, never thrown to the
 *   caller — a Redis outage degrades this to an L1-only cache, it never
 *   takes the app down (reliability over performance, per CLAUDE.md's
 *   priority order).
 * - Single-flight coalescing: concurrent misses (or concurrent stale-hits
 *   needing a background refresh) for the same key share one in-flight
 *   factory call instead of each firing its own DB/provider fetch — an
 *   in-process `Map<key, Promise>`, the same pattern as Go's
 *   `singleflight` package. Per-process only; two separate Node processes
 *   racing the same miss will each still do their own fetch (a
 *   distributed lock would be needed for that, not implemented here).
 * - Stale-while-revalidate (`getOrSetSWR`/`getOrSetCatalog`), for public
 *   catalog reads only — see the namespace enforcement below. A "fresh"
 *   window (`ttlSeconds`) where the cached value is returned as-is, then a
 *   "stale but servable" grace window (`staleSeconds`, default half the
 *   TTL) where the cached value is still returned immediately but a
 *   background refresh is kicked off (itself single-flighted), then a
 *   hard-expiry past which a request blocks on a fresh fetch like a plain
 *   cache miss.
 * - User-specific cache isolation, enforced rather than just conventional:
 *   `userKey()` is the only sanctioned way to build a personalized cache
 *   key (always prefixed `user:<id>:`), `getOrSetForUser()` is the only
 *   sanctioned way to read/write one, and `getOrSetSWR`/`getOrSetCatalog`
 *   (the public-catalog path) throw if ever given a key already in that
 *   reserved namespace — see assertPublicNamespace(). See
 *   tests/cache-namespace.test.ts for the runtime + source-scan tests this
 *   guard is checked by.
 * - Multi-tag invalidation, still supported across both tiers: tags are
 *   indexed in Redis too (`cache:tagidx:<tag>` sets), so `invalidateTag`
 *   purges the matching keys from L1 *and* L2, not just the in-process
 *   copy.
 *
 * Caveat worth knowing: L2 values round-trip through `JSON.stringify`/
 * `JSON.parse`. A `Date` cached via a factory that ran on *this* process
 * (an L1 hit, or the process whose factory call populated L2) comes back
 * as a real `Date`; a value backfilled from an L2 hit on a fresh process
 * comes back with any `Date` fields as ISO strings instead, same as any
 * other JSON-based cache. Don't cache values whose callers assume real
 * `Date` instances without also handling that.
 */

import type { Redis as IORedisClient } from 'ioredis';
import { getProducerRedisConnection, isRedisConfigured } from '../queue/connection';
import { logger } from '../logger';

interface CacheEntry<T> {
  value: T;
  /** End of the "fresh" window. For entries written via plain set()/getOrSet(), equals expiresAt (no SWR grace period). */
  staleAt: number;
  /** Hard expiry — past this, the entry is a full miss, not served even as stale. */
  expiresAt: number;
  tags: string[];
}

interface L2Payload<T> {
  value: T;
  staleAt: number;
  expiresAt: number;
}

export type CatalogCacheCategory = 'anime-detail' | 'schedule' | 'news';

/** Per-category TTLs for public catalog reads — the "fresh" window before an entry becomes stale-but-servable. */
export const CATALOG_CACHE_TTL_SECONDS: Record<CatalogCacheCategory, number> = {
  'anime-detail': 60 * 60, // 1h
  schedule: 5 * 60, // 5min
  news: 15 * 60, // 15min
};

const DEFAULT_STALE_RATIO = 0.5; // default staleSeconds = ttlSeconds * this, when not given explicitly

/** Reserved prefix for personalized cache keys — see userKey()/assertPublicNamespace(). */
const USER_NAMESPACE_PREFIX = 'user:';

/** Redis key prefix for everything this cache writes — keeps it out of BullMQ's `bull:*` keyspace on the same Redis instance. */
const REDIS_KEY_PREFIX = 'cache:v1:';
const REDIS_TAG_INDEX_PREFIX = 'cache:tagidx:v1:';

export class CacheManager {
  private static l1 = new Map<string, CacheEntry<any>>();
  private static readonly MAX_ENTRIES = 5000;

  // Metrics. `hits`/`misses` keep their original meaning (L1 hit/miss) so
  // existing getMetrics() consumers see unchanged numbers; the rest are
  // additive.
  private static hits = 0;
  private static misses = 0;
  private static l2Hits = 0;
  private static l2Errors = 0;
  private static staleServes = 0;
  private static coalescedWaits = 0;

  // Single-flight registry: key -> the in-flight factory promise currently
  // populating it (a plain miss fetch, or a background SWR revalidation).
  private static inFlight = new Map<string, Promise<any>>();

  private static lastL2ErrorLoggedAt = 0;

  // ---------------------------------------------------------------------
  // Original public API — unchanged signatures, unchanged L1-only
  // synchronous semantics. See the class-level doc comment for why.
  // ---------------------------------------------------------------------

  /**
   * Retrieves an item from cache, or executes fallback factory and caches
   * result. Now checks L2 (Redis) on an L1 miss before falling through to
   * the factory, and coalesces concurrent misses for the same key via
   * single-flight.
   */
  static async getOrSet<T>(
    key: string,
    factory: () => Promise<T>,
    ttlSeconds = 300,
    tags: string[] = []
  ): Promise<T> {
    const cached = this.get<T>(key);
    if (cached !== null) return cached;

    const fromL2 = await this.readL2<T>(key);
    if (fromL2 && Date.now() < fromL2.expiresAt) {
      this.l2Hits++;
      this.setL1(key, fromL2.value, fromL2.staleAt, fromL2.expiresAt, tags);
      return fromL2.value;
    }

    return this.singleFlight(key, factory, ttlSeconds, ttlSeconds, tags);
  }

  /**
   * Gets cached value if unexpired. L1 only, synchronous — deliberately
   * cannot check L2 (Redis is inherently async). Use getOrSet()/
   * getOrSetForUser()/getOrSetSWR() to benefit from L2.
   */
  static get<T>(key: string): T | null {
    const entry = this.l1.get(key);
    if (!entry) {
      this.misses++;
      return null;
    }

    if (Date.now() > entry.expiresAt) {
      this.l1.delete(key);
      this.misses++;
      return null;
    }

    this.hits++;
    return entry.value as T;
  }

  /**
   * Sets value in cache with TTL and optional tags. Writes L1 immediately
   * (synchronous, unchanged) and fires a best-effort L2 write-through in
   * the background (not awaited — this method's signature/timing is
   * unchanged for existing callers).
   */
  static set<T>(key: string, value: T, ttlSeconds = 300, tags: string[] = []) {
    const expiresAt = Date.now() + ttlSeconds * 1000;
    this.setL1(key, value, expiresAt, expiresAt, tags);
    void this.writeL2(key, value, expiresAt, expiresAt, tags);
  }

  /**
   * Invalidates a specific cache key. Returns whether it was present in
   * L1 (unchanged return semantics); also fires a best-effort L2 delete.
   */
  static invalidate(key: string): boolean {
    const existed = this.l1.delete(key);
    void this.deleteL2(key);
    return existed;
  }

  /**
   * Invalidates all cache keys associated with a specific tag, in both
   * tiers. Returns the count purged from L1 (unchanged return semantics —
   * the L2 purge is fire-and-forget and not reflected in this count,
   * since L2 tag membership requires an extra round trip this
   * synchronous-looking return value can't wait on).
   */
  static invalidateTag(tag: string): number {
    let purged = 0;
    for (const [key, entry] of this.l1.entries()) {
      if (entry.tags.includes(tag)) {
        this.l1.delete(key);
        purged++;
      }
    }
    void this.invalidateTagInL2(tag);
    return purged;
  }

  /**
   * Helper to build user-isolated cache keys. The *only* sanctioned way
   * to construct a personalized key — always prefixed `user:<id>:`, which
   * getOrSetSWR()/getOrSetCatalog() (the public-catalog path) refuse to
   * accept. Use this, or getOrSetForUser() (which calls this for you),
   * for anything that depends on which user is asking.
   */
  static userKey(userId: string, subKey: string): string {
    if (!userId) throw new Error('CacheManager.userKey requires a non-empty userId');
    return `${USER_NAMESPACE_PREFIX}${userId}:${subKey}`;
  }

  static isUserScopedKey(key: string): boolean {
    return key.startsWith(USER_NAMESPACE_PREFIX);
  }

  /** Clears all cache entries — L1 immediately, L2 via a scoped SCAN+UNLINK over this cache's own `cache:v1:*` keys only (never FLUSHDB — Redis is shared with the BullMQ queue). */
  static clearAll() {
    this.l1.clear();
    this.hits = 0;
    this.misses = 0;
    this.l2Hits = 0;
    this.l2Errors = 0;
    this.staleServes = 0;
    this.coalescedWaits = 0;
    void this.clearL2();
  }

  /** Returns cache metrics. Original fields unchanged; L1/L2/SWR/coalescing breakdown added. */
  static getMetrics(): {
    totalEntries: number;
    hits: number;
    misses: number;
    hitRatio: number;
    l2Hits: number;
    l2Errors: number;
    staleServes: number;
    coalescedWaits: number;
    inFlight: number;
  } {
    const total = this.hits + this.misses;
    const hitRatio = total > 0 ? parseFloat((this.hits / total).toFixed(3)) : 0;
    return {
      totalEntries: this.l1.size,
      hits: this.hits,
      misses: this.misses,
      hitRatio,
      l2Hits: this.l2Hits,
      l2Errors: this.l2Errors,
      staleServes: this.staleServes,
      coalescedWaits: this.coalescedWaits,
      inFlight: this.inFlight.size,
    };
  }

  // ---------------------------------------------------------------------
  // New API
  // ---------------------------------------------------------------------

  /**
   * Reads/writes a personalized cache entry. The only sanctioned way to
   * cache something that depends on `userId` — always goes through
   * userKey(), gets the same L1+L2+single-flight treatment as getOrSet(),
   * but never the stale-while-revalidate grace period getOrSetSWR() gives
   * public catalog reads (a personalized result going stale-but-served
   * has different, per-feature freshness implications this generic cache
   * shouldn't assume).
   */
  static async getOrSetForUser<T>(
    userId: string,
    subKey: string,
    factory: () => Promise<T>,
    ttlSeconds = 300,
    tags: string[] = []
  ): Promise<T> {
    return this.getOrSet(this.userKey(userId, subKey), factory, ttlSeconds, tags);
  }

  /**
   * Stale-while-revalidate read for a public catalog key: serves the
   * cached value immediately once it's known (fresh, or stale-but-within-
   * grace — kicking off a coalesced background refresh in the latter
   * case), and only blocks the caller on a real fetch for a genuine miss
   * or one past its hard expiry. Refuses any key in the reserved
   * `user:` namespace (see assertPublicNamespace()) — this is the public-
   * catalog path, personalized data must go through getOrSetForUser()
   * instead.
   */
  static async getOrSetSWR<T>(
    key: string,
    factory: () => Promise<T>,
    options: { ttlSeconds: number; staleSeconds?: number; tags?: string[] }
  ): Promise<T> {
    this.assertPublicNamespace(key);
    const ttlSeconds = options.ttlSeconds;
    const staleSeconds = options.staleSeconds ?? Math.round(ttlSeconds * DEFAULT_STALE_RATIO);
    const tags = options.tags ?? [];
    const now = Date.now();

    const l1Entry = this.l1.get(key);
    if (l1Entry) {
      if (now < l1Entry.staleAt) {
        this.hits++;
        return l1Entry.value as T;
      }
      if (now < l1Entry.expiresAt) {
        this.hits++;
        this.staleServes++;
        this.backgroundRevalidate(key, factory, ttlSeconds, staleSeconds, tags);
        return l1Entry.value as T;
      }
      // past hard expiry — fall through to a real miss below
      this.l1.delete(key);
    }
    this.misses++;

    const fromL2 = await this.readL2<T>(key);
    if (fromL2) {
      this.setL1(key, fromL2.value, fromL2.staleAt, fromL2.expiresAt, tags);
      if (now < fromL2.staleAt) {
        this.l2Hits++;
        return fromL2.value;
      }
      if (now < fromL2.expiresAt) {
        this.l2Hits++;
        this.staleServes++;
        this.backgroundRevalidate(key, factory, ttlSeconds, staleSeconds, tags);
        return fromL2.value;
      }
    }

    return this.singleFlight(key, factory, ttlSeconds, staleSeconds, tags);
  }

  /**
   * getOrSetSWR() with the TTL looked up from a named catalog category
   * instead of given explicitly — anime detail: 1h, schedule: 5min,
   * news: 15min (CATALOG_CACHE_TTL_SECONDS). The intended entry point for
   * "cache this public catalog read."
   */
  static async getOrSetCatalog<T>(
    category: CatalogCacheCategory,
    key: string,
    factory: () => Promise<T>,
    options: { staleSeconds?: number; tags?: string[] } = {}
  ): Promise<T> {
    return this.getOrSetSWR(key, factory, {
      ttlSeconds: CATALOG_CACHE_TTL_SECONDS[category],
      staleSeconds: options.staleSeconds,
      tags: options.tags,
    });
  }

  // ---------------------------------------------------------------------
  // Internals
  // ---------------------------------------------------------------------

  private static assertPublicNamespace(key: string): void {
    if (this.isUserScopedKey(key)) {
      throw new Error(
        `CacheManager: refusing to cache "${key}" via the public-catalog path (getOrSetSWR/getOrSetCatalog) — ` +
          `it's in the reserved "${USER_NAMESPACE_PREFIX}" personalized-key namespace. ` +
          `A personalized result must never be written under a key any other user's request could read. ` +
          `Use getOrSetForUser() instead.`
      );
    }
  }

  private static setL1<T>(key: string, value: T, staleAt: number, expiresAt: number, tags: string[]): void {
    if (this.l1.size >= this.MAX_ENTRIES && !this.l1.has(key)) {
      const firstKey = this.l1.keys().next().value;
      if (firstKey) this.l1.delete(firstKey);
    }
    this.l1.set(key, { value, staleAt, expiresAt, tags });
  }

  /** Single-flighted blocking fetch: concurrent callers for the same key share one factory call. */
  private static async singleFlight<T>(
    key: string,
    factory: () => Promise<T>,
    ttlSeconds: number,
    staleSeconds: number,
    tags: string[]
  ): Promise<T> {
    const existing = this.inFlight.get(key);
    if (existing) {
      this.coalescedWaits++;
      return existing as Promise<T>;
    }

    const promise = (async () => {
      try {
        const value = await factory();
        const now = Date.now();
        const staleAt = now + ttlSeconds * 1000;
        const expiresAt = now + (ttlSeconds + staleSeconds) * 1000;
        this.setL1(key, value, staleAt, expiresAt, tags);
        void this.writeL2(key, value, staleAt, expiresAt, tags);
        return value;
      } finally {
        this.inFlight.delete(key);
      }
    })();

    this.inFlight.set(key, promise);
    return promise;
  }

  /** Fire-and-forget background refresh for a stale-but-servable SWR entry. Coalesced the same way as singleFlight — a key already being refreshed doesn't start a second refresh. */
  private static backgroundRevalidate<T>(
    key: string,
    factory: () => Promise<T>,
    ttlSeconds: number,
    staleSeconds: number,
    tags: string[]
  ): void {
    if (this.inFlight.has(key)) {
      this.coalescedWaits++;
      return;
    }

    const promise = (async () => {
      try {
        const value = await factory();
        const now = Date.now();
        const staleAt = now + ttlSeconds * 1000;
        const expiresAt = now + (ttlSeconds + staleSeconds) * 1000;
        this.setL1(key, value, staleAt, expiresAt, tags);
        void this.writeL2(key, value, staleAt, expiresAt, tags);
      } catch (err) {
        // The stale value already served stays in L1/L2 until its hard
        // expiry — a failed background refresh must never evict a value
        // that's still within its servable grace window.
        logger.error('CacheManager background revalidation failed (stale value still served until hard expiry)', { error: err, key });
      } finally {
        this.inFlight.delete(key);
      }
    })();

    this.inFlight.set(key, promise);
  }

  private static redisKey(key: string): string {
    return `${REDIS_KEY_PREFIX}${key}`;
  }

  private static tagIndexKey(tag: string): string {
    return `${REDIS_TAG_INDEX_PREFIX}${tag}`;
  }

  private static getRedis(): IORedisClient | null {
    if (!isRedisConfigured()) return null;
    try {
      return getProducerRedisConnection();
    } catch {
      return null;
    }
  }

  private static logL2Error(context: string, err: unknown): void {
    this.l2Errors++;
    // Rate-limit noisy logging when Redis is down for a stretch — one line
    // per 30s is plenty to know L2 is degraded without flooding logs on
    // every cache op.
    const now = Date.now();
    if (now - this.lastL2ErrorLoggedAt > 30_000) {
      this.lastL2ErrorLoggedAt = now;
      logger.error('CacheManager L2 (Redis) error — falling back to L1-only', { error: err, context });
    }
  }

  private static async readL2<T>(key: string): Promise<L2Payload<T> | null> {
    const redis = this.getRedis();
    if (!redis) return null;
    try {
      const raw = await redis.get(this.redisKey(key));
      if (!raw) return null;
      return JSON.parse(raw) as L2Payload<T>;
    } catch (err) {
      this.logL2Error('read failed', err);
      return null;
    }
  }

  private static async writeL2<T>(key: string, value: T, staleAt: number, expiresAt: number, tags: string[]): Promise<void> {
    const redis = this.getRedis();
    if (!redis) return;
    const ttlSecondsFromNow = Math.max(1, Math.ceil((expiresAt - Date.now()) / 1000));
    try {
      const payload: L2Payload<T> = { value, staleAt, expiresAt };
      await redis.set(this.redisKey(key), JSON.stringify(payload), 'EX', ttlSecondsFromNow);
      if (tags.length) await this.indexTagsInL2(key, tags, ttlSecondsFromNow);
    } catch (err) {
      this.logL2Error('write failed', err);
    }
  }

  private static async indexTagsInL2(key: string, tags: string[], ttlSecondsFromNow: number): Promise<void> {
    const redis = this.getRedis();
    if (!redis) return;
    try {
      const pipeline = redis.pipeline();
      for (const tag of tags) {
        pipeline.sadd(this.tagIndexKey(tag), key);
        // Outlive the longest entry it indexes by a bit, so the index
        // itself doesn't expire out from under a still-valid entry.
        pipeline.expire(this.tagIndexKey(tag), ttlSecondsFromNow + 60);
      }
      await pipeline.exec();
    } catch (err) {
      this.logL2Error('tag index write failed', err);
    }
  }

  private static async deleteL2(key: string): Promise<void> {
    const redis = this.getRedis();
    if (!redis) return;
    try {
      await redis.del(this.redisKey(key));
    } catch (err) {
      this.logL2Error('delete failed', err);
    }
  }

  private static async invalidateTagInL2(tag: string): Promise<void> {
    const redis = this.getRedis();
    if (!redis) return;
    try {
      const members = await redis.smembers(this.tagIndexKey(tag));
      if (members.length) {
        const pipeline = redis.pipeline();
        for (const member of members) pipeline.del(this.redisKey(member));
        pipeline.del(this.tagIndexKey(tag));
        await pipeline.exec();
      } else {
        await redis.del(this.tagIndexKey(tag));
      }
    } catch (err) {
      this.logL2Error('tag invalidation failed', err);
    }
  }

  /** Scoped flush — SCAN+UNLINK over this cache's own `cache:v1:*` keys only. Never FLUSHDB: Redis is shared with the BullMQ queue (src/lib/queue/**), whose `bull:*` keys must survive a cache clear. */
  private static async clearL2(): Promise<void> {
    const redis = this.getRedis();
    if (!redis) return;
    try {
      let cursor = '0';
      do {
        const [nextCursor, keys] = await redis.scan(cursor, 'MATCH', `${REDIS_KEY_PREFIX}*`, 'COUNT', 500);
        cursor = nextCursor;
        if (keys.length) await redis.unlink(...keys);
      } while (cursor !== '0');

      cursor = '0';
      do {
        const [nextCursor, keys] = await redis.scan(cursor, 'MATCH', `${REDIS_TAG_INDEX_PREFIX}*`, 'COUNT', 500);
        cursor = nextCursor;
        if (keys.length) await redis.unlink(...keys);
      } while (cursor !== '0');
    } catch (err) {
      this.logL2Error('scoped clear failed', err);
    }
  }
}
