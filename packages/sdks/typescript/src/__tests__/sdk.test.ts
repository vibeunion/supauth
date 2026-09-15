import { describe, it, expect, beforeEach } from 'bun:test';
import { SupaOAuthClient, SupaOAuthAPIError, type SupaOAuthFetch } from '../index.js';
import { health } from './domain-fixtures.js';

let transport: SupaOAuthFetch = async () => { throw new Error('Configure the test transport'); };
function mockFetch(fn: SupaOAuthFetch) {
  const orig = transport;
  transport = fn;
  return () => { transport = orig; };
}

describe('SupaOAuthClient', () => {
  let client: SupaOAuthClient;

  beforeEach(() => {
    client = new SupaOAuthClient({ baseUrl: 'http://localhost:4010', accessToken: 'test-token', fetch: (input, init) => transport(input, init) });
  });

  it('constructs with base URL trimmed', async () => {
    const seen: string[] = [];
    const c = new SupaOAuthClient({ baseUrl: 'http://localhost:4010///', fetch: async input => {
      seen.push(String(input));
      return Response.json(health);
    } });
    await c.health();
    expect(seen).toEqual(['http://localhost:4010/v1/health']);
  });

  it('stores access token', async () => {
    const seen: Array<string | null> = [];
    const restore = mockFetch(async (_input, init) => {
      seen.push(new Headers(init?.headers).get('authorization'));
      return Response.json(health);
    });
    try {
      await client.health();
      client.setAccessToken('new-token');
      await client.health();
      client.setAccessToken(null);
      await client.health();
      expect(seen).toEqual(['Bearer test-token', 'Bearer new-token', null]);
    } finally {
      restore();
    }
  });

  it('throws SupaOAuthAPIError on non-2xx response', async () => {
    const restore = mockFetch(() =>
      Promise.resolve(new Response('not found', { status: 404 }))
    );
    try {
      const err: unknown = await client.health().catch((error: unknown) => error);
      expect(err).toBeInstanceOf(SupaOAuthAPIError);
      if (!(err instanceof SupaOAuthAPIError)) throw new Error('Expected API error');
      expect(err.status).toBe(404);
    } finally {
      restore();
    }
  });

  it('returns undefined for a declared void deletion response', async () => {
    const restore = mockFetch(() =>
      Promise.resolve(new Response(null, { status: 204 }))
    );
    try {
      const result = await client.deleteApplication('123');
      expect(result).toBeUndefined();
    } finally {
      restore();
    }
  });

  it('sends Authorization header when token is set', async () => {
    let capturedHeaders = new Headers();
    const restore = mockFetch((_input, init) => {
      capturedHeaders = new Headers(init?.headers);
      return Promise.resolve(Response.json(health));
    });
    try {
      await client.health();
      expect(capturedHeaders.get('Authorization')).toBe('Bearer test-token');
    } finally {
      restore();
    }
  });

  it('omits Authorization header when token is null', async () => {
    let capturedHeaders = new Headers();
    client.setAccessToken(null);
    const restore = mockFetch((_input, init) => {
      capturedHeaders = new Headers(init?.headers);
      return Promise.resolve(Response.json(health));
    });
    try {
      await client.health();
      expect(capturedHeaders.get('Authorization')).toBeNull();
    } finally {
      restore();
    }
  });
});

describe('SupaOAuthAPIError', () => {
  it('has correct properties', () => {
    const err = new SupaOAuthAPIError(403, 'forbidden', '/v1/roles');
    expect(err.name).toBe('SupaOAuthAPIError');
    expect(err.status).toBe(403);
    expect(err.body).toBe('forbidden');
    expect(err.path).toBe('/v1/roles');
    expect(err.message).toContain('403');
    expect(err).toBeInstanceOf(Error);
  });
});
