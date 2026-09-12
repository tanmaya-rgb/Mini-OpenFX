import type { Trade } from '../../db/schema/index.js';
import { fromMinorUnits } from '../../domain/money.js';

export function presentTrade(trade: Trade) {
  return {
    id: trade.id,
    quote_id: trade.quoteId,
    symbol: trade.symbol,
    side: trade.side,
    base_currency: trade.baseCurrency,
    quote_currency: trade.quoteCurrency,
    base_amount: fromMinorUnits(trade.baseAmountMinor, trade.baseCurrency).toString(),
    base_amount_minor: trade.baseAmountMinor.toString(),
    price: trade.price,
    quote_amount: fromMinorUnits(trade.quoteAmountMinor, trade.quoteCurrency).toString(),
    quote_amount_minor: trade.quoteAmountMinor.toString(),
    status: trade.status,
    idempotency_key: trade.idempotencyKey,
    created_at: trade.createdAt.toISOString(),
  };
}
