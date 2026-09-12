import { Logger } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';
import { ConfigService } from '@nestjs/config';
import { AppModule } from './app.module.js';
import { AllExceptionsFilter } from './common/filters/http-exception.filter.js';
import type { Env } from './config/env.schema.js';

async function bootstrap() {
  const app = await NestFactory.create(AppModule);
  const config = app.get(ConfigService<Env, true>);

  // Every route is versioned under /v1 — the brief asks for "clear,
  // versioned REST APIs", and prefixing at the app level (rather than
  // per-controller) means we can never forget it on a new module.
  app.setGlobalPrefix('v1', { exclude: [] });

  app.useGlobalFilters(new AllExceptionsFilter());

  const port = config.get('PORT', { infer: true });
  await app.listen(port);
  Logger.log(`MiniOpenFX listening on port ${port} (prefix: /v1)`, 'Bootstrap');
}

await bootstrap();
