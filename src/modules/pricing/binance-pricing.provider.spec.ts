import { afterEach, describe, expect, it, vi } from 'vitest';
import type { ConfigService } from '@nestjs/config';
import { BinancePricingProvider } from './binance-pricing.provider.js';
import { PricingProviderError } from '../../domain/errors.js';
import type { Env } from '../../config/env.schema.js';

function makeConfig(overrides: Partial<Env> = {}): ConfigService<Env, true> {
  const defaults: Partial<Env> = {
    BINANCE_BASE_URL: 'https://api.binance.com',
    PRICING_TIMEOUT_MS: 2000,
    PRICING_MAX_RETRIES: 1,
    ...overrides,
  };
  return { get: (key: keyof Env) => defaults[key] } as unknown as ConfigService<Env, true>;
}

function jsonResponse(body: unknown, ok = true, status = 200): Response {
  return {
    ok,
    status,
    json: () => Promise.resolve(body),
    text: () => Promise.resolve(JSON.stringify(body)),
  } as Response;
}

describe('BinancePricingProvider', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('parses a successful bookTicker response into bid/ask/mid', async () => {
    const fetchMock = vi.fn().mockResolvedValue(jsonResponse({ symbol: 'BTCUSDT', bidPrice: '64999.5', askPrice: '65000.5' }));
    vi.stubGlobal('fetch', fetchMock);

    const provider = new BinancePricingProvider(makeConfig());
    const result = await provider.fetchPrice('BTCUSDT');

    expect(result.symbol).toBe('BTCUSDT');
    expect(result.bid).toBe('64999.5');
    expect(result.ask).toBe('65000.5');
    expect(result.mid).toBe('65000');
    expect(result.source).toBe('binance');
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(fetchMock.mock.calls[0][0]).toContain('symbol=BTCUSDT');
  });

  it('retries up to PRICING_MAX_RETRIES on failure, then succeeds', async () => {
    const fetchMock = vi
      .fn()
      .mockRejectedValueOnce(new Error('network blip'))
      .mockResolvedValueOnce(jsonResponse({ symbol: 'BTCUSDT', bidPrice: '100', askPrice: '102' }));
    vi.stubGlobal('fetch', fetchMock);

    const provider = new BinancePricingProvider(makeConfig({ PRICING_MAX_RETRIES: 1 }));
    const result = await provider.fetchPrice('BTCUSDT');

    expect(result.mid).toBe('101');
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it('gives up after PRICING_MAX_RETRIES and throws a typed PricingProviderError', async () => {
    const fetchMock = vi.fn().mockRejectedValue(new Error('always fails'));
    vi.stubGlobal('fetch', fetchMock);

    const provider = new BinancePricingProvider(makeConfig({ PRICING_MAX_RETRIES: 2 }));

    await expect(provider.fetchPrice('BTCUSDT')).rejects.toBeInstanceOf(PricingProviderError);
    expect(fetchMock).toHaveBeenCalledTimes(3); // 1 initial + 2 retries
  });

  it('treats a non-ok HTTP response (e.g. Binance 403/500) as a failure, not a thrown parse error', async () => {
    const fetchMock = vi.fn().mockResolvedValue(jsonResponse({ msg: 'blocked' }, false, 403));
    vi.stubGlobal('fetch', fetchMock);

    const provider = new BinancePricingProvider(makeConfig({ PRICING_MAX_RETRIES: 0 }));

    await expect(provider.fetchPrice('BTCUSDT')).rejects.toBeInstanceOf(PricingProviderError);
  });
});
