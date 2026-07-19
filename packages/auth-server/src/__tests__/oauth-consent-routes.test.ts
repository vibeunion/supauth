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
    expect(await missing.json()).toMatchObject({ code: 'oauth_authorization_not_found' });
  });
});
