import { describe, expect, it, vi } from 'vitest';
import { PricingService } from './pricing.service.js';
import { PriceCacheService } from './price-cache.service.js';
import { PricingProviderError } from '../../domain/errors.js';
import type { PricingProvider } from './pricing.types.js';

/**
 * These are pure unit tests: PricingService is constructed directly with
 * hand-rolled fakes for its two dependencies (cache + provider), so they
 * run instantly and never touch a real network or Redis instance. This is
 * deliberate — Binance is a real, occasionally-flaky third party, and a
 * unit test suite shouldn't depend on it being reachable (in this
 * project's cloud dev sandbox, the network egress policy blocks it
 * entirely, which is exactly the kind of provider failure this service is
 * built to survive).
 */
function makeCache(overrides: Partial<PriceCacheService> = {}): PriceCacheService {
  return {
    getFresh: vi.fn().mockResolvedValue(null),
    getLastKnown: vi.fn().mockResolvedValue(null),
    setFromProviderResult: vi.fn().mockResolvedValue(undefined),
    ...overrides,
  } as unknown as PriceCacheService;
}

describe('PricingService', () => {
  it('rejects an unsupported symbol before touching cache or provider', async () => {
    const cache = makeCache();
    const provider: PricingProvider = { fetchPrice: vi.fn() };
    const service = new PricingService(cache, provider);

    await expect(service.getIndicativePrice('NOTREAL')).rejects.toThrow('Unsupported symbol');
    expect(provider.fetchPrice).not.toHaveBeenCalled();
  });

  it('returns the fresh cache entry, marked stale:false, without calling the provider', async () => {
    const cachedPrice = { symbol: 'BTCUSDT', bid: '100', ask: '101', mid: '100.5', timestamp: 't', source: 'binance' as const };
    const cache = makeCache({ getFresh: vi.fn().mockResolvedValue(cachedPrice) });
    const provider: PricingProvider = { fetchPrice: vi.fn() };
    const service = new PricingService(cache, provider);

    const result = await service.getIndicativePrice('BTCUSDT');

    expect(result).toEqual({ ...cachedPrice, stale: false });
    expect(provider.fetchPrice).not.toHaveBeenCalled();
  });

  it('calls the provider on a cache miss, populates the cache, and returns stale:false', async () => {
    const providerPrice = { symbol: 'BTCUSDT', bid: '200', ask: '201', mid: '200.5', timestamp: 't', source: 'binance' as const };
    const cache = makeCache();
    const provider: PricingProvider = { fetchPrice: vi.fn().mockResolvedValue(providerPrice) };
    const service = new PricingService(cache, provider);

    const result = await service.getIndicativePrice('BTCUSDT');

    expect(result).toEqual({ ...providerPrice, stale: false });
    expect(cache.setFromProviderResult).toHaveBeenCalledWith('BTCUSDT', providerPrice);
  });

  it('falls back to the last-known cached price, marked stale:true, when the provider fails', async () => {
    const lastKnown = { symbol: 'BTCUSDT', bid: '90', ask: '91', mid: '90.5', timestamp: 'old', source: 'binance' as const };
    const cache = makeCache({ getLastKnown: vi.fn().mockResolvedValue(lastKnown) });
    const provider: PricingProvider = { fetchPrice: vi.fn().mockRejectedValue(new PricingProviderError('boom')) };
    const service = new PricingService(cache, provider);

    const result = await service.getIndicativePrice('BTCUSDT');

    expect(result).toEqual({ ...lastKnown, stale: true });
  });

  it('throws PricingProviderError when the provider fails and there is no fallback', async () => {
    const cache = makeCache();
    const provider: PricingProvider = { fetchPrice: vi.fn().mockRejectedValue(new PricingProviderError('boom')) };
    const service = new PricingService(cache, provider);

    await expect(service.getIndicativePrice('BTCUSDT')).rejects.toBeInstanceOf(PricingProviderError);
  });
});
