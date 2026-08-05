import { describe, expect, it } from 'bun:test';
import { validateInboundSSO } from '../routes/enterprise-sso.js';

const connectorRecordId = '11111111-1111-4111-8111-111111111111';
const domains = ['example.test'];

describe('enterprise SSO connector validation', () => {
  it('reads back a custom OIDC runtime identity before accepting the connector UUID', async () => {
    const readbackIds: string[] = [];
    const protocol = await validateInboundSSO({ connectorId: connectorRecordId, domains }, {
      getEnabledConnector: async () => ({
        provider_id: 'custom:workos',
        runtime_kind: 'custom_oidc',
        enabled: true,
        category: 'enterprise_sso',
      }),
      readCustomOidc: async providerId => {
        readbackIds.push(providerId);
        return { identifier: providerId };
      },
      readSaml: async () => {
        throw new Error('SAML readback must not be used for OIDC');
      },
    });

    expect(protocol).toBe('oidc');
    expect(readbackIds).toEqual(['custom:workos']);
  });

  it('rejects protocol mismatch before reading the upstream runtime', async () => {
    let readbackCalls = 0;
    await expect(validateInboundSSO({
      connectorId: connectorRecordId,
      domains,
      protocol: 'oidc',
    }, {
      getEnabledConnector: async () => ({
        provider_id: 'saml-provider',
        runtime_kind: 'saml',
        enabled: true,
        category: 'enterprise_sso',
      }),
      readCustomOidc: async () => {
        readbackCalls += 1;
        return {};
      },
      readSaml: async () => {
        readbackCalls += 1;
        return {};
      },
    })).rejects.toMatchObject({ code: 'enterprise_sso_protocol_mismatch' });
    expect(readbackCalls).toBe(0);
  });

  it('fails closed when the authoritative SAML provider no longer exists or mismatches', async () => {
    await expect(validateInboundSSO({ connectorId: connectorRecordId, domains }, {
      getEnabledConnector: async () => ({
        provider_id: 'saml-provider',
        runtime_kind: 'saml',
        enabled: true,
        category: 'enterprise_sso',
      }),
      readCustomOidc: async () => ({}),
      readSaml: async () => ({ id: 'different-provider' }),
    })).rejects.toMatchObject({ code: 'enterprise_sso_connector_readback_mismatch' });
  });

  it('rejects invalid UUIDs and disabled or non-enterprise connector records', async () => {
    const unreachable = async () => { throw new Error('runtime readback must not run'); };
    await expect(validateInboundSSO({ connectorId: connectorRecordId, domains: [] }, {
      getEnabledConnector: unreachable,
      readCustomOidc: unreachable,
      readSaml: unreachable,
    })).rejects.toMatchObject({ code: 'invalid_enterprise_sso_domains' });
    await expect(validateInboundSSO({ connectorId: 'custom:workos', domains }, {
      getEnabledConnector: async () => null,
      readCustomOidc: unreachable,
      readSaml: unreachable,
    })).rejects.toMatchObject({ code: 'invalid_enterprise_sso_connector' });

    for (const connector of [
      { provider_id: 'custom:workos', runtime_kind: 'custom_oidc', enabled: false, category: 'enterprise_sso' },
      { provider_id: 'custom:workos', runtime_kind: 'custom_oidc', enabled: true, category: 'social' },
    ]) {
      await expect(validateInboundSSO({ connectorId: connectorRecordId, domains }, {
        getEnabledConnector: async () => connector,
        readCustomOidc: unreachable,
        readSaml: unreachable,
      })).rejects.toMatchObject({ code: 'enterprise_sso_connector_unavailable' });
    }
  });
});
