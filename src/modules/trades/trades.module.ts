import { Module } from '@nestjs/common';
import { ClientsModule } from '../clients/clients.module.js';
import { QuotesModule } from '../quotes/quotes.module.js';
import { BalancesModule } from '../balances/balances.module.js';
import { LedgerModule } from '../ledger/ledger.module.js';
import { TradesController } from './trades.controller.js';
import { TradesService } from './trades.service.js';
import { TradesRepository } from './trades.repository.js';

@Module({
  imports: [ClientsModule, QuotesModule, BalancesModule, LedgerModule],
  controllers: [TradesController],
  providers: [TradesService, TradesRepository],
  exports: [TradesRepository],
})
export class TradesModule {}
