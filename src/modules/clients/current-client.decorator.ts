import { createParamDecorator, type ExecutionContext } from '@nestjs/common';
import type { AuthenticatedRequest } from './api-key-auth.guard.js';

/**
 * Use as `@CurrentClient() client: Client` in any handler guarded by
 * ApiKeyAuthGuard. Throws (via a non-null request.client) only if the
 * guard didn't run first — a programming error, not a runtime one, since
 * every client-scoped controller applies the guard at the class level.
 */
export const CurrentClient = createParamDecorator((_data: unknown, ctx: ExecutionContext) => {
  const request = ctx.switchToHttp().getRequest<AuthenticatedRequest>();
  return request.client;
});
