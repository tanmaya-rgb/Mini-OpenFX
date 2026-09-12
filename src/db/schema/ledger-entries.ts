import { bigint, index, pgTable, text, timestamp, uuid } from 'drizzle-orm/pg-core';
import { clients } from './clients.js';
import { ledgerReasonEnum } from './enums.js';

/**
 * The source of truth for every money movement. Balances are derived from
 * this table (and cached in `balances` for fast reads) — nothing ever
 * mutates a balance directly without a corresponding ledger entry.
 *
 * A trade always produces exactly two rows: a negative delta on the
 * currency the client pays, and a positive delta on the currency they
 * receive (see the worked example in the README). ref_type/ref_id point
 * back at the trade (or deposit) that caused the entry, so the ledger can
 * be replayed/audited independently of the trades table.
 */
export const ledgerEntries = pgTable(
  'ledger_entries',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    clientId: uuid('client_id')
      .notNull()
      .references(() => clients.id),
    currency: text('currency').notNull(),
    deltaMinor: bigint('delta_minor', { mode: 'bigint' }).notNull(),
    reason: ledgerReasonEnum('reason').notNull(),
    refType: text('ref_type').notNull(),
    refId: uuid('ref_id').notNull(),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [index('ledger_entries_client_currency_idx').on(table.clientId, table.currency)],
);

export type LedgerEntry = typeof ledgerEntries.$inferSelect;
export type NewLedgerEntry = typeof ledgerEntries.$inferInsert;
