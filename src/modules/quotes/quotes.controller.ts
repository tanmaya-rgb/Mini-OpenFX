import { Body, Controller, Get, Param, Post, UseGuards } from '@nestjs/common';
import { ApiKeyAuthGuard } from '../clients/api-key-auth.guard.js';
import { CurrentClient } from '../clients/current-client.decorator.js';
import { ZodValidationPipe } from '../../common/pipes/zod-validation.pipe.js';
import { QuotesService } from './quotes.service.js';
import { createQuoteSchema, type CreateQuoteDto } from './dto/create-quote.dto.js';
import { presentQuote } from './quote.presenter.js';
import type { Client } from '../../db/schema/index.js';

@Controller('quotes')
@UseGuards(ApiKeyAuthGuard)
export class QuotesController {
  constructor(private readonly quotesService: QuotesService) {}

  @Post()
  async create(@CurrentClient() client: Client, @Body(new ZodValidationPipe(createQuoteSchema)) body: CreateQuoteDto) {
    const quote = await this.quotesService.createQuote(client, body);
    return presentQuote(quote);
  }

  @Get(':id')
  async getById(@CurrentClient() client: Client, @Param('id') id: string) {
    const quote = await this.quotesService.getQuote(client, id);
    return presentQuote(quote);
  }
}
