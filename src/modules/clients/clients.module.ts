import { Module } from '@nestjs/common';
import { ClientsRepository } from './clients.repository.js';
import { ClientAuthService } from './client-auth.service.js';
import { ApiKeyAuthGuard } from './api-key-auth.guard.js';

@Module({
  providers: [ClientsRepository, ClientAuthService, ApiKeyAuthGuard],
  exports: [ClientsRepository, ClientAuthService, ApiKeyAuthGuard],
})
export class ClientsModule {}
