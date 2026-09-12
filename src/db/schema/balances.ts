import { sql } from 'drizzle-orm';
import { bigint, pgTable, text, timestamp, uniqueIndex, uuid } from 'drizzle-orm/pg-core';
import { clients } from './clients.js';

/**
 * Cached "current balance" per (client, currency) — fast reads for
 * GET /v1/balances. This is NOT the source of truth: ledger_entries is.
 * Every write to this table happens inside the same transaction as the
 * ledger_entries insert that justifies it, so the two never drift.
 *
 * available_minor is a signed bigint in the currency's minor units (see
 * domain/currencies.ts for the decimals-per-currency table). Drizzle's
 * `bigint({ mode: 'bigint' })` maps this to a JS bigint rather than
 * `number`, which matters once BTC amounts get large enough in minor
 * units (8 decimals) to risk floating-point precision loss.
 */
export const balances = pgTable(
  'balances',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    clientId: uuid('client_id')
      .notNull()
      .references(() => clients.id),
    currency: text('currency').notNull(),
    availableMinor: bigint('available_minor', { mode: 'bigint' })
      .notNull()
      .default(sql`0`),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [uniqueIndex('balances_client_currency_unique').on(table.clientId, table.currency)],
);

export type Balance = typeof balances.$inferSelect;
export type NewBalance = typeof balances.$inferInsert;
