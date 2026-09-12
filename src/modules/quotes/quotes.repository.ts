import { Inject, Injectable } from '@nestjs/common';
import { and, eq } from 'drizzle-orm';
import { DRIZZLE, type Database } from '../../db/db.module.js';
import { quotes, type NewQuote, type Quote } from '../../db/schema/index.js';

@Injectable()
export class QuotesRepository {
  constructor(@Inject(DRIZZLE) private readonly db: Database) {}

  async create(values: NewQuote): Promise<Quote> {
    const [row] = await this.db.insert(quotes).values(values).returning();
    return row;
  }

  findByIdForClient(id: string, clientId: string): Promise<Quote | undefined> {
    return this.db.query.quotes.findFirst({
      where: and(eq(quotes.id, id), eq(quotes.clientId, clientId)),
    });
  }

  /**
   * Locks the quote row for the duration of the caller's transaction —
   * used by trade execution so two concurrent requests for the same
   * quote serialize instead of racing (the second blocks here until the
   * first's transaction commits or rolls back, then sees the up-to-date
   * status).
   */
  findByIdForClientForUpdate(tx: Database, id: string, clientId: string): Promise<Quote | undefined> {
    return tx
      .select()
      .from(quotes)
      .where(and(eq(quotes.id, id), eq(quotes.clientId, clientId)))
      .for('update')
      .then((rows) => rows[0]);
  }

  async markExpired(id: string, tx?: Database): Promise<void> {
    await (tx ?? this.db).update(quotes).set({ status: 'EXPIRED' }).where(eq(quotes.id, id));
  }

  async markExecuted(id: string, tx: Database): Promise<void> {
    await tx.update(quotes).set({ status: 'EXECUTED' }).where(eq(quotes.id, id));
  }
}
