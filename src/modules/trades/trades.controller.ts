import { Body, Controller, Get, Headers, Param, Post, Query, UseGuards } from '@nestjs/common';
import { ApiKeyAuthGuard } from '../clients/api-key-auth.guard.js';
import { CurrentClient } from '../clients/current-client.decorator.js';
import { ZodValidationPipe } from '../../common/pipes/zod-validation.pipe.js';
import { TradesService } from './trades.service.js';
import { createTradeSchema, type CreateTradeDto } from './dto/create-trade.dto.js';
import { listTradesQuerySchema, type ListTradesQuery } from './dto/list-trades.query.js';
import { presentTrade } from './trade.presenter.js';
import { decodeCursor, encodeCursor } from './trade-cursor.js';
import type { Client } from '../../db/schema/index.js';

@Controller('trades')
@UseGuards(ApiKeyAuthGuard)
export class TradesController {
  constructor(private readonly tradesService: TradesService) {}

  @Post()
  async create(
    @CurrentClient() client: Client,
    @Body(new ZodValidationPipe(createTradeSchema)) body: CreateTradeDto,
    @Headers('idempotency-key') idempotencyKeyHeader: string | undefined,
  ) {
    const idempotencyKey = TradesService.validateIdempotencyKey(idempotencyKeyHeader);
    const trade = await this.tradesService.executeTrade(client, body, idempotencyKey);
    return presentTrade(trade);
  }

  @Get()
  async list(@CurrentClient() client: Client, @Query(new ZodValidationPipe(listTradesQuerySchema)) query: ListTradesQuery) {
    const cursor = query.cursor ? decodeCursor(query.cursor) : undefined;
    const { trades, hasMore } = await this.tradesService.listTrades(client, query.limit, cursor);
    const last = trades.at(-1);
    return {
      data: trades.map(presentTrade),
      next_cursor: hasMore && last ? encodeCursor({ createdAt: last.createdAt, id: last.id }) : null,
    };
  }

  @Get(':id')
  async getById(@CurrentClient() client: Client, @Param('id') id: string) {
    const trade = await this.tradesService.getTrade(client, id);
    return presentTrade(trade);
  }
}
