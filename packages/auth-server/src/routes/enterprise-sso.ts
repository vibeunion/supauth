// Enterprise SSO routes (P1-9) with OpenAPI annotations

import { Elysia } from 'elysia';
import * as ssoRepo from '../repositories/enterprise-sso.js';
import * as connectorRepo from '../repositories/connectors.js';
import * as auditRepo from '../repositories/audit.js';
import { getSupaCloudAdapter } from '../supacloud/adapter.js';
import { ApiContractError, pagedResponse } from '../utils/api-contract.js';

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const adapter = getSupaCloudAdapter();

interface EnterpriseConnectorInfo {
  provider_id: string;
  runtime_kind: string;
  enabled: boolean;
  category: string;
}

interface InboundSSOValidationDependencies {
  getEnabledConnector: (connectorId: string) => Promise<EnterpriseConnectorInfo | null>;
  readCustomOidc: (providerId: string) => Promise<unknown>;
  readSaml: (providerId: string) => Promise<unknown>;
}

const defaultValidationDependencies: InboundSSOValidationDependencies = {
  getEnabledConnector: connectorRepo.getConnectorConfigByRecordId,
  readCustomOidc: providerId => adapter.getCustomOidcProvider(providerId),
  readSaml: providerId => adapter.getSamlProvider(providerId),
};

async function audit(eventType: string, resourceType: string, resourceId: string, details?: Record<string, unknown>) {
  await auditRepo.logAudit({ eventType, resourceType, resourceId, actorType: 'admin', details });
}

export const enterpriseSSORoutes = new Elysia({ prefix: '/v1/enterprise-sso' })
  .get('/', async () => {
    const items = await ssoRepo.listEnterpriseSSOConfigs();
    return pagedResponse(items);
  }, {
    detail: { summary: 'List enterprise SSO configurations', tags: ['Enterprise SSO'] },
  })

  .get('/domain/:domain', async ({ params }) => {
    const config = await ssoRepo.findSSOConfigByDomain(params.domain);
    if (!config) return new Response('No SSO config found for domain', { status: 404 });
    return config;
  }, {
    detail: { summary: 'Find SSO config by email domain (domain discovery)', tags: ['Enterprise SSO'] },
  })

  .get('/:id', async ({ params }) => {
    const config = await ssoRepo.getEnterpriseSSOConfigById(params.id);
    if (!config) throw new ApiContractError(404, 'enterprise_sso_not_found', 'Enterprise SSO configuration was not found');
    return config;
  }, {
    detail: { summary: 'Get inbound enterprise SSO configuration', tags: ['Enterprise SSO'] },
  })

  .post('/', async ({ body }) => {
    const data = body as { connector_id: string; domains: string[]; sso_protocol?: string; jit_provisioning?: boolean; org_membership_mapping?: Record<string, string>; role_mapping?: Record<string, string> };
    const protocol = await validateInboundSSO({ connectorId: data.connector_id, protocol: data.sso_protocol, domains: data.domains });
    const config = await ssoRepo.createEnterpriseSSOConfig({
      connectorId: data.connector_id,
      domains: data.domains,
      ssoProtocol: protocol,
      jitProvisioning: data.jit_provisioning,
      orgMembershipMapping: data.org_membership_mapping,
      roleMapping: data.role_mapping,
    });
    await audit('enterprise_sso.create', 'enterprise_sso', config.id, { connector_id: data.connector_id, domains: data.domains });
    return config;
  }, {
    detail: { summary: 'Create enterprise SSO configuration', tags: ['Enterprise SSO'] },
  })

  .put('/:id', async ({ params, body }) => {
    const data = body as { domains?: string[]; sso_protocol?: string; jit_provisioning?: boolean; org_membership_mapping?: Record<string, string>; role_mapping?: Record<string, string> };
    const current = await ssoRepo.getEnterpriseSSOConfigById(params.id);
    if (!current) throw new ApiContractError(404, 'enterprise_sso_not_found', 'Enterprise SSO configuration was not found');
    await validateInboundSSO({
      connectorId: current.connectorId,
      protocol: data.sso_protocol || current.ssoProtocol,
      domains: data.domains || current.domains,
    });
    const updated = await ssoRepo.updateEnterpriseSSOConfig(params.id, data);
    await audit('enterprise_sso.update', 'enterprise_sso', params.id);
    return updated;
  }, {
    detail: { summary: 'Update enterprise SSO configuration', tags: ['Enterprise SSO'] },
  })

  .delete('/:id', async ({ params }) => {
    await ssoRepo.deleteEnterpriseSSOConfig(params.id);
    await audit('enterprise_sso.delete', 'enterprise_sso', params.id);
  }, {
    detail: { summary: 'Delete enterprise SSO configuration', tags: ['Enterprise SSO'] },
  });

export async function validateInboundSSO(
  input: { connectorId: string; protocol?: string; domains: string[] },
  dependencies: InboundSSOValidationDependencies = defaultValidationDependencies,
) {
  if (!UUID_PATTERN.test(input.connectorId)) {
    throw new ApiContractError(400, 'invalid_enterprise_sso_connector', 'Enterprise SSO connector must be an internal connector UUID');
  }
  if (input.protocol !== undefined && !['oidc', 'saml'].includes(input.protocol)) {
    throw new ApiContractError(400, 'invalid_enterprise_sso_protocol', 'Inbound enterprise SSO protocol must be oidc or saml');
  }
  if (!Array.isArray(input.domains)
    || input.domains.length === 0
    || input.domains.some((domain) => typeof domain !== 'string' || !domain.trim())) {
    throw new ApiContractError(400, 'invalid_enterprise_sso_domains', 'Enterprise SSO domains must be non-empty strings');
  }
  const connector = await dependencies.getEnabledConnector(input.connectorId);
  if (!connector || connector.enabled !== true || connector.category !== 'enterprise_sso') {
    throw new ApiContractError(400, 'enterprise_sso_connector_unavailable', 'Enterprise SSO requires an enabled enterprise connector');
  }
  const connectorProtocol = connector.runtime_kind === 'saml' ? 'saml' : 'oidc';
  if (!['custom_oidc', 'saml'].includes(connector.runtime_kind)) {
    throw new ApiContractError(400, 'enterprise_sso_connector_unavailable', 'Connector does not provide an enterprise SSO runtime');
  }
  if (input.protocol && input.protocol !== connectorProtocol) {
    throw new ApiContractError(400, 'enterprise_sso_protocol_mismatch', 'Enterprise SSO protocol does not match the selected connector');
  }
  const readback = connectorProtocol === 'saml'
    ? await dependencies.readSaml(connector.provider_id)
    : await dependencies.readCustomOidc(connector.provider_id);
  const readbackIdentity = readback && typeof readback === 'object'
    ? (readback as Record<string, unknown>)[connectorProtocol === 'saml' ? 'id' : 'identifier']
    : null;
  if (readbackIdentity !== connector.provider_id) {
    throw new ApiContractError(502, 'enterprise_sso_connector_readback_mismatch', 'Enterprise connector authoritative readback did not match its runtime identity');
  }
  return connectorProtocol;
}
