import { Body, Controller, Post, UseGuards } from '@nestjs/common';
import { ApiKeyAuthGuard } from '../clients/api-key-auth.guard.js';
import { CurrentClient } from '../clients/current-client.decorator.js';
import { ZodValidationPipe } from '../../common/pipes/zod-validation.pipe.js';
import { DevDepositsGuard } from './dev-deposits.guard.js';
import { DepositsService } from './deposits.service.js';
import { createDepositSchema, type CreateDepositDto } from './dto/create-deposit.dto.js';
import { presentBalance } from '../balances/balance.presenter.js';
import type { Client } from '../../db/schema/index.js';

/**
 * Dev/demo only — see dev-deposits.guard.ts. Order matters: ApiKeyAuthGuard
 * runs first (so an unauthenticated caller gets 401, not a 404 that leaks
 * whether dev deposits are enabled), then DevDepositsGuard.
 */
@Controller('deposits')
@UseGuards(ApiKeyAuthGuard, DevDepositsGuard)
export class DepositsController {
  constructor(private readonly depositsService: DepositsService) {}

  @Post()
  async create(@CurrentClient() client: Client, @Body(new ZodValidationPipe(createDepositSchema)) body: CreateDepositDto) {
    const balance = await this.depositsService.createDeposit(client, body);
    return presentBalance(balance);
  }
}
