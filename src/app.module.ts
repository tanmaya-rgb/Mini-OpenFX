import { Module } from '@nestjs/common';
import { ConfigModule } from './config/config.module.js';
import { DbModule } from './db/db.module.js';
import { RedisModule } from './redis/redis.module.js';
import { HealthModule } from './modules/health/health.module.js';
import { PricingModule } from './modules/pricing/pricing.module.js';
import { ClientsModule } from './modules/clients/clients.module.js';
import { QuotesModule } from './modules/quotes/quotes.module.js';
import { BalancesModule } from './modules/balances/balances.module.js';
import { LedgerModule } from './modules/ledger/ledger.module.js';
import { TradesModule } from './modules/trades/trades.module.js';
import { DepositsModule } from './modules/deposits/deposits.module.js';

@Module({
  imports: [
    ConfigModule,
    DbModule,
    RedisModule,
    HealthModule,
    PricingModule,
    ClientsModule,
    QuotesModule,
    BalancesModule,
    LedgerModule,
    TradesModule,
    DepositsModule,
  ],
})
export class AppModule {}
