import { bigint, index, numeric, pgTable, text, timestamp, uniqueIndex, uuid } from 'drizzle-orm/pg-core';
import { clients } from './clients.js';
import { quotes } from './quotes.js';
import { tradeSideEnum, tradeStatusEnum } from './enums.js';

/**
 * An immutable record of an executed trade. Two constraints do the heavy
 * lifting for correctness here:
 *
 *  - UNIQUE(quote_id): a quote can be executed at most once, ever. This is
 *    what makes "lock the quote row, check status, then insert" safe even
 *    under concurrent requests for the same quote — the second insert
 *    simply fails the constraint instead of double-executing.
 *  - UNIQUE(client_id, idempotency_key): a retried request with the same
 *    Idempotency-Key header can never create a second trade — the trade
 *    service catches the constraint violation and returns the original
 *    trade instead.
 */
export const trades = pgTable(
  'trades',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    clientId: uuid('client_id')
      .notNull()
      .references(() => clients.id),
    quoteId: uuid('quote_id')
      .notNull()
      .references(() => quotes.id),
    symbol: text('symbol').notNull(),
    side: tradeSideEnum('side').notNull(),
    baseCurrency: text('base_currency').notNull(),
    quoteCurrency: text('quote_currency').notNull(),
    baseAmountMinor: bigint('base_amount_minor', { mode: 'bigint' }).notNull(),
    quoteAmountMinor: bigint('quote_amount_minor', { mode: 'bigint' }).notNull(),
    price: numeric('price', { precision: 38, scale: 18, mode: 'string' }).notNull(),
    status: tradeStatusEnum('status').notNull(),
    idempotencyKey: text('idempotency_key').notNull(),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    uniqueIndex('trades_quote_id_unique').on(table.quoteId),
    uniqueIndex('trades_client_idempotency_key_unique').on(table.clientId, table.idempotencyKey),
    index('trades_client_created_at_idx').on(table.clientId, table.createdAt, table.id),
  ],
);

export type Trade = typeof trades.$inferSelect;
export type NewTrade = typeof trades.$inferInsert;
