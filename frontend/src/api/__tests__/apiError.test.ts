import { describe, it, expect } from 'vitest';
import { ApiError } from '../apiError';

describe('ApiError', () => {
  it('is an instance of Error and carries a name of "ApiError"', () => {
    const err = new ApiError('boom', 500, null);
    expect(err).toBeInstanceOf(Error);
    expect(err).toBeInstanceOf(ApiError);
    expect(err.name).toBe('ApiError');
  });

  it('exposes the message via Error.message', () => {
    const err = new ApiError('not found', 404, null);
    expect(err.message).toBe('not found');
  });

  it('preserves the numeric status code', () => {
    const err = new ApiError('unauthorized', 401, null);
    expect(err.status).toBe(401);
  });

  it('preserves the parsed response body verbatim as data', () => {
    const body = { error: 'nope', details: ['a', 'b'] };
    const err = new ApiError('nope', 400, body);
    expect(err.data).toBe(body);
  });

  it('accepts null and non-object shapes for data (raw text bodies, empty bodies)', () => {
    expect(new ApiError('x', 500, null).data).toBeNull();
    expect(new ApiError('x', 500, 'plain text').data).toBe('plain text');
    expect(new ApiError('x', 500, undefined).data).toBeUndefined();
  });

  it('is catchable as Error and its properties survive rethrow', () => {
    let caught: unknown;
    try {
      throw new ApiError('rethrown', 503, { retryAfter: 5 });
    } catch (e) {
      caught = e;
    }
    expect(caught).toBeInstanceOf(ApiError);
    expect((caught as ApiError).status).toBe(503);
    expect((caught as ApiError).data).toEqual({ retryAfter: 5 });
  });
});
