import { Injectable } from '@nestjs/common';
import type { Database } from '../../db/db.module.js';
import { ledgerEntries } from '../../db/schema/index.js';

interface LedgerLine {
  clientId: string;
  currency: string;
  deltaMinor: bigint;
  refType: string;
  refId: string;
}

/**
 * The source of truth for money movement (see db/schema/ledger-entries.ts).
 * Every write here takes the caller's active transaction (`tx`) — ledger
 * rows are never inserted standalone, always alongside the balance update
 * and trade/deposit row they justify, in the same transaction.
 */
@Injectable()
export class LedgerRepository {
  async insertTradeEntries(tx: Database, debit: LedgerLine, credit: LedgerLine): Promise<void> {
    await tx.insert(ledgerEntries).values([
      { ...debit, reason: 'TRADE' },
      { ...credit, reason: 'TRADE' },
    ]);
  }

  async insertDepositEntry(tx: Database, line: LedgerLine): Promise<void> {
    await tx.insert(ledgerEntries).values({ ...line, reason: 'DEPOSIT' });
  }
}
