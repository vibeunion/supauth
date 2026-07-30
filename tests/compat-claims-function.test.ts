import { describe, expect, it } from 'bun:test';

const compatClaimsFunction = (await import(
  './fixtures/supabase-auth-compat/functions/compat-claims/index.js'
)).default;

describe('compat-claims Function fixture', () => {
  it('exports an Edge worker fetch handler', () => {
    expect(compatClaimsFunction.fetch).toBeFunction();
  });

  it('rejects a missing bearer token', async () => {
    const response = compatClaimsFunction.fetch(new Request('https://function.example.test'));

    expect(response.status).toBe(401);
    expect(await response.json()).toEqual({ code: 'missing_bearer_token' });
  });

  it('rejects a malformed bearer token', async () => {
    const response = compatClaimsFunction.fetch(new Request('https://function.example.test', {
      headers: { authorization: 'Bearer not-a-jwt' },
    }));

    expect(response.status).toBe(401);
    expect(await response.json()).toEqual({ code: 'invalid_bearer_token' });
  });

  it('returns only sub and role from a valid three-segment JWT', async () => {
    const encodedClaims = Buffer.from(JSON.stringify({
      sub: 'user-123',
      role: 'authenticated',
      ignored: 'private',
    })).toString('base64url');
    const response = compatClaimsFunction.fetch(new Request('https://function.example.test', {
      headers: { authorization: `Bearer header.${encodedClaims}.signature` },
    }));

    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ sub: 'user-123', role: 'authenticated' });
  });
});
