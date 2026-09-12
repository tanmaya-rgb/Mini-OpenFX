import { Global, Module } from '@nestjs/common';
import { ConfigModule as NestConfigModule, ConfigService } from '@nestjs/config';
import { validateEnv } from './env.schema.js';

/**
 * Thin wrapper around @nestjs/config that forces every value through our
 * Zod schema at boot time. If something is missing or malformed, the app
 * fails to start with a clear message instead of throwing a confusing
 * error later, deep inside a request.
 */
@Global()
@Module({
  imports: [
    NestConfigModule.forRoot({
      isGlobal: true,
      envFilePath: ['.env'],
      validate: validateEnv,
    }),
  ],
  exports: [NestConfigModule],
})
export class ConfigModule {}

export type { Env } from './env.schema.js';
export { ConfigService };
