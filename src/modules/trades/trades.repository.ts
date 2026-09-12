import { Inject, Injectable } from '@nestjs/common';
import { and, desc, eq, lt, or } from 'drizzle-orm';
import postgres from 'postgres';
import { DRIZZLE, type Database } from '../../db/db.module.js';
import { trades, type NewTrade, type Trade } from '../../db/schema/index.js';

export const UNIQUE_VIOLATION = '23505';

@Injectable()
export class TradesRepository {
  constructor(@Inject(DRIZZLE) private readonly db: Database) {}

  findByIdempotencyKey(clientId: string, idempotencyKey: string): Promise<Trade | undefined> {
    return this.db.query.trades.findFirst({
      where: and(eq(trades.clientId, clientId), eq(trades.idempotencyKey, idempotencyKey)),
    });
  }

  findByIdForClient(id: string, clientId: string): Promise<Trade | undefined> {
    return this.db.query.trades.findFirst({
      where: and(eq(trades.id, id), eq(trades.clientId, clientId)),
    });
  }

  async create(tx: Database, values: NewTrade): Promise<Trade> {
    const [row] = await tx.insert(trades).values(values).returning();
    return row;
  }

  /** Keyset pagination on (created_at, id) descending — see modules/trades/trades.service.ts for the cursor format. */
  async listForClient(clientId: string, limit: number, cursor?: { createdAt: Date; id: string }): Promise<Trade[]> {
    const conditions = [eq(trades.clientId, clientId)];
    if (cursor) {
      // "Strictly older than the cursor row" — createdAt earlier, or the
      // same instant with a lower id as a tiebreaker, which is why the
      // index is on (client_id, created_at, id) rather than created_at alone.
      conditions.push(
        or(
          lt(trades.createdAt, cursor.createdAt),
          and(eq(trades.createdAt, cursor.createdAt), lt(trades.id, cursor.id)),
        )!,
      );
    }
    return this.db
      .select()
      .from(trades)
      .where(and(...conditions))
      .orderBy(desc(trades.createdAt), desc(trades.id))
      .limit(limit);
  }

  isUniqueViolation(error: unknown, constraintName?: string): boolean {
    if (!(error instanceof postgres.PostgresError)) return false;
    if (error.code !== UNIQUE_VIOLATION) return false;
    return constraintName ? error.constraint_name === constraintName : true;
  }
}
