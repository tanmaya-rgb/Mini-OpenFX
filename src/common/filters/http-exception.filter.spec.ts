import { describe, expect, it, vi } from 'vitest';
import { BadRequestException, HttpStatus, type ArgumentsHost } from '@nestjs/common';
import { AllExceptionsFilter } from './http-exception.filter.js';
import { InsufficientFundsError } from '../../domain/errors.js';

function makeHost() {
  const json = vi.fn();
  const status = vi.fn().mockReturnValue({ json });
  const response = { status };
  const request = { method: 'POST', url: '/v1/trades' };
  const host = {
    switchToHttp: () => ({ getResponse: () => response, getRequest: () => request }),
  } as unknown as ArgumentsHost;
  return { host, status, json };
}

describe('AllExceptionsFilter', () => {
  it('maps a DomainError to its own status and code', () => {
    const filter = new AllExceptionsFilter();
    const { host, status, json } = makeHost();

    filter.catch(new InsufficientFundsError('BTC'), host);

    expect(status).toHaveBeenCalledWith(HttpStatus.UNPROCESSABLE_ENTITY);
    expect(json).toHaveBeenCalledWith({
      error: { code: 'INSUFFICIENT_FUNDS', message: 'Insufficient BTC balance to execute this trade', details: undefined },
    });
  });

  it('maps a Nest HttpException (e.g. from a built-in pipe) to the same envelope shape', () => {
    const filter = new AllExceptionsFilter();
    const { host, status, json } = makeHost();

    filter.catch(new BadRequestException('bad input'), host);

    expect(status).toHaveBeenCalledWith(HttpStatus.BAD_REQUEST);
    expect(json).toHaveBeenCalledWith({ error: { code: 'BAD_REQUEST', message: 'bad input' } });
  });

  it('maps an unrecognized thrown value to a generic 500 without leaking internals', () => {
    const filter = new AllExceptionsFilter();
    const { host, status, json } = makeHost();

    filter.catch(new Error('some internal detail nobody outside should see'), host);

    expect(status).toHaveBeenCalledWith(HttpStatus.INTERNAL_SERVER_ERROR);
    expect(json).toHaveBeenCalledWith({ error: { code: 'INTERNAL_SERVER_ERROR', message: 'An unexpected error occurred' } });
  });
});
