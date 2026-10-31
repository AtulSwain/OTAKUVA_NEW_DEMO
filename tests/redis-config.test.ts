import { test } from 'node:test';
import assert from 'node:assert/strict';
import { isRedisConfigured } from '../src/lib/queue/connection';

function withEnv(env: Record<string, string | undefined>, fn: () => void) {
  const saved: Record<string, string | undefined> = {};
  for (const key of Object.keys(env)) {
    saved[key] = process.env[key];
    if (env[key] === undefined) delete process.env[key];
    else process.env[key] = env[key];
  }
  try {
    fn();
  } finally {
    for (const key of Object.keys(saved)) {
      if (saved[key] === undefined) delete process.env[key];
      else process.env[key] = saved[key];
    }
  }
}

test('production without REDIS_URL has no Redis (cache skips it)', () => {
  withEnv({ NODE_ENV: 'production', REDIS_URL: undefined }, () => assert.equal(isRedisConfigured(), false));
});

test('an explicit REDIS_URL is used in production', () => {
  withEnv({ NODE_ENV: 'production', REDIS_URL: 'redis://example:6379' }, () => assert.equal(isRedisConfigured(), true));
});

test('local development falls back to localhost Redis', () => {
  withEnv({ NODE_ENV: 'development', REDIS_URL: undefined }, () => assert.equal(isRedisConfigured(), true));
});
