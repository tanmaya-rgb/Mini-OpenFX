import { ValidationError } from '../../domain/errors.js';

interface Cursor {
  createdAt: Date;
  id: string;
}

/**
 * Keyset ("seek") pagination cursor, opaque to the client. Encodes the
 * last row's (created_at, id) — see trades.repository.ts for why both
 * fields are needed (created_at alone isn't unique enough to seek past
 * ties). Deliberately NOT offset-based pagination: OFFSET re-numbers rows
 * on every request, so inserting a new trade while a client is paging
 * through history silently duplicates or skips a row for them — keyset
 * pagination has no such failure mode because every page is defined
 * relative to a real row, not a row count.
 */
export function encodeCursor(row: Cursor): string {
  return Buffer.from(JSON.stringify({ createdAt: row.createdAt.toISOString(), id: row.id })).toString('base64url');
}

export function decodeCursor(cursor: string): Cursor {
  try {
    const parsed = JSON.parse(Buffer.from(cursor, 'base64url').toString('utf8')) as { createdAt: string; id: string };
    const createdAt = new Date(parsed.createdAt);
    if (Number.isNaN(createdAt.getTime()) || typeof parsed.id !== 'string' || !parsed.id) {
      throw new Error('malformed cursor payload');
    }
    return { createdAt, id: parsed.id };
  } catch {
    throw new ValidationError('Invalid cursor');
  }
}
