import { Decimal } from 'decimal.js';
import { decimalsFor } from './currencies.js';

/**
 * Money math lives in exactly one place. Two rules, always:
 *  1. Anything stored in Postgres or moved through the ledger is a plain
 *     JS integer (bigint-safe range) in "minor units" — never a float.
 *  2. Anything computed (price * amount, applying a spread) goes through
 *     decimal.js and is rounded back to an integer only at the boundary,
 *     using the correct number of decimals for that currency.
 */

// decimal.js defaults to 20 significant digits which is plenty for FX/crypto
// notional sizes; we fix rounding mode so results are reproducible.
Decimal.set({ precision: 40, rounding: Decimal.ROUND_HALF_UP });

export function toMinorUnits(humanAmount: Decimal.Value, currency: string): bigint {
  const decimals = decimalsFor(currency);
  const scaled = new Decimal(humanAmount).mul(new Decimal(10).pow(decimals));
  if (!scaled.isInteger()) {
    // Human input had more precision than the currency supports — round
    // rather than silently truncate/error, but round at the edge only.
    return BigInt(scaled.toDecimalPlaces(0, Decimal.ROUND_HALF_UP).toFixed(0));
  }
  return BigInt(scaled.toFixed(0));
}

export function fromMinorUnits(minorAmount: bigint | number, currency: string): Decimal {
  const decimals = decimalsFor(currency);
  return new Decimal(minorAmount.toString()).div(new Decimal(10).pow(decimals));
}

/**
 * Applies a spread in basis points to a mid price, in the direction that
 * favors the house: BUY quotes get marked up, SELL quotes get marked down.
 * 1 basis point = 0.01%.
 */
export function applySpreadBps(midPrice: Decimal.Value, side: 'BUY' | 'SELL', spreadBps: number): Decimal {
  const mid = new Decimal(midPrice);
  const spreadFactor = new Decimal(spreadBps).div(10_000);
  return side === 'BUY' ? mid.mul(new Decimal(1).plus(spreadFactor)) : mid.mul(new Decimal(1).minus(spreadFactor));
}

/**
 * Computes the quote-currency amount for a given base amount and price,
 * returned as an integer in the quote currency's minor units.
 * quote_amount = base_amount * price
 */
export function computeQuoteAmountMinor(
  baseAmountMinor: bigint,
  baseCurrency: string,
  price: Decimal.Value,
  quoteCurrency: string,
): bigint {
  const baseAmountHuman = fromMinorUnits(baseAmountMinor, baseCurrency);
  const quoteAmountHuman = baseAmountHuman.mul(new Decimal(price));
  return toMinorUnits(quoteAmountHuman, quoteCurrency);
}
