import { describe, expect, it, vi } from 'vitest';
import { TradesService } from './trades.service.js';
import { QuotesRepository } from '../quotes/quotes.repository.js';
import { TradesRepository } from './trades.repository.js';
import { BalancesRepository } from '../balances/balances.repository.js';
import { LedgerRepository } from '../ledger/ledger.repository.js';
import {
  IdempotencyConflictError,
  InsufficientFundsError,
  NotFoundError,
  QuoteAlreadyExecutedError,
  QuoteExpiredError,
  ValidationError,
} from '../../domain/errors.js';
import type { Client, Quote, Trade } from '../../db/schema/index.js';

const CLIENT: Client = { id: 'client-1', name: 'Test', apiKeyHash: 'x', createdAt: new Date() };

function makeQuote(overrides: Partial<Quote> = {}): Quote {
  return {
    id: 'quote-1',
    clientId: CLIENT.id,
    symbol: 'BTCUSDT',
    side: 'BUY',
    baseCurrency: 'BTC',
    quoteCurrency: 'USDT',
    baseAmountMinor: 1_000_000n, // 0.01 BTC
    price: '65065.000000000000000000',
    quoteAmountMinor: 65065n, // 650.65 USDT
    status: 'ACTIVE',
    expiresAt: new Date(Date.now() + 60_000),
    createdAt: new Date(),
    ...overrides,
  };
}

/**
 * A fake `Database` whose only real behavior is `transaction`: it just
 * invokes the callback with a placeholder `tx` value. Every repository
 * call inside TradesService is itself mocked (see below), so nothing
 * actually needs `tx` to be a real Drizzle transaction — this lets the
 * whole orchestration be tested without a real Postgres connection.
 */
function makeDb() {
  return { transaction: vi.fn((cb: (tx: unknown) => unknown) => cb({})) };
}

interface Harness {
  service: TradesService;
  db: ReturnType<typeof makeDb>;
  quotesRepository: QuotesRepository;
  tradesRepository: TradesRepository;
  balancesRepository: BalancesRepository;
  ledgerRepository: LedgerRepository;
}

function makeHarness(overrides: {
  quote?: Quote | undefined;
  payBalanceMinor?: bigint;
  existingTrade?: Trade;
} = {}): Harness {
  const db = makeDb();
  const quote = 'quote' in overrides ? overrides.quote : makeQuote();

  const quotesRepository = {
    findByIdForClientForUpdate: vi.fn().mockResolvedValue(quote),
    markExpired: vi.fn().mockResolvedValue(undefined),
    markExecuted: vi.fn().mockResolvedValue(undefined),
  } as unknown as QuotesRepository;

  const tradesRepository = {
    findByIdempotencyKey: vi.fn().mockResolvedValue(overrides.existingTrade),
    create: vi.fn().mockImplementation((_tx, values) => Promise.resolve({ id: 'trade-1', ...values })),
    isUniqueViolation: vi.fn().mockReturnValue(false),
  } as unknown as TradesRepository;

  const payBalance =
    overrides.payBalanceMinor !== undefined
      ? { id: 'bal-1', clientId: CLIENT.id, currency: quote?.quoteCurrency ?? 'USDT', availableMinor: overrides.payBalanceMinor, updatedAt: new Date() }
      : undefined;

  const balancesRepository = {
    findForUpdate: vi.fn().mockResolvedValue(payBalance),
    applyDelta: vi.fn().mockResolvedValue(undefined),
  } as unknown as BalancesRepository;

  const ledgerRepository = { insertTradeEntries: vi.fn().mockResolvedValue(undefined) } as unknown as LedgerRepository;

  const service = new TradesService(db as never, quotesRepository, tradesRepository, balancesRepository, ledgerRepository);

  return { service, db, quotesRepository, tradesRepository, balancesRepository, ledgerRepository };
}

describe('TradesService.executeTrade', () => {
  it('returns the existing trade without opening a transaction on an idempotent replay', async () => {
    const existingTrade = { id: 'trade-existing', quoteId: 'quote-1' } as Trade;
    const h = makeHarness({ existingTrade });

    const result = await h.service.executeTrade(CLIENT, { quote_id: 'quote-1' }, 'key-1');

    expect(result).toBe(existingTrade);
    expect(h.db.transaction).not.toHaveBeenCalled();
  });

  it('throws IdempotencyConflictError when the same key was used for a different quote', async () => {
    const existingTrade = { id: 'trade-existing', quoteId: 'quote-OTHER' } as Trade;
    const h = makeHarness({ existingTrade });

    await expect(h.service.executeTrade(CLIENT, { quote_id: 'quote-1' }, 'key-1')).rejects.toBeInstanceOf(IdempotencyConflictError);
    expect(h.db.transaction).not.toHaveBeenCalled();
  });

  it('throws NotFoundError when the quote does not exist for this client', async () => {
    const h = makeHarness({ quote: undefined });

    await expect(h.service.executeTrade(CLIENT, { quote_id: 'missing' }, 'key-1')).rejects.toBeInstanceOf(NotFoundError);
  });

  it('throws QuoteAlreadyExecutedError when the quote is already EXECUTED', async () => {
    const h = makeHarness({ quote: makeQuote({ status: 'EXECUTED' }) });

    await expect(h.service.executeTrade(CLIENT, { quote_id: 'quote-1' }, 'key-1')).rejects.toBeInstanceOf(QuoteAlreadyExecutedError);
    expect(h.tradesRepository.create).not.toHaveBeenCalled();
  });

  it('lazily expires an ACTIVE quote past its expiry and throws QuoteExpiredError, without creating a trade', async () => {
    const h = makeHarness({ quote: makeQuote({ status: 'ACTIVE', expiresAt: new Date(Date.now() - 1000) }) });

    await expect(h.service.executeTrade(CLIENT, { quote_id: 'quote-1' }, 'key-1')).rejects.toBeInstanceOf(QuoteExpiredError);
    expect(h.quotesRepository.markExpired).toHaveBeenCalledWith('quote-1', {});
    expect(h.tradesRepository.create).not.toHaveBeenCalled();
  });

  it('throws InsufficientFundsError and creates no trade when the pay-currency balance is too low', async () => {
    const h = makeHarness({ payBalanceMinor: 100n }); // needs 65065n

    await expect(h.service.executeTrade(CLIENT, { quote_id: 'quote-1' }, 'key-1')).rejects.toBeInstanceOf(InsufficientFundsError);
    expect(h.tradesRepository.create).not.toHaveBeenCalled();
    expect(h.ledgerRepository.insertTradeEntries).not.toHaveBeenCalled();
  });

  it('on a BUY: debits quote currency, credits base currency, and marks the quote EXECUTED', async () => {
    const h = makeHarness({ quote: makeQuote({ side: 'BUY' }), payBalanceMinor: 1_000_000n });

    const trade = await h.service.executeTrade(CLIENT, { quote_id: 'quote-1' }, 'key-1');

    expect(trade.status).toBe('FILLED');
    expect(h.ledgerRepository.insertTradeEntries).toHaveBeenCalledWith(
      {},
      expect.objectContaining({ currency: 'USDT', deltaMinor: -65065n }),
      expect.objectContaining({ currency: 'BTC', deltaMinor: 1_000_000n }),
    );
    expect(h.quotesRepository.markExecuted).toHaveBeenCalledWith('quote-1', {});
  });

  it('on a SELL: debits base currency, credits quote currency', async () => {
    const sellQuote = makeQuote({ side: 'SELL' });
    const h = makeHarness({ quote: sellQuote, payBalanceMinor: 1_000_000n });

    await h.service.executeTrade(CLIENT, { quote_id: 'quote-1' }, 'key-1');

    expect(h.ledgerRepository.insertTradeEntries).toHaveBeenCalledWith(
      {},
      expect.objectContaining({ currency: 'BTC', deltaMinor: -1_000_000n }),
      expect.objectContaining({ currency: 'USDT', deltaMinor: 65065n }),
    );
  });

  it('falls back to the DB unique-violation catch, returning the winner, when the idempotency-key pre-check race is lost', async () => {
    const h = makeHarness({ payBalanceMinor: 1_000_000n });
    const winner = { id: 'trade-winner', quoteId: 'quote-1' } as Trade;
    (h.tradesRepository.create as ReturnType<typeof vi.fn>).mockRejectedValue(new Error('unique violation'));
    (h.tradesRepository.isUniqueViolation as ReturnType<typeof vi.fn>).mockImplementation(
      (_error: unknown, constraint?: string) => constraint === 'trades_client_idempotency_key_unique',
    );
    (h.tradesRepository.findByIdempotencyKey as ReturnType<typeof vi.fn>)
      .mockResolvedValueOnce(undefined) // pre-check: no existing trade yet
      .mockResolvedValueOnce(winner); // post-failure re-check: the race winner

    const result = await h.service.executeTrade(CLIENT, { quote_id: 'quote-1' }, 'key-1');

    expect(result).toBe(winner);
  });

  it('throws QuoteAlreadyExecutedError when the DB reports the quote_id unique-violation race', async () => {
    const h = makeHarness({ payBalanceMinor: 1_000_000n });
    (h.tradesRepository.create as ReturnType<typeof vi.fn>).mockRejectedValue(new Error('unique violation'));
    (h.tradesRepository.isUniqueViolation as ReturnType<typeof vi.fn>).mockImplementation(
      (_error: unknown, constraint?: string) => constraint === 'trades_quote_id_unique',
    );

    await expect(h.service.executeTrade(CLIENT, { quote_id: 'quote-1' }, 'key-1')).rejects.toBeInstanceOf(QuoteAlreadyExecutedError);
  });
});

describe('TradesService.validateIdempotencyKey', () => {
  it('rejects a missing key', () => {
    expect(() => TradesService.validateIdempotencyKey(undefined)).toThrow(ValidationError);
  });

  it('rejects an empty/whitespace key', () => {
    expect(() => TradesService.validateIdempotencyKey('   ')).toThrow(ValidationError);
  });

  it('rejects an overly long key', () => {
    expect(() => TradesService.validateIdempotencyKey('x'.repeat(256))).toThrow(ValidationError);
  });

  it('accepts a normal key', () => {
    expect(TradesService.validateIdempotencyKey('abc-123')).toBe('abc-123');
  });
});
