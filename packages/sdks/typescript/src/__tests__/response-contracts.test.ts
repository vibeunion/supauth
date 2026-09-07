import { afterEach, describe, expect, it, mock } from 'bun:test';
import { SupaOAuthAPIError, SupaOAuthClient, SupaOAuthResponseContractError } from '../index.js';

const originalFetch = globalThis.fetch;
const client = new SupaOAuthClient({ baseUrl: 'https://auth.example.test' });

afterEach(() => { globalThis.fetch = originalFetch; });

function respond(value: unknown, status = 200) {
  const fetcher = mock(async () => status === 204 || status === 205
    ? new Response(null, { status })
    : Response.json(value, { status }));
  globalThis.fetch = fetcher as unknown as typeof fetch;
  return fetcher;
}

describe('SDK response contracts', () => {
  it('infers health fields from the decoder and rejects a changed runtime enum', async () => {
    respond({ status: 'ok', runtime_mode: 'gotrue', project_ref: 'project', internal: 'not public' });
    expect(await client.health()).toEqual({ status: 'ok', runtime_mode: 'gotrue', project_ref: 'project' });
    respond({ status: 'ok', runtime_mode: 'unknown', project_ref: 'project' });
    await expect(client.health()).rejects.toMatchObject({ reason: 'invalid_payload' });
  });

  it.each([{}, [], null, { status: 2 }, { status: 'ok', runtime_mode: 'gotrue' }].map(value => [value]))(
    'rejects malformed health payload %j', async (value) => {
      respond(value);
      await expect(client.health()).rejects.toBeInstanceOf(SupaOAuthResponseContractError);
    },
  );

  it.each([204, 205])('rejects unexpected no-content status %i for data methods', async (status) => {
    respond(null, status);
    await expect(client.health()).rejects.toMatchObject({ status, reason: 'unexpected_no_content' });
    await expect(client.getApplication('app')).rejects.toMatchObject({ reason: 'unexpected_no_content' });
  });

  it.each([204, 205, 200])('returns undefined for declared void methods with status %i', async (status) => {
    respond({ ok: true }, status);
    expect(await client.deleteApplication('app')).toBeUndefined();
  });

  it('reports invalid JSON without including response text', async () => {
    globalThis.fetch = mock(async () => new Response('private-response-not-json', { status: 200 })) as unknown as typeof fetch;
    try {
      await client.health();
      throw new Error('expected rejection');
    } catch (error) {
      expect(error).toBeInstanceOf(SupaOAuthResponseContractError);
      expect(error).toMatchObject({ code: 'SUPAUTH_RESPONSE_CONTRACT_INVALID', reason: 'invalid_json' });
      expect(String(error)).not.toContain('private-response');
    }
  });

  it('rejects malformed runtime discovery, status and keys', async () => {
    respond({ status: false });
    await expect(client.getRuntimeHealth()).rejects.toBeInstanceOf(SupaOAuthResponseContractError);
    respond({ enabled: 'true', signing_alg: 'RS256', allow_dynamic_registration: false });
    await expect(client.getOAuthServerStatus()).rejects.toBeInstanceOf(SupaOAuthResponseContractError);
    respond({ issuer: 'https://auth.example.test' });
    await expect(client.getDiscovery()).rejects.toBeInstanceOf(SupaOAuthResponseContractError);
    respond({ keys: [null] });
    await expect(client.getJWKS()).rejects.toBeInstanceOf(SupaOAuthResponseContractError);
  });

  it('preserves additive discovery metadata and valid runtime results', async () => {
    respond({ status: 'ok' });
    expect(await client.getRuntimeHealth()).toEqual({ status: 'ok' });
    const server = { enabled: true, signing_alg: 'RS256', allow_dynamic_registration: false, migration_status: 'complete' };
    respond(server);
    expect(await client.getOAuthServerStatus()).toEqual(server);
    const discovery = {
      issuer: 'https://auth.example.test', authorization_endpoint: 'https://auth.example.test/authorize',
      token_endpoint: 'https://auth.example.test/token', userinfo_endpoint: 'https://auth.example.test/userinfo',
      jwks_uri: 'https://auth.example.test/jwks', scopes_supported: ['openid'],
    };
    respond(discovery);
    expect(await client.getDiscovery()).toEqual(discovery);
    respond({ keys: [{ kty: 'RSA', kid: 'key' }] });
    expect(await client.getJWKS()).toEqual({ keys: [{ kty: 'RSA', kid: 'key' }] });
  });

  it('keeps HTTP errors distinct and does not call the decoder', async () => {
    respond({ error: 'forbidden' }, 403);
    const decoder = mock(() => ({ value: 1 }));
    await expect(client.requestDecoded('/custom', decoder)).rejects.toBeInstanceOf(SupaOAuthAPIError);
    expect(decoder).not.toHaveBeenCalled();
  });

  it('does not replay a write when its result decoder rejects and redacts the decoder error', async () => {
    const fetcher = respond({ secret: 'private-token' });
    await expect(client.requestDecoded('/custom', () => { throw new Error('private-token'); }, { method: 'POST' }))
      .rejects.toThrow('SupaOAuth response contract failed (invalid_payload)');
    expect(fetcher).toHaveBeenCalledTimes(1);
  });

  it('passes cancellation to fetch and preserves the abort reason', async () => {
    const controller = new AbortController();
    const abort = new DOMException('cancelled', 'AbortError');
    globalThis.fetch = mock(async (_url: unknown, options?: RequestInit) => {
      expect(options?.signal).toBe(controller.signal);
      return new Promise<Response>((_resolve, reject) => {
        options?.signal?.addEventListener('abort', () => reject(options.signal?.reason), { once: true });
      });
    }) as unknown as typeof fetch;
    const pending = client.requestDecoded('/custom', String, { signal: controller.signal });
    controller.abort(abort);
    await expect(pending).rejects.toBe(abort);
  });
});
