import { Injectable } from '@nestjs/common';
import bcrypt from 'bcryptjs';
import { UnauthorizedError } from '../../domain/errors.js';
import { ClientsRepository } from './clients.repository.js';
import type { Client } from '../../db/schema/index.js';

/**
 * Turns an `Authorization: Bearer <key>` header into a Client row. Every
 * quote, trade, and balance in the system is scoped to whatever this
 * returns — it's also what makes `(client_id, idempotency_key)` mean
 * anything.
 */
@Injectable()
export class ClientAuthService {
  constructor(private readonly clientsRepository: ClientsRepository) {}

  async authenticate(rawApiKey: string | undefined): Promise<Client> {
    if (!rawApiKey) {
      throw new UnauthorizedError('Missing Authorization header');
    }

    const candidates = await this.clientsRepository.findAll();
    for (const client of candidates) {
      if (await bcrypt.compare(rawApiKey, client.apiKeyHash)) {
        return client;
      }
    }

    throw new UnauthorizedError('Invalid API key');
  }
}
