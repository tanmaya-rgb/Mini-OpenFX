import { Test, type TestingModuleBuilder } from '@nestjs/testing';
import { INestApplication } from '@nestjs/common';
import { AppModule } from '../src/app.module.js';
import { AllExceptionsFilter } from '../src/common/filters/http-exception.filter.js';

/**
 * Builds a test Nest application with the same bootstrap as main.ts (the
 * /v1 global prefix and the global exception filter). Every e2e test
 * should go through this rather than calling Test.createTestingModule
 * directly — a test app that skips useGlobalFilters() will pass domain
 * errors through Nest's default handler instead of AllExceptionsFilter,
 * which returns a raw 500 for anything that isn't an HttpException
 * instead of the real 401/404/409/410/422 the app actually returns in
 * production. That gap is exactly how the two bugs below were found: a
 * first draft of the integration test omitted this, and two tests that
 * should have gotten 401/422 got a misleading 500 instead.
 *
 * `configure` lets a test override providers (e.g. swapping the real
 * Binance-backed PRICING_PROVIDER for a fake one) before the module compiles.
 */
export async function createTestApp(configure?: (builder: TestingModuleBuilder) => TestingModuleBuilder): Promise<INestApplication> {
  let builder = Test.createTestingModule({ imports: [AppModule] });
  if (configure) {
    builder = configure(builder);
  }
  const moduleFixture = await builder.compile();

  const app = moduleFixture.createNestApplication();
  app.setGlobalPrefix('v1');
  app.useGlobalFilters(new AllExceptionsFilter());
  await app.init();

  return app;
}
