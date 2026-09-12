import { randomUUID } from 'node:crypto';
import { Inject, Injectable } from '@nestjs/common';
import { DRIZZLE, type Database } from '../../db/db.module.js';
import type { Client, Balance } from '../../db/schema/index.js';
import { toMinorUnits } from '../../domain/money.js';
import { BalancesRepository } from '../balances/balances.repository.js';
import { LedgerRepository } from '../ledger/ledger.repository.js';
import type { CreateDepositDto } from './dto/create-deposit.dto.js';

/**
 * Credits a client's balance directly, with a DEPOSIT ledger entry
 * justifying it — the same "ledger is the source of truth, balance is a
 * derived cache" pattern as trade execution, just simpler (one currency,
 * one direction, no quote to lock). See dev-deposits.guard.ts for why
 * this endpoint exists at all and why it's gated.
 */
@Injectable()
export class DepositsService {
  constructor(
    @Inject(DRIZZLE) private readonly db: Database,
    private readonly balancesRepository: BalancesRepository,
    private readonly ledgerRepository: LedgerRepository,
  ) {}

  async createDeposit(client: Client, input: CreateDepositDto): Promise<Balance> {
    const amountMinor = toMinorUnits(input.amount, input.currency);
    const depositId = randomUUID();

    return this.db.transaction(async (tx) => {
      const existingBalance = await this.balancesRepository.findForUpdate(tx, client.id, input.currency);

      await this.ledgerRepository.insertDepositEntry(tx, {
        clientId: client.id,
        currency: input.currency,
        deltaMinor: amountMinor,
        refType: 'DEPOSIT',
        refId: depositId,
      });

      await this.balancesRepository.applyDelta(tx, client.id, input.currency, amountMinor, existingBalance);

      const updated = await this.balancesRepository.findForUpdate(tx, client.id, input.currency);
      // Guaranteed to exist: we just created or credited it above.
      return updated as Balance;
    });
  }
}
