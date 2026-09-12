import { describe, expect, it } from 'vitest';
import { decimalsFor, isSupportedCurrency, isSupportedSymbol, SYMBOLS } from './currencies.js';

describe('currencies', () => {
  it('recognizes supported currencies and rejects unknown ones', () => {
    expect(isSupportedCurrency('BTC')).toBe(true);
    expect(isSupportedCurrency('DOGE')).toBe(false);
  });

  it('returns the correct decimals per currency', () => {
    expect(decimalsFor('USD')).toBe(2);
    expect(decimalsFor('BTC')).toBe(8);
  });

  it('throws for an unsupported currency rather than returning a default', () => {
    expect(() => decimalsFor('DOGE')).toThrow('Unsupported currency');
  });

  it('recognizes supported symbols and rejects unknown ones', () => {
    expect(isSupportedSymbol('BTCUSDT')).toBe(true);
    expect(isSupportedSymbol('DOGEUSDT')).toBe(false);
  });

  it('splits every supported symbol into a base/quote pair that are both supported currencies', () => {
    for (const [symbol, { base, quote }] of Object.entries(SYMBOLS)) {
      expect(isSupportedCurrency(base), `${symbol} base`).toBe(true);
      expect(isSupportedCurrency(quote), `${symbol} quote`).toBe(true);
    }
  });
});
