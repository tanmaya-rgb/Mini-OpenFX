import { describe, expect, it, vi } from 'vitest';
import { QuotesService } from './quotes.service.js';
import { QuotesRepository } from './quotes.repository.js';
import { PricingService } from '../pricing/pricing.service.js';
import { ConfigService } from '@nestjs/config';
import { NotFoundError, PricingProviderError, ValidationError } from '../../domain/errors.js';
import type { Client, Quote } from '../../db/schema/index.js';
import type { Env } from '../../config/env.schema.js';

const FAKE_CLIENT: Client = {
  id: 'client-1',
  name: 'Test Client',
  apiKeyHash: 'irrelevant',
  createdAt: new Date(),
};

function makeConfig(overrides: Record<string, unknown> = {}): ConfigService<Env, true> {
  const defaults: Record<string, unknown> = { QUOTE_SPREAD_BPS: 10, DEFAULT_QUOTE_TTL_SECONDS: 15, ...overrides };
  return { get: (key: string) => defaults[key] } as unknown as ConfigService<Env, true>;
}

describe('QuotesService.createQuote', () => {
  it('rejects an unsupported symbol', async () => {
    const repo = { create: vi.fn() } as unknown as QuotesRepository;
    const pricing = { getIndicativePrice: vi.fn() } as unknown as PricingService;
    const service = new QuotesService(repo, pricing, makeConfig());

    await expect(
      service.createQuote(FAKE_CLIENT, { symbol: 'DOGEUSDT', side: 'BUY', base_amount: '1' }),
    ).rejects.toBeInstanceOf(ValidationError);
    expect(repo.create).not.toHaveBeenCalled();
  });

  it('refuses to create a firm quote from a stale indicative price', async () => {
    const repo = { create: vi.fn() } as unknown as QuotesRepository;
    const pricing = {
      getIndicativePrice: vi.fn().mockResolvedValue({ symbol: 'BTCUSDT', mid: '65000', bid: '64999', ask: '65001', timestamp: 't', source: 'binance', stale: true }),
    } as unknown as PricingService;
    const service = new QuotesService(repo, pricing, makeConfig());

    await expect(
      service.createQuote(FAKE_CLIENT, { symbol: 'BTCUSDT', side: 'BUY', base_amount: '0.01' }),
    ).rejects.toBeInstanceOf(PricingProviderError);
    expect(repo.create).not.toHaveBeenCalled();
  });

  it('applies the spread in the house-favoring direction for BUY vs SELL and stores minor units correctly', async () => {
    const repo = { create: vi.fn().mockImplementation((values) => Promise.resolve({ id: 'q1', ...values })) } as unknown as QuotesRepository;
    const pricing = {
      getIndicativePrice: vi.fn().mockResolvedValue({ symbol: 'BTCUSDT', mid: '65000', bid: '64999', ask: '65001', timestamp: 't', source: 'binance', stale: false }),
    } as unknown as PricingService;
    const service = new QuotesService(repo, pricing, makeConfig({ QUOTE_SPREAD_BPS: 10 }));

    await service.createQuote(FAKE_CLIENT, { symbol: 'BTCUSDT', side: 'BUY', base_amount: '0.01' });
    const buyCall = (repo.create as ReturnType<typeof vi.fn>).mock.calls[0][0];
    expect(buyCall.price).toBe('65065.000000000000000000'); // 65000 * 1.001
    expect(buyCall.baseAmountMinor).toBe(1000000n); // 0.01 BTC at 8 decimals
    expect(buyCall.quoteAmountMinor).toBe(65065n); // 650.65 USDT at 2 decimals

    await service.createQuote(FAKE_CLIENT, { symbol: 'BTCUSDT', side: 'SELL', base_amount: '0.01' });
    const sellCall = (repo.create as ReturnType<typeof vi.fn>).mock.calls[1][0];
    expect(sellCall.price).toBe('64935.000000000000000000'); // 65000 * 0.999
  });
});

describe('QuotesService.getQuote', () => {
  it('throws NotFoundError when the quote does not exist for this client', async () => {
    const repo = { findByIdForClient: vi.fn().mockResolvedValue(undefined) } as unknown as QuotesRepository;
    const service = new QuotesService(repo, {} as PricingService, makeConfig());

    await expect(service.getQuote(FAKE_CLIENT, 'missing-id')).rejects.toBeInstanceOf(NotFoundError);
  });

  it('lazily flips an expired ACTIVE quote to EXPIRED and persists it', async () => {
    const expiredQuote: Quote = {
      id: 'q1',
      clientId: FAKE_CLIENT.id,
      symbol: 'BTCUSDT',
      side: 'BUY',
      baseCurrency: 'BTC',
      quoteCurrency: 'USDT',
      baseAmountMinor: 1000000n,
      price: '65000.000000000000000000',
      quoteAmountMinor: 65000n,
      status: 'ACTIVE',
      expiresAt: new Date(Date.now() - 1000), // already in the past
      createdAt: new Date(Date.now() - 5000),
    };
    const repo = {
      findByIdForClient: vi.fn().mockResolvedValue(expiredQuote),
      markExpired: vi.fn().mockResolvedValue(undefined),
    } as unknown as QuotesRepository;
    const service = new QuotesService(repo, {} as PricingService, makeConfig());

    const result = await service.getQuote(FAKE_CLIENT, 'q1');

    expect(result.status).toBe('EXPIRED');
    expect(repo.markExpired).toHaveBeenCalledWith('q1');
  });

  it('leaves a still-valid ACTIVE quote untouched', async () => {
    const activeQuote: Quote = {
      id: 'q2',
      clientId: FAKE_CLIENT.id,
      symbol: 'BTCUSDT',
      side: 'BUY',
      baseCurrency: 'BTC',
      quoteCurrency: 'USDT',
      baseAmountMinor: 1000000n,
      price: '65000.000000000000000000',
      quoteAmountMinor: 65000n,
      status: 'ACTIVE',
      expiresAt: new Date(Date.now() + 60_000),
      createdAt: new Date(),
    };
    const repo = {
      findByIdForClient: vi.fn().mockResolvedValue(activeQuote),
      markExpired: vi.fn(),
    } as unknown as QuotesRepository;
    const service = new QuotesService(repo, {} as PricingService, makeConfig());

    const result = await service.getQuote(FAKE_CLIENT, 'q2');

    expect(result.status).toBe('ACTIVE');
    expect(repo.markExpired).not.toHaveBeenCalled();
  });
});
