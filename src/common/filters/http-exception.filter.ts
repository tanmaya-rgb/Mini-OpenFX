import { ArgumentsHost, Catch, ExceptionFilter, HttpException, HttpStatus, Logger } from '@nestjs/common';
import type { Request, Response } from 'express';
import { DomainError } from '../../domain/errors.js';

interface ErrorBody {
  error: {
    code: string;
    message: string;
    details?: unknown;
  };
}

/**
 * Every error response from this API has the same shape, regardless of
 * where it came from: a DomainError thrown by a service, a Nest built-in
 * HttpException (e.g. from ValidationPipe), or an unexpected exception.
 * That consistency is one of the "mandatory" requirements in the brief
 * ("proper error responses"), so it's centralized here instead of being
 * left to each controller.
 */
@Catch()
export class AllExceptionsFilter implements ExceptionFilter {
  private readonly logger = new Logger('ExceptionFilter');

  catch(exception: unknown, host: ArgumentsHost): void {
    const ctx = host.switchToHttp();
    const response = ctx.getResponse<Response>();
    const request = ctx.getRequest<Request>();

    const { status, body } = this.toErrorResponse(exception);

    if (status >= 500) {
      this.logger.error(`${request.method} ${request.url} -> ${status}`, exception instanceof Error ? exception.stack : String(exception));
    }

    response.status(status).json(body);
  }

  private toErrorResponse(exception: unknown): { status: number; body: ErrorBody } {
    if (exception instanceof DomainError) {
      return {
        status: exception.status,
        body: { error: { code: exception.code, message: exception.message, details: exception.details } },
      };
    }

    if (exception instanceof HttpException) {
      const status = exception.getStatus();
      const response = exception.getResponse();
      const message =
        typeof response === 'string' ? response : ((response as { message?: string | string[] }).message ?? exception.message);
      return {
        status,
        body: {
          error: {
            code: HttpStatus[status] ?? 'HTTP_ERROR',
            message: Array.isArray(message) ? message.join('; ') : message,
          },
        },
      };
    }

    return {
      status: HttpStatus.INTERNAL_SERVER_ERROR,
      body: { error: { code: 'INTERNAL_SERVER_ERROR', message: 'An unexpected error occurred' } },
    };
  }
}
