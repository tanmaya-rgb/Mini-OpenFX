import { pgEnum } from 'drizzle-orm/pg-core';

export const tradeSideEnum = pgEnum('trade_side', ['BUY', 'SELL']);

export const quoteStatusEnum = pgEnum('quote_status', ['ACTIVE', 'EXPIRED', 'EXECUTED']);

export const tradeStatusEnum = pgEnum('trade_status', ['FILLED', 'REJECTED']);

export const ledgerReasonEnum = pgEnum('ledger_reason', ['DEPOSIT', 'TRADE']);
