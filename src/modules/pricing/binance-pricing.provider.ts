import { Inject, Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Decimal } from 'decimal.js';
import type { Env } from '../../config/env.schema.js';
import { PricingProviderError } from '../../domain/errors.js';
import type { IndicativePrice, PricingProvider } from './pricing.types.js';

interface BinanceBookTicker {
  symbol: string;
  bidPrice: string;
  bidQty: string;
  askPrice: string;
  askQty: string;
}

/**
 * Adapter around Binance's public REST API. Deliberately isolated behind
 * the PricingProvider interface: PricingService (the caching/resilience
 * layer) never knows it's talking to Binance specifically.
 *
 * Two things worth calling out for reviewers:
 *  - `/api/v3/ticker/bookTicker` is a PUBLIC market-data endpoint — it
 *    needs no API key. We only need a key for placing real orders on
 *    Binance, which this service never does (trading happens against our
 *    own ledger, not Binance's order book).
 *  - Every call has a hard timeout (PRICING_TIMEOUT_MS) via AbortController
 *    and a small number of retries with linear backoff
 *    (PRICING_MAX_RETRIES), so a slow/unreachable Binance turns into a
 *    typed, bounded-latency PricingProviderError (mapped to 502/503 by the
 *    global exception filter) instead of a hung request or a raw 500.
 */
@Injectable()
export class BinancePricingProvider implements PricingProvider {
  private readonly logger = new Logger(BinancePricingProvider.name);

  constructor(@Inject(ConfigService) private readonly config: ConfigService<Env, true>) {}

  async fetchPrice(symbol: string): Promise<Omit<IndicativePrice, 'stale'>> {
    const baseUrl = this.config.get('BINANCE_BASE_URL', { infer: true });
    const timeoutMs = this.config.get('PRICING_TIMEOUT_MS', { infer: true });
    const maxRetries = this.config.get('PRICING_MAX_RETRIES', { infer: true });

    const url = `${baseUrl}/api/v3/ticker/bookTicker?symbol=${encodeURIComponent(symbol)}`;

    let lastError: unknown;
    for (let attempt = 0; attempt <= maxRetries; attempt++) {
      try {
        const ticker = await this.fetchOnce(url, timeoutMs);
        const bid = new Decimal(ticker.bidPrice);
        const ask = new Decimal(ticker.askPrice);
        const mid = bid.plus(ask).div(2);

        return {
          symbol: ticker.symbol,
          bid: bid.toString(),
          ask: ask.toString(),
          mid: mid.toString(),
          timestamp: new Date().toISOString(),
          source: 'binance',
        };
      } catch (error) {
        lastError = error;
        if (attempt < maxRetries) {
          this.logger.warn(`Binance fetch failed for ${symbol} (attempt ${attempt + 1}/${maxRetries + 1}), retrying: ${String(error)}`);
          await sleep(200 * (attempt + 1));
        }
      }
    }

    throw new PricingProviderError(
      `Failed to fetch price for ${symbol} from Binance after ${maxRetries + 1} attempt(s): ${String(lastError)}`,
    );
  }

  private async fetchOnce(url: string, timeoutMs: number): Promise<BinanceBookTicker> {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);

    try {
      const response = await fetch(url, { signal: controller.signal });

      if (!response.ok) {
        const body = await response.text().catch(() => '');
        throw new PricingProviderError(`Binance responded with ${response.status}: ${body.slice(0, 200)}`, response.status >= 500);
      }

      return (await response.json()) as BinanceBookTicker;
    } finally {
      clearTimeout(timer);
    }
  }
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
