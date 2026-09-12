import { Module } from '@nestjs/common';
import { ClientsModule } from '../clients/clients.module.js';
import { BalancesController } from './balances.controller.js';
import { BalancesRepository } from './balances.repository.js';

@Module({
  imports: [ClientsModule],
  controllers: [BalancesController],
  providers: [BalancesRepository],
  exports: [BalancesRepository],
})
export class BalancesModule {}
