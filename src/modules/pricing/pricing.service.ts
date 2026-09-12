import { Inject, Injectable, Logger } from '@nestjs/common';
import { PricingProviderError, ValidationError } from '../../domain/errors.js';
import { isSupportedSymbol } from '../../domain/currencies.js';
import { PriceCacheService } from './price-cache.service.js';
import type { IndicativePrice, PricingProvider } from './pricing.types.js';

export const PRICING_PROVIDER = Symbol('PRICING_PROVIDER');

/**
 * The one place that decides how fresh a price needs to be. Read path:
 *
 *  1. Fresh cache hit (younger than PRICE_CACHE_TTL_MS)? Return it.
 *  2. Otherwise call the provider. On success, populate both the fresh
 *     cache and the longer-lived "last known" cache, return it.
 *  3. Provider call failed? Fall back to the last-known-good cached price,
 *     marked `stale: true`, so a transient Binance blip degrades the API
 *     rather than breaking it. Only if there's no fallback either do we
 *     surface the PricingProviderError (-> 502/503 via the exception
 *     filter).
 *
 * Quote creation (modules/quotes) calls this same service, but is
 * expected to reject a `stale` price rather than lock in a firm quote off
 * of it — that policy lives in the quoting service, not here, so this
 * service stays a pure "get me the best price I can" primitive.
 */
@Injectable()
export class PricingService {
  private readonly logger = new Logger(PricingService.name);

  constructor(
    private readonly cache: PriceCacheService,
    @Inject(PRICING_PROVIDER) private readonly provider: PricingProvider,
  ) {}

  async getIndicativePrice(symbolInput: string): Promise<IndicativePrice> {
    const symbol = symbolInput.toUpperCase();
    if (!isSupportedSymbol(symbol)) {
      throw new ValidationError(`Unsupported symbol: ${symbolInput}`, {
        symbol: symbolInput,
      });
    }

    const fresh = await this.cache.getFresh(symbol);
    if (fresh) {
      return { ...fresh, stale: false };
    }

    try {
      const priceFromProvider = await this.provider.fetchPrice(symbol);
      await this.cache.setFromProviderResult(symbol, priceFromProvider);
      return { ...priceFromProvider, stale: false };
    } catch (error) {
      this.logger.warn(`Pricing provider failed for ${symbol}, attempting stale fallback: ${String(error)}`);
      const lastKnown = await this.cache.getLastKnown(symbol);
      if (lastKnown) {
        return { ...lastKnown, stale: true };
      }
      if (error instanceof PricingProviderError) {
        throw error;
      }
      throw new PricingProviderError(`Pricing unavailable for ${symbol}: ${String(error)}`);
    }
  }
}
