import { pgTable, text, timestamp, uuid } from 'drizzle-orm/pg-core';

/**
 * Who is calling the API. Everything else (balances, quotes, trades,
 * ledger entries) is scoped to a client_id, and idempotency is scoped to
 * (client_id, idempotency_key) — so this table exists even though the
 * assignment only needs a single seeded client to demo end to end.
 *
 * We never store the raw API key, only a hash of it (bcrypt) — the auth
 * guard hashes the incoming Bearer token and compares.
 */
export const clients = pgTable('clients', {
  id: uuid('id').primaryKey().defaultRandom(),
  name: text('name').notNull(),
  apiKeyHash: text('api_key_hash').notNull(),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
});

export type Client = typeof clients.$inferSelect;
export type NewClient = typeof clients.$inferInsert;
