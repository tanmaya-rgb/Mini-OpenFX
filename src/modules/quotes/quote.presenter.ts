import type { Quote } from '../../db/schema/index.js';
import { fromMinorUnits } from '../../domain/money.js';

/**
 * Maps a DB row to the API response shape. Two things this exists to fix:
 *  - `bigint` doesn't serialize through JSON.stringify (Nest's default
 *    body serializer would throw), so every minor-unit field is exposed
 *    twice: as the exact integer string (`*_amount_minor`) and as a
 *    human-readable decimal (`*_amount`) computed via domain/money.ts.
 *  - Callers shouldn't need to know a currency's decimal count to render
 *    an amount.
 */
export function presentQuote(quote: Quote) {
  return {
    id: quote.id,
    symbol: quote.symbol,
    side: quote.side,
    base_currency: quote.baseCurrency,
    quote_currency: quote.quoteCurrency,
    base_amount: fromMinorUnits(quote.baseAmountMinor, quote.baseCurrency).toString(),
    base_amount_minor: quote.baseAmountMinor.toString(),
    price: quote.price,
    quote_amount: fromMinorUnits(quote.quoteAmountMinor, quote.quoteCurrency).toString(),
    quote_amount_minor: quote.quoteAmountMinor.toString(),
    status: quote.status,
    expires_at: quote.expiresAt.toISOString(),
    created_at: quote.createdAt.toISOString(),
  };
}
