import { afterEach, describe, expect, mock, spyOn, test } from 'bun:test';
import {
  assertOAuthSessionGrants, SupaOAuthClient, SupaOAuthSessionConfigurationError,
} from '../index.js';

function mockTransport(transport: (...args: Parameters<typeof fetch>) => ReturnType<typeof fetch>) {
  return spyOn(globalThis, 'fetch').mockImplementation(
    Object.assign(transport, { preconnect: globalThis.fetch.preconnect }),
  );
}

describe('explicit OAuth session requirements', () => {
  afterEach(() => mock.restore());
  test('a refreshable client requires both grants without mutating its configuration', () => {
    const client = Object.freeze({
      grant_types: Object.freeze(['authorization_code']),
      client_type: 'public', token_endpoint_auth_method: 'none',
      redirect_uris: Object.freeze(['https://app.example.test/auth/callback']),
    });
    expect(() => assertOAuthSessionGrants(client, 'refreshable')).toThrow(SupaOAuthSessionConfigurationError);
    try { assertOAuthSessionGrants(client, 'refreshable'); } catch (error: unknown) {
      expect(error).toMatchObject({ reason: 'missing_grant', missingGrants: ['refresh_token'] });
    }
    expect(client.grant_types).toEqual(['authorization_code']);
    expect(() => assertOAuthSessionGrants(client, 'authorization-code')).not.toThrow();
    expect(() => assertOAuthSessionGrants({
      grant_types: ['refresh_token'],
    }, 'refreshable')).toThrow('authorization_code');
    expect(() => assertOAuthSessionGrants({
      ...client, grant_types: ['authorization_code', 'refresh_token'],
    }, 'refreshable')).not.toThrow();
  });

  test('malformed or absent authoritative grants fail closed without leaking response data', () => {
    for (const client of [null, {}, [], { grant_types: null }, { grant_types: 'private-value' },
      { grant_types: ['authorization_code', 123], client_secret: 'private-value' }]) {
      let failure: unknown;
      try { assertOAuthSessionGrants(client, 'refreshable'); } catch (error: unknown) { failure = error; }
      expect(failure).toMatchObject({ code: 'SUPAUTH_SESSION_CONFIGURATION_INVALID', reason: 'invalid_grant_types' });
      expect(String(failure)).not.toContain('private-value');
    }
    expect(() => assertOAuthSessionGrants({ grant_types: [] }, 'refreshable')).toThrow('authorization_code, refresh_token');
    expect(() => Reflect.apply(assertOAuthSessionGrants, undefined, [{ grant_types: [] }, 'unknown']))
      .toThrow(SupaOAuthSessionConfigurationError);
  });

  test('create and update guards reject before transport, including partial updates', () => {
    const fetcher = mockTransport(async () => Response.json({ client_id: 'app' }));
    const sdk = new SupaOAuthClient({ baseUrl: 'https://auth.example.test' });
    const input = { redirect_uris: ['https://app.example.test/auth/callback'], grant_types: ['authorization_code'] };
    expect(() => sdk.createApplication(input, { sessionRequirement: 'refreshable' })).toThrow(SupaOAuthSessionConfigurationError);
    expect(() => sdk.updateApplication('app', input, { sessionRequirement: 'refreshable' })).toThrow(SupaOAuthSessionConfigurationError);
    expect(() => sdk.updateApplication('app', { client_name: 'Renamed' }, { sessionRequirement: 'refreshable' })).toThrow(SupaOAuthSessionConfigurationError);
    expect(fetcher).not.toHaveBeenCalled();
  });

  test('valid guarded writes preserve the exact payload and do not serialize local requirements', async () => {
    const requests: RequestInit[] = [];
    mockTransport(async (_url, init) => {
      requests.push(init ?? {});
      return Response.json({ client_id: 'app' });
    });
    const sdk = new SupaOAuthClient({ baseUrl: 'https://auth.example.test' });
    const input = {
      client_type: 'public' as const, token_endpoint_auth_method: 'none' as const,
      redirect_uris: ['https://app.example.test/auth/callback'],
      grant_types: ['authorization_code', 'refresh_token'],
    };
    await sdk.createApplication(input, { sessionRequirement: 'refreshable' });
    await sdk.updateApplication('app', input, { sessionRequirement: 'refreshable' });
    expect(requests.map((request) => request.method)).toEqual(['POST', 'PUT']);
    for (const request of requests) expect(request.body).toBe(JSON.stringify(input));
  });

  test('existing callers do not silently gain refresh grants or extra requests', async () => {
    const bodies: Array<BodyInit | null | undefined> = [];
    mockTransport(async (_url, init) => {
      bodies.push(init?.body); return Response.json({ client_id: 'app' });
    });
    const sdk = new SupaOAuthClient({ baseUrl: 'https://auth.example.test' });
    const input = { name: 'Legacy', type: 'spa' as const, redirect_uris: ['https://app.example.test/auth/callback'], grant_types: ['authorization_code'] };
    await sdk.createApplication(input);
    await sdk.updateApplication('app', { client_name: 'Renamed' });
    expect(bodies).toEqual([JSON.stringify(input), JSON.stringify({ client_name: 'Renamed' })]);
  });

  test('preflight validates authoritative client grants without issuing a write', async () => {
    const fetcher = mockTransport(async () => Response.json({
      client_id: 'app', grant_types: ['authorization_code'],
    }));
    const sdk = new SupaOAuthClient({ baseUrl: 'https://auth.example.test' });
    const application = await sdk.getApplication('app');
    expect(() => assertOAuthSessionGrants(application, 'refreshable')).toThrow('refresh_token');
    expect(fetcher).toHaveBeenCalledTimes(1);
    expect(fetcher.mock.calls[0]?.[0]).toBe('https://auth.example.test/v1/applications/app');
    expect(fetcher.mock.calls[0]?.[1]?.method).toBeUndefined();
  });
});
