import { describe, it, expect, mock, beforeEach } from 'bun:test';
import { SupaOAuthClient, SupaOAuthAPIError } from '../index.js';

// Helper to mock globalThis.fetch without type mismatch
function mockFetch(fn: (input: string | Request, init?: RequestInit) => Promise<Response>) {
  const orig = globalThis.fetch;
  globalThis.fetch = fn as typeof fetch;
  return () => { globalThis.fetch = orig; };
}

describe('SupaOAuthClient', () => {
  let client: SupaOAuthClient;

  beforeEach(() => {
    client = new SupaOAuthClient({ baseUrl: 'http://localhost:4010', accessToken: 'test-token' });
  });

  it('constructs with base URL trimmed', () => {
    const c = new SupaOAuthClient({ baseUrl: 'http://localhost:4010///' });
    expect((c as any).baseUrl).toBe('http://localhost:4010');
  });

  it('stores access token', () => {
    expect((client as any).accessToken).toBe('test-token');
    client.setAccessToken('new-token');
    expect((client as any).accessToken).toBe('new-token');
    client.setAccessToken(null);
    expect((client as any).accessToken).toBeNull();
  });

  it('throws SupaOAuthAPIError on non-2xx response', async () => {
    const restore = mockFetch(() =>
      Promise.resolve(new Response('not found', { status: 404 }))
    );
    try {
      const err = await client['request']('/v1/health').catch(e => e);
      expect(err).toBeInstanceOf(SupaOAuthAPIError);
      expect((err as SupaOAuthAPIError).status).toBe(404);
    } finally {
      restore();
    }
  });

  it('returns null for 204 response', async () => {
    const restore = mockFetch(() =>
      Promise.resolve(new Response(null, { status: 204 }))
    );
    try {
      const result = await client['request']('/v1/applications/123', { method: 'DELETE' });
      expect(result).toBeNull();
    } finally {
      restore();
    }
  });

  it('sends Authorization header when token is set', async () => {
    let capturedHeaders: Record<string, string> = {};
    const restore = mockFetch((_input, init) => {
      capturedHeaders = (init?.headers || {}) as Record<string, string>;
      return Promise.resolve(new Response(JSON.stringify({ status: 'ok' }), { status: 200 }));
    });
    try {
      await client['request']('/v1/health');
      expect(capturedHeaders['Authorization']).toBe('Bearer test-token');
    } finally {
      restore();
    }
  });

  it('omits Authorization header when token is null', async () => {
    let capturedHeaders: Record<string, string> = {};
    client.setAccessToken(null);
    const restore = mockFetch((_input, init) => {
      capturedHeaders = (init?.headers || {}) as Record<string, string>;
      return Promise.resolve(new Response(JSON.stringify({ status: 'ok' }), { status: 200 }));
    });
    try {
      await client['request']('/v1/health');
      expect(capturedHeaders['Authorization']).toBeUndefined();
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
