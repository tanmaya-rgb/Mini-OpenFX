import { Module } from '@nestjs/common';
import { LedgerRepository } from './ledger.repository.js';

@Module({
  providers: [LedgerRepository],
  exports: [LedgerRepository],
})
export class LedgerModule {}
