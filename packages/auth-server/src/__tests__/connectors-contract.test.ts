import { describe, expect, it } from 'bun:test';
import {
  auditCommittedConnectorFactory,
  customOidcFactoryRequest,
  enterpriseConnectorEnabledUpdate,
  instantiateConnectorFactory,
  mergeProvidersWithConnectorConfigs,
  notifyCommittedConnectorUpdate,
  samlFactoryRequest,
  updateBuiltinConnectorRuntime,
  updateConnectorEnabledState,
  verifiedConnectorState,
} from '../routes/connectors.js';
import { SupaCloudApiError } from '../supacloud/adapter.js';
import { withoutSecrets } from '../utils/secrets.js';

describe('enterprise connector contracts', () => {
  it('requires builtin OAuth credentials before enabling a connector', async () => {
    let updateCalls = 0;
    const existingConfig = null;
    await expect(updateConnectorEnabledState({
      providerId: 'google', runtimeKind: 'builtin_oauth', enabled: true, existingConfig,
    }, {
      readRuntime: async () => ({ id: 'google', enabled: false }),
      updateRuntime: async () => { updateCalls += 1; return { id: 'google', enabled: true }; },
      saveOverlay: async () => ({ id: 'google' }),
      readOverlay: async () => null,
    })).rejects.toMatchObject({ status: 409, code: 'connector_configuration_required' });
    expect(updateCalls).toBe(0);

    let configuredOverlay = {
      id: 'google', provider_id: 'google', runtime_kind: 'builtin_oauth',
      name: 'google', category: 'social', enabled: false, config: {},
    };
    await expect(updateConnectorEnabledState({
      providerId: 'google', runtimeKind: 'builtin_oauth', enabled: true, existingConfig: null,
    }, {
      readRuntime: async () => ({
        id: 'google', enabled: true,
        client_id: 'client', secret_configured: true,
      }),
      updateRuntime: async () => {
        updateCalls += 1;
        throw new Error('builtin runtime update must not be called');
      },
      saveOverlay: async input => {
        configuredOverlay = { ...configuredOverlay, enabled: input.enabled === true };
        return configuredOverlay;
      },
      readOverlay: async () => configuredOverlay,
    })).resolves.toMatchObject({ enabled: true, provider_enabled: true });
    expect(updateCalls).toBe(0);
  });

  it('keeps builtin visibility separate from provider availability in list and detail readback', async () => {
    let updateCalls = 0;
    let overlay = {
      id: 'google', provider_id: 'google', runtime_kind: 'builtin_oauth',
      name: 'Google', category: 'social', enabled: true, config: {},
    };
    const dependencies = {
      readRuntime: async () => ({
        id: 'google', enabled: true, client_id: 'client', secret_configured: true,
      }),
      updateRuntime: async () => { updateCalls += 1; return {}; },
      saveOverlay: async (input: { enabled?: boolean }) => {
        overlay = { ...overlay, enabled: input.enabled === true };
        return overlay;
      },
      readOverlay: async () => overlay,
    };

    const disabled = await updateConnectorEnabledState({
      providerId: 'google', runtimeKind: 'builtin_oauth', enabled: false, existingConfig: overlay,
    }, dependencies);

    expect(disabled).toMatchObject({ enabled: false, provider_enabled: true });
    expect(updateCalls).toBe(0);
    const listed = mergeProvidersWithConnectorConfigs([
      { id: 'google', enabled: true, client_id: 'client', secret_configured: true },
    ], [overlay])[0];
    const detailed = await verifiedConnectorState('google', overlay, dependencies);
    expect(listed).toMatchObject({ enabled: false, provider_enabled: true });
    expect(detailed).toMatchObject({ enabled: false, provider_enabled: true });

    const listedWithoutOverlay = mergeProvidersWithConnectorConfigs([
      { id: 'google', enabled: true, client_id: 'client', secret_configured: true },
    ], [])[0];
    const detailedWithoutOverlay = await verifiedConnectorState('google', null, dependencies);
    expect(listedWithoutOverlay).toMatchObject({ enabled: false, provider_enabled: true });
    expect(detailedWithoutOverlay).toMatchObject({ enabled: false, provider_enabled: true });
  });

  it('classifies a confirmed connector capability rejection as retryable without reconciliation', async () => {
    await expect(instantiateConnectorFactory({
      name: 'Enterprise SAML', protocol: 'saml', category: 'enterprise_sso', enabled: true,
    }, {
      name: 'Acme', metadata_url: 'https://idp.example.test/metadata', enabled: true,
    }, {
      createCustomOidc: async () => { throw new Error('unexpected OIDC create'); },
      readCustomOidc: async () => { throw new Error('unexpected OIDC read'); },
      deleteCustomOidc: async () => { throw new Error('unexpected OIDC delete'); },
      createSaml: async () => {
        throw new SupaCloudApiError(501, 'runtime unavailable', '/auth/sso/providers');
      },
      readSaml: async () => { throw new Error('unexpected SAML read'); },
      deleteSaml: async () => { throw new Error('unexpected SAML delete'); },
      saveOverlay: async () => { throw new Error('unexpected overlay write'); },
      readOverlay: async () => null,
    })).rejects.toMatchObject({ status: 503, code: 'connector_runtime_unavailable' });
  });

  it('classifies a confirmed connector runtime 503 as retryable without reconciliation', async () => {
    await expect(instantiateConnectorFactory({
      name: 'Enterprise SAML', protocol: 'saml', category: 'enterprise_sso', enabled: true,
    }, {
      name: 'Acme', metadata_url: 'https://idp.example.test/metadata', enabled: true,
    }, {
      createCustomOidc: async () => { throw new Error('unexpected OIDC create'); },
      readCustomOidc: async () => { throw new Error('unexpected OIDC read'); },
      deleteCustomOidc: async () => { throw new Error('unexpected OIDC delete'); },
      createSaml: async () => {
        throw new SupaCloudApiError(503, 'runtime unavailable', '/auth/sso/providers');
      },
      readSaml: async () => { throw new Error('unexpected SAML read'); },
      deleteSaml: async () => { throw new Error('unexpected SAML delete'); },
      saveOverlay: async () => { throw new Error('unexpected overlay write'); },
      readOverlay: async () => null,
    })).rejects.toMatchObject({ status: 503, code: 'connector_runtime_unavailable' });
  });

  it('preserves a connector transport interruption for outcome reconciliation', async () => {
    const transportFailure = new TypeError('fetch failed');
    await expect(instantiateConnectorFactory({
      name: 'Enterprise SAML', protocol: 'saml', category: 'enterprise_sso', enabled: true,
    }, {
      name: 'Acme', metadata_url: 'https://idp.example.test/metadata', enabled: true,
    }, {
      createCustomOidc: async () => { throw new Error('unexpected OIDC create'); },
      readCustomOidc: async () => { throw new Error('unexpected OIDC read'); },
      deleteCustomOidc: async () => { throw new Error('unexpected OIDC delete'); },
      createSaml: async () => { throw transportFailure; },
      readSaml: async () => { throw new Error('unexpected SAML read'); },
      deleteSaml: async () => { throw new Error('unexpected SAML delete'); },
      saveOverlay: async () => { throw new Error('unexpected overlay write'); },
      readOverlay: async () => null,
    })).rejects.toBe(transportFailure);
  });

  it('maps enterprise enabled state to each typed runtime contract', () => {
    expect(enterpriseConnectorEnabledUpdate('custom_oidc', true)).toEqual({ enabled: true });
    expect(enterpriseConnectorEnabledUpdate('custom_oidc', false)).toEqual({ enabled: false });
    expect(enterpriseConnectorEnabledUpdate('saml', true)).toEqual({ disabled: false });
    expect(enterpriseConnectorEnabledUpdate('saml', false)).toEqual({ disabled: true });
  });

  it('reads back runtime and overlay state while preserving local connector metadata', async () => {
    let runtimeEnabledState = false;
    let overlay = {
      id: 'custom:workos',
      provider_id: 'custom:workos',
      connector_record_id: '11111111-1111-4111-8111-111111111111',
      runtime_kind: 'custom_oidc',
      name: 'WorkOS 企业登录',
      category: 'enterprise_sso',
      enabled: false,
      config: { issuer: 'https://issuer.example.test' },
    };
    const response = await updateConnectorEnabledState({
      providerId: 'custom:workos',
      runtimeKind: 'custom_oidc',
      enabled: true,
      existingConfig: overlay,
    }, {
      readRuntime: async () => ({ identifier: 'custom:workos', enabled: runtimeEnabledState }),
      updateRuntime: async (_providerId, _runtimeKind, updateInput) => {
        expect(updateInput).toEqual({ enabled: true });
        runtimeEnabledState = true;
        return { identifier: 'custom:workos', enabled: true };
      },
      saveOverlay: async input => {
        overlay = { ...overlay, enabled: input.enabled === true };
        return overlay;
      },
      readOverlay: async () => overlay,
    });

    expect(response).toMatchObject({
      id: 'custom:workos',
      name: 'WorkOS 企业登录',
      enabled: true,
      provider_enabled: true,
      runtime_kind: 'custom_oidc',
    });
    expect(overlay.config).toEqual({ issuer: 'https://issuer.example.test' });
  });

  it('keeps enterprise detail state locked to the typed runtime readback', async () => {
    const overlay = {
      id: 'custom:workos', provider_id: 'custom:workos', runtime_kind: 'custom_oidc',
      name: 'WorkOS', category: 'enterprise_sso', enabled: false, config: {},
    };
    await expect(verifiedConnectorState('custom:workos', overlay, {
      readRuntime: async () => ({ identifier: 'custom:workos', enabled: true }),
      updateRuntime: async () => { throw new Error('unexpected runtime update'); },
      saveOverlay: async () => { throw new Error('unexpected overlay write'); },
      readOverlay: async () => overlay,
    })).rejects.toMatchObject({ status: 503, code: 'connector_update_outcome_unknown' });
  });

  it('accepts an interrupted overlay response only when readback proves it committed', async () => {
    let runtimeEnabledState = false;
    let overlay = {
      id: 'saml-one', provider_id: 'saml-one', runtime_kind: 'saml',
      name: 'SAML One', category: 'enterprise_sso', enabled: false, config: {},
    };
    await expect(updateConnectorEnabledState({
      providerId: 'saml-one', runtimeKind: 'saml', enabled: true, existingConfig: overlay,
    }, {
      readRuntime: async () => ({ id: 'saml-one', disabled: !runtimeEnabledState }),
      updateRuntime: async () => { runtimeEnabledState = true; return { id: 'saml-one', disabled: false }; },
      saveOverlay: async input => {
        overlay = { ...overlay, enabled: input.enabled === true };
        throw new TypeError('overlay response interrupted');
      },
      readOverlay: async () => overlay,
    })).resolves.toMatchObject({ enabled: true, provider_enabled: true, name: 'SAML One' });
  });

  it('reconciles an interrupted runtime update and preserves a confirmed non-commit error', async () => {
    let runtimeEnabledState = false;
    let overlayWrites = 0;
    let overlay = {
      id: 'custom:workos', provider_id: 'custom:workos', runtime_kind: 'custom_oidc',
      name: 'WorkOS', category: 'enterprise_sso', enabled: false, config: {},
    };
    const input = {
      providerId: 'custom:workos', runtimeKind: 'custom_oidc' as const,
      enabled: true, existingConfig: overlay,
    };
    const committedResponse = updateConnectorEnabledState(input, {
      readRuntime: async () => ({ identifier: 'custom:workos', enabled: runtimeEnabledState }),
      updateRuntime: async () => {
        runtimeEnabledState = true;
        throw new TypeError('runtime response interrupted');
      },
      saveOverlay: async overlayInput => {
        overlayWrites += 1;
        overlay = { ...overlay, enabled: overlayInput.enabled === true };
        return overlay;
      },
      readOverlay: async () => overlay,
    });
    await expect(committedResponse).resolves.toMatchObject({ enabled: true, provider_enabled: true });

    runtimeEnabledState = false;
    overlayWrites = 0;
    overlay = { ...overlay, enabled: false };
    const rejectedUpdate = new Error('runtime rejected update');
    await expect(updateConnectorEnabledState(input, {
      readRuntime: async () => ({ identifier: 'custom:workos', enabled: runtimeEnabledState }),
      updateRuntime: async () => { throw rejectedUpdate; },
      saveOverlay: async () => { overlayWrites += 1; return overlay; },
      readOverlay: async () => overlay,
    })).rejects.toBe(rejectedUpdate);
    expect(overlayWrites).toBe(0);
  });

  it('treats a nullable SAML disabled field as enabled', async () => {
    let overlay = {
      id: 'saml-one', provider_id: 'saml-one', runtime_kind: 'saml',
      name: 'SAML One', category: 'enterprise_sso', enabled: true, config: {},
    };
    await expect(updateConnectorEnabledState({
      providerId: 'saml-one', runtimeKind: 'saml', enabled: true, existingConfig: overlay,
    }, {
      readRuntime: async () => ({ id: 'saml-one', disabled: null }),
      updateRuntime: async () => ({ id: 'saml-one', disabled: null }),
      saveOverlay: async input => {
        overlay = { ...overlay, enabled: input.enabled === true };
        return overlay;
      },
      readOverlay: async () => overlay,
    })).resolves.toMatchObject({ enabled: true, provider_enabled: true });
  });

  it('reports an unknown toggle outcome when runtime and overlay cannot be reconciled', async () => {
    const overlay = {
      id: 'saml-one', provider_id: 'saml-one', runtime_kind: 'saml',
      name: 'SAML One', category: 'enterprise_sso', enabled: false, config: {},
    };
    let runtimeEnabledState = false;
    await expect(updateConnectorEnabledState({
      providerId: 'saml-one', runtimeKind: 'saml', enabled: true, existingConfig: overlay,
    }, {
      readRuntime: async () => ({ id: 'saml-one', disabled: !runtimeEnabledState }),
      updateRuntime: async () => { runtimeEnabledState = true; return { id: 'saml-one', disabled: false }; },
      saveOverlay: async () => { throw new Error('overlay unavailable'); },
      readOverlay: async () => overlay,
    })).rejects.toMatchObject({ status: 503, code: 'connector_update_outcome_unknown' });
  });

  it('rejects a mismatched or malformed typed runtime readback before updating', async () => {
    const existingConfig = {
      id: 'saml-one', provider_id: 'saml-one', runtime_kind: 'saml',
      name: 'SAML One', category: 'enterprise_sso', enabled: false, config: {},
    };
    let updateCalls = 0;
    const dependencies = {
      readRuntime: async () => ({ id: 'another-provider' }),
      updateRuntime: async () => { updateCalls += 1; return {}; },
      saveOverlay: async () => existingConfig,
      readOverlay: async () => existingConfig,
    };
    await expect(updateConnectorEnabledState({
      providerId: 'saml-one', runtimeKind: 'saml', enabled: true, existingConfig,
    }, dependencies)).rejects.toMatchObject({ code: 'connector_readback_mismatch' });
    dependencies.readRuntime = async () => ({ id: 'saml-one', disabled: 'false', enabled: true });
    await expect(updateConnectorEnabledState({
      providerId: 'saml-one', runtimeKind: 'saml', enabled: true, existingConfig,
    }, dependencies)).rejects.toMatchObject({ code: 'invalid_upstream_response' });
    dependencies.readRuntime = async () => ({ id: 'saml-one' });
    await expect(updateConnectorEnabledState({
      providerId: 'saml-one', runtimeKind: 'saml', enabled: true, existingConfig,
    }, dependencies)).rejects.toMatchObject({ code: 'invalid_upstream_response' });
    expect(updateCalls).toBe(0);
  });

  it('reports notification failures as unknown after connector update commit', async () => {
    await expect(notifyCommittedConnectorUpdate('connector-one', {
      writeAudit: async () => { throw new Error('audit unavailable'); },
      dispatchWebhook: async () => {},
    })).rejects.toMatchObject({ status: 503, code: 'connector_update_outcome_unknown' });
    await expect(notifyCommittedConnectorUpdate('connector-one', {
      writeAudit: async () => {},
      dispatchWebhook: async () => { throw new Error('webhook unavailable'); },
    })).rejects.toMatchObject({ status: 503, code: 'connector_update_outcome_unknown' });
  });

  it('reports an unknown outcome when audit fails after factory creation committed', async () => {
    await expect(auditCommittedConnectorFactory('factory-one', async () => {
      throw new Error('audit rejected the committed mutation');
    })).rejects.toMatchObject({
      status: 503,
      code: 'connector_creation_outcome_unknown',
    });
  });

  it('normalizes custom OIDC identifiers and keeps the secret only in the upstream request', () => {
    const upstreamRequest = customOidcFactoryRequest({
      identifier: 'WorkOS',
      name: 'WorkOS',
      client_id: 'client-id',
      client_secret: 'send-once',
      issuer: 'https://issuer.example.test',
      enabled: true,
      scopes: 'openid, email',
      ignored: 'must-not-forward',
    });

    expect(upstreamRequest).toEqual({
      provider_type: 'oidc',
      identifier: 'custom:workos',
      name: 'WorkOS',
      client_id: 'client-id',
      client_secret: 'send-once',
      issuer: 'https://issuer.example.test',
      enabled: true,
      scopes: ['openid', 'email'],
      pkce_enabled: true,
    });
    const safeOverlayConfig = withoutSecrets(upstreamRequest) as Record<string, unknown>;
    expect(safeOverlayConfig).toEqual({
      provider_type: 'oidc',
      identifier: 'custom:workos',
      name: 'WorkOS',
      client_id: 'client-id',
      issuer: 'https://issuer.example.test',
      enabled: true,
      scopes: ['openid', 'email'],
      pkce_enabled: true,
      secret_configured: true,
    });
    expect(JSON.stringify(safeOverlayConfig)).not.toContain('send-once');
  });

  it('enforces client_id boundaries before builtin and custom OIDC runtime writes', async () => {
    const maximumClientId = 'c'.repeat(255);
    let builtinUpdateCalls = 0;
    await expect(updateBuiltinConnectorRuntime('google', { client_id: maximumClientId }, async (_providerId, input) => {
      builtinUpdateCalls += 1;
      return input;
    })).resolves.toMatchObject({ client_id: maximumClientId });
    expect(builtinUpdateCalls).toBe(1);
    for (const invalidLength of [256, 10_000]) {
      await expect(updateBuiltinConnectorRuntime('google', {
        client_id: 'c'.repeat(invalidLength),
      }, async () => {
        builtinUpdateCalls += 1;
        return {};
      })).rejects.toMatchObject({ status: 400, code: 'invalid_connector_client_id' });
    }
    expect(builtinUpdateCalls).toBe(1);
    expect(customOidcFactoryRequest({
      identifier: 'workos', name: 'WorkOS', client_id: maximumClientId,
      client_secret: 'secret', issuer: 'https://issuer.example.test',
    }).client_id).toBe(maximumClientId);
    for (const invalidLength of [256, 10_000]) {
      expect(() => customOidcFactoryRequest({
        identifier: 'workos', name: 'WorkOS', client_id: 'c'.repeat(invalidLength),
        client_secret: 'secret', issuer: 'https://issuer.example.test',
      })).toThrow(`client_id must contain between 1 and 255 characters`);
    }

    let customOidcCreateCalls = 0;
    await expect(instantiateConnectorFactory({
      name: 'Enterprise OIDC', protocol: 'oidc', category: 'enterprise_sso', enabled: true,
    }, {
      identifier: 'workos', name: 'WorkOS', client_id: 'c'.repeat(256),
      client_secret: 'secret', issuer: 'https://issuer.example.test',
    }, {
      createCustomOidc: async () => { customOidcCreateCalls += 1; return {}; },
      readCustomOidc: async () => ({}),
      deleteCustomOidc: async () => null,
      createSaml: async () => ({}),
      readSaml: async () => ({}),
      deleteSaml: async () => null,
      saveOverlay: async () => ({} as never),
      readOverlay: async () => null,
    })).rejects.toMatchObject({ status: 400, code: 'invalid_connector_client_id' });
    expect(customOidcCreateCalls).toBe(0);
  });

  it('accepts either SAML metadata XML or URL and parses typed collection fields', () => {
    expect(samlFactoryRequest({
      name: 'Acme',
      metadata_xml: '<EntityDescriptor />',
      domains: 'example.test, corp.test',
      attribute_mapping: '{"keys":{"email":{"name":"mail"}}}',
      name_id_format: 'urn:oasis:names:tc:SAML:1.1:nameid-format:emailAddress',
      enabled: true,
    })).toEqual({
      type: 'saml',
      metadata_xml: '<EntityDescriptor />',
      domains: ['example.test', 'corp.test'],
      attribute_mapping: { keys: { email: { name: 'mail' } } },
      name_id_format: 'urn:oasis:names:tc:SAML:1.1:nameid-format:emailAddress',
      disabled: false,
    });

    expect(samlFactoryRequest({
      name: 'Acme',
      metadata_url: 'https://idp.example.test/metadata',
      enabled: true,
    })).toEqual({
      type: 'saml',
      metadata_url: 'https://idp.example.test/metadata',
      disabled: false,
    });
    expect(() => samlFactoryRequest({ name: 'Acme' }))
      .toThrow('exactly one of metadata_url or metadata_xml is required');
    expect(() => samlFactoryRequest({
      name: 'Acme',
      metadata_url: 'https://idp.example.test/metadata',
      metadata_xml: '<EntityDescriptor />',
    })).toThrow('exactly one of metadata_url or metadata_xml is required');
  });

  it('keeps connector record UUID separate from the runtime provider identity', () => {
    const connectors = mergeProvidersWithConnectorConfigs([], [{
      id: 'custom:workos',
      connector_record_id: '11111111-1111-4111-8111-111111111111',
      provider_id: 'custom:workos',
      runtime_kind: 'custom_oidc',
      name: 'WorkOS',
      category: 'enterprise_sso',
      enabled: true,
    }]);

    expect(connectors).toEqual([expect.objectContaining({
      id: 'custom:workos',
      connector_record_id: '11111111-1111-4111-8111-111111111111',
      runtime_kind: 'custom_oidc',
      enabled: true,
    })]);
  });

  it('advertises configuration requirements only for incomplete builtin connectors', () => {
    const connectors = mergeProvidersWithConnectorConfigs([
      { id: 'google', enabled: false },
      { id: 'github', enabled: true, client_id: 'client', secret_configured: true },
    ], []);

    expect(connectors).toEqual([
      expect.objectContaining({ id: 'google', configuration_required: true }),
      expect.objectContaining({ id: 'github', configuration_required: false }),
    ]);
  });

  it('creates, reads back, then stores a secret-free OIDC overlay', async () => {
    const events: string[] = [];
    let savedConfig: Record<string, unknown> | undefined;
    let savedOverlay: Record<string, unknown> | null = null;
    const response = await instantiateConnectorFactory({
      name: 'Enterprise OIDC',
      protocol: 'oidc',
      category: 'enterprise_sso',
      enabled: true,
    }, {
      identifier: 'workos',
      name: 'WorkOS',
      client_id: 'client-id',
      client_secret: 'send-once',
      issuer: 'https://issuer.example.test',
      enabled: true,
    }, {
      createCustomOidc: async request => {
        events.push('create');
        expect(request.client_secret).toBe('send-once');
        return { identifier: 'custom:workos' };
      },
      readCustomOidc: async providerId => {
        events.push('readback');
        expect(providerId).toBe('custom:workos');
        return { identifier: providerId, name: 'WorkOS', client_secret: 'must-not-return' };
      },
      deleteCustomOidc: async () => { throw new Error('unexpected OIDC rollback'); },
      createSaml: async () => { throw new Error('unexpected SAML create'); },
      readSaml: async () => { throw new Error('unexpected SAML readback'); },
      deleteSaml: async () => { throw new Error('unexpected SAML rollback'); },
      saveOverlay: async input => {
        events.push('overlay');
        savedConfig = input.config;
        savedOverlay = {
          id: input.providerId,
          provider_id: input.providerId,
          connector_record_id: '11111111-1111-4111-8111-111111111111',
          runtime_kind: input.runtimeKind,
          name: input.name,
          category: input.category,
          enabled: input.enabled,
          config: input.config,
        };
        return savedOverlay as never;
      },
      readOverlay: async () => {
        events.push('overlay-readback');
        return savedOverlay as never;
      },
    });

    expect(events).toEqual(['create', 'readback', 'overlay', 'overlay-readback']);
    expect(savedConfig).toMatchObject({ secret_configured: true });
    expect(savedConfig).not.toHaveProperty('client_secret');
    expect(JSON.stringify(response)).not.toContain('send-once');
    expect(JSON.stringify(response)).not.toContain('must-not-return');
  });

  it('fails unsupported factories before any upstream or overlay write', async () => {
    const calls: string[] = [];
    await expect(instantiateConnectorFactory({
      name: 'Reserved',
      protocol: 'oauth2',
      category: 'enterprise_sso',
      enabled: true,
    }, {}, {
      createCustomOidc: async () => { calls.push('create-oidc'); return {}; },
      readCustomOidc: async () => { calls.push('read-oidc'); return {}; },
      deleteCustomOidc: async () => { calls.push('delete-oidc'); return {}; },
      createSaml: async () => { calls.push('create-saml'); return {}; },
      readSaml: async () => { calls.push('read-saml'); return {}; },
      deleteSaml: async () => { calls.push('delete-saml'); return {}; },
      saveOverlay: async () => { calls.push('overlay'); return {} as never; },
      readOverlay: async () => { calls.push('read-overlay'); return null; },
    })).rejects.toMatchObject({ code: 'connector_factory_runtime_unavailable' });
    expect(calls).toEqual([]);
  });

  it('uses the SAML request and readback contract before writing its overlay', async () => {
    const events: string[] = [];
    let savedOverlay: Record<string, unknown> | null = null;
    await instantiateConnectorFactory({
      name: 'Enterprise SAML',
      protocol: 'saml',
      category: 'enterprise_sso',
      enabled: true,
    }, {
      name: 'Acme',
      metadata_url: 'https://idp.example.test/metadata',
      enabled: true,
    }, {
      createCustomOidc: async () => { throw new Error('unexpected OIDC create'); },
      readCustomOidc: async () => { throw new Error('unexpected OIDC readback'); },
      deleteCustomOidc: async () => { throw new Error('unexpected OIDC rollback'); },
      createSaml: async request => {
        events.push('create');
        expect(request).toEqual({
          type: 'saml',
          metadata_url: 'https://idp.example.test/metadata',
          disabled: false,
        });
        return { id: 'saml-provider' };
      },
      readSaml: async providerId => {
        events.push('readback');
        return { id: providerId };
      },
      deleteSaml: async () => { throw new Error('unexpected SAML rollback'); },
      saveOverlay: async input => {
        events.push('overlay');
        expect(input.runtimeKind).toBe('saml');
        expect(input.name).toBe('Acme');
        savedOverlay = {
          id: input.providerId,
          provider_id: input.providerId,
          runtime_kind: input.runtimeKind,
          name: input.name,
          category: input.category,
          enabled: input.enabled,
          config: input.config,
        };
        return savedOverlay as never;
      },
      readOverlay: async () => {
        events.push('overlay-readback');
        return savedOverlay as never;
      },
    });
    expect(events).toEqual(['create', 'readback', 'overlay', 'overlay-readback']);
  });

  it('rolls back the upstream connector when the local overlay write fails', async () => {
    const events: string[] = [];
    await expect(instantiateConnectorFactory({
      name: 'Enterprise OIDC', protocol: 'oidc', category: 'enterprise_sso', enabled: true,
    }, {
      identifier: 'workos', name: 'WorkOS', client_id: 'client', client_secret: 'secret',
      issuer: 'https://issuer.example.test', enabled: true,
    }, {
      createCustomOidc: async () => { events.push('create'); return { identifier: 'custom:workos' }; },
      readCustomOidc: async () => { events.push('readback'); return { identifier: 'custom:workos' }; },
      deleteCustomOidc: async () => { events.push('rollback'); return null; },
      createSaml: async () => ({}),
      readSaml: async () => ({}),
      deleteSaml: async () => null,
      saveOverlay: async () => { events.push('overlay'); throw new Error('overlay unavailable'); },
      readOverlay: async () => { events.push('overlay-readback'); return null; },
    })).rejects.toThrow('overlay unavailable');
    expect(events).toEqual(['create', 'readback', 'overlay', 'overlay-readback', 'rollback']);
  });

  it('rolls back the upstream connector when authoritative readback fails', async () => {
    const events: string[] = [];
    await expect(instantiateConnectorFactory({
      name: 'Enterprise OIDC', protocol: 'oidc', category: 'enterprise_sso', enabled: true,
    }, {
      identifier: 'workos', name: 'WorkOS', client_id: 'client', client_secret: 'secret',
      issuer: 'https://issuer.example.test', enabled: true,
    }, {
      createCustomOidc: async () => { events.push('create'); return { identifier: 'custom:workos' }; },
      readCustomOidc: async () => { events.push('readback'); throw new Error('readback unavailable'); },
      deleteCustomOidc: async () => { events.push('rollback'); return null; },
      createSaml: async () => ({}),
      readSaml: async () => ({}),
      deleteSaml: async () => null,
      saveOverlay: async () => { events.push('overlay'); return {} as never; },
      readOverlay: async () => { events.push('overlay-readback'); return null; },
    })).rejects.toThrow('readback unavailable');
    expect(events).toEqual(['create', 'readback', 'rollback']);
  });

  it('reports an unknown outcome when both the overlay write and rollback fail', async () => {
    await expect(instantiateConnectorFactory({
      name: 'Enterprise SAML', protocol: 'saml', category: 'enterprise_sso', enabled: true,
    }, {
      name: 'Acme', metadata_url: 'https://idp.example.test/metadata', enabled: true,
    }, {
      createCustomOidc: async () => ({}),
      readCustomOidc: async () => ({}),
      deleteCustomOidc: async () => null,
      createSaml: async () => ({ id: 'saml-provider' }),
      readSaml: async () => ({ id: 'saml-provider' }),
      deleteSaml: async () => { throw new Error('rollback unavailable'); },
      saveOverlay: async () => { throw new Error('overlay unavailable'); },
      readOverlay: async () => null,
    })).rejects.toMatchObject({ code: 'connector_creation_outcome_unknown' });
  });

  it('keeps a committed overlay when its write response is interrupted', async () => {
    const events: string[] = [];
    const committedOverlay = {
      id: 'custom:workos',
      provider_id: 'custom:workos',
      connector_record_id: '11111111-1111-4111-8111-111111111111',
      runtime_kind: 'custom_oidc',
      name: 'WorkOS',
      category: 'enterprise_sso',
      enabled: true,
      config: {},
    };
    const response = await instantiateConnectorFactory({
      name: 'Enterprise OIDC', protocol: 'oidc', category: 'enterprise_sso', enabled: true,
    }, {
      identifier: 'workos', name: 'WorkOS', client_id: 'client', client_secret: 'secret',
      issuer: 'https://issuer.example.test', enabled: true,
    }, {
      createCustomOidc: async () => ({ identifier: 'custom:workos' }),
      readCustomOidc: async () => ({ identifier: 'custom:workos', name: 'WorkOS' }),
      deleteCustomOidc: async () => { events.push('rollback'); return null; },
      createSaml: async () => ({}),
      readSaml: async () => ({}),
      deleteSaml: async () => null,
      saveOverlay: async () => { events.push('overlay'); throw new TypeError('response interrupted'); },
      readOverlay: async () => { events.push('overlay-readback'); return committedOverlay; },
    });

    expect(response).toMatchObject({ connector_record_id: committedOverlay.connector_record_id });
    expect(events).toEqual(['overlay', 'overlay-readback']);
  });

  it('does not delete the runtime when overlay readback is unavailable', async () => {
    let rollbackCalls = 0;
    await expect(instantiateConnectorFactory({
      name: 'Enterprise OIDC', protocol: 'oidc', category: 'enterprise_sso', enabled: true,
    }, {
      identifier: 'workos', name: 'WorkOS', client_id: 'client', client_secret: 'secret',
      issuer: 'https://issuer.example.test', enabled: true,
    }, {
      createCustomOidc: async () => ({ identifier: 'custom:workos' }),
      readCustomOidc: async () => ({ identifier: 'custom:workos' }),
      deleteCustomOidc: async () => { rollbackCalls += 1; return null; },
      createSaml: async () => ({}),
      readSaml: async () => ({}),
      deleteSaml: async () => null,
      saveOverlay: async () => { throw new TypeError('response interrupted'); },
      readOverlay: async () => { throw new Error('overlay readback unavailable'); },
    })).rejects.toMatchObject({ code: 'connector_creation_outcome_unknown' });
    expect(rollbackCalls).toBe(0);
  });
});
