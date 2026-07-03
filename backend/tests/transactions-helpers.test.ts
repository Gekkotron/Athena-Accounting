import { describe, it, expect, vi } from 'vitest';
import type { FastifyReply, FastifyRequest } from 'fastify';
import { isPgError, parseId } from '../src/http/routes/transactions/helpers.js';

describe('isPgError', () => {
  it('returns true for objects with a string `code` field (pg-flavored errors)', () => {
    expect(isPgError({ code: '23505' })).toBe(true);
    expect(isPgError({ code: '23503', detail: 'fk violation' })).toBe(true);
  });

  it('returns false for values that lack a string code', () => {
    expect(isPgError(null)).toBe(false);
    expect(isPgError(undefined)).toBe(false);
    expect(isPgError('boom')).toBe(false);
    expect(isPgError({})).toBe(false);
    expect(isPgError({ code: 42 })).toBe(false);  // wrong type
    expect(isPgError(new Error('x'))).toBe(false); // Error has no code
  });

  it('narrows to `{ code: string }` when true (compile-time check via usage)', () => {
    const err: unknown = { code: '23505' };
    if (isPgError(err)) {
      // If this line compiles, the guard successfully narrowed the type.
      expect(err.code.length).toBeGreaterThan(0);
    } else {
      throw new Error('guard did not narrow');
    }
  });
});

describe('parseId', () => {
  function makeReply() {
    const codeFn = vi.fn().mockReturnThis();
    const sendFn = vi.fn().mockReturnThis();
    return { code: codeFn, send: sendFn } as unknown as FastifyReply & {
      code: typeof codeFn;
      send: typeof sendFn;
    };
  }

  it('returns the parsed integer for a valid string param', () => {
    const req = { params: { id: '42' } } as unknown as FastifyRequest;
    const reply = makeReply();
    expect(parseId(req, reply)).toBe(42);
    expect(reply.code).not.toHaveBeenCalled();
    expect(reply.send).not.toHaveBeenCalled();
  });

  it('returns null and replies 400 for a non-numeric id', () => {
    const req = { params: { id: 'not-a-number' } } as unknown as FastifyRequest;
    const reply = makeReply();
    expect(parseId(req, reply)).toBeNull();
    expect(reply.code).toHaveBeenCalledWith(400);
    expect(reply.send).toHaveBeenCalledWith({ error: 'invalid id' });
  });

  it('rejects zero and negative ids (positive constraint)', () => {
    for (const bad of ['0', '-1', '-9999']) {
      const req = { params: { id: bad } } as unknown as FastifyRequest;
      const reply = makeReply();
      expect(parseId(req, reply)).toBeNull();
      expect(reply.code).toHaveBeenCalledWith(400);
    }
  });

  it('rejects a fractional id', () => {
    const req = { params: { id: '3.14' } } as unknown as FastifyRequest;
    const reply = makeReply();
    expect(parseId(req, reply)).toBeNull();
    expect(reply.code).toHaveBeenCalledWith(400);
  });
});
