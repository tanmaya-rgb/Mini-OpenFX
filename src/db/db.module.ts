import { Global, Module } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { drizzle, type PostgresJsDatabase } from 'drizzle-orm/postgres-js';
import postgres from 'postgres';
import type { Env } from '../config/env.schema.js';
import * as schema from './schema/index.js';
import { DRIZZLE } from './db.constants.js';

export { DRIZZLE };
export type Database = PostgresJsDatabase<typeof schema>;

/**
 * Exposes a single Drizzle instance (backed by one pooled `postgres.js`
 * connection) as an injectable, under the DRIZZLE token. We use a Symbol
 * token + a custom provider rather than injecting a class directly
 * because a Database instance isn't something Nest can construct on its
 * own — this is the standard pattern for wiring a third-party client into
 * Nest's DI container.
 *
 * @Global() so every feature module (pricing, quotes, trades, balances)
 * can `@Inject(DRIZZLE)` without each one re-importing DbModule.
 */
@Global()
@Module({
  providers: [
    {
      provide: DRIZZLE,
      inject: [ConfigService],
      useFactory: (config: ConfigService<Env, true>): Database => {
        const connectionString = config.get('DATABASE_URL', { infer: true });
        const client = postgres(connectionString, { max: 10 });
        return drizzle(client, { schema });
      },
    },
  ],
  exports: [DRIZZLE],
})
export class DbModule {}
