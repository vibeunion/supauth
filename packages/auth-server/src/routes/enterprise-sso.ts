// Enterprise SSO routes (P1-9) with OpenAPI annotations

import { Elysia } from 'elysia';
import * as ssoRepo from '../repositories/enterprise-sso.js';
import * as connectorRepo from '../repositories/connectors.js';
import * as auditRepo from '../repositories/audit.js';
import { getSupaCloudAdapter } from '../supacloud/adapter.js';
import { ApiContractError, pagedResponse, isRecord } from '../utils/api-contract.js';
import { configurationContract, decodeConfigurationInput } from '../utils/configuration-contract.js';
import { definedFields, requiredRow } from '../utils/defined-fields.js';

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
    decodeConfigurationInput('listEnterpriseSSOConfigs', {});
    const items = await ssoRepo.listEnterpriseSSOConfigs();
    return pagedResponse(items);
  }, configurationContract('listEnterpriseSSOConfigs', {
    detail: { summary: 'List enterprise SSO configurations', tags: ['Enterprise SSO'] },
  }))

  .get('/domain/:domain', async ({ params }) => {
    decodeConfigurationInput('discoverEnterpriseSSO', { params });
    const config = await ssoRepo.findSSOConfigByDomain(params.domain);
    if (!config) return new Response('No SSO config found for domain', { status: 404 });
    return config;
  }, configurationContract('discoverEnterpriseSSO', {
    detail: { summary: 'Find SSO config by email domain (domain discovery)', tags: ['Enterprise SSO'] },
  }))

  .get('/:id', async ({ params }) => {
    decodeConfigurationInput('getEnterpriseSSOConfig', { params });
    const config = await ssoRepo.getEnterpriseSSOConfigById(params.id);
    if (!config) throw new ApiContractError(404, 'enterprise_sso_not_found', 'Enterprise SSO configuration was not found');
    return config;
  }, configurationContract('getEnterpriseSSOConfig', {
    detail: { summary: 'Get inbound enterprise SSO configuration', tags: ['Enterprise SSO'] },
  }))

  .post('/', async ({ body }) => {
    validateInboundSSOFields(body);
    const { body: data } = decodeConfigurationInput('createEnterpriseSSOConfig', { body });
    const protocol = await validateInboundSSO(definedFields({ connectorId: data.connector_id, protocol: data.sso_protocol, domains: data.domains }));
    const config = requiredRow(await ssoRepo.createEnterpriseSSOConfig(definedFields({
      connectorId: data.connector_id,
      domains: data.domains,
      ssoProtocol: protocol,
      jitProvisioning: data.jit_provisioning ?? undefined,
      orgMembershipMapping: data.org_membership_mapping ?? undefined,
      roleMapping: data.role_mapping ?? undefined,
    })));
    await audit('enterprise_sso.create', 'enterprise_sso', config.id, { connector_id: data.connector_id, domains: data.domains });
    return config;
  }, configurationContract('createEnterpriseSSOConfig', {
    detail: { summary: 'Create enterprise SSO configuration', tags: ['Enterprise SSO'] },
  }))

  .put('/:id', async ({ params, body }) => {
    const current = await ssoRepo.getEnterpriseSSOConfigById(params.id);
    if (!current) throw new ApiContractError(404, 'enterprise_sso_not_found', 'Enterprise SSO configuration was not found');
    validateInboundSSOFields(body, current.connectorId, current.domains);
    const { body: data } = decodeConfigurationInput('updateEnterpriseSSOConfig', { params, body });
    await validateInboundSSO({
      connectorId: current.connectorId,
      protocol: data.sso_protocol || current.ssoProtocol,
      domains: data.domains || current.domains,
    });
    const updated = await ssoRepo.updateEnterpriseSSOConfig(params.id, data);
    await audit('enterprise_sso.update', 'enterprise_sso', params.id);
    return updated;
  }, configurationContract('updateEnterpriseSSOConfig', {
    detail: { summary: 'Update enterprise SSO configuration', tags: ['Enterprise SSO'] },
  }))

  .delete('/:id', async ({ params }) => {
    decodeConfigurationInput('deleteEnterpriseSSOConfig', { params });
    await ssoRepo.deleteEnterpriseSSOConfig(params.id);
    await audit('enterprise_sso.delete', 'enterprise_sso', params.id);
  }, configurationContract('deleteEnterpriseSSOConfig', {
    detail: { summary: 'Delete enterprise SSO configuration', tags: ['Enterprise SSO'] },
  }));

function validateInboundSSOFields(body: unknown, connectorId?: string, domains?: unknown) {
  const source = body && typeof body === 'object' ? body : {};
  const id = connectorId ?? ('connector_id' in source ? source.connector_id : undefined);
  if (typeof id !== 'string' || !UUID_PATTERN.test(id)) {
    throw new ApiContractError(400, 'invalid_enterprise_sso_connector', 'Enterprise SSO connector must be an internal connector UUID');
  }
  const protocol = 'sso_protocol' in source ? source.sso_protocol : undefined;
  if (protocol !== undefined && protocol !== 'oidc' && protocol !== 'saml') {
    throw new ApiContractError(400, 'invalid_enterprise_sso_protocol', 'Inbound enterprise SSO protocol must be oidc or saml');
  }
  const requestedDomains = ('domains' in source ? source.domains : undefined) || domains;
  if (!Array.isArray(requestedDomains) || requestedDomains.length === 0
    || requestedDomains.some((domain: unknown) => typeof domain !== 'string' || !domain.trim())) {
    throw new ApiContractError(400, 'invalid_enterprise_sso_domains', 'Enterprise SSO domains must be non-empty strings');
  }
}

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
  const readbackIdentity = isRecord(readback)
    ? readback[connectorProtocol === 'saml' ? 'id' : 'identifier']
    : null;
  if (readbackIdentity !== connector.provider_id) {
    throw new ApiContractError(502, 'enterprise_sso_connector_readback_mismatch', 'Enterprise connector authoritative readback did not match its runtime identity');
  }
  return connectorProtocol;
}
