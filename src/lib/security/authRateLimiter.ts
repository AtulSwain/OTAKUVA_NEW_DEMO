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
 * Backing store (updated 2026-11-06 — see sharedRateStore.ts): Redis, then
 * Postgres, then memory. Original note: Redis (reusing the BullMQ producer connection from
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
import { clearHits, peekHits, recordHit } from './sharedRateStore';

export const IP_MAX_ATTEMPTS = 10;
export const IP_WINDOW_MS = 15 * 60 * 1000; // 15 minutes

export const ACCOUNT_MAX_ATTEMPTS = 5;
export const ACCOUNT_WINDOW_MS = 15 * 60 * 1000; // 15 minutes

export interface RateLimitResult {
  allowed: boolean;
  /** Seconds the caller should wait before retrying. Only set when !allowed. */
  retryAfterSec?: number;
}

// Storage (2026-11-06): sharedRateStore — Redis when REDIS_URL is set, else
// Postgres ("RateLimitHit"), else process memory. Before, without Redis
// (Vercel) this was memory-only, so each instance kept its own count.

function toResult(count: number, maxAttempts: number, windowMs: number): RateLimitResult {
  if (count < maxAttempts) return { allowed: true };
  return { allowed: false, retryAfterSec: Math.ceil(windowMs / 1000) };
}

/**
 * Checks (without recording) whether `key` is currently at/over its limit.
 * `count` is prior recorded attempts, so the boundary is `count < max`.
 */
async function peek(key: string, maxAttempts: number, windowMs: number): Promise<RateLimitResult> {
  return toResult(await peekHits(key, windowMs), maxAttempts, windowMs);
}

/**
 * Records one attempt, then returns whether it's now over the limit. The
 * count includes this attempt, so the Nth attempt itself is still allowed.
 */
async function recordAndCheck(key: string, maxAttempts: number, windowMs: number): Promise<RateLimitResult> {
  const count = await recordHit(key, windowMs);
  return toResult(count - 1, maxAttempts, windowMs);
}

async function record(key: string, windowMs: number): Promise<void> {
  await recordHit(key, windowMs);
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
  await clearHits(accountKey(route, identifier));
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
