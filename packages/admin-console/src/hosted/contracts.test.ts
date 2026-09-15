import { describe, expect, test } from 'bun:test';
import {
  accountResponses, ClaimInputSchema, ClaimResultSchema, ChangePasswordResultSchema,
  decodeSchema, parsePasswordPolicy, readContract, sdkEndpoints, validateAccountRequest,
  AuthorizationSchema, SignupResultSchema, RecoverResultSchema,
} from './contracts.js';

describe('hosted shared contract consumption', () => {
  test('requires an authorization decision or complete consent details', () => {
    for (const value of [{}, { redirect_url: '' }, { client: {}, scope: 'openid' }]) {
      expect(() => decodeSchema(AuthorizationSchema, value)).toThrow();
    }
    expect(decodeSchema(AuthorizationSchema, { redirect_url: 'https://app.example.test/callback?code=code' }))
      .toHaveProperty('redirect_url');
    expect(decodeSchema(AuthorizationSchema, {
      authorization_id: 'authorization', redirect_uri: 'https://app.example.test/callback', scope: 'openid email',
      client: { id: 'client', name: 'App', uri: '', logo_uri: '' }, user: { id: 'user', email: 'user@example.test' },
    })).toHaveProperty('client.id', 'client');
    expect(decodeSchema(AuthorizationSchema, {
      authorization_id: 'authorization', client: { id: 'client' }, user: { id: 'user' },
    })).toHaveProperty('client.id', 'client');
  });

  test('checks signup user/session variants and the exact empty recovery acknowledgement', async () => {
    const user = {
      id: 'user', aud: 'authenticated', app_metadata: {}, user_metadata: {}, created_at: '2026-09-08T00:00:00Z',
    };
    expect(decodeSchema(SignupResultSchema, user)).toEqual(user);
    expect(decodeSchema(SignupResultSchema, {
      user, access_token: 'access', refresh_token: 'refresh', token_type: 'bearer', expires_in: 3600,
    })).toHaveProperty('user.id', 'user');
    for (const value of [{}, { success: true }, { user, access_token: 'access' }]) {
      expect(() => decodeSchema(SignupResultSchema, value)).toThrow();
    }
    await expect(readContract(Response.json({}), RecoverResultSchema)).resolves.toEqual({});
    for (const value of [null, [], { error: 'rejected' }]) {
      await expect(readContract(Response.json(value), RecoverResultSchema)).rejects.toThrow();
    }
  });

  test('uses the SDK public endpoint schema and rejects malformed public responses', async () => {
    await expect(readContract(Response.json({ branding: { primary_color: 42 } }), sdkEndpoints.resolvePublicSignInExperience.result))
      .rejects.toThrow('Hosted API response does not match its contract');
    await expect(readContract(Response.json({ language_tag: 'en', phrases: { title: 'Sign In' } }), sdkEndpoints.getPublicPhrases.result))
      .resolves.toMatchObject({ phrases: { title: 'Sign In' } });
  });

  test('requires complete password policy flags and bounded lengths', () => {
    expect(parsePasswordPolicy({ min_length: 8 })).toBeNull();
    expect(parsePasswordPolicy({ min_length: 128, require_uppercase: true, require_lowercase: true, require_numbers: true, require_symbols: true }))
      .toMatchObject({ min_length: 128 });
    expect(parsePasswordPolicy({ min_length: 129, require_uppercase: true, require_lowercase: true, require_numbers: true, require_symbols: true })).toBeNull();
  });

  test('preserves one-time claim responses and requires explicit password-change success', () => {
    const claimed = { success: true as const, status: 'claimed', email: 'test@example.test', initial_password: 'one-time' };
    expect(decodeSchema(ClaimResultSchema, claimed)).toEqual(claimed);
    expect(decodeSchema(ClaimResultSchema, { success: true, status: 'claimed', email: 'test@example.test', password_set: true }))
      .toHaveProperty('password_set', true);
    expect(() => decodeSchema(ChangePasswordResultSchema, { success: true })).toThrow();
    expect(() => decodeSchema(ClaimInputSchema, { external_id: '123', new_password: undefined })).toThrow();
  });

  test('checks account write body and method without replaying or coercing', () => {
    expect(() => validateAccountRequest('/account/profile', { method: 'PATCH', body: '{"data":{"name":"Updated"}}' })).not.toThrow();
    expect(() => validateAccountRequest('/account/profile', { method: 'PATCH', body: '{"data":{"name":42}}' })).toThrow();
    expect(() => validateAccountRequest('/account/profile', { method: 'GET' })).toThrow();
    expect(() => validateAccountRequest('/account/grants/app-1', { method: 'DELETE' })).not.toThrow();
    expect(() => validateAccountRequest('/account', { method: 'DELETE', body: '{"confirmation":"YES"}' })).toThrow();
  });

  test('requires MFA upgraded session tokens and list envelopes', () => {
    expect(() => decodeSchema(accountResponses.verification, { success: true, session: { access_token: 'access' } })).toThrow();
    expect(decodeSchema(accountResponses.verification, { success: true, session: { access_token: 'access', refresh_token: 'refresh' } }))
      .toHaveProperty('session.refresh_token', 'refresh');
    expect(() => decodeSchema(accountResponses.items, { success: true, items: {} })).toThrow();
    expect(() => decodeSchema(accountResponses.user, { success: true, user: {} })).toThrow();
  });
});
