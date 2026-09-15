import { describe, expect, test } from 'bun:test';
import { Elysia } from 'elysia';
import { accountEndpoints, accountRouteContract, HookClaimsSchema, BeforeSignupRequestSchema, BeforeSignupPayloadSchema, AccessTokenRequestSchema, AccessTokenPayloadSchema } from '../../../shared/src/server-account.js';
import { decodeSchema, type Static } from '../../../shared/src/schema.js';
import { accountContract, accountOutput, readAccountInput, readAccountNormalization } from '../utils/account-contract.js';
import { validateServerResponse } from '../utils/server-contract.js';

describe('account domain contract boundaries', () => {
  test('accounts for all 40 declarations and classifies retired and signed endpoints', () => {
    expect(Object.keys(accountEndpoints)).toHaveLength(40);
    expect(Object.values(accountEndpoints).filter(endpoint => 'retired' in endpoint)).toHaveLength(5);
    expect(Object.values(accountEndpoints).filter(endpoint => endpoint.request === 'raw-signed')).toHaveLength(2);
    for (const name of Object.keys(accountEndpoints) as Array<keyof typeof accountEndpoints>) {
      const options = accountContract(name, { detail: { summary: name } });
      expect(options.detail['x-supauth-contract'].source).toBe(`server-account:${name}`);
      expect(options.detail['x-supauth-input-schema']).toBe(accountEndpoints[name].input);
    }
  });

  test('every declared successful domain rejects native JSON responses of the wrong shape', async () => {
    for (const name of Object.keys(accountEndpoints) as Array<keyof typeof accountEndpoints>) {
      if ('retired' in accountEndpoints[name]) continue;
      await expect(validateServerResponse(accountRouteContract(name), Response.json('not a domain object', {
        status: name === 'authorize' ? 302 : 200,
      }))).rejects.toMatchObject({ status: 502, code: 'invalid_upstream_response' });
    }
  });

  test('a success handler cannot bypass its declared input validation', async () => {
    const unvalidated = new Elysia().get('/account', () => ({ success: true, user: { id: 'user' } }),
      accountContract('me', { detail: {} }));
    expect((await unvalidated.handle(new Request('http://localhost/account'))).status).toBe(502);

    const validated = new Elysia().get('/account', ({ request }) => {
      readAccountInput('me', request, {});
      return accountOutput('me', { success: true, user: { id: 'user' } });
    }, accountContract('me', { detail: {} }));
    expect((await validated.handle(new Request('http://localhost/account'))).status).toBe(200);
  });

  test('validation receipts are scoped to each request and endpoint', async () => {
    const request = new Request('http://localhost/account');
    readAccountInput('me', request, {});
    await expect(accountContract('identities', { detail: {} }).afterHandle({
      request, set: {}, responseValue: { success: true, items: [], total: 0 },
    })).rejects.toMatchObject({ code: 'unvalidated_account_request' });
    await expect(accountContract('me', { detail: {} }).afterHandle({
      request: new Request(request), set: {}, responseValue: { success: true, user: { id: 'user' } },
    })).rejects.toMatchObject({ code: 'unvalidated_account_request' });
  });

  test('normalization schemas preserve typed protocol boundaries and reject undefined', () => {
    const request = new Request('http://localhost/account');
    const result = readAccountNormalization('password', request, {
      email: 'user@example.test', currentPassword: 'old-test-password', newPassword: 'new-test-password',
    });
    const email: string = result.email;
    // @ts-expect-error schema reader must retain its concrete field type.
    const wrong: number = result.email;
    void wrong;
    expect(email).toBe('user@example.test');
    expect(() => readAccountNormalization('enrollment', request, { friendly_name: 'Authenticator', issuer: undefined })).toThrow();
    expect(accountContract('password', {}).detail['x-supauth-normalized-input']).toBeDefined();
    const profile = accountContract('profile', {});
    expect(profile.detail['x-supauth-contract'].request).toBe('protocol');
    expect(profile.detail['x-supauth-normalized-input']).toBeDefined();
    expect(readAccountNormalization('profile', request, { nickname: 'Alice', age: 20 })).toEqual({ nickname: 'Alice', age: 20 });
    expect(() => readAccountNormalization('profile', request, { nickname: ['Alice'] })).toThrow();
  });

  test('preserves supported OAuth identity claims and metadata extensions', () => {
    const claims = {
      sub: 'user', role: 'authenticated', client_id: 'client', azp: 'client', scope: 'openid profile',
      app_metadata: { provider: 'email', app_specific_key: ['kept'] },
      user_metadata: { custom_profile_field: true },
    } satisfies Static<typeof HookClaimsSchema>;
    expect(decodeSchema(HookClaimsSchema, claims)).toEqual(claims);
    expect(() => decodeSchema(HookClaimsSchema, { ...claims, client_id: 7 })).toThrow();
  });

  test('known action domains cannot be replaced with an arbitrary object', () => {
    expect(() => accountOutput('revokeGrant', { success: true, result: { unrelated: true } })).toThrow();
    expect(accountOutput('revokeGrant', { success: true, result: {} })).toEqual({ success: true, result: {} });
    expect(() => accountOutput('me', { success: true, user: { id: 1 } })).toThrow();
  });

  test('legacy hook request containers do not weaken normalized payloads or JSON validation', () => {
    expect(decodeSchema(BeforeSignupRequestSchema, { metadata: null })).toEqual({ metadata: null });
    expect(decodeSchema(BeforeSignupRequestSchema, [])).toEqual([]);
    expect(() => decodeSchema(BeforeSignupPayloadSchema, { metadata: null })).toThrow();
    expect(() => decodeSchema(BeforeSignupRequestSchema, [{ ignored: undefined }])).toThrow();
    expect(() => decodeSchema(BeforeSignupRequestSchema, { metadata: [new Map()] })).toThrow();
    const payload = { claims: { sub: 'user', role: 'authenticated', app_metadata: null } } satisfies Static<typeof AccessTokenRequestSchema>;
    expect(decodeSchema(AccessTokenRequestSchema, payload)).toEqual(payload);
    expect(() => decodeSchema(AccessTokenPayloadSchema, payload)).toThrow();
    expect(() => decodeSchema(HookClaimsSchema, payload.claims)).toThrow();
    expect(() => decodeSchema(AccessTokenRequestSchema, { claims: { ...payload.claims, exp: 'invalid' } })).toThrow();
    expect(() => decodeSchema(AccessTokenRequestSchema, { claims: { ...payload.claims, custom: undefined } })).toThrow();
  });
});
