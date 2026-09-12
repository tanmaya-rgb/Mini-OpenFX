import { z } from 'zod';

/**
 * z.coerce.boolean() is a trap for env vars: it does `Boolean(value)`
 * under the hood, and in JS `Boolean("false")` is `true` — any non-empty
 * string is truthy. That means `ENABLE_DEV_DEPOSITS=false` in a real .env
 * file would have silently coerced to `true` with z.coerce.boolean(),
 * which is exactly backwards for a flag that guards a mutating endpoint.
 * This parses the literal strings instead.
 */
const booleanFromEnv = z
  .string()
  .optional()
  .transform((value) => value?.toLowerCase() === 'true');

/**
 * All process.env access in the app should go through the validated config
 * (see config.module.ts), not process.env directly — this is the single
 * place that knows what shape the environment is supposed to have and fails
 * fast at boot if it doesn't.
 */
export const envSchema = z.object({
  PORT: z.coerce.number().int().positive().default(3000),
  NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),

  DATABASE_URL: z.string().min(1, 'DATABASE_URL is required'),
  REDIS_URL: z.string().min(1, 'REDIS_URL is required'),

  SEED_CLIENT_API_KEY: z.string().min(8, 'SEED_CLIENT_API_KEY must be at least 8 characters'),

  BINANCE_BASE_URL: z.string().url().default('https://api.binance.com'),
  PRICE_CACHE_TTL_MS: z.coerce.number().int().positive().default(1500),
  PRICING_TIMEOUT_MS: z.coerce.number().int().positive().default(2000),
  PRICING_MAX_RETRIES: z.coerce.number().int().min(0).max(5).default(1),

  DEFAULT_QUOTE_TTL_SECONDS: z.coerce.number().int().positive().default(15),
  QUOTE_SPREAD_BPS: z.coerce.number().int().min(0).default(10),

  ENABLE_DEV_DEPOSITS: booleanFromEnv,
});

export type Env = z.infer<typeof envSchema>;

export function validateEnv(config: Record<string, unknown>): Env {
  const parsed = envSchema.safeParse(config);
  if (!parsed.success) {
    const issues = parsed.error.issues
      .map((issue) => `  - ${issue.path.join('.')}: ${issue.message}`)
      .join('\n');
    throw new Error(`Invalid environment configuration:\n${issues}`);
  }
  return parsed.data;
}
