import { describe, expect, test } from 'bun:test';
import { decodeCreatedUser, decodeOAuthReply, decodeTokenReply } from '../scripts/compat-session-contract.js';
import { decodeCompatibilityUsers } from '../scripts/supabase-management-api.js';

describe('compatibility response boundaries', () => {
  test.each([[], 1, 'token', { redirect_url: 3 }, { error: false }].map(value => ({ value })))(
    'rejects invalid consent responses %#', ({ value }) => {
      expect(() => decodeOAuthReply(value)).toThrow();
    },
  );

  test.each([[], { access_token: 3 }, { refresh_token: false }, { access_token: '' }].map(value => ({ value })))(
    'rejects invalid token responses %#', ({ value }) => {
      expect(() => decodeTokenReply(value)).toThrow();
    },
  );

  test('preserves explicit failure and compatible successful envelopes', () => {
    expect(decodeOAuthReply(null)).toBeNull();
    expect(decodeOAuthReply({ error: 'access_denied' })).toEqual({ error: 'access_denied' });
    expect(decodeTokenReply({ access_token: 'access', refresh_token: 'refresh' }))
      .toEqual({ access_token: 'access', refresh_token: 'refresh' });
    expect(decodeCreatedUser({ user: { id: 'user-1' } })).toEqual({ user: { id: 'user-1' } });
    expect(() => decodeCreatedUser({ user: { id: 3 } })).toThrow();
  });

  test.each([null, [], {}, { items: {} }, { users: [null] }, { data: [{ id: 3 }] }, { items: [{ id: '1', email: false }] }].map(value => ({ value })))(
    'rejects malformed user list envelopes %#', ({ value }) => {
      expect(() => decodeCompatibilityUsers(value)).toThrow();
    },
  );

  test.each(['items', 'users', 'data'])('accepts the %s envelope', key => {
    expect(decodeCompatibilityUsers({ [key]: [{ id: 'user-1', email: 'user@example.test' }] }))
      .toEqual([{ id: 'user-1', email: 'user@example.test' }]);
    expect(decodeCompatibilityUsers({ [key]: [] })).toEqual([]);
  });
});
