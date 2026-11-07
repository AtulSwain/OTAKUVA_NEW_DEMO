import './helpers/setupTestDb';

import { after, describe, test } from 'node:test';
import assert from 'node:assert/strict';
import { prisma } from '../src/lib/prisma';
import { RateLimiter } from '../src/lib/security/rateLimiter';
import { checkAccountRateLimit, recordAccountFailure, resetAccountRateLimit, ACCOUNT_MAX_ATTEMPTS } from '../src/lib/security/authRateLimiter';

process.env.RATE_LIMIT_BACKEND = 'db';

after(async () => {
  await prisma.$disconnect();
});

describe('shared rate limits (stored in Postgres, not process memory)', () => {
  test('the limit holds and is visible in the database', async () => {
    const id = `t-${Date.now()}`;
    for (let i = 0; i < 3; i++) {
      assert.equal((await RateLimiter.check('COMMUNITY', id, { maxRequests: 3 })).allowed, true);
    }
    const blocked = await RateLimiter.check('COMMUNITY', id, { maxRequests: 3 });
    assert.equal(blocked.allowed, false);
    assert.ok((blocked.retryAfterSec ?? 0) >= 1);
    // Another server instance would read the same rows.
    const rows = await prisma.$queryRaw<{ n: bigint }[]>`SELECT COUNT(*)::bigint AS n FROM "RateLimitHit" WHERE "key" = ${`ratelimit:COMMUNITY:${id}`}`;
    assert.equal(Number(rows[0].n), 4);
    await RateLimiter.resetShared('COMMUNITY', id);
    assert.equal((await RateLimiter.check('COMMUNITY', id, { maxRequests: 3 })).allowed, true);
  });

  test('sign-in lockout per account uses the shared store', async () => {
    const who = `user-${Date.now()}`;
    for (let i = 0; i < ACCOUNT_MAX_ATTEMPTS; i++) await recordAccountFailure('login', who);
    assert.equal((await checkAccountRateLimit('login', who)).allowed, false);
    await resetAccountRateLimit('login', who);
    assert.equal((await checkAccountRateLimit('login', who)).allowed, true);
  });
});
