import { Controller, Get, UseGuards } from '@nestjs/common';
import { ApiKeyAuthGuard } from '../clients/api-key-auth.guard.js';
import { CurrentClient } from '../clients/current-client.decorator.js';
import { BalancesRepository } from './balances.repository.js';
import { presentBalance } from './balance.presenter.js';
import type { Client } from '../../db/schema/index.js';

@Controller('balances')
@UseGuards(ApiKeyAuthGuard)
export class BalancesController {
  constructor(private readonly balancesRepository: BalancesRepository) {}

  @Get()
  async list(@CurrentClient() client: Client) {
    const balances = await this.balancesRepository.listForClient(client.id);
    return { data: balances.map(presentBalance) };
  }
}
