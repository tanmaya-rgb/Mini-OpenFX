import { HttpStatus } from '@nestjs/common';

/**
 * Domain-level errors that carry their own HTTP status. Services throw
 * these; a single exception filter (see common/filters) turns them into
 * the API's consistent error response shape. This keeps HTTP concerns out
 * of the service layer while still giving each failure mode the right
 * status code (400/404/409/410/422/502/503) instead of everything
 * collapsing to 500.
 */
export class DomainError extends Error {
  constructor(
    public readonly code: string,
    message: string,
    public readonly status: HttpStatus,
    public readonly details?: unknown,
  ) {
    super(message);
    this.name = this.constructor.name;
  }
}

export class ValidationError extends DomainError {
  constructor(message: string, details?: unknown) {
    super('VALIDATION_ERROR', message, HttpStatus.BAD_REQUEST, details);
  }
}

export class UnauthorizedError extends DomainError {
  constructor(message = 'Missing or invalid API key') {
    super('UNAUTHORIZED', message, HttpStatus.UNAUTHORIZED);
  }
}

export class NotFoundError extends DomainError {
  constructor(resource: string) {
    super('NOT_FOUND', `${resource} not found`, HttpStatus.NOT_FOUND);
  }
}

export class QuoteExpiredError extends DomainError {
  constructor(quoteId: string) {
    super('QUOTE_EXPIRED', `Quote ${quoteId} has expired`, HttpStatus.GONE);
  }
}

export class QuoteAlreadyExecutedError extends DomainError {
  constructor(quoteId: string) {
    super('QUOTE_ALREADY_EXECUTED', `Quote ${quoteId} has already been executed`, HttpStatus.CONFLICT);
  }
}

export class IdempotencyConflictError extends DomainError {
  constructor(message = 'Idempotency-Key was already used with a different request') {
    super('IDEMPOTENCY_CONFLICT', message, HttpStatus.CONFLICT);
  }
}

export class InsufficientFundsError extends DomainError {
  constructor(currency: string) {
    super('INSUFFICIENT_FUNDS', `Insufficient ${currency} balance to execute this trade`, HttpStatus.UNPROCESSABLE_ENTITY);
  }
}

export class PricingProviderError extends DomainError {
  constructor(message: string, retryable = true) {
    super('PRICING_PROVIDER_ERROR', message, retryable ? HttpStatus.SERVICE_UNAVAILABLE : HttpStatus.BAD_GATEWAY);
  }
}
