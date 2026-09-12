/**
 * Every amount in this system is stored and moved as an integer in "minor
 * units" (no floats, ever) — the same idea as storing cents instead of
 * dollars. The number of minor-unit decimals is NOT the same for every
 * currency (USD has 2, BTC has 8), so this table is the single source of
 * truth for that conversion. Anything that turns a human-readable amount
 * ("0.01 BTC") into a stored integer (1000000) — or back — must go through
 * here, never hardcode "* 100".
 */
export const CURRENCY_DECIMALS = {
  USD: 2,
  USDT: 2, // treated as a 2-decimal stablecoin for this assignment; see README
  BTC: 8,
  ETH: 8, // truncated from ETH's native 18 decimals — see README tradeoffs
  EUR: 2,
} as const;

export type SupportedCurrency = keyof typeof CURRENCY_DECIMALS;

export function isSupportedCurrency(value: string): value is SupportedCurrency {
  return Object.prototype.hasOwnProperty.call(CURRENCY_DECIMALS, value);
}

export function decimalsFor(currency: string): number {
  if (!isSupportedCurrency(currency)) {
    throw new Error(`Unsupported currency: ${currency}`);
  }
  return CURRENCY_DECIMALS[currency];
}

/**
 * A trading symbol like "BTCUSDT" is just base currency + quote currency
 * concatenated, Binance-style. We keep an explicit map rather than trying
 * to split the string heuristically (ambiguous for things like "ETHBTC"
 * where either side could a priori be 3 or 4 characters).
 */
export const SYMBOLS: Record<string, { base: SupportedCurrency; quote: SupportedCurrency }> = {
  BTCUSDT: { base: 'BTC', quote: 'USDT' },
  ETHUSDT: { base: 'ETH', quote: 'USDT' },
  ETHBTC: { base: 'ETH', quote: 'BTC' },
};

export type SupportedSymbol = keyof typeof SYMBOLS;

export function isSupportedSymbol(value: string): value is SupportedSymbol {
  return Object.prototype.hasOwnProperty.call(SYMBOLS, value);
}
