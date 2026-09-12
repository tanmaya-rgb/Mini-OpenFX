import { describe, expect, it } from 'vitest';
import { validateEnv } from './env.schema.js';

const REQUIRED_BASE = {
  DATABASE_URL: 'postgres://localhost/test',
  REDIS_URL: 'redis://localhost',
  SEED_CLIENT_API_KEY: 'a-long-enough-key',
};

describe('env schema: ENABLE_DEV_DEPOSITS boolean parsing', () => {
  // Regression test for a real bug found while building the deposits
  // endpoint: z.coerce.boolean() does `Boolean(value)`, and in JS
  // `Boolean("false")` is `true` (any non-empty string is truthy). That
  // silently made `ENABLE_DEV_DEPOSITS=false` in a real .env file turn
  // the flag ON. These cases pin the fix (a literal string comparison)
  // in place.
  it('parses the literal string "false" as false', () => {
    const env = validateEnv({ ...REQUIRED_BASE, ENABLE_DEV_DEPOSITS: 'false' });
    expect(env.ENABLE_DEV_DEPOSITS).toBe(false);
  });

  it('parses the literal string "true" as true', () => {
    const env = validateEnv({ ...REQUIRED_BASE, ENABLE_DEV_DEPOSITS: 'true' });
    expect(env.ENABLE_DEV_DEPOSITS).toBe(true);
  });

  it('defaults to false when unset', () => {
    const env = validateEnv({ ...REQUIRED_BASE });
    expect(env.ENABLE_DEV_DEPOSITS).toBe(false);
  });
});
