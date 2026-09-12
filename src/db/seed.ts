/**
 * Seeds one "institutional client" so the API can be exercised end to end
 * without a real onboarding/funding flow (see plan: "add one way to fund
 * balances"). Run with: npm run db:seed
 *
 * Idempotent-ish: re-running it won't duplicate the client if one with the
 * same name already exists, and balances are set (not incremented) so you
 * can reseed to reset state during local development.
 */
import 'dotenv/config';
import bcrypt from 'bcryptjs';
import postgres from 'postgres';
import { drizzle } from 'drizzle-orm/postgres-js';
import { eq } from 'drizzle-orm';
import * as schema from './schema/index.js';
import { CURRENCY_DECIMALS } from '../domain/currencies.js';
import { toMinorUnits } from '../domain/money.js';

const SEED_CLIENT_NAME = 'Local Dev Client';

// Generous starting balances so trades of realistic size can be demoed
// immediately after seeding.
const STARTING_BALANCES: Record<keyof typeof CURRENCY_DECIMALS, string> = {
  USD: '100000',
  USDT: '100000',
  BTC: '5',
  ETH: '50',
  EUR: '50000',
};

async function main() {
  const databaseUrl = process.env.DATABASE_URL;
  const apiKey = process.env.SEED_CLIENT_API_KEY;
  if (!databaseUrl) throw new Error('DATABASE_URL is not set');
  if (!apiKey) throw new Error('SEED_CLIENT_API_KEY is not set');

  const client = postgres(databaseUrl, { max: 1 });
  const db = drizzle(client, { schema });

  try {
    const existing = await db.query.clients.findFirst({
      where: eq(schema.clients.name, SEED_CLIENT_NAME),
    });

    const apiKeyHash = await bcrypt.hash(apiKey, 10);

    const clientRow =
      existing ??
      (
        await db
          .insert(schema.clients)
          .values({ name: SEED_CLIENT_NAME, apiKeyHash })
          .returning()
      )[0];

    if (existing) {
      // Keep the hash in sync in case SEED_CLIENT_API_KEY changed in .env.
      await db.update(schema.clients).set({ apiKeyHash }).where(eq(schema.clients.id, clientRow.id));
    }

    for (const [currency, humanAmount] of Object.entries(STARTING_BALANCES)) {
      const availableMinor = toMinorUnits(humanAmount, currency);

      const existingBalance = await db.query.balances.findFirst({
        where: (b, { and, eq: eqOp }) => and(eqOp(b.clientId, clientRow.id), eqOp(b.currency, currency)),
      });

      if (existingBalance) {
        await db.update(schema.balances).set({ availableMinor, updatedAt: new Date() }).where(eq(schema.balances.id, existingBalance.id));
      } else {
        await db.insert(schema.balances).values({ clientId: clientRow.id, currency, availableMinor });
      }

      // A DEPOSIT reason ledger entry justifies the seeded balance, so the
      // ledger stays the source of truth even for seed data.
      await db.insert(schema.ledgerEntries).values({
        clientId: clientRow.id,
        currency,
        deltaMinor: availableMinor,
        reason: 'DEPOSIT',
        refType: 'SEED',
        refId: clientRow.id,
      });
    }

    console.log('Seed complete.');
    console.log(`  client_id: ${clientRow.id}`);
    console.log(`  name:      ${clientRow.name}`);
    console.log(`  Send requests with: Authorization: Bearer ${apiKey}`);
  } finally {
    await client.end();
  }
}

await main();
