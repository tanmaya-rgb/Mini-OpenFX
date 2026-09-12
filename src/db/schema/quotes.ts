import { bigint, index, numeric, pgTable, text, timestamp, uuid } from 'drizzle-orm/pg-core';
import { clients } from './clients.js';
import { quoteStatusEnum, tradeSideEnum } from './enums.js';

/**
 * A firm, time-bound price. Pricing (external, best-effort) and trading
 * (internal, transactional) never touch each other directly — a quote is
 * the bridge: the pricing service is consulted once, at quote-creation
 * time, and the result is locked in here. Trade execution later only ever
 * reads this row; it never calls the pricing provider again.
 *
 * `price` is stored as a numeric/string (not a float) and is only ever
 * manipulated through decimal.js (see domain/money.ts) — see the mode:
 * 'string' below, which makes Drizzle return it as a string rather than a
 * lossy JS number.
 *
 * Expiry is deterministic and checked at read/execution time
 * (`status === 'ACTIVE' && now < expires_at`); nothing here relies on a
 * background job to flip status, though both GET /v1/quotes/:id and trade
 * execution lazily correct `status` to EXPIRED when they observe it.
 */
export const quotes = pgTable(
  'quotes',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    clientId: uuid('client_id')
      .notNull()
      .references(() => clients.id),
    symbol: text('symbol').notNull(),
    side: tradeSideEnum('side').notNull(),
    baseCurrency: text('base_currency').notNull(),
    quoteCurrency: text('quote_currency').notNull(),
    baseAmountMinor: bigint('base_amount_minor', { mode: 'bigint' }).notNull(),
    price: numeric('price', { precision: 38, scale: 18, mode: 'string' }).notNull(),
    quoteAmountMinor: bigint('quote_amount_minor', { mode: 'bigint' }).notNull(),
    status: quoteStatusEnum('status').notNull().default('ACTIVE'),
    expiresAt: timestamp('expires_at', { withTimezone: true }).notNull(),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [index('quotes_client_idx').on(table.clientId)],
);

export type Quote = typeof quotes.$inferSelect;
export type NewQuote = typeof quotes.$inferInsert;
