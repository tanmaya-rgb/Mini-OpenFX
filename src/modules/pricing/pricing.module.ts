import { Module } from '@nestjs/common';
import { PricingController } from './pricing.controller.js';
import { PricingService, PRICING_PROVIDER } from './pricing.service.js';
import { PriceCacheService } from './price-cache.service.js';
import { BinancePricingProvider } from './binance-pricing.provider.js';

@Module({
  controllers: [PricingController],
  providers: [
    PricingService,
    PriceCacheService,
    BinancePricingProvider,
    { provide: PRICING_PROVIDER, useExisting: BinancePricingProvider },
  ],
  exports: [PricingService],
})
export class PricingModule {}
