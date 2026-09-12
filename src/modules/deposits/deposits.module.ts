import { Module } from '@nestjs/common';
import { ClientsModule } from '../clients/clients.module.js';
import { BalancesModule } from '../balances/balances.module.js';
import { LedgerModule } from '../ledger/ledger.module.js';
import { DepositsController } from './deposits.controller.js';
import { DepositsService } from './deposits.service.js';
import { DevDepositsGuard } from './dev-deposits.guard.js';

@Module({
  imports: [ClientsModule, BalancesModule, LedgerModule],
  controllers: [DepositsController],
  providers: [DepositsService, DevDepositsGuard],
})
export class DepositsModule {}
