import { describe, expect, it } from 'vitest';
import { decodeCursor, encodeCursor } from './trade-cursor.js';
import { ValidationError } from '../../domain/errors.js';

describe('trade cursor', () => {
  it('round-trips createdAt and id through encode/decode', () => {
    const createdAt = new Date('2026-01-01T00:00:00.000Z');
    const encoded = encodeCursor({ createdAt, id: 'abc-123' });
    const decoded = decodeCursor(encoded);

    expect(decoded.id).toBe('abc-123');
    expect(decoded.createdAt.toISOString()).toBe(createdAt.toISOString());
  });

  it('is opaque base64url, not a readable JSON string', () => {
    const encoded = encodeCursor({ createdAt: new Date(), id: 'abc-123' });
    expect(encoded).not.toContain('{');
    expect(encoded).not.toContain('abc-123');
  });

  it('rejects garbage input as a ValidationError rather than throwing a raw parse error', () => {
    expect(() => decodeCursor('not-a-real-cursor!!!')).toThrow(ValidationError);
  });

  it('rejects a validly-encoded but malformed payload (missing id)', () => {
    const badPayload = Buffer.from(JSON.stringify({ createdAt: new Date().toISOString() })).toString('base64url');
    expect(() => decodeCursor(badPayload)).toThrow(ValidationError);
  });
});
