import { describe, it, expect } from 'vitest';
import { notifications } from '../src/db/schema.js';

describe('notifications table', () => {
  it('exposes the expected columns', () => {
    const cols = Object.keys(notifications);
    expect(cols).toEqual(expect.arrayContaining([
      'id', 'userId', 'kind', 'payload', 'readAt', 'createdAt', 'idempotency',
    ]));
  });
});
