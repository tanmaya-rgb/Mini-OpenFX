import { Injectable, type CanActivate } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { NotFoundError } from '../../domain/errors.js';
import type { Env } from '../../config/env.schema.js';

/**
 * Gates POST /v1/deposits behind ENABLE_DEV_DEPOSITS. This is a stand-in
 * for a real funding flow (wire transfer confirmation, card top-up,
 * whatever) — it exists purely so this assignment can be demoed end to
 * end without a real one. Throwing NotFoundError rather than
 * ForbiddenException is deliberate: with the flag off, the route should
 * look like it doesn't exist rather than advertise "there's a funding
 * endpoint here, but you're not allowed to use it."
 */
@Injectable()
export class DevDepositsGuard implements CanActivate {
  constructor(private readonly config: ConfigService<Env, true>) {}

  canActivate(): boolean {
    if (!this.config.get('ENABLE_DEV_DEPOSITS', { infer: true })) {
      throw new NotFoundError('Route');
    }
    return true;
  }
}
