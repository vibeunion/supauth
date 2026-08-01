import { afterAll, beforeEach, describe, expect, it, mock } from 'bun:test';
import { Elysia } from 'elysia';

const recordOAuthConsentDecision = mock(async () => undefined);
const logAudit = mock(async () => undefined);

mock.module('../repositories/consents.js', () => ({ recordOAuthConsentDecision }));
mock.module('../repositories/audit.js', () => ({ logAudit }));

process.env.OAUTH_RUNTIME_URL = 'https://gotrue.example.test';
process.env.OAUTH_RUNTIME_INTERNAL_URL = 'https://gotrue.example.test';
process.env.SUPAUTH_PUBLIC_URL = 'https://auth.example.test';

const originalFetch = globalThis.fetch;
const { loadConfig } = await import('../config/index.js');
loadConfig();
const { publicOAuthRoutes } = await import('../routes/sign-in-experience.js');

function oauthRequest(path: string, init?: RequestInit) {
  const app = new Elysia().use(publicOAuthRoutes);
  const headers = new Headers(init?.headers);
  headers.set('Authorization', 'Bearer user-access-token');
  return app.handle(new Request(`https://auth.example.test/v1/public/oauth${path}`, {
    ...init,
    headers,
  }));
}

function responseWithBodyError(error: unknown) {
  return new Response(new ReadableStream<Uint8Array>({
    start(controller) {
      controller.error(error);
    },
  }), { status: 200 });
}

describe('stock GoTrue OAuth consent BFF', () => {
  beforeEach(() => {
    recordOAuthConsentDecision.mockClear();
    logAudit.mockClear();
  });

  afterAll(() => {
    globalThis.fetch = originalFetch;
  });

  it('loads details before submitting and records a successful explicit approval', async () => {
    const calls: Array<{ path: string; method: string; body: string }> = [];
    globalThis.fetch = mock(async (input: string | URL | Request, init?: RequestInit) => {
      const url = new URL(String(input));
      calls.push({
        path: url.pathname,
        method: init?.method || 'GET',
        body: String(init?.body || ''),
      });
      if (init?.method === 'POST') {
        return Response.json({ redirect_url: 'https://client.example.test/callback?code=one' });
      }
      return Response.json({
        authorization_id: 'authorization-one',
        client: { id: '11111111-1111-4111-8111-111111111111', name: 'Client One' },
        user: { id: '22222222-2222-4222-8222-222222222222' },
        scope: 'openid profile',
      });
    }) as unknown as typeof fetch;

    const response = await oauthRequest('/authorizations/authorization-one/consent', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ action: 'approve' }),
    });

    expect(response.status).toBe(200);
    expect(calls).toEqual([
      {
        path: '/auth/v1/oauth/authorizations/authorization-one',
        method: 'GET',
        body: '',
      },
      {
        path: '/auth/v1/oauth/authorizations/authorization-one/consent',
        method: 'POST',
        body: JSON.stringify({ action: 'approve' }),
      },
    ]);
    expect(recordOAuthConsentDecision).toHaveBeenCalledWith({
      authorizationId: 'authorization-one',
      userId: '22222222-2222-4222-8222-222222222222',
      applicationId: '11111111-1111-4111-8111-111111111111',
      requestedScopes: ['openid', 'profile'],
      decision: 'approved',
    });
    expect(logAudit).toHaveBeenCalledTimes(1);
  });

  it('returns GoTrue auto-approval without posting another consent decision', async () => {
    const methods: string[] = [];
    globalThis.fetch = mock((_input: string | URL | Request, init?: RequestInit) => {
      methods.push(init?.method || 'GET');
      return Promise.resolve(Response.json({
        redirect_url: 'https://client.example.test/callback?code=existing',
      }));
    }) as unknown as typeof fetch;

    const response = await oauthRequest('/authorizations/authorization-existing/consent', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ action: 'approve' }),
    });

    expect(response.status).toBe(200);
    expect(methods).toEqual(['GET']);
    expect(recordOAuthConsentDecision).not.toHaveBeenCalled();
  });

  it('forwards denial and preserves an upstream not-found response', async () => {
    let mode: 'deny' | 'missing' = 'deny';
    const bodies: string[] = [];
    globalThis.fetch = mock((_input: string | URL | Request, init?: RequestInit) => {
      if (mode === 'missing') {
        return Promise.resolve(Response.json(
          { code: 'oauth_authorization_not_found', message: 'authorization not found' },
          { status: 404 },
        ));
      }
      if (init?.method === 'POST') {
        bodies.push(String(init.body));
        return Promise.resolve(Response.json({ redirect_url: 'https://client.example.test/callback?error=access_denied' }));
      }
      return Promise.resolve(Response.json({
        client: { id: '33333333-3333-4333-8333-333333333333' },
        user: { id: '44444444-4444-4444-8444-444444444444' },
        scope: 'openid',
      }));
    }) as unknown as typeof fetch;

    const denied = await oauthRequest('/authorizations/authorization-denied/consent', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ action: 'deny' }),
    });
    expect(denied.status).toBe(200);
    expect(bodies).toEqual([JSON.stringify({ action: 'deny' })]);
    expect(recordOAuthConsentDecision).toHaveBeenCalledWith(expect.objectContaining({ decision: 'denied' }));

    mode = 'missing';
    const missing = await oauthRequest('/authorizations/authorization-missing');
    expect(missing.status).toBe(404);
    expect(await missing.json()).toEqual({
      error: 'upstream_not_found',
      error_description: 'Authentication resource was not found.',
    });
  });

  it('sanitizes the same upstream response matrix for lookup and consent', async () => {
    const failureCases = [
      { status: 400, expectedStatus: 400, lookupCode: 'gotrue_authorization_lookup_failed', consentCode: 'gotrue_consent_failed' },
      { status: 401, expectedStatus: 401, lookupCode: 'invalid_token', consentCode: 'invalid_token' },
      { status: 403, expectedStatus: 403, lookupCode: 'upstream_forbidden', consentCode: 'upstream_forbidden' },
      { status: 404, expectedStatus: 404, lookupCode: 'upstream_not_found', consentCode: 'upstream_not_found' },
      { status: 429, expectedStatus: 429, lookupCode: 'upstream_rate_limited', consentCode: 'upstream_rate_limited' },
      { status: 500, expectedStatus: 502, lookupCode: 'runtime_unavailable', consentCode: 'runtime_unavailable' },
    ];

    for (const operation of ['lookup', 'consent'] as const) {
      for (const failureCase of failureCases) {
        globalThis.fetch = mock((_input: string | URL | Request, init?: RequestInit) => {
          if (operation === 'consent' && init?.method !== 'POST') {
            return Promise.resolve(Response.json({
              client: { id: 'client-one' },
              user: { id: 'user-one' },
              scope: 'openid',
            }));
          }
          return Promise.resolve(Response.json({
            code: 'private_upstream_code',
            message: 'postgres://secret@auth.internal:5432/private',
          }, { status: failureCase.status }));
        }) as unknown as typeof fetch;

        const response = operation === 'lookup'
          ? await oauthRequest('/authorizations/matrix-lookup')
          : await oauthRequest('/authorizations/matrix-consent/consent', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ action: 'approve' }),
          });
        const body = await response.json() as Record<string, unknown>;

        expect(response.status).toBe(failureCase.expectedStatus);
        expect(body.error).toBe(operation === 'lookup' ? failureCase.lookupCode : failureCase.consentCode);
        expect(JSON.stringify(body)).not.toContain('auth.internal');
        expect(JSON.stringify(body)).not.toContain('secret');
        expect(JSON.stringify(body)).not.toContain('private_upstream_code');
      }
    }
  });

  it('sanitizes lookup and consent transport failures with timeout distinction', async () => {
    const transportCases = [
      {
        error: new TypeError('getaddrinfo ENOTFOUND auth.internal?token=secret'),
        status: 502,
        code: 'runtime_unavailable',
      },
      {
        error: new DOMException('auth.internal timed out with token=secret', 'TimeoutError'),
        status: 504,
        code: 'runtime_timeout',
      },
    ];

    for (const operation of ['lookup', 'consent'] as const) {
      for (const transportCase of transportCases) {
        globalThis.fetch = mock((_input: string | URL | Request, init?: RequestInit) => {
          if (operation === 'consent' && init?.method !== 'POST') {
            return Promise.resolve(Response.json({
              client: { id: 'client-one' },
              user: { id: 'user-one' },
              scope: 'openid',
            }));
          }
          return Promise.reject(transportCase.error);
        }) as unknown as typeof fetch;

        const response = operation === 'lookup'
          ? await oauthRequest('/authorizations/transport-lookup')
          : await oauthRequest('/authorizations/transport-consent/consent', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ action: 'approve' }),
          });
        const body = await response.json() as Record<string, unknown>;

        expect(response.status).toBe(transportCase.status);
        expect(body.error).toBe(transportCase.code);
        expect(JSON.stringify(body)).not.toContain('auth.internal');
        expect(JSON.stringify(body)).not.toContain('secret');
      }
    }
  });

  it('maps a response-body timeout to the same sanitized timeout contract', async () => {
    globalThis.fetch = mock(async () => responseWithBodyError(
      new DOMException('auth.internal private body detail', 'TimeoutError'),
    )) as unknown as typeof fetch;

    const response = await oauthRequest('/authorizations/body-timeout');
    const body = await response.json() as Record<string, unknown>;

    expect(response.status).toBe(504);
    expect(body.error).toBe('runtime_timeout');
    expect(JSON.stringify(body)).not.toContain('auth.internal');
    expect(JSON.stringify(body)).not.toContain('private');
  });
});
