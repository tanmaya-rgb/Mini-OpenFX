import { Inject, Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import type { Redis } from 'ioredis';
import type { Env } from '../../config/env.schema.js';
import { REDIS } from '../../redis/redis.constants.js';
import type { IndicativePrice } from './pricing.types.js';

const FRESH_PREFIX = 'price:fresh:';
const LAST_KNOWN_PREFIX = 'price:last:';
// The "last known" fallback key lives much longer than the fresh cache —
// it exists purely so a provider outage can still serve *something*
// (marked stale: true) rather than a hard failure, for read-only display.
const LAST_KNOWN_TTL_SECONDS = 60 * 10;

/**
 * Thin read-through cache in front of the pricing provider. This is the
 * "Redis for caching" piece from the brief — deliberately scoped to just
 * this one job rather than caching anything transactional. If Redis is
 * down, every method here fails soft (returns null / logs a warning) so
 * pricing degrades to "always hit the provider" rather than the whole
 * endpoint breaking.
 */
@Injectable()
export class PriceCacheService {
  private readonly logger = new Logger(PriceCacheService.name);

  constructor(
    @Inject(REDIS) private readonly redis: Redis,
    private readonly config: ConfigService<Env, true>,
  ) {}

  /** Fresh cache: short TTL, used to avoid hammering the provider. */
  async getFresh(symbol: string): Promise<Omit<IndicativePrice, 'stale'> | null> {
    return this.readKey(FRESH_PREFIX + symbol);
  }

  /** Last-known-good cache: long TTL, used only when the provider is down. */
  async getLastKnown(symbol: string): Promise<Omit<IndicativePrice, 'stale'> | null> {
    return this.readKey(LAST_KNOWN_PREFIX + symbol);
  }

  async setFromProviderResult(symbol: string, price: Omit<IndicativePrice, 'stale'>): Promise<void> {
    const ttlMs = this.config.get('PRICE_CACHE_TTL_MS', { infer: true });
    const payload = JSON.stringify(price);
    try {
      await Promise.all([
        this.redis.set(FRESH_PREFIX + symbol, payload, 'PX', ttlMs),
        this.redis.set(LAST_KNOWN_PREFIX + symbol, payload, 'EX', LAST_KNOWN_TTL_SECONDS),
      ]);
    } catch (error) {
      this.logger.warn(`Redis SET failed for ${symbol}: ${String(error)}`);
    }
  }

  private async readKey(key: string): Promise<Omit<IndicativePrice, 'stale'> | null> {
    try {
      const raw = await this.redis.get(key);
      return raw ? (JSON.parse(raw) as Omit<IndicativePrice, 'stale'>) : null;
    } catch (error) {
      this.logger.warn(`Redis GET failed for ${key}, treating as cache miss: ${String(error)}`);
      return null;
    }
  }
}
