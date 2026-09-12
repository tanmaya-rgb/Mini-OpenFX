import { Injectable, type CanActivate, type ExecutionContext } from '@nestjs/common';
import type { Request } from 'express';
import { ClientAuthService } from './client-auth.service.js';
import type { Client } from '../../db/schema/index.js';

export interface AuthenticatedRequest extends Request {
  client: Client;
}

/**
 * Applied per-controller with `@UseGuards(ApiKeyAuthGuard)` on every
 * endpoint that reads or writes client-scoped data (quotes, trades,
 * balances). Health and prices stay unguarded — they carry no client
 * state. On success, attaches the authenticated Client to the request so
 * `@CurrentClient()` (see current-client.decorator.ts) can pull it out in
 * controller handlers without repeating the header-parsing logic.
 */
@Injectable()
export class ApiKeyAuthGuard implements CanActivate {
  constructor(private readonly clientAuthService: ClientAuthService) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const request = context.switchToHttp().getRequest<AuthenticatedRequest>();
    const apiKey = extractBearerToken(request.headers.authorization);
    request.client = await this.clientAuthService.authenticate(apiKey);
    return true;
  }
}

function extractBearerToken(header: string | undefined): string | undefined {
  if (!header) return undefined;
  const [scheme, token] = header.split(' ');
  return scheme === 'Bearer' ? token : undefined;
}
