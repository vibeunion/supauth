import { describe, expect, it } from 'bun:test';
import { readFileSync } from 'node:fs';
import {
  applyThirdPartyAuth,
  extractThirdPartyAuthConfig,
  validateIssuerMetadata,
} from '../scripts/apply-third-party-auth.js';

const PRESET = 'config/third-party-auth/xigu-business.json';

function fetchMock(handler: (url: URL, init?: RequestInit) => Response | Promise<Response>) {
  return ((input: string | URL | Request, init?: RequestInit) => handler(new URL(input instanceof Request ? input.url : String(input)), init)) as typeof fetch;
}

function metadataFetch(extra?: (url: URL, init?: RequestInit) => Response | undefined) {
  return fetchMock((url, init) => {
    const overridden = extra?.(url, init);
    if (overridden) return overridden;
    if (url.pathname.endsWith('/.well-known/openid-configuration')) {
      return Response.json({
        issuer: 'https://auth.ai.xigu.team/auth/v1',
        jwks_uri: 'https://auth.ai.xigu.team/auth/v1/.well-known/jwks.json',
      });
    }
    if (url.pathname.endsWith('/.well-known/jwks.json')) {
      return Response.json({ keys: [{ kty: 'EC', crv: 'P-256', use: 'sig', alg: 'ES256', kid: 'public-key', d: 'must-not-propagate' }] });
    }
    throw new Error(`Unexpected request: ${url}`);
  });
}

describe('Third-party Auth apply tool', () => {
  it('keeps Xigu values in tenant config and validates the current client', () => {
    const config = extractThirdPartyAuthConfig(JSON.parse(readFileSync(PRESET, 'utf8')));
    expect(config.issuer).toBe('https://auth.ai.xigu.team/auth/v1');
    expect(config.client_id).toBe('25cb5b0e-a74a-461e-ba50-61b46aa39c3b');
    expect(config.audience).toBe('authenticated');
    expect(config).not.toHaveProperty('jwt_secret');
  });

  it('rejects unknown fields, insecure issuers, invalid modes and missing claim mappings', () => {
    const valid = extractThirdPartyAuthConfig(JSON.parse(readFileSync(PRESET, 'utf8')));
    expect(() => extractThirdPartyAuthConfig({ ...valid, jwt_secret: 'nope' })).toThrow('unknown field');
    expect(() => extractThirdPartyAuthConfig({ third_party_auth: valid, unexpected: true })).toThrow('Config contains unknown field');
    expect(() => extractThirdPartyAuthConfig({ ...valid, issuer: 'http://issuer.example.test' })).toThrow('must use HTTPS');
    expect(() => extractThirdPartyAuthConfig({ ...valid, auth_endpoint_mode: 'proxy' })).toThrow('must be "local" or "external"');
    expect(() => extractThirdPartyAuthConfig({ ...valid, claim_mapping: { sub: 'sub' } })).toThrow('claim_mapping.role is required');
  });

  it('requires matching discovery metadata and asymmetric JWKS keys', async () => {
    const config = extractThirdPartyAuthConfig(JSON.parse(readFileSync(PRESET, 'utf8')));
    const validation = await validateIssuerMetadata(config, metadataFetch());
    expect(validation.signing_algorithms).toEqual(['ES256']);

    await expect(validateIssuerMetadata(config, metadataFetch((url) => {
      if (url.pathname.endsWith('/.well-known/jwks.json')) return Response.json({ keys: [{ kty: 'oct', alg: 'HS256' }] });
    }))).rejects.toThrow('symmetric oct/HS');
    await expect(validateIssuerMetadata(config, metadataFetch((url) => {
      if (url.pathname.endsWith('/.well-known/jwks.json')) return Response.json({ keys: [{ kty: 'EC', alg: 'HS256', x: 'x', y: 'y' }] });
    }))).rejects.toThrow('symmetric oct/HS');
  });

  it('dry-runs without a token or write request', async () => {
    const calls: string[] = [];
    const dryRunSummary = await applyThirdPartyAuth({
      baseUrl: 'https://management.example.test',
      projectRef: 'business-ref',
      configPath: PRESET,
      dryRun: true,
      fetchImpl: metadataFetch((url, init) => {
        calls.push(`${init?.method || 'GET'} ${url.pathname}`);
        return undefined;
      }),
    });
    expect(dryRunSummary.dryRun).toBe(true);
    expect(calls).toEqual([
      'GET /auth/v1/.well-known/openid-configuration',
      'GET /auth/v1/.well-known/jwks.json',
    ]);
  });

  it('patches the project auth config and verifies read-back', async () => {
    const calls: Array<{ method: string; authorization: string | null; body?: unknown }> = [];
    const preset = extractThirdPartyAuthConfig(JSON.parse(readFileSync(PRESET, 'utf8')));
    const applied = {
      ...preset,
      jwt_jwks: { keys: [{ kty: 'EC', crv: 'P-256', use: 'sig', alg: 'ES256', kid: 'public-key' }] },
    };
    const applySummary = await applyThirdPartyAuth({
      baseUrl: 'https://management.example.test/',
      projectRef: 'business-ref',
      configPath: PRESET,
      token: 'management-token-value',
      fetchImpl: metadataFetch((url, init) => {
        if (!url.pathname.endsWith('/config/auth') && !url.pathname.endsWith('/settings')) return undefined;
        const headers = new Headers(init?.headers);
        calls.push({
          method: init?.method || 'GET',
          authorization: headers.get('authorization'),
          body: typeof init?.body === 'string' ? JSON.parse(init.body) : undefined,
        });
        return url.pathname.endsWith('/config/auth')
          ? Response.json({ third_party_auth: applied })
          : Response.json({ auth: { third_party_auth: { ...applied, extra_server_field: true } } });
      }),
    });
    expect(applySummary.verified).toBe(true);
    expect(calls.map(call => call.method)).toEqual(['PATCH', 'GET']);
    expect(calls.every(call => call.authorization === 'Bearer management-token-value')).toBe(true);
    expect(calls[0]?.body).toEqual({
      third_party_auth: {
        ...applied,
      },
    });
  });

  it('fails when live read-back differs', async () => {
    const preset = extractThirdPartyAuthConfig(JSON.parse(readFileSync(PRESET, 'utf8')));
    const applied = {
      ...preset,
      jwt_jwks: { keys: [{ kty: 'EC', crv: 'P-256', use: 'sig', alg: 'ES256', kid: 'public-key' }] },
    };
    await expect(applyThirdPartyAuth({
      baseUrl: 'https://management.example.test',
      projectRef: 'business-ref',
      configPath: PRESET,
      token: 'management-token-value',
      fetchImpl: metadataFetch((url, init) => {
        if (!url.pathname.endsWith('/config/auth') && !url.pathname.endsWith('/settings')) return undefined;
        return url.pathname.endsWith('/config/auth')
          ? Response.json({ third_party_auth: applied })
          : Response.json({ auth: { third_party_auth: { ...applied, client_id: 'stale-client' } } });
      }),
    })).rejects.toThrow('third_party_auth.client_id read-back mismatch');
  });
});
