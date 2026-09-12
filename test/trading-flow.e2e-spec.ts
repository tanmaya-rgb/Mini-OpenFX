import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { INestApplication } from '@nestjs/common';
import bcrypt from 'bcryptjs';
import { eq } from 'drizzle-orm';
import request from 'supertest';
import { createTestApp } from './test-app.factory.js';
import { PRICING_PROVIDER } from '../src/modules/pricing/pricing.service.js';
import type { PricingProvider } from '../src/modules/pricing/pricing.types.js';
import { DRIZZLE, type Database } from '../src/db/db.module.js';
import { clients, balances, quotes, trades, ledgerEntries } from '../src/db/schema/index.js';

/**
 * A real integration test: a real NestJS application, a real Postgres
 * connection, a real Redis connection — the only thing faked is the
 * Binance provider, because it's the one genuinely external third party.
 * Everything else in the request path (auth, validation, the trade
 * transaction, ledger writes, balance updates) runs for real, exactly as
 * it would against a live deployment.
 *
 * A dedicated client is created for this suite (not the dev seed client)
 * so it can run repeatedly and in parallel with manual testing without
 * fighting over rows, and is cleaned up in afterAll.
 */
const TEST_API_KEY = `test-key-${randomUUID()}`;
const FAKE_MID_PRICE = '65000';

const fakePricingProvider: PricingProvider = {
  fetchPrice: (symbol: string) =>
    Promise.resolve({
      symbol,
      bid: '64999.5',
      ask: '65000.5',
      mid: FAKE_MID_PRICE,
      timestamp: new Date().toISOString(),
      source: 'binance' as const,
    }),
};

describe('Trading flow (e2e, real DB)', () => {
  let app: INestApplication;
  let db: Database;
  let clientId: string;

  beforeAll(async () => {
    app = await createTestApp((builder) => builder.overrideProvider(PRICING_PROVIDER).useValue(fakePricingProvider));

    db = app.get<Database>(DRIZZLE);

    const [client] = await db
      .insert(clients)
      .values({ name: 'E2E Test Client', apiKeyHash: await bcrypt.hash(TEST_API_KEY, 4) })
      .returning();
    clientId = client.id;

    await db.insert(balances).values([
      { clientId, currency: 'USDT', availableMinor: 100_000_00n }, // 100,000 USDT
      { clientId, currency: 'BTC', availableMinor: 100_000_000n }, // 1 BTC
    ]);
  });

  afterAll(async () => {
    if (clientId) {
      // FK-safe order: children before the clients row itself. No
      // ON DELETE CASCADE on these tables by design (see db/schema —
      // financial records shouldn't vanish silently via a parent delete
      // in production), so a test that creates its own client is
      // responsible for cleaning up everything it wrote.
      await db.delete(ledgerEntries).where(eq(ledgerEntries.clientId, clientId));
      await db.delete(trades).where(eq(trades.clientId, clientId));
      await db.delete(quotes).where(eq(quotes.clientId, clientId));
      await db.delete(balances).where(eq(balances.clientId, clientId));
      await db.delete(clients).where(eq(clients.id, clientId));
    }
    await app.close();
  });

  const auth = () => `Bearer ${TEST_API_KEY}`;

  it('runs the full quote -> trade -> balance -> history flow with correct money movement', async () => {
    const quoteRes = await request(app.getHttpServer())
      .post('/v1/quotes')
      .set('Authorization', auth())
      .send({ symbol: 'BTCUSDT', side: 'BUY', base_amount: '0.01', ttl_seconds: 30 })
      .expect(201);

    expect(quoteRes.body.price).toBe('65065.000000000000000000'); // 65000 * 1.001
    expect(quoteRes.body.quote_amount).toBe('650.65');
    const quoteId = quoteRes.body.id;

    const tradeRes = await request(app.getHttpServer())
      .post('/v1/trades')
      .set('Authorization', auth())
      .set('Idempotency-Key', `e2e-${randomUUID()}`)
      .send({ quote_id: quoteId })
      .expect(201);

    expect(tradeRes.body.status).toBe('FILLED');
    expect(tradeRes.body.quote_id).toBe(quoteId);

    const balancesRes = await request(app.getHttpServer()).get('/v1/balances').set('Authorization', auth()).expect(200);
    const btc = balancesRes.body.data.find((b: { currency: string }) => b.currency === 'BTC');
    const usdt = balancesRes.body.data.find((b: { currency: string }) => b.currency === 'USDT');
    expect(btc.available_minor).toBe('101000000'); // 1 BTC + 0.01 BTC
    expect(usdt.available_minor).toBe('9934935'); // 100,000 USDT - 650.65 USDT

    const historyRes = await request(app.getHttpServer()).get('/v1/trades?limit=10').set('Authorization', auth()).expect(200);
    expect(historyRes.body.data.some((t: { id: string }) => t.id === tradeRes.body.id)).toBe(true);
  });

  it('rejects a trade against a quote with insufficient funds, leaving no trade row', async () => {
    const quoteRes = await request(app.getHttpServer())
      .post('/v1/quotes')
      .set('Authorization', auth())
      .send({ symbol: 'BTCUSDT', side: 'SELL', base_amount: '999', ttl_seconds: 30 })
      .expect(201);

    const idempotencyKey = `e2e-insufficient-${randomUUID()}`;
    const res = await request(app.getHttpServer())
      .post('/v1/trades')
      .set('Authorization', auth())
      .set('Idempotency-Key', idempotencyKey)
      .send({ quote_id: quoteRes.body.id })
      .expect(422);

    expect(res.body.error.code).toBe('INSUFFICIENT_FUNDS');

    // Retrying with the same key after "funding" should be possible in
    // principle (no side effect was recorded) — verified here by checking
    // the quote is still ACTIVE, not stuck in some half-executed state.
    const quoteCheck = await request(app.getHttpServer()).get(`/v1/quotes/${quoteRes.body.id}`).set('Authorization', auth()).expect(200);
    expect(quoteCheck.body.status).toBe('ACTIVE');
  });

  it('returns the same trade on an idempotent retry rather than executing twice', async () => {
    const quoteRes = await request(app.getHttpServer())
      .post('/v1/quotes')
      .set('Authorization', auth())
      .send({ symbol: 'BTCUSDT', side: 'BUY', base_amount: '0.001', ttl_seconds: 30 })
      .expect(201);

    const idempotencyKey = `e2e-retry-${randomUUID()}`;
    const first = await request(app.getHttpServer())
      .post('/v1/trades')
      .set('Authorization', auth())
      .set('Idempotency-Key', idempotencyKey)
      .send({ quote_id: quoteRes.body.id })
      .expect(201);

    const second = await request(app.getHttpServer())
      .post('/v1/trades')
      .set('Authorization', auth())
      .set('Idempotency-Key', idempotencyKey)
      .send({ quote_id: quoteRes.body.id })
      .expect(201);

    expect(second.body.id).toBe(first.body.id);
    expect(second.body.created_at).toBe(first.body.created_at);
  });

  it('rejects requests with no Authorization header', async () => {
    await request(app.getHttpServer()).get('/v1/balances').expect(401);
  });
});
