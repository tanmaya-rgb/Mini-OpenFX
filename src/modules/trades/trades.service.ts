import { Inject, Injectable, Logger } from '@nestjs/common';
import { DRIZZLE, type Database } from '../../db/db.module.js';
import type { Client, Trade } from '../../db/schema/index.js';
import {
  IdempotencyConflictError,
  InsufficientFundsError,
  NotFoundError,
  QuoteAlreadyExecutedError,
  QuoteExpiredError,
  ValidationError,
} from '../../domain/errors.js';
import { QuotesRepository } from '../quotes/quotes.repository.js';
import { BalancesRepository } from '../balances/balances.repository.js';
import { LedgerRepository } from '../ledger/ledger.repository.js';
import { TradesRepository } from './trades.repository.js';
import type { CreateTradeDto } from './dto/create-trade.dto.js';

/**
 * Trade execution — the one place in the system that actually moves
 * money. Everything else (pricing, quoting) is read-only or additive;
 * this is the only service that touches balances and the ledger, and it
 * does so entirely inside one Postgres transaction, so a crash partway
 * through leaves nothing half-applied.
 *
 * Concurrency and idempotency are handled at two layers, deliberately
 * redundant with each other:
 *
 *  1. Application-level checks (an idempotency-key lookup before the
 *     transaction, a quote status/expiry check inside it) handle the
 *     common case cheaply and produce clean, typed errors.
 *  2. Database constraints (UNIQUE(quote_id), UNIQUE(client_id,
 *     idempotency_key)) are the actual safety net for the race where two
 *     requests for the same quote or same idempotency key arrive at
 *     almost the same instant — the application-level check alone has a
 *     TOCTOU gap; the constraint is what makes the guarantee real. See
 *     the catch blocks below for how a constraint violation is turned
 *     back into the same typed error / idempotent replay a caller would
 *     have gotten if their request had simply lost the race.
 */
@Injectable()
export class TradesService {
  private readonly logger = new Logger(TradesService.name);

  constructor(
    @Inject(DRIZZLE) private readonly db: Database,
    private readonly quotesRepository: QuotesRepository,
    private readonly tradesRepository: TradesRepository,
    private readonly balancesRepository: BalancesRepository,
    private readonly ledgerRepository: LedgerRepository,
  ) {}

  async executeTrade(client: Client, input: CreateTradeDto, idempotencyKey: string): Promise<Trade> {
    // Cheap pre-check: if this exact (client, key) already produced a
    // trade, short-circuit before opening a transaction at all. This is
    // the fast path for the overwhelmingly common retry case (network
    // timeout, client-side retry logic) — the DB constraint below still
    // has the final word if this check loses a race.
    const existing = await this.tradesRepository.findByIdempotencyKey(client.id, idempotencyKey);
    if (existing) {
      if (existing.quoteId !== input.quote_id) {
        throw new IdempotencyConflictError();
      }
      return existing;
    }

    try {
      return await this.db.transaction(async (tx) => {
        const quote = await this.quotesRepository.findByIdForClientForUpdate(tx, input.quote_id, client.id);
        if (!quote) {
          throw new NotFoundError('Quote');
        }

        if (quote.status === 'EXECUTED') {
          throw new QuoteAlreadyExecutedError(quote.id);
        }

        const isExpired = quote.status === 'EXPIRED' || quote.expiresAt.getTime() <= Date.now();
        if (isExpired) {
          if (quote.status !== 'EXPIRED') {
            await this.quotesRepository.markExpired(quote.id, tx);
          }
          throw new QuoteExpiredError(quote.id);
        }

        // BUY: client pays in the quote currency, receives the base
        // currency. SELL: the reverse. See README for a worked example.
        const [payCurrency, payAmountMinor, receiveCurrency, receiveAmountMinor] =
          quote.side === 'BUY'
            ? [quote.quoteCurrency, quote.quoteAmountMinor, quote.baseCurrency, quote.baseAmountMinor]
            : [quote.baseCurrency, quote.baseAmountMinor, quote.quoteCurrency, quote.quoteAmountMinor];

        const payBalance = await this.balancesRepository.findForUpdate(tx, client.id, payCurrency);
        const availablePayMinor = payBalance?.availableMinor ?? 0n;
        if (availablePayMinor < payAmountMinor) {
          throw new InsufficientFundsError(payCurrency);
        }

        const trade = await this.tradesRepository.create(tx, {
          clientId: client.id,
          quoteId: quote.id,
          symbol: quote.symbol,
          side: quote.side,
          baseCurrency: quote.baseCurrency,
          quoteCurrency: quote.quoteCurrency,
          baseAmountMinor: quote.baseAmountMinor,
          quoteAmountMinor: quote.quoteAmountMinor,
          price: quote.price,
          status: 'FILLED',
          idempotencyKey,
        });

        await this.ledgerRepository.insertTradeEntries(
          tx,
          { clientId: client.id, currency: payCurrency, deltaMinor: -payAmountMinor, refType: 'TRADE', refId: trade.id },
          { clientId: client.id, currency: receiveCurrency, deltaMinor: receiveAmountMinor, refType: 'TRADE', refId: trade.id },
        );

        await this.balancesRepository.applyDelta(tx, client.id, payCurrency, -payAmountMinor, payBalance);
        const receiveBalance = await this.balancesRepository.findForUpdate(tx, client.id, receiveCurrency);
        await this.balancesRepository.applyDelta(tx, client.id, receiveCurrency, receiveAmountMinor, receiveBalance);

        await this.quotesRepository.markExecuted(quote.id, tx);

        return trade;
      });
    } catch (error) {
      // Lost the idempotency-key race: another request for the same
      // (client, key) committed between our pre-check and our insert.
      // Postgres rejected our insert; the correct response isn't an
      // error, it's the same trade the winner produced.
      if (this.tradesRepository.isUniqueViolation(error, 'trades_client_idempotency_key_unique')) {
        const winner = await this.tradesRepository.findByIdempotencyKey(client.id, idempotencyKey);
        if (winner) {
          if (winner.quoteId !== input.quote_id) {
            throw new IdempotencyConflictError();
          }
          return winner;
        }
      }
      // Lost the quote race: another request executed this exact quote
      // between our status check and our insert (shouldn't happen given
      // the row lock, but the constraint is the real guarantee, not the
      // lock — defense in depth).
      if (this.tradesRepository.isUniqueViolation(error, 'trades_quote_id_unique')) {
        throw new QuoteAlreadyExecutedError(input.quote_id);
      }
      throw error;
    }
  }

  async getTrade(client: Client, tradeId: string): Promise<Trade> {
    const trade = await this.tradesRepository.findByIdForClient(tradeId, client.id);
    if (!trade) {
      throw new NotFoundError('Trade');
    }
    return trade;
  }

  /**
   * Keyset pagination: fetches `limit` rows strictly older than `cursor`
   * (see trade-cursor.ts). Always requests one extra row so we can tell
   * whether a next page exists without a separate COUNT query, then
   * trims it back off before returning.
   */
  async listTrades(client: Client, limit: number, cursor?: { createdAt: Date; id: string }): Promise<{ trades: Trade[]; hasMore: boolean }> {
    const rows = await this.tradesRepository.listForClient(client.id, limit + 1, cursor);
    const hasMore = rows.length > limit;
    return { trades: hasMore ? rows.slice(0, limit) : rows, hasMore };
  }

  static validateIdempotencyKey(key: string | undefined): string {
    if (!key || key.trim().length === 0) {
      throw new ValidationError('Idempotency-Key header is required');
    }
    if (key.length > 255) {
      throw new ValidationError('Idempotency-Key must be at most 255 characters');
    }
    return key;
  }
}
