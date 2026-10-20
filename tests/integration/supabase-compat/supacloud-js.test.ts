import { createFetchMock } from "../../tooling-test-values.js";
import { describe, expect, it } from 'bun:test';
import { createClient } from '@supabase/supabase-js';
import { createSupaCloudOAuthFetch } from '@supacloud/js';

describe('@supacloud/js compatibility', () => {
  it('keeps standard Supabase traffic unchanged when no OAuth client is configured', () => {
    const transport = createFetchMock(((async () => new Response(null, { status: 204 }))));

    expect(createSupaCloudOAuthFetch({ fetch: transport })).toBe(transport);
  });

  it('adapts only refresh-token requests to the SupAuth OAuth contract', async () => {
    let forwardedRequest: Request | undefined;
    const transport = createFetchMock(((async (input: RequestInfo | URL, init?: RequestInit) => {
      forwardedRequest = new Request(input, init);
      return Response.json({ access_token: 'access-token' });
    })));
    const supacloudFetch = createSupaCloudOAuthFetch({
      clientId: 'public-client',
      fetch: transport,
    });

    await supacloudFetch('https://auth.example.test/auth/v1/token?grant_type=refresh_token', {
      method: 'POST',
      headers: {
        authorization: 'Bearer must-not-be-forwarded',
        cookie: 'session=must-not-be-forwarded',
        'content-type': 'application/json',
        'proxy-authorization': 'Basic must-not-be-forwarded',
      },
      body: JSON.stringify({ refresh_token: 'refresh-token' }),
    });

    expect(forwardedRequest).toBeDefined();
    expect(forwardedRequest?.url).toBe('https://auth.example.test/auth/v1/oauth/token');
    expect(forwardedRequest?.redirect).toBe('error');
    expect(forwardedRequest?.headers.get('authorization')).toBeNull();
    expect(forwardedRequest?.headers.get('cookie')).toBeNull();
    expect(forwardedRequest?.headers.get('proxy-authorization')).toBeNull();
    expect(forwardedRequest?.headers.get('content-type')).toContain('application/x-www-form-urlencoded');

    const body = new URLSearchParams(await forwardedRequest?.text());
    expect(body.get('grant_type')).toBe('refresh_token');
    expect(body.get('refresh_token')).toBe('refresh-token');
    expect(body.get('client_id')).toBe('public-client');
  });

  it('lets supabase-js refresh a session through the OAuth transport', async () => {
    let forwardedRequest: Request | undefined;
    const transport = createFetchMock(((async (input: RequestInfo | URL, init?: RequestInit) => {
      forwardedRequest = new Request(input, init);
      return Response.json({
        access_token: 'new-access-token',
        expires_in: 3600,
        refresh_token: 'new-refresh-token',
        token_type: 'bearer',
        user: {
          id: '11111111-1111-1111-1111-111111111111',
          aud: 'authenticated',
          role: 'authenticated',
          email: 'user@example.test',
        },
      });
    })));
    const client = createClient('https://auth.example.test', 'public-anon-key', {
      auth: {
        autoRefreshToken: false,
        detectSessionInUrl: false,
        persistSession: false,
      },
      global: {
        fetch: createSupaCloudOAuthFetch({
          clientId: 'public-client',
          fetch: transport,
        }),
      },
    });

    const result = await client.auth.refreshSession({ refresh_token: 'refresh-token' });

    expect(result.error).toBeNull();
    expect(result.data.session?.access_token).toBe('new-access-token');
    expect(result.data.session?.refresh_token).toBe('new-refresh-token');
    expect(forwardedRequest).toBeDefined();
    expect(forwardedRequest?.url).toBe('https://auth.example.test/auth/v1/oauth/token');
    expect(forwardedRequest?.url).not.toContain('refresh-token');
    expect(forwardedRequest?.headers.get('authorization')).toBeNull();
    expect(forwardedRequest?.headers.get('cookie')).toBeNull();
    expect(forwardedRequest?.headers.get('proxy-authorization')).toBeNull();
    expect(forwardedRequest?.headers.get('content-type')).toContain('application/x-www-form-urlencoded');

    const body = new URLSearchParams(await forwardedRequest?.text());
    expect(body.get('client_id')).toBe('public-client');
    expect(body.get('grant_type')).toBe('refresh_token');
    expect(body.get('refresh_token')).toBe('refresh-token');
    expect(body.toString()).not.toContain('must-not-be-forwarded');
  });

  it('passes non-refresh requests through when an OAuth client is configured', async () => {
    let forwardedRequest: Request | undefined;
    const transport = createFetchMock(((async (input: RequestInfo | URL, init?: RequestInit) => {
      forwardedRequest = new Request(input, init);
      return new Response('ok', { status: 200 });
    })));
    const supacloudFetch = createSupaCloudOAuthFetch({
      clientId: 'public-client',
      fetch: transport,
    });

    const response = await supacloudFetch('https://auth.example.test/auth/v1/user', {
      method: 'GET',
      headers: { authorization: 'Bearer access-token' },
    });

    expect(response.status).toBe(200);
    expect(forwardedRequest?.url).toBe('https://auth.example.test/auth/v1/user');
    expect(forwardedRequest?.method).toBe('GET');
    expect(forwardedRequest?.headers.get('authorization')).toBe('Bearer access-token');
    expect(await forwardedRequest?.text()).toBe('');
  });

  it('rejects a cross-origin OAuth token endpoint before forwarding the refresh token', async () => {
    let requestCount = 0;
    const transport = createFetchMock(((async () => {
      requestCount += 1;
      return Response.json({});
    })));
    const supacloudFetch = createSupaCloudOAuthFetch({
      clientId: 'public-client',
      tokenEndpoint: 'https://attacker.example.test/oauth/token',
      fetch: transport,
    });

    await expect(supacloudFetch('https://auth.example.test/auth/v1/token?grant_type=refresh_token', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ refresh_token: 'refresh-token' }),
    })).rejects.toThrow('must use the Supabase Auth origin');
    expect(requestCount).toBe(0);
  });
});
