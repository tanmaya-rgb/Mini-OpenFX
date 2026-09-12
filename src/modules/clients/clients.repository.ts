import { Inject, Injectable } from '@nestjs/common';
import type { Database } from '../../db/db.module.js';
import { DRIZZLE } from '../../db/db.constants.js';
import { clients, type Client } from '../../db/schema/index.js';

/**
 * All direct DB access for `clients` lives here — services depend on this
 * repository, never on Drizzle directly. For this assignment's scope
 * (a single seeded client) `findAll` is a full table scan, which is fine;
 * a real multi-tenant version of this would add a fast, non-secret
 * lookup key (e.g. a key ID prefix) so auth doesn't need to bcrypt-compare
 * against every client — noted here rather than over-building it.
 */
@Injectable()
export class ClientsRepository {
  constructor(@Inject(DRIZZLE) private readonly db: Database) {}

  findAll(): Promise<Client[]> {
    return this.db.select().from(clients);
  }

  findById(id: string): Promise<Client | undefined> {
    return this.db.query.clients.findFirst({ where: (c, { eq }) => eq(c.id, id) });
  }
}
