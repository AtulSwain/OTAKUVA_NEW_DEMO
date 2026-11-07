/**
 * Shared sliding-window counters for rate limiting (2026-11-06).
 *
 * In-memory counters only work inside one server process. On Vercel every
 * request can land on a different instance, so a memory-only limit barely
 * limits anything. This store keeps the hits where every instance can see
 * them, trying in order:
 *   1. Redis (sorted sets) — when REDIS_URL is set.
 *   2. Postgres — table "RateLimitHit", one row per counted hit.
 *   3. Process memory — last resort if both are unreachable (e.g. the
 *      migration hasn't been applied yet). Same behaviour as before.
 * A backend that errors is skipped for a cooldown so a broken one doesn't
 * add latency to every request.
 */

import { prisma } from '../prisma';
import { getProducerRedisConnection } from '../queue/connection';
import { logger } from '../logger';

const COOLDOWN_MS = 30_000;
let redisDownUntil = 0;
let dbDownUntil = 0;
let lastSweep = 0;

const memory = new Map<string, number[]>();

function memoryWindow(key: string, windowMs: number): number[] {
  const now = Date.now();
  const hits = (memory.get(key) || []).filter((t) => t > now - windowMs);
  memory.set(key, hits);
  return hits;
}

function useRedis() {
  // Tests run against a throwaway Postgres; keep them off a developer's Redis.
  if (process.env.RATE_LIMIT_BACKEND === 'db' || process.env.RATE_LIMIT_BACKEND === 'memory') return false;
  // Only an explicit REDIS_URL: local dev without Redis shouldn't pay
  // ioredis's retry delay before falling through to Postgres.
  return Boolean(process.env.REDIS_URL) && Date.now() >= redisDownUntil;
}
function useDb() {
  if (process.env.RATE_LIMIT_BACKEND === 'memory') return false;
  return Date.now() >= dbDownUntil;
}

function down(which: 'redis' | 'db', err: unknown) {
  if (which === 'redis') redisDownUntil = Date.now() + COOLDOWN_MS;
  else dbDownUntil = Date.now() + COOLDOWN_MS;
  logger.warn(`Rate limiter: ${which} unavailable, trying the next store`, {
    error: err instanceof Error ? err : new Error(String(err)),
    component: 'security/sharedRateStore',
  });
}

function maybeSweep() {
  const now = Date.now();
  if (now - lastSweep < 10 * 60_000) return;
  lastSweep = now;
  prisma.$executeRaw`DELETE FROM "RateLimitHit" WHERE "at" < ${new Date(now - 24 * 3_600_000)}`.catch(() => {});
}

/** Hits for `key` within the window, without adding one. */
export async function peekHits(key: string, windowMs: number): Promise<number> {
  const since = Date.now() - windowMs;
  if (useRedis()) {
    try {
      const redis = getProducerRedisConnection();
      await redis.zremrangebyscore(key, 0, since);
      return await redis.zcard(key);
    } catch (err) {
      down('redis', err);
    }
  }
  if (useDb()) {
    try {
      const rows = await prisma.$queryRaw<{ n: bigint }[]>`
        SELECT COUNT(*)::bigint AS n FROM "RateLimitHit" WHERE "key" = ${key} AND "at" > ${new Date(since)}`;
      return Number(rows[0]?.n ?? 0);
    } catch (err) {
      down('db', err);
    }
  }
  return memoryWindow(key, windowMs).length;
}

/** Adds one hit for `key` and returns the count within the window, including it. */
export async function recordHit(key: string, windowMs: number): Promise<number> {
  const now = Date.now();
  if (useRedis()) {
    try {
      const redis = getProducerRedisConnection();
      await redis.zremrangebyscore(key, 0, now - windowMs);
      await redis.zadd(key, now, `${now}-${Math.random().toString(36).slice(2)}`);
      await redis.pexpire(key, windowMs);
      return await redis.zcard(key);
    } catch (err) {
      down('redis', err);
    }
  }
  if (useDb()) {
    try {
      const rows = await prisma.$queryRaw<{ n: bigint }[]>`
        WITH ins AS (INSERT INTO "RateLimitHit" ("key", "at") VALUES (${key}, ${new Date(now)}) RETURNING 1)
        SELECT (SELECT COUNT(*) FROM "RateLimitHit" WHERE "key" = ${key} AND "at" > ${new Date(now - windowMs)})
             + (SELECT COUNT(*) FROM ins) AS n`;
      maybeSweep();
      return Number(rows[0]?.n ?? 1);
    } catch (err) {
      down('db', err);
    }
  }
  const hits = memoryWindow(key, windowMs);
  hits.push(now);
  return hits.length;
}

/** Oldest hit time still inside the window (for an accurate Retry-After). */
export async function oldestHit(key: string, windowMs: number): Promise<number | null> {
  const since = Date.now() - windowMs;
  if (useRedis()) {
    try {
      const first = await getProducerRedisConnection().zrangebyscore(key, since, '+inf', 'WITHSCORES', 'LIMIT', 0, 1);
      return first.length >= 2 ? Number(first[1]) : null;
    } catch (err) {
      down('redis', err);
    }
  }
  if (useDb()) {
    try {
      const rows = await prisma.$queryRaw<{ at: Date | null }[]>`
        SELECT MIN("at") AS at FROM "RateLimitHit" WHERE "key" = ${key} AND "at" > ${new Date(since)}`;
      return rows[0]?.at ? rows[0].at.getTime() : null;
    } catch (err) {
      down('db', err);
    }
  }
  return memoryWindow(key, windowMs)[0] ?? null;
}

/** Forgets every hit for `key`. */
export async function clearHits(key: string): Promise<void> {
  memory.delete(key);
  if (useRedis()) {
    try {
      await getProducerRedisConnection().del(key);
      return;
    } catch (err) {
      down('redis', err);
    }
  }
  if (useDb()) {
    try {
      await prisma.$executeRaw`DELETE FROM "RateLimitHit" WHERE "key" = ${key}`;
    } catch (err) {
      down('db', err);
    }
  }
}
