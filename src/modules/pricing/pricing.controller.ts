import { Controller, Get, Query } from '@nestjs/common';
import { PricingService } from './pricing.service.js';
import { ZodValidationPipe } from '../../common/pipes/zod-validation.pipe.js';
import { getPriceQuerySchema, type GetPriceQuery } from './dto/get-price.query.js';

@Controller('prices')
export class PricingController {
  constructor(private readonly pricingService: PricingService) {}

  @Get()
  async getPrice(@Query(new ZodValidationPipe(getPriceQuerySchema)) query: GetPriceQuery) {
    return this.pricingService.getIndicativePrice(query.symbol);
  }
}
