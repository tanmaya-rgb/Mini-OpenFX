import { describe, expect, it, vi } from 'vitest';
import bcrypt from 'bcryptjs';
import { ClientAuthService } from './client-auth.service.js';
import { ClientsRepository } from './clients.repository.js';
import { UnauthorizedError } from '../../domain/errors.js';
import type { Client } from '../../db/schema/index.js';

async function makeClient(rawKey: string, overrides: Partial<Client> = {}): Promise<Client> {
  return {
    id: 'client-1',
    name: 'Test',
    apiKeyHash: await bcrypt.hash(rawKey, 4), // low cost factor for fast tests
    createdAt: new Date(),
    ...overrides,
  };
}

describe('ClientAuthService', () => {
  it('rejects a missing key without querying the repository', async () => {
    const repo = { findAll: vi.fn() } as unknown as ClientsRepository;
    const service = new ClientAuthService(repo);

    await expect(service.authenticate(undefined)).rejects.toBeInstanceOf(UnauthorizedError);
    expect(repo.findAll).not.toHaveBeenCalled();
  });

  it('authenticates when the raw key matches a client\'s stored hash', async () => {
    const client = await makeClient('correct-key');
    const repo = { findAll: vi.fn().mockResolvedValue([client]) } as unknown as ClientsRepository;
    const service = new ClientAuthService(repo);

    const result = await service.authenticate('correct-key');
    expect(result.id).toBe(client.id);
  });

  it('rejects a key that does not match any client', async () => {
    const client = await makeClient('correct-key');
    const repo = { findAll: vi.fn().mockResolvedValue([client]) } as unknown as ClientsRepository;
    const service = new ClientAuthService(repo);

    await expect(service.authenticate('wrong-key')).rejects.toBeInstanceOf(UnauthorizedError);
  });

  it('picks the correct client out of several candidates', async () => {
    const clientA = await makeClient('key-a', { id: 'a' });
    const clientB = await makeClient('key-b', { id: 'b' });
    const repo = { findAll: vi.fn().mockResolvedValue([clientA, clientB]) } as unknown as ClientsRepository;
    const service = new ClientAuthService(repo);

    const result = await service.authenticate('key-b');
    expect(result.id).toBe('b');
  });
});
