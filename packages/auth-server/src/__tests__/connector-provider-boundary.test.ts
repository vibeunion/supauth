import { beforeEach, describe, expect, mock, test } from 'bun:test';
import { Elysia } from 'elysia';
import { decodeSchema } from '../../../shared/src/schema.js';
import {
  BuiltinOAuthProvidersSchema, ConnectorFactoryStoredConfigSchema,
  type BuiltinOAuthProvider,
} from '../../../shared/src/server-configuration.js';

const configuredProvider = {
  id: 'github', enabled: true, client_id: 'client-one',
  redirect_uri: 'https://auth.example.test/callback', secret_configured: true,
};
let upstream: unknown = [configuredProvider, { id: 'google', enabled: false }];
let overlayReads = 0;
const overlay = {
  id: 'github',
  get provider_id() { overlayReads += 1; return 'github'; },
  name: 'GitHub', category: 'social', runtime_kind: 'builtin_oauth', enabled: true,
};
const listProviders = mock(async () => upstream);
mock.module('../supacloud/adapter.js', () => ({
  SupaCloudApiError: class extends Error {},
  getSupaCloudAdapter: () => ({ listProviders }),
  isSupaCloudApiError: () => false,
}));
mock.module('../repositories/connectors.js', () => ({
  listConnectorConfigs: async () => [overlay],
  listEnabledConnectorConfigs: async () => [overlay],
}));
const { connectorRoutes } = await import('../routes/connectors.js');
const { resolvePublicSignInExperience } = await import('../routes/sign-in-experience.js');
const { observabilityMiddleware } = await import('../middleware/index.js');
const app = new Elysia().use(observabilityMiddleware).use(connectorRoutes);
const request = () => new Request('http://localhost/v1/connectors');
const publicOptions = {
  getExperience: async () => ({ sign_up_enabled: true }),
  getAuthConfig: async () => ({ password_min_length: 8, password_required_characters: '' }),
};

beforeEach(() => {
  upstream = [configuredProvider, { id: 'google', enabled: false }];
  overlayReads = 0;
  listProviders.mockClear();
});

describe('provider decisions require decoded upstream records', () => {
  test('accepts complete configured and disabled wire fixtures before merging overlays', async () => {
    const response = await app.handle(request());
    expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject({
      items: [
        { id: 'github', enabled: true, provider_enabled: true, configuration_required: false },
        { id: 'google', enabled: false, provider_enabled: false, configuration_required: true },
      ],
      total: 2,
    });
    expect(overlayReads).toBeGreaterThan(0);
    expect(listProviders).toHaveBeenCalledTimes(1);
  });

  test('retains supported pagination envelope extraction without trusting its item type', async () => {
    upstream = { items: [configuredProvider], total: 1, page: 1, limit: 20 };
    const response = await app.handle(request());
    expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject({ total: 1, items: [{ id: 'github' }] });
  });

  test.each([
    [{ ...configuredProvider, id: 7 }],
    [{ ...configuredProvider, enabled: 'true' }],
    [{ id: 'github' }],
    [{ ...configuredProvider, name: 7 }],
    [{ ...configuredProvider, type: false }],
    [{ ...configuredProvider, client_id: 7 }],
    [{ ...configuredProvider, secret_configured: 'true' }],
    [{ ...configuredProvider, clientId: false }],
    [{ ...configuredProvider, clientSecret: 7 }],
  ])('rejects invalid provider fields before touching overlay decisions: %j', async (invalid) => {
    upstream = [invalid];
    const response = await app.handle(request());
    expect(response.status).toBe(502);
    expect(await response.json()).toMatchObject({ error: { code: 'invalid_upstream_response' } });
    expect(overlayReads).toBe(0);
    expect(listProviders).toHaveBeenCalledTimes(1);
  });

  test('keeps public connector discovery fail-closed without classifying malformed providers', async () => {
    upstream = [{ ...configuredProvider, enabled: 'true' }];
    const experience = await resolvePublicSignInExperience(undefined, publicOptions);
    expect(experience.connectors).toEqual([]);
    expect(overlayReads).toBe(0);
    expect(listProviders).toHaveBeenCalledTimes(1);
  });

  test('public connector discovery still returns validated enabled overlays', async () => {
    const experience = await resolvePublicSignInExperience(undefined, publicOptions);
    expect(experience.connectors).toEqual([
      { id: 'github', name: 'GitHub', type: 'social', runtime_kind: 'builtin_oauth' },
    ]);
  });

  test('preserves checked historical credential aliases without exposing secrets', async () => {
    upstream = [{ id: 'github', enabled: true, clientId: 'legacy-client', clientSecret: 'not-public' }];
    const response = await app.handle(request());
    expect(response.status).toBe(200);
    const body: unknown = await response.json();
    expect(body).toMatchObject({ items: [{ configuration_required: false, secret_configured: true }] });
    expect(JSON.stringify(body)).not.toContain('not-public');
  });

  test('checks the actual sanitized OIDC and SAML persisted config shapes', () => {
    expect(decodeSchema(ConnectorFactoryStoredConfigSchema, {
      provider_type: 'oidc', identifier: 'custom:acme', name: 'Acme', client_id: 'client',
      issuer: 'https://idp.example.test', enabled: true, pkce_enabled: true, secret_configured: true,
    })).toMatchObject({ provider_type: 'oidc', secret_configured: true });
    expect(decodeSchema(ConnectorFactoryStoredConfigSchema, {
      type: 'saml', disabled: false, metadata_url: 'https://idp.example.test/metadata',
      domains: ['example.test'], attribute_mapping: { email: { name: 'email' } },
    })).toMatchObject({ type: 'saml', disabled: false });
    expect(() => decodeSchema(ConnectorFactoryStoredConfigSchema, {
      type: 'saml', disabled: 'false',
    })).toThrow();
  });
});

const typedProvider: BuiltinOAuthProvider = configuredProvider;
decodeSchema(BuiltinOAuthProvidersSchema, [typedProvider]);
// @ts-expect-error 上游启用状态必须是布尔值，不得借助分页泛型伪造。
const invalidProvider: BuiltinOAuthProvider = { id: 'github', enabled: 'true' };
void invalidProvider;
