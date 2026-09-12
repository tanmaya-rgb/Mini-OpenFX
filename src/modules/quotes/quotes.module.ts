import { Module } from '@nestjs/common';
import { ClientsModule } from '../clients/clients.module.js';
import { PricingModule } from '../pricing/pricing.module.js';
import { QuotesController } from './quotes.controller.js';
import { QuotesService } from './quotes.service.js';
import { QuotesRepository } from './quotes.repository.js';

@Module({
  imports: [ClientsModule, PricingModule],
  controllers: [QuotesController],
  providers: [QuotesService, QuotesRepository],
  exports: [QuotesRepository],
})
export class QuotesModule {}
