import { describe, expect, it } from 'bun:test';
import { createSupaCloudOAuthFetch } from '@supacloud/js';

describe('@supacloud/js compatibility', () => {
  it('keeps standard Supabase traffic unchanged when no OAuth client is configured', () => {
    const transport = (async () => new Response(null, { status: 204 })) as unknown as typeof fetch;

    expect(createSupaCloudOAuthFetch({ fetch: transport })).toBe(transport);
  });

  it('adapts only refresh-token requests to the SupAuth OAuth contract', async () => {
    let forwardedRequest: Request | undefined;
    const transport = (async (input: RequestInfo | URL, init?: RequestInit) => {
      forwardedRequest = new Request(input, init);
      return Response.json({ access_token: 'access-token' });
    }) as unknown as typeof fetch;
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

  it('rejects a cross-origin OAuth token endpoint before forwarding the refresh token', async () => {
    let requestCount = 0;
    const transport = (async () => {
      requestCount += 1;
      return Response.json({});
    }) as unknown as typeof fetch;
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
