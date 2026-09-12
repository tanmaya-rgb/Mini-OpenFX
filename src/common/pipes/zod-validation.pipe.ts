import { Injectable, type PipeTransform } from '@nestjs/common';
import type { ZodType } from 'zod';
import { ValidationError } from '../../domain/errors.js';

/**
 * Bridges Zod schemas into Nest's pipe system. We use Zod rather than
 * class-validator + DTO classes for request validation across this app —
 * one schema per endpoint, colocated with its module (see each module's
 * dto folder) — because the same schemas double as the source for
 * generated OpenAPI docs later (step: bonus deploy/docs) without needing
 * decorator duplication.
 *
 * On failure this throws our own ValidationError (400) rather than
 * Nest's BadRequestException, so it comes out through the same error
 * envelope as every other domain error (see common/filters).
 */
@Injectable()
export class ZodValidationPipe<T> implements PipeTransform {
  constructor(private readonly schema: ZodType<T>) {}

  transform(value: unknown): T {
    const result = this.schema.safeParse(value);
    if (!result.success) {
      throw new ValidationError(
        'Request validation failed',
        result.error.issues.map((issue) => ({ path: issue.path.join('.'), message: issue.message })),
      );
    }
    return result.data;
  }
}
