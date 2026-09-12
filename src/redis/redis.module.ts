import { Global, Module } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Redis } from 'ioredis';
import type { Env } from '../config/env.schema.js';
import { REDIS } from './redis.constants.js';

/**
 * A single ioredis connection, exposed under the REDIS token — same
 * "Symbol + custom provider" pattern as DbModule. Redis is used purely as
 * a short-TTL read-through cache in front of the pricing provider (see
 * modules/pricing); it is never a source of truth for money, so there is
 * no correctness risk if the cache is cold, evicted, or briefly
 * unavailable — the pricing service falls back to calling the provider
 * directly.
 */
@Global()
@Module({
  providers: [
    {
      provide: REDIS,
      inject: [ConfigService],
      useFactory: (config: ConfigService<Env, true>) => {
        const url = config.get('REDIS_URL', { infer: true });
        // lazyConnect + maxRetriesPerRequest so a Redis outage surfaces
        // quickly to the caller (which falls back to the provider) instead
        // of hanging requests.
        return new Redis(url, { maxRetriesPerRequest: 1, connectTimeout: 2000 });
      },
    },
  ],
  exports: [REDIS],
})
export class RedisModule {}
