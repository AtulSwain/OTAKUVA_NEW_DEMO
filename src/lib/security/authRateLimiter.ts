/**
 * OTAKUVA — Auth brute-force rate limiting (login / register, and any
 * future password-reset routes) under src/app/api/auth/**.
 *
 * Two independent limits, both sliding-window:
 *   - Per IP: IP_MAX_ATTEMPTS attempts / IP_WINDOW_MS, counts every request
 *     regardless of outcome. Stops one source from hammering the endpoint
 *     across many different account identifiers.
 *   - Per account/email: ACCOUNT_MAX_ATTEMPTS / ACCOUNT_WINDOW_MS, counts
 *     only failed attempts (see recordAccountFailure) against the
 *     identifier the caller supplied (email/username as typed — not
 *     resolved to a real user, so a nonexistent account still gets rate
 *     limited the same as a real one and doesn't leak which is which).
 *     Once at the limit, the account is "locked" for the rest of the
 *     window: checkAccountLimit() short-circuits with a 429 *before* the
 *     route touches the DB, and does not itself count as another attempt —
 *     otherwise an attacker who keeps hammering a locked account would
 *     keep sliding the window forward and the lockout would never expire.
 *
 * Backing store: Redis (reusing the BullMQ producer connection from
 * src/lib/queue/connection.ts — same REDIS_URL, already a hard dependency
 * for this app) via sorted sets, so the limit is shared across app
 * instances. If Redis is unreachable, falls back to an in-memory sliding
 * window scoped to this process — auth still gets rate-limited, just not
 * consistently across instances, and a circuit breaker avoids retrying
 * Redis (and eating its retry latency) on every request while it's down.
 *
 * NOTE: the in-memory fallback is a single-instance stopgap. If/when this
 * app runs as more than one instance, an attacker can get IP_MAX_ATTEMPTS
 * (or ACCOUNT_MAX_ATTEMPTS) per instance rather than in total for as long
 * as Redis stays unreachable — acceptable degradation, not the steady
 * state.
 */

import { NextResponse } from 'next/server';
import { getProducerRedisConnection, isRedisConfigured } from '../queue/connection';
import { logger } from '../logger';

export const IP_MAX_ATTEMPTS = 10;
export const IP_WINDOW_MS = 15 * 60 * 1000; // 15 minutes

export const ACCOUNT_MAX_ATTEMPTS = 5;
export const ACCOUNT_WINDOW_MS = 15 * 60 * 1000; // 15 minutes

export interface RateLimitResult {
  allowed: boolean;
  /** Seconds the caller should wait before retrying. Only set when !allowed. */
  retryAfterSec?: number;
}

// --- In-memory fallback -----------------------------------------------
// Only used while Redis is unreachable. Same sliding-window-of-timestamps
// approach as src/lib/security/rateLimiter.ts, kept local/private here
// rather than sharing that class so this module has no dependency the
// Redis path doesn't also need.
const memoryStore = new Map<string, number[]>();

function memoryPeek(key: string, windowMs: number): number[] {
  const now = Date.now();
  const timestamps = (memoryStore.get(key) || []).filter((t) => t > now - windowMs);
  memoryStore.set(key, timestamps);
  return timestamps;
}

function memoryRecord(key: string, windowMs: number): number[] {
  const now = Date.now();
  const timestamps = memoryPeek(key, windowMs);
  timestamps.push(now);
  memoryStore.set(key, timestamps);
  return timestamps;
}

// --- Redis circuit breaker ----------------------------------------------
// Avoid paying ioredis's retry/backoff on every single request while Redis
// is down; fall back to memory immediately for a cooldown window, then try
// Redis again.
const REDIS_COOLDOWN_MS = 30_000;
let redisDownUntil = 0;

function redisAvailable(): boolean {
  // No Redis configured (e.g. Vercel without a Redis add-on): use the
  // in-memory limiter and never open a connection to localhost.
  if (!isRedisConfigured()) return false;
  return Date.now() >= redisDownUntil;
}

function markRedisDown(err: unknown) {
  redisDownUntil = Date.now() + REDIS_COOLDOWN_MS;
  logger.warn('Auth rate limiter: Redis unavailable, falling back to in-memory limiter', {
    toSentry: true,
    error: err instanceof Error ? err : new Error(String(err)),
    component: 'security/authRateLimiter',
  });
}

/** Current count within the window, via Redis sorted set, without adding an entry. */
async function redisPeek(key: string, windowMs: number): Promise<number> {
  const redis = getProducerRedisConnection();
  const now = Date.now();
  const windowStart = now - windowMs;
  await redis.zremrangebyscore(key, 0, windowStart);
  return redis.zcard(key);
}

/** Adds one entry (score = now) and returns the count within the window afterward. */
async function redisRecord(key: string, windowMs: number): Promise<number> {
  const redis = getProducerRedisConnection();
  const now = Date.now();
  const windowStart = now - windowMs;
  await redis.zremrangebyscore(key, 0, windowStart);
  // Unique member per call so concurrent attempts in the same millisecond
  // don't collide and get de-duped by the sorted set.
  await redis.zadd(key, now, `${now}-${Math.random().toString(36).slice(2)}`);
  await redis.pexpire(key, windowMs);
  return redis.zcard(key);
}

function toResult(count: number, maxAttempts: number, windowMs: number): RateLimitResult {
  if (count < maxAttempts) return { allowed: true };
  return { allowed: false, retryAfterSec: Math.ceil(windowMs / 1000) };
}

/**
 * Checks (without recording) whether `key` is currently at/over its limit.
 * Use before doing any real work, e.g. to short-circuit a locked-out
 * account before querying the DB. `count` here is prior recorded attempts
 * (not including the one being checked), so the boundary is `count < max`.
 */
async function peek(key: string, maxAttempts: number, windowMs: number): Promise<RateLimitResult> {
  if (redisAvailable()) {
    try {
      const count = await redisPeek(key, windowMs);
      return toResult(count, maxAttempts, windowMs);
    } catch (err) {
      markRedisDown(err);
    }
  }
  const count = memoryPeek(key, windowMs).length;
  return toResult(count, maxAttempts, windowMs);
}

/**
 * Records one attempt against `key`, then returns whether it's now at/over
 * its limit. `count` here already includes the attempt just recorded, so
 * the Nth attempt itself (count === max) is still allowed — the boundary
 * is `count <= max`, not `count < max` as in peek().
 */
async function recordAndCheck(key: string, maxAttempts: number, windowMs: number): Promise<RateLimitResult> {
  if (redisAvailable()) {
    try {
      const count = await redisRecord(key, windowMs);
      return toResult(count - 1, maxAttempts, windowMs);
    } catch (err) {
      markRedisDown(err);
    }
  }
  const count = memoryRecord(key, windowMs).length;
  return toResult(count - 1, maxAttempts, windowMs);
}

/** Records one attempt against `key` without returning/caring about the result. */
async function record(key: string, windowMs: number): Promise<void> {
  if (redisAvailable()) {
    try {
      await redisRecord(key, windowMs);
      return;
    } catch (err) {
      markRedisDown(err);
    }
  }
  memoryRecord(key, windowMs);
}

function ipKey(route: string, ip: string): string {
  return `ratelimit:auth:ip:${route}:${ip}`;
}

function accountKey(route: string, identifier: string): string {
  return `ratelimit:auth:acct:${route}:${identifier.trim().toLowerCase()}`;
}

/**
 * Records this request against the IP limit and returns whether it's
 * allowed. Call once per request, regardless of outcome (success or
 * failure both count — this limit is about request volume, not correctness).
 */
export async function checkIpRateLimit(route: string, ip: string): Promise<RateLimitResult> {
  return recordAndCheck(ipKey(route, ip), IP_MAX_ATTEMPTS, IP_WINDOW_MS);
}

/**
 * Checks whether `identifier` (email/username as submitted) is currently
 * locked out, WITHOUT recording an attempt. Call before doing any real
 * auth/DB work.
 */
export async function checkAccountRateLimit(route: string, identifier: string): Promise<RateLimitResult> {
  if (!identifier?.trim()) return { allowed: true };
  return peek(accountKey(route, identifier), ACCOUNT_MAX_ATTEMPTS, ACCOUNT_WINDOW_MS);
}

/**
 * Records a failed attempt against `identifier`. Call only after
 * authentication/validation for that identifier has failed.
 */
export async function recordAccountFailure(route: string, identifier: string): Promise<void> {
  if (!identifier?.trim()) return;
  await record(accountKey(route, identifier), ACCOUNT_WINDOW_MS);
}

/** Clears the account limit for `identifier` — call after a successful attempt so past failures don't linger. */
export async function resetAccountRateLimit(route: string, identifier: string): Promise<void> {
  if (!identifier?.trim()) return;
  const key = accountKey(route, identifier);
  if (redisAvailable()) {
    try {
      await getProducerRedisConnection().del(key);
      return;
    } catch (err) {
      markRedisDown(err);
    }
  }
  memoryStore.delete(key);
}

/** Standard 429 JSON response with a Retry-After header. */
export function rateLimitResponse(message: string, retryAfterSec: number) {
  return NextResponse.json(
    { error: message, retryAfterSec },
    { status: 429, headers: { 'Retry-After': String(retryAfterSec) } }
  );
}

/** Best-effort client IP extraction, matching the convention already used elsewhere in the app. */
export function getClientIp(request: Request): string {
  const forwarded = request.headers.get('x-forwarded-for');
  if (forwarded) {
    const first = forwarded.split(',')[0]?.trim();
    if (first) return first;
  }
  return request.headers.get('x-real-ip') || 'unknown';
}
