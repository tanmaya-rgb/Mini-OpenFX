import { describe, expect, it } from 'vitest';
import { applySpreadBps, computeQuoteAmountMinor, fromMinorUnits, toMinorUnits } from './money.js';

describe('toMinorUnits / fromMinorUnits', () => {
  it('converts a 2-decimal currency (USD) correctly', () => {
    expect(toMinorUnits('100', 'USD')).toBe(10000n);
    expect(toMinorUnits('0.01', 'USD')).toBe(1n);
    expect(fromMinorUnits(10000n, 'USD').toString()).toBe('100');
  });

  it('converts an 8-decimal currency (BTC) correctly, including small fractional amounts', () => {
    expect(toMinorUnits('0.01', 'BTC')).toBe(1_000_000n);
    expect(toMinorUnits('0.00000001', 'BTC')).toBe(1n); // one satoshi
    expect(fromMinorUnits(1_000_000n, 'BTC').toString()).toBe('0.01');
  });

  it('rounds rather than truncates when given more precision than a currency supports', () => {
    // USD has 2 decimals; a third decimal digit must round, not vanish or throw.
    expect(toMinorUnits('1.005', 'USD')).toBe(101n); // rounds up (ROUND_HALF_UP)
    expect(toMinorUnits('1.004', 'USD')).toBe(100n);
  });

  it('round-trips a value without drift', () => {
    const original = '65065.00';
    const minor = toMinorUnits(original, 'USDT');
    expect(fromMinorUnits(minor, 'USDT').toString()).toBe('65065');
  });
});

describe('applySpreadBps', () => {
  it('marks a BUY price up', () => {
    expect(applySpreadBps('65000', 'BUY', 10).toString()).toBe('65065');
  });

  it('marks a SELL price down', () => {
    expect(applySpreadBps('65000', 'SELL', 10).toString()).toBe('64935');
  });

  it('is a no-op at zero spread', () => {
    expect(applySpreadBps('65000', 'BUY', 0).toString()).toBe('65000');
    expect(applySpreadBps('65000', 'SELL', 0).toString()).toBe('65000');
  });
});

describe('computeQuoteAmountMinor', () => {
  it('computes base_amount * price and converts to the quote currency minor units', () => {
    // 0.01 BTC at a firm price of 65065 USDT/BTC -> 650.65 USDT -> 65065 minor units (2dp)
    const baseAmountMinor = toMinorUnits('0.01', 'BTC');
    const result = computeQuoteAmountMinor(baseAmountMinor, 'BTC', '65065', 'USDT');
    expect(result).toBe(65065n);
  });

  it('handles a SELL-sized example (1 ETH at 3196.8)', () => {
    const baseAmountMinor = toMinorUnits('1', 'ETH');
    const result = computeQuoteAmountMinor(baseAmountMinor, 'ETH', '3196.8', 'USDT');
    expect(result).toBe(319680n);
  });
});
