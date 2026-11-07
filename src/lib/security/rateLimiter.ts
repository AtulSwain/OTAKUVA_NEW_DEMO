import { clearHits, oldestHit, recordHit } from './sharedRateStore';

/**
 * OTAKUVA SECURITY — PHASE 10.1 & 10.3
 * CATEGORY-AWARE RATE LIMITER ENGINE
 * 
 * Fine-grained sliding window rate limiter tailored by endpoint sensitivity:
 * - AUTH: 5 requests / 60s (strict anti-brute-force)
 * - RATINGS: 15 ratings / 60s (anti-burst rating spam)
 * - REVIEWS: 5 reviews / 60s (quality review throttling)
 * - COMMENTS: 15 comments / 60s (discussion spam control)
 * - COMMUNITY: 8 actions / 60s (community creation throttling)
 * - CHAT: 30 messages / 60s (anti-flood)
 * - SEARCH: 60 queries / 60s (search DDoS mitigation)
 * - PUBLIC_READ: 120 requests / 60s (general catalog browsing)
 * - ADMIN: 120 requests / 60s (staff operations)
 * - ACCOUNT: 5 requests / 60 minutes (self-service data export / account
 *   deletion — infrequent, heavy, and sensitive, so this is windowed in
 *   hours rather than seconds like every other category here)
 * - INVITE_KEY: 8 access-key attempts / 15 minutes per user, and 30 per
 *   invitation (members-only community invitations — anti brute-force)
 */

export type RateLimitCategory =
  | 'AUTH'
  | 'RATINGS'
  | 'REVIEWS'
  | 'COMMENTS'
  | 'COMMUNITY'
  | 'CHAT'
  | 'SEARCH'
  | 'PUBLIC_READ'
  | 'ADMIN'
  | 'MEDIA_UPLOAD'
  | 'ACCOUNT'
  | 'INVITE_KEY';

export interface RateLimitPolicy {
  maxRequests: number;
  windowMs: number;
}

export const RATE_LIMIT_POLICIES: Record<RateLimitCategory, RateLimitPolicy> = {
  AUTH: { maxRequests: 5, windowMs: 60 * 1000 },
  RATINGS: { maxRequests: 15, windowMs: 60 * 1000 },
  REVIEWS: { maxRequests: 5, windowMs: 60 * 1000 },
  COMMENTS: { maxRequests: 15, windowMs: 60 * 1000 },
  COMMUNITY: { maxRequests: 8, windowMs: 60 * 1000 },
  CHAT: { maxRequests: 30, windowMs: 60 * 1000 },
  SEARCH: { maxRequests: 60, windowMs: 60 * 1000 },
  PUBLIC_READ: { maxRequests: 120, windowMs: 60 * 1000 },
  ADMIN: { maxRequests: 120, windowMs: 60 * 1000 },
  MEDIA_UPLOAD: { maxRequests: 10, windowMs: 60 * 1000 },
  ACCOUNT: { maxRequests: 5, windowMs: 60 * 60 * 1000 },
  INVITE_KEY: { maxRequests: 8, windowMs: 15 * 60 * 1000 },
};

export interface RateLimitStatus {
  allowed: boolean;
  currentCount: number;
  maxAllowed: number;
  remaining: number;
  resetMs: number;
  retryAfterSec?: number;
}

export class RateLimiter {
  private static store = new Map<string, number[]>();

  /**
   * Shared limit (2026-11-06): counts are kept in Redis or Postgres, so they
   * hold across every server instance (see sharedRateStore.ts). Use this for
   * anything a person can abuse — writes, uploads, auth-adjacent checks.
   * `checkRateLimit` below stays for high-volume, low-risk reads.
   */
  static async check(
    category: RateLimitCategory,
    identifier: string,
    customPolicy?: Partial<RateLimitPolicy>
  ): Promise<RateLimitStatus> {
    const policy: RateLimitPolicy = { ...RATE_LIMIT_POLICIES[category], ...customPolicy };
    const key = `ratelimit:${category}:${identifier}`;
    const count = await recordHit(key, policy.windowMs);
    if (count <= policy.maxRequests) {
      return {
        allowed: true,
        currentCount: count,
        maxAllowed: policy.maxRequests,
        remaining: policy.maxRequests - count,
        resetMs: policy.windowMs,
      };
    }
    const oldest = await oldestHit(key, policy.windowMs);
    const resetMs = Math.max(1000, (oldest ?? Date.now()) + policy.windowMs - Date.now());
    return {
      allowed: false,
      currentCount: count,
      maxAllowed: policy.maxRequests,
      remaining: 0,
      resetMs,
      retryAfterSec: Math.max(1, Math.ceil(resetMs / 1000)),
    };
  }

  /** Clears a shared limit (see `check`). */
  static async resetShared(category: RateLimitCategory, identifier: string) {
    await clearHits(`ratelimit:${category}:${identifier}`);
  }

  /**
   * Evaluates if a request is allowed under the category policy
   */
  static checkRateLimit(
    category: RateLimitCategory,
    identifier: string,
    customPolicy?: Partial<RateLimitPolicy>
  ): RateLimitStatus {
    const policy: RateLimitPolicy = {
      ...RATE_LIMIT_POLICIES[category],
      ...customPolicy,
    };

    const key = `${category}:${identifier}`;
    const now = Date.now();
    const windowStart = now - policy.windowMs;

    const timestamps = this.store.get(key) || [];
    const validTimestamps = timestamps.filter((t) => t > windowStart);

    if (validTimestamps.length >= policy.maxRequests) {
      const oldest = validTimestamps[0];
      const resetMs = oldest + policy.windowMs - now;
      const retryAfterSec = Math.max(1, Math.ceil(resetMs / 1000));

      this.store.set(key, validTimestamps);
      return {
        allowed: false,
        currentCount: validTimestamps.length,
        maxAllowed: policy.maxRequests,
        remaining: 0,
        resetMs,
        retryAfterSec,
      };
    }

    validTimestamps.push(now);
    this.store.set(key, validTimestamps);

    return {
      allowed: true,
      currentCount: validTimestamps.length,
      maxAllowed: policy.maxRequests,
      remaining: policy.maxRequests - validTimestamps.length,
      resetMs: policy.windowMs,
    };
  }

  /**
   * Resets rate limit for an identifier (useful in tests or after successful verification)
   */
  static reset(category: RateLimitCategory, identifier: string) {
    this.store.delete(`${category}:${identifier}`);
  }

  /**
   * Cleans up expired rate limit entries to prevent memory growth
   */
  static cleanup() {
    const now = Date.now();
    for (const [key, timestamps] of this.store.entries()) {
      const valid = timestamps.filter((t) => t > now - 3600000); // 1hr max age
      if (valid.length === 0) {
        this.store.delete(key);
      } else {
        this.store.set(key, valid);
      }
    }
  }
}
