import { afterEach, beforeEach, describe, expect, it, spyOn } from 'bun:test';
import { Elysia } from 'elysia';
import { loadConfig } from '../config/index.js';

process.env['OAUTH_RUNTIME_URL'] = 'https://runtime.invalid';
process.env['OAUTH_RUNTIME_INTERNAL_URL'] = 'https://runtime.invalid';
process.env['SUPAUTH_PUBLIC_URL'] = 'https://auth.invalid';
const config = loadConfig();
const { changePasswordWithGoTrue } = await import('../routes/account-password.js');
const { publicOAuthRoutes, resolvePublicSignInExperience, getAuthConfigRuntimeConsistency } = await import('../routes/sign-in-experience.js');
const { getSupaCloudAdapter } = await import('../supacloud/adapter.js');

const originalFetch = globalThis.fetch;
const input = {
  email: 'strict@example.test',
  currentPassword: 'synthetic-current-fixture',
  newPassword: 'synthetic-new-fixture',
};
const grant = { access_token: 'synthetic-token-fixture', user: { id: 'strict-user' } };
const authorization = {
  authorization_id: 'strict-authorization',
  client: { id: '11111111-1111-4111-8111-111111111111', name: 'Strict Client' },
  user: { id: '22222222-2222-4222-8222-222222222222' },
  scope: 'openid profile',
};

beforeEach(() => {
  config.oauthRuntimeUrl = 'https://runtime.invalid';
  config.oauthRuntimeInternalUrl = 'https://runtime.invalid';
  config.publicBaseUrl = 'https://auth.invalid';
});
afterEach(() => {
  globalThis.fetch = originalFetch;
});

function oauthRequest(consent = false): Promise<Response> {
  return new Elysia().use(publicOAuthRoutes).handle(new Request(
    `https://auth.invalid/v1/public/oauth/authorizations/strict-authorization${consent ? '/consent' : ''}`,
    {
      method: consent ? 'POST' : 'GET',
      headers: { Authorization: 'Bearer synthetic-user-fixture', 'Content-Type': 'application/json' },
      ...(consent ? { body: JSON.stringify({ action: 'approve' }) } : {}),
    },
  ));
}

function malformedResponses(): Array<() => Response> {
  return [
    () => Response.json(null),
    () => Response.json([]),
    () => Response.json(42),
    () => new Response('{', { headers: { 'Content-Type': 'application/json' } }),
  ];
}

describe('actual upstream reader compatibility', () => {
  it('reports missing sign-in experience explicitly instead of asserting away null', async () => {
    await expect(resolvePublicSignInExperience(undefined, {
      getExperience: async () => null,
      getConnectors: async () => [],
      getAuthConfig: async () => ({ password_min_length: 8, password_required_characters: '' }),
    })).rejects.toMatchObject({ status: 503, code: 'sign_in_experience_unavailable' });
  });
  it('rejects malformed password grants before mutation or audit', async () => {
    for (const response of malformedResponses()) {
      let calls = 0;
      let audited = false;
      const fetchImpl = Object.assign(async () => {
        calls++;
        return response();
      }, { preconnect() {} });
      const result = await changePasswordWithGoTrue(input, {
        fetchImpl,
        runtimeBaseUrls: ['https://runtime.invalid'],
        auditImpl: async () => { audited = true; },
      });
      expect(result).toMatchObject({ ok: false, status: 502, code: 'invalid_upstream_response' });
      expect(calls).toBe(1);
      expect(audited).toBe(false);
    }
  });

  it('rejects malformed password update receipts without reporting audit success', async () => {
    for (const response of malformedResponses()) {
      let calls = 0;
      let audited = false;
      const fetchImpl = Object.assign(async () => {
        calls++;
        return calls === 1 ? Response.json(grant) : response();
      }, { preconnect() {} });
      const result = await changePasswordWithGoTrue(input, {
        fetchImpl,
        runtimeBaseUrls: ['https://runtime.invalid'],
        auditImpl: async () => { audited = true; },
      });
      expect(result).toMatchObject({ ok: false, status: 502, code: 'invalid_upstream_response' });
      expect(calls).toBe(2);
      expect(audited).toBe(false);
    }
  });

  it('retains empty 204 password-update success', async () => {
    let calls = 0;
    let audited = false;
    const fetchImpl = Object.assign(async () => {
      calls++;
      return calls === 1 ? Response.json(grant) : new Response(null, { status: 204 });
    }, { preconnect() {} });
    const result = await changePasswordWithGoTrue(input, {
      fetchImpl,
      runtimeBaseUrls: ['https://runtime.invalid'],
      auditImpl: async () => { audited = true; },
    });
    expect(result).toMatchObject({ ok: true, userId: 'strict-user' });
    expect(audited).toBe(true);
  });

  it('does not replay a password PUT with an unknown transport result', async () => {
    for (const error of [
      new TypeError('synthetic-private-transport-detail'),
      new DOMException('synthetic-private-transport-detail', 'TimeoutError'),
    ]) {
      const requests: Array<{ url: string; method: string | undefined }> = [];
      let audited = false;
      const fetchImpl = Object.assign(async (target: string | URL | Request, init?: RequestInit) => {
        const url = target instanceof Request ? target.url : String(target);
        requests.push({ url, method: init?.method });
        if (init?.method === 'POST') return Response.json(grant);
        throw error;
      }, { preconnect() {} });
      const result = await changePasswordWithGoTrue(input, {
        fetchImpl,
        runtimeBaseUrls: ['https://one.invalid', 'https://two.invalid'],
        auditImpl: async () => { audited = true; },
      });
      expect(result).toMatchObject({
        ok: false, code: 'password_update_outcome_unknown',
        status: error.name === 'TimeoutError' ? 504 : 502,
      });
      expect(requests).toEqual([
        { url: 'https://one.invalid/auth/v1/token?grant_type=password', method: 'POST' },
        { url: 'https://one.invalid/auth/v1/user', method: 'PUT' },
      ]);
      expect(audited).toBe(false);
      expect(JSON.stringify(result)).not.toContain('synthetic-private-transport-detail');
    }
  });

  it('binds the password PUT to the runtime that successfully granted the token', async () => {
    const requests: Array<{ url: string; method: string | undefined }> = [];
    let audited = false;
    const fetchImpl = Object.assign(async (target: string | URL | Request, init?: RequestInit) => {
      const url = target instanceof Request ? target.url : String(target);
      requests.push({ url, method: init?.method });
      if (url.startsWith('https://internal.invalid/')) throw new TypeError('Unavailable');
      return init?.method === 'POST' ? Response.json(grant) : new Response(null, { status: 204 });
    }, { preconnect() {} });
    const result = await changePasswordWithGoTrue(input, {
      fetchImpl,
      runtimeBaseUrls: ['https://internal.invalid', 'https://public.invalid'],
      auditImpl: async () => { audited = true; },
    });
    expect(result).toMatchObject({ ok: true, userId: 'strict-user' });
    expect(requests).toEqual([
      { url: 'https://internal.invalid/auth/v1/token?grant_type=password', method: 'POST' },
      { url: 'https://public.invalid/auth/v1/token?grant_type=password', method: 'POST' },
      { url: 'https://public.invalid/auth/v1/user', method: 'PUT' },
    ]);
    expect(audited).toBe(true);
  });

  it('preserves HTTP failure classification for non-JSON password error pages', async () => {
    const fetchImpl = Object.assign(async () => new Response('private detail', { status: 403 }), { preconnect() {} });
    const result = await changePasswordWithGoTrue(input, {
      fetchImpl,
      runtimeBaseUrls: ['https://runtime.invalid'],
      auditImpl: async () => { throw new Error('Unexpected audit'); },
    });
    expect(result).toMatchObject({ ok: false, status: 403, code: 'upstream_forbidden' });
    expect(JSON.stringify(result)).not.toContain('private detail');
  });

  it('rejects malformed successful OAuth lookup and consent bodies through actual routes', async () => {
    for (const consent of [false, true]) {
      for (const response of malformedResponses()) {
        let calls = 0;
        globalThis.fetch = Object.assign(async () => {
          calls++;
          return consent && calls === 1 ? Response.json(authorization) : response();
        }, { preconnect() {} });
        const result = await oauthRequest(consent);
        expect(result.status).toBe(502);
        const body: unknown = await result.json();
        expect(body).toMatchObject({ error: 'invalid_upstream_response' });
        expect(calls).toBe(consent ? 2 : 1);
      }
    }
  });

  it('does not repeat an OAuth consent write after an empty 204 receipt', async () => {
    let calls = 0;
    globalThis.fetch = Object.assign(async () => {
      calls++;
      return calls === 1 ? Response.json(authorization) : new Response(null, { status: 204 });
    }, { preconnect() {} });
    const result = await oauthRequest(true);
    expect(result.status).toBe(502);
    expect(calls).toBe(2);
  });

  it('preserves a raw-internal 404 fallback even when the error page is not JSON', async () => {
    config.oauthRuntimeInternalUrl = 'https://internal.invalid';
    let calls = 0;
    globalThis.fetch = Object.assign(async () => {
      calls++;
      return calls === 1 ? new Response('Not Found', { status: 404 })
        : Response.json({ redirect_url: 'https://client.invalid/callback' });
    }, { preconnect() {} });
    const result = await oauthRequest();
    expect(result.status).toBe(200);
    expect(calls).toBe(2);
  });

  it('validates actual runtime settings receipts and preserves valid missing-field defaults', async () => {
    const authConfig = spyOn(getSupaCloudAdapter(), 'getAuthConfig').mockResolvedValue({ enable_signup: false });
    try {
      for (const response of [
        ...malformedResponses(),
        () => Response.json({ disable_signup: 'false' }),
        () => Response.json({ disable_signup: null }),
      ]) {
        let calls = 0;
        const fetchImpl = Object.assign(async () => { calls++; return response(); }, { preconnect() {} });
        await expect(getAuthConfigRuntimeConsistency(fetchImpl)).rejects.toMatchObject({
          status: 502, code: 'invalid_upstream_response',
        });
        expect(calls).toBe(1);
      }
      for (const [value, enabled] of [[{}, true], [{ disable_signup: false }, true], [{ disable_signup: true }, false]] as const) {
        const fetchImpl = Object.assign(async () => Response.json(value), { preconnect() {} });
        expect(await getAuthConfigRuntimeConsistency(fetchImpl)).toMatchObject({
          runtime: { signups_enabled: enabled }, consistent: !enabled,
        });
      }
    } finally {
      authConfig.mockRestore();
    }
  });

  it('allows empty successful settings GET to fall back but rejects JSON null without fallback', async () => {
    const authConfig = spyOn(getSupaCloudAdapter(), 'getAuthConfig').mockResolvedValue({ enable_signup: false });
    try {
      let calls = 0;
      const fetchImpl = Object.assign(async () => {
        calls++;
        return calls === 1 ? new Response(null, { status: 204 }) : Response.json({ disable_signup: true });
      }, { preconnect() {} });
      expect(await getAuthConfigRuntimeConsistency(fetchImpl)).toMatchObject({ consistent: true });
      expect(calls).toBe(2);

      calls = 0;
      const nullFetch = Object.assign(async () => { calls++; return Response.json(null); }, { preconnect() {} });
      await expect(getAuthConfigRuntimeConsistency(nullFetch)).rejects.toMatchObject({
        status: 502, code: 'invalid_upstream_response',
      });
      expect(calls).toBe(1);
    } finally {
      authConfig.mockRestore();
    }
  });

  it('retains non-JSON OAuth error classification for both actual operations', async () => {
    for (const consent of [false, true]) {
      let calls = 0;
      globalThis.fetch = Object.assign(async () => {
        calls++;
        return consent && calls === 1 ? Response.json(authorization) : new Response('private detail', { status: 403 });
      }, { preconnect() {} });
      const response = await oauthRequest(consent);
      expect(response.status).toBe(403);
      const body: unknown = await response.json();
      expect(body).toMatchObject({ error: 'upstream_forbidden' });
      expect(JSON.stringify(body)).not.toContain('private detail');
      expect(calls).toBe(consent ? 2 : 1);
    }
  });
});
