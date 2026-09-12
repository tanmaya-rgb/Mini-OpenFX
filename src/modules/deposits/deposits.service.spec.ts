import { describe, expect, it, vi } from 'vitest';
import { DepositsService } from './deposits.service.js';
import { BalancesRepository } from '../balances/balances.repository.js';
import { LedgerRepository } from '../ledger/ledger.repository.js';
import type { Client, Balance } from '../../db/schema/index.js';

const CLIENT: Client = { id: 'client-1', name: 'Test', apiKeyHash: 'x', createdAt: new Date() };

function makeDb() {
  return { transaction: vi.fn((cb: (tx: unknown) => unknown) => cb({})) };
}

describe('DepositsService', () => {
  it('credits a currency the client has never held before (no existing balance row)', async () => {
    const db = makeDb();
    const balancesRepository = {
      findForUpdate: vi
        .fn()
        .mockResolvedValueOnce(undefined) // before crediting: no row yet
        .mockResolvedValueOnce({ id: 'bal-1', clientId: CLIENT.id, currency: 'USD', availableMinor: 50000n, updatedAt: new Date() } as Balance), // after
      applyDelta: vi.fn().mockResolvedValue(undefined),
    } as unknown as BalancesRepository;
    const ledgerRepository = { insertDepositEntry: vi.fn().mockResolvedValue(undefined) } as unknown as LedgerRepository;

    const service = new DepositsService(db as never, balancesRepository, ledgerRepository);
    const result = await service.createDeposit(CLIENT, { currency: 'USD', amount: '500' });

    expect(result.availableMinor).toBe(50000n);
    expect(balancesRepository.applyDelta).toHaveBeenCalledWith({}, CLIENT.id, 'USD', 50000n, undefined);
    expect(ledgerRepository.insertDepositEntry).toHaveBeenCalledWith(
      {},
      expect.objectContaining({ clientId: CLIENT.id, currency: 'USD', deltaMinor: 50000n, refType: 'DEPOSIT' }),
    );
  });

  it('adds to an existing balance rather than replacing it', async () => {
    const db = makeDb();
    const existing = { id: 'bal-1', clientId: CLIENT.id, currency: 'USD', availableMinor: 10000n, updatedAt: new Date() } as Balance;
    const balancesRepository = {
      findForUpdate: vi.fn().mockResolvedValueOnce(existing).mockResolvedValueOnce({ ...existing, availableMinor: 60000n }),
      applyDelta: vi.fn().mockResolvedValue(undefined),
    } as unknown as BalancesRepository;
    const ledgerRepository = { insertDepositEntry: vi.fn().mockResolvedValue(undefined) } as unknown as LedgerRepository;

    const service = new DepositsService(db as never, balancesRepository, ledgerRepository);
    await service.createDeposit(CLIENT, { currency: 'USD', amount: '500' });

    expect(balancesRepository.applyDelta).toHaveBeenCalledWith({}, CLIENT.id, 'USD', 50000n, existing);
  });
});
