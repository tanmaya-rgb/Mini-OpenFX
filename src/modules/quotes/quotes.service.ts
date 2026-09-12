import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Decimal } from 'decimal.js';
import type { Env } from '../../config/env.schema.js';
import { isSupportedSymbol, SYMBOLS } from '../../domain/currencies.js';
import { applySpreadBps, computeQuoteAmountMinor, toMinorUnits } from '../../domain/money.js';
import { NotFoundError, PricingProviderError, ValidationError } from '../../domain/errors.js';
import { PricingService } from '../pricing/pricing.service.js';
import { QuotesRepository } from './quotes.repository.js';
import type { CreateQuoteDto } from './dto/create-quote.dto.js';
import type { Client, Quote } from '../../db/schema/index.js';

@Injectable()
export class QuotesService {
  constructor(
    private readonly quotesRepository: QuotesRepository,
    private readonly pricingService: PricingService,
    private readonly config: ConfigService<Env, true>,
  ) {}

  async createQuote(client: Client, input: CreateQuoteDto): Promise<Quote> {
    if (!isSupportedSymbol(input.symbol)) {
      throw new ValidationError(`Unsupported symbol: ${input.symbol}`, { symbol: input.symbol });
    }
    const { base: baseCurrency, quote: quoteCurrency } = SYMBOLS[input.symbol];

    // A quote is a firm, executable promise — it must not be built on a
    // price we already know is out of date. Pricing degrading to a
    // best-effort stale value is fine for GET /v1/prices (display only);
    // it is not fine here. See PricingService for what "stale" means.
    const indicativePrice = await this.pricingService.getIndicativePrice(input.symbol);
    if (indicativePrice.stale) {
      throw new PricingProviderError('Pricing provider is currently unavailable; cannot create a firm quote from a stale price', false);
    }

    const baseAmountMinor = toMinorUnits(input.base_amount, baseCurrency);
    const spreadBps = this.config.get('QUOTE_SPREAD_BPS', { infer: true });
    const firmPrice = applySpreadBps(indicativePrice.mid, input.side, spreadBps);
    const quoteAmountMinor = computeQuoteAmountMinor(baseAmountMinor, baseCurrency, firmPrice, quoteCurrency);

    const ttlSeconds = input.ttl_seconds ?? this.config.get('DEFAULT_QUOTE_TTL_SECONDS', { infer: true });
    const expiresAt = new Date(Date.now() + ttlSeconds * 1000);

    return this.quotesRepository.create({
      clientId: client.id,
      symbol: input.symbol,
      side: input.side,
      baseCurrency,
      quoteCurrency,
      baseAmountMinor,
      price: firmPriceToStorageString(firmPrice),
      quoteAmountMinor,
      status: 'ACTIVE',
      expiresAt,
    });
  }

  async getQuote(client: Client, quoteId: string): Promise<Quote> {
    const quote = await this.quotesRepository.findByIdForClient(quoteId, client.id);
    if (!quote) {
      throw new NotFoundError('Quote');
    }

    // Deterministic, lazy expiry: no background job flips ACTIVE ->
    // EXPIRED, but a read (or trade execution — see modules/trades) that
    // observes an ACTIVE quote past its expires_at corrects the stored
    // status on the way out, so the DB stops lying about it.
    if (quote.status === 'ACTIVE' && quote.expiresAt.getTime() <= Date.now()) {
      await this.quotesRepository.markExpired(quote.id);
      return { ...quote, status: 'EXPIRED' };
    }

    return quote;
  }
}

function firmPriceToStorageString(price: Decimal): string {
  return price.toFixed(18);
}
