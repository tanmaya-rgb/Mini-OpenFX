import { Inject, Injectable } from '@nestjs/common';
import { and, eq } from 'drizzle-orm';
import { DRIZZLE, type Database } from '../../db/db.module.js';
import { balances, type Balance } from '../../db/schema/index.js';

/**
 * Every method that mutates a balance takes an explicit `tx` (the active
 * Drizzle transaction from TradesService) rather than the module-level
 * `db` — balances must only ever change inside the same transaction as
 * the ledger entries that justify the change (see TradesService). Only
 * the plain read used by GET /v1/balances runs outside a transaction.
 */
@Injectable()
export class BalancesRepository {
  constructor(@Inject(DRIZZLE) private readonly db: Database) {}

  listForClient(clientId: string): Promise<Balance[]> {
    return this.db.select().from(balances).where(eq(balances.clientId, clientId));
  }

  /** Locks the (client, currency) row for the duration of the caller's transaction. Returns undefined if the client has never held this currency. */
  findForUpdate(tx: Database, clientId: string, currency: string): Promise<Balance | undefined> {
    return tx
      .select()
      .from(balances)
      .where(and(eq(balances.clientId, clientId), eq(balances.currency, currency)))
      .for('update')
      .then((rows) => rows[0]);
  }

  /**
   * Applies a signed delta to a balance, creating the row at `delta` if
   * the client has never held this currency before (only valid for a
   * positive delta — callers are expected to have already verified a
   * sufficient existing balance before applying a negative delta, via
   * findForUpdate).
   */
  async applyDelta(tx: Database, clientId: string, currency: string, deltaMinor: bigint, existing: Balance | undefined): Promise<void> {
    if (existing) {
      await tx
        .update(balances)
        .set({ availableMinor: existing.availableMinor + deltaMinor, updatedAt: new Date() })
        .where(eq(balances.id, existing.id));
    } else {
      await tx.insert(balances).values({ clientId, currency, availableMinor: deltaMinor });
    }
  }
}
