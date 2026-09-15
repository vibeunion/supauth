// Connector management routes with OpenAPI annotations

import { Elysia } from 'elysia';
import {
  getSupaCloudAdapter,
  isSupaCloudApiError,
  type ConnectorRuntimeKind,
} from '../supacloud/adapter.js';
import * as auditRepo from '../repositories/audit.js';
import * as webhookDelivery from '../repositories/webhook-delivery.js';
import * as tenantConfigRepo from '../repositories/tenant-config.js';
import * as connectorRepo from '../repositories/connectors.js';
import { ApiContractError, pagedResponse, isRecord } from '../utils/api-contract.js';
import { withoutSecrets } from '../utils/secrets.js';
import { configurationContract, decodeConfigurationInput, decodeConfigurationResponse } from '../utils/configuration-contract.js';
import { BuiltinOAuthProvidersSchema, ConnectorFactoryStoredConfigSchema } from '../../../shared/src/server-configuration.js';
import { definedFields } from '../utils/defined-fields.js';
import { decodeProviderReadback, type ProviderReadback as ProviderInfo } from '../utils/upstream-contract.js';
export type { ProviderReadback as ProviderInfo } from '../utils/upstream-contract.js';

const adapter = getSupaCloudAdapter();
const MAX_CONNECTOR_CLIENT_ID_LENGTH = 255;

async function audit(eventType: string, resourceType: string, resourceId: string, details?: Record<string, unknown>) {
  await auditRepo.logAudit({ eventType, resourceType, resourceId, actorType: 'admin', details });
}

async function fireWebhook(eventType: string, data: Record<string, unknown>) {
  await webhookDelivery.dispatchEvent(webhookDelivery.buildEvent(eventType, data));
}

interface ConnectorConfigInfo {
  id: string;
  connector_record_id?: string;
  provider_id?: string;
  runtime_kind?: string;
  enabled?: boolean;
  name?: string;
  category?: string;
  config?: Record<string, unknown>;
}

export interface FactoryInfo {
  name: string;
  protocol: string;
  category: string;
  enabled: boolean;
}

interface FactoryInstantiationDependencies {
  createCustomOidc: (request: Record<string, unknown>) => Promise<unknown>;
  readCustomOidc: (providerId: string) => Promise<unknown>;
  deleteCustomOidc: (providerId: string) => Promise<unknown>;
  createSaml: (request: Record<string, unknown>) => Promise<unknown>;
  readSaml: (providerId: string) => Promise<unknown>;
  deleteSaml: (providerId: string) => Promise<unknown>;
  saveOverlay: (input: connectorRepo.ConnectorConfigInput) => Promise<ConnectorConfigInfo>;
  readOverlay: (providerId: string) => Promise<ConnectorConfigInfo | null>;
}

interface ConnectorEnabledUpdateInput {
  providerId: string;
  runtimeKind: ConnectorRuntimeKind;
  enabled: boolean;
  existingConfig: ConnectorConfigInfo | null;
}

interface ConnectorEnabledUpdateDependencies {
  readRuntime: (providerId: string, runtimeKind: ConnectorRuntimeKind) => Promise<unknown>;
  updateRuntime: (
    providerId: string,
    runtimeKind: ConnectorRuntimeKind,
    updateInput: Record<string, unknown>,
  ) => Promise<unknown>;
  saveOverlay: (input: connectorRepo.ConnectorConfigInput) => Promise<ConnectorConfigInfo>;
  readOverlay: (providerId: string) => Promise<ConnectorConfigInfo | null>;
}

function providerId(provider: ProviderInfo) {
  return String(provider.id || '');
}

function providerName(provider: ProviderInfo, fallbackId: string) {
  return String(provider.name || provider.id || fallbackId);
}

function providerCategory(provider: ProviderInfo) {
  return String(provider.type || 'social');
}

function nonEmptyProviderSetting(provider: ProviderInfo, field: string) {
  return typeof provider[field] === 'string' && String(provider[field]).trim().length > 0;
}

function builtinConnectorConfigured(provider: ProviderInfo) {
  const clientConfigured = nonEmptyProviderSetting(provider, 'client_id')
    || nonEmptyProviderSetting(provider, 'clientId');
  const secretConfigured = provider["secret_configured"] === true
    || nonEmptyProviderSetting(provider, 'client_secret')
    || nonEmptyProviderSetting(provider, 'clientSecret');
  return clientConfigured && secretConfigured;
}

function providerInfo(payload: unknown, fallbackId: string): ProviderInfo {
  return decodeProviderReadback(payload, fallbackId);
}

function connectorRuntimeKind(config?: ConnectorConfigInfo | null): ConnectorRuntimeKind {
  const runtimeKind = config?.runtime_kind || 'builtin_oauth';
  if (runtimeKind === 'builtin_oauth' || runtimeKind === 'custom_oidc' || runtimeKind === 'saml') return runtimeKind;
  throw new ApiContractError(500, 'invalid_connector_runtime_kind', 'Connector runtime kind is invalid');
}

async function authoritativeConnector(providerId: string, runtimeKind: ConnectorRuntimeKind) {
  if (runtimeKind === 'custom_oidc') return adapter.getCustomOidcProvider(providerId);
  if (runtimeKind === 'saml') return adapter.getSamlProvider(providerId);
  return adapter.getProvider(providerId);
}

async function updateConnectorRuntime(
  providerId: string,
  runtimeKind: ConnectorRuntimeKind,
  updateInput: Record<string, unknown>,
) {
  if (runtimeKind === 'builtin_oauth') return updateBuiltinConnectorRuntime(providerId, updateInput);
  if (updateInput["enabled"] === undefined) return authoritativeConnector(providerId, runtimeKind);
  const enabledUpdate = enterpriseConnectorEnabledUpdate(runtimeKind, updateInput["enabled"] === true);
  if (runtimeKind === 'custom_oidc') return adapter.updateCustomOidcProvider(providerId, enabledUpdate);
  return adapter.updateSamlProvider(providerId, enabledUpdate);
}

export function enterpriseConnectorEnabledUpdate(
  runtimeKind: Exclude<ConnectorRuntimeKind, 'builtin_oauth'>,
  enabled: boolean,
) {
  return runtimeKind === 'custom_oidc' ? { enabled } : { disabled: !enabled };
}

const defaultEnabledUpdateDependencies: ConnectorEnabledUpdateDependencies = {
  readRuntime: authoritativeConnector,
  updateRuntime: updateConnectorRuntime,
  saveOverlay: input => connectorRepo.upsertConnectorConfig(input),
  readOverlay: providerId => connectorRepo.getConnectorConfig(providerId),
};

function runtimeEnabled(payload: unknown, runtimeKind: ConnectorRuntimeKind) {
  if (!isRecord(payload)) {
    throw new ApiContractError(502, 'invalid_upstream_response', 'Connector runtime readback has an invalid shape');
  }
  const runtime = payload;
  if (runtimeKind === 'saml') {
    if (!Object.prototype.hasOwnProperty.call(runtime, 'disabled')) {
      throw new ApiContractError(502, 'invalid_upstream_response', 'SAML connector readback did not include its disabled state');
    }
    if (runtime["disabled"] === true) return false;
    if (runtime["disabled"] === false || runtime["disabled"] === null) return true;
    throw new ApiContractError(502, 'invalid_upstream_response', 'SAML connector disabled state is invalid');
  }
  const enabled = runtime["enabled"];
  if (typeof enabled !== 'boolean') {
    throw new ApiContractError(502, 'invalid_upstream_response', 'Connector runtime readback did not include its enabled state');
  }
  return enabled;
}

async function readRuntimeState(
  input: Pick<ConnectorEnabledUpdateInput, 'providerId' | 'runtimeKind'>,
  dependencies: ConnectorEnabledUpdateDependencies,
) {
  const runtime = await dependencies.readRuntime(input.providerId, input.runtimeKind);
  if (input.runtimeKind !== 'builtin_oauth'
    && upstreamConnectorId(runtime, input.runtimeKind) !== input.providerId) {
    throw new ApiContractError(502, 'connector_readback_mismatch', 'Connector runtime readback identity did not match');
  }
  return {
    provider: providerInfo(runtime, input.providerId),
    enabled: runtimeEnabled(runtime, input.runtimeKind),
  };
}

function updateOutcomeUnknown() {
  return new ApiContractError(
    503,
    'connector_update_outcome_unknown',
    'Connector update could not be reconciled safely',
  );
}

async function readCommittedRuntimeState(
  input: ConnectorEnabledUpdateInput,
  dependencies: ConnectorEnabledUpdateDependencies,
) {
  try {
    return await readRuntimeState(input, dependencies);
  } catch {
    throw updateOutcomeUnknown();
  }
}

async function updateRuntimeEnabled(
  input: ConnectorEnabledUpdateInput,
  previousEnabled: boolean,
  dependencies: ConnectorEnabledUpdateDependencies,
) {
  try {
    await dependencies.updateRuntime(input.providerId, input.runtimeKind, { enabled: input.enabled });
  } catch (updateError) {
    const readback = await readCommittedRuntimeState(input, dependencies);
    if (readback.enabled === input.enabled) return readback;
    if (readback.enabled === previousEnabled) throw updateError;
    throw updateOutcomeUnknown();
  }
  const readback = await readCommittedRuntimeState(input, dependencies);
  if (readback.enabled !== input.enabled) throw updateOutcomeUnknown();
  return readback;
}

function updatedOverlayInput(input: ConnectorEnabledUpdateInput, runtime: ProviderInfo) {
  return {
    providerId: input.providerId,
    runtimeKind: input.runtimeKind,
    name: input.existingConfig?.name || providerName(runtime, input.providerId),
    category: input.existingConfig?.category || providerCategory(runtime),
    enabled: input.enabled,
    config: input.existingConfig?.config || {},
  };
}

async function persistUpdatedOverlay(
  expected: connectorRepo.ConnectorConfigInput,
  dependencies: ConnectorEnabledUpdateDependencies,
) {
  try {
    await dependencies.saveOverlay(expected);
  } catch {
    // 写入响应中断时数据库可能已提交，只有权威读回才能决定结果。
  }
  let overlay: ConnectorConfigInfo | null;
  try {
    overlay = await dependencies.readOverlay(expected.providerId);
  } catch {
    throw updateOutcomeUnknown();
  }
  if (!overlay || !connectorOverlayMatches(overlay, expected)) throw updateOutcomeUnknown();
  return overlay;
}

function mergedConnectorState(
  runtime: ProviderInfo,
  overlay: ConnectorConfigInfo,
  providerEnabled: boolean,
) {
  return withoutSecrets({
    ...runtime,
    id: overlay.provider_id || runtime.id,
    name: overlay.name || runtime.name,
    type: overlay.category || runtime.type,
    provider_enabled: providerEnabled,
    enabled: overlay.enabled === true,
    connector_record_id: overlay.connector_record_id,
    runtime_kind: overlay.runtime_kind,
  });
}

export async function updateConnectorEnabledState(
  input: ConnectorEnabledUpdateInput,
  dependencies: ConnectorEnabledUpdateDependencies = defaultEnabledUpdateDependencies,
) {
  const previousRuntime = await readRuntimeState(input, dependencies);
  if (input.runtimeKind === 'builtin_oauth'
    && input.enabled
    && (!previousRuntime.enabled || !builtinConnectorConfigured(previousRuntime.provider))) {
    throw new ApiContractError(
      409,
      'connector_configuration_required',
      'Connector credentials must be configured before enabling the connector',
    );
  }
  const updatedRuntime = input.runtimeKind === 'builtin_oauth'
    ? previousRuntime
    : await updateRuntimeEnabled(input, previousRuntime.enabled, dependencies);
  const expectedOverlay = updatedOverlayInput(input, updatedRuntime.provider);
  const overlay = await persistUpdatedOverlay(expectedOverlay, dependencies);
  return mergedConnectorState(updatedRuntime.provider, overlay, updatedRuntime.enabled);
}

export async function verifiedConnectorState(
  providerId: string,
  config: ConnectorConfigInfo | null,
  dependencies: ConnectorEnabledUpdateDependencies = defaultEnabledUpdateDependencies,
) {
  const runtimeKind = connectorRuntimeKind(config);
  const runtime = await readRuntimeState({ providerId, runtimeKind }, dependencies);
  if (!config) {
    return withoutSecrets({
      ...runtime.provider,
      provider_enabled: runtime.enabled,
      enabled: false,
      runtime_kind: runtimeKind,
      configuration_required: !builtinConnectorConfigured(runtime.provider),
    });
  }
  if (runtimeKind !== 'builtin_oauth' && config.enabled !== runtime.enabled) throw updateOutcomeUnknown();
  return mergedConnectorState(runtime.provider, config, runtime.enabled);
}

export async function notifyCommittedConnectorUpdate(
  connectorId: string,
  dependencies: { writeAudit: typeof audit; dispatchWebhook: typeof fireWebhook } = {
    writeAudit: audit,
    dispatchWebhook: fireWebhook,
  },
) {
  try {
    await dependencies.writeAudit('connector.update', 'connector', connectorId);
    await dependencies.dispatchWebhook('connector.updated', { connector_id: connectorId });
  } catch {
    throw updateOutcomeUnknown();
  }
}

export function mergeProvidersWithConnectorConfigs(
  providers: ProviderInfo[],
  connectorConfigs: ConnectorConfigInfo[],
) {
  const configByProviderId = new Map(
    connectorConfigs.map(config => [String(config.provider_id || config.id), config]),
  );

  const mergedProviders = providers.map(provider => {
    const id = providerId(provider);
    const config = configByProviderId.get(id);
    const runtimeKind = connectorRuntimeKind(config);
    return {
      ...provider,
      id,
      name: config?.name || provider.name || id,
      type: config?.category || provider.type || 'social',
      provider_enabled: provider.enabled === true,
      enabled: config?.enabled === true,
      configuration_required: runtimeKind === 'builtin_oauth'
        && !builtinConnectorConfigured(provider),
      connector_record_id: config?.connector_record_id,
      runtime_kind: runtimeKind,
    };
  });
  const upstreamProviderIds = new Set(mergedProviders.map(provider => provider.id));
  const enterpriseOverlays = connectorConfigs
    .filter(config => config.category === 'enterprise_sso' && !upstreamProviderIds.has(String(config.provider_id || config.id)))
    .map(config => ({
      id: String(config.provider_id || config.id),
      name: config.name || config.provider_id || config.id,
      type: config.category,
      enabled: config.enabled === true,
      connector_record_id: config.connector_record_id,
      runtime_kind: config.runtime_kind,
      config: config.config || {},
    }));
  return [...mergedProviders, ...enterpriseOverlays];
}

function requiredString(input: Record<string, unknown>, field: string) {
  const fieldValue = input[field];
  if (typeof fieldValue !== 'string' || !fieldValue.trim()) {
    throw new ApiContractError(400, 'invalid_connector_factory_input', `${field} is required`);
  }
  return fieldValue.trim();
}

function connectorClientId(input: Record<string, unknown>) {
  const clientId = input["client_id"];
  if (typeof clientId !== 'string'
    || !clientId.trim()
    || clientId.length > MAX_CONNECTOR_CLIENT_ID_LENGTH) {
    throw new ApiContractError(
      400,
      'invalid_connector_client_id',
      `client_id must contain between 1 and ${MAX_CONNECTOR_CLIENT_ID_LENGTH} characters`,
    );
  }
  return clientId.trim();
}

function builtinConnectorUpdateRequest(input: Record<string, unknown>) {
  if (!Object.prototype.hasOwnProperty.call(input, 'client_id')) return input;
  return { ...input, client_id: connectorClientId(input) };
}

export async function updateBuiltinConnectorRuntime(
  providerId: string,
  input: Record<string, unknown>,
  updateProvider: (providerId: string, input: Record<string, unknown>) => Promise<unknown>
    = (id, updateInput) => adapter.updateProvider(id, updateInput),
) {
  return updateProvider(providerId, builtinConnectorUpdateRequest(input));
}

function customProviderIdentifier(input: Record<string, unknown>) {
  const requestedIdentifier = requiredString(input, 'identifier').toLowerCase();
  const suffix = requestedIdentifier.startsWith('custom:')
    ? requestedIdentifier.slice('custom:'.length)
    : requestedIdentifier;
  if (!/^[a-z0-9][a-z0-9._-]{0,63}$/.test(suffix)) {
    throw new ApiContractError(400, 'invalid_connector_factory_input', 'identifier must be a valid custom provider name');
  }
  return `custom:${suffix}`;
}

function optionalStringList(input: Record<string, unknown>, field: string) {
  const fieldValue = input[field];
  if (fieldValue === undefined || fieldValue === '') return undefined;
  if (Array.isArray(fieldValue) && fieldValue.every(
    (entry: unknown): entry is string => typeof entry === 'string' && entry.trim().length > 0,
  )) {
    return fieldValue.map(entry => entry.trim());
  }
  if (typeof fieldValue === 'string') return fieldValue.split(',').map(entry => entry.trim()).filter(Boolean);
  throw new ApiContractError(400, 'invalid_connector_factory_input', `${field} must be a string list`);
}

function optionalString(input: Record<string, unknown>, field: string) {
  const fieldValue = input[field];
  if (fieldValue === undefined || fieldValue === '') return undefined;
  return requiredString(input, field);
}

function optionalRecord(input: Record<string, unknown>, field: string) {
  const fieldValue = input[field];
  if (fieldValue === undefined || fieldValue === '') return undefined;
  if (fieldValue && typeof fieldValue === 'object' && !Array.isArray(fieldValue)) return fieldValue;
  if (typeof fieldValue !== 'string') {
    throw new ApiContractError(400, 'invalid_connector_factory_input', `${field} must be a JSON object`);
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(fieldValue);
  } catch {
    throw new ApiContractError(400, 'invalid_connector_factory_input', `${field} must be valid JSON`);
  }
  if (!isRecord(parsed)) {
    throw new ApiContractError(400, 'invalid_connector_factory_input', `${field} must be a JSON object`);
  }
  return parsed;
}

export function customOidcFactoryRequest(input: Record<string, unknown>) {
  const scopes = optionalStringList(input, 'scopes');
  return {
    provider_type: 'oidc',
    identifier: customProviderIdentifier(input),
    name: requiredString(input, 'name'),
    client_id: connectorClientId(input),
    client_secret: requiredString(input, 'client_secret'),
    issuer: requiredString(input, 'issuer'),
    enabled: input["enabled"] === true,
    pkce_enabled: true,
    ...(scopes ? { scopes } : {}),
  };
}

export function samlFactoryRequest(input: Record<string, unknown>): Record<string, unknown> {
  requiredString(input, 'name');
  const optionalFields = ['resource_id', 'name_id_format'] as const;
  const metadataUrl = optionalString(input, 'metadata_url');
  const metadataXml = optionalString(input, 'metadata_xml');
  if ((!metadataUrl && !metadataXml) || (metadataUrl && metadataXml)) {
    throw new ApiContractError(400, 'invalid_connector_factory_input', 'exactly one of metadata_url or metadata_xml is required');
  }
  const domains = optionalStringList(input, 'domains');
  const attributeMapping = optionalRecord(input, 'attribute_mapping');
  return {
    type: 'saml',
    ...Object.fromEntries(optionalFields
      .filter(field => input[field] !== undefined && input[field] !== '')
      .map(field => [field, requiredString(input, field)])),
    ...(metadataUrl ? { metadata_url: metadataUrl } : {}),
    ...(metadataXml ? { metadata_xml: metadataXml } : {}),
    ...(domains ? { domains } : {}),
    ...(attributeMapping ? { attribute_mapping: attributeMapping } : {}),
    disabled: input["enabled"] !== true,
  };
}

function upstreamConnectorId(payload: unknown, runtimeKind: ConnectorRuntimeKind) {
  if (!isRecord(payload)) return '';
  const record = payload;
  const identifier = runtimeKind === 'custom_oidc' ? record["identifier"] : record["id"];
  return typeof identifier === 'string' ? identifier : '';
}

const defaultFactoryDependencies: FactoryInstantiationDependencies = {
  createCustomOidc: request => adapter.createCustomOidcProvider(request),
  readCustomOidc: providerId => adapter.getCustomOidcProvider(providerId),
  deleteCustomOidc: providerId => adapter.deleteCustomOidcProvider(providerId),
  createSaml: request => adapter.createSamlProvider(request),
  readSaml: providerId => adapter.getSamlProvider(providerId),
  deleteSaml: providerId => adapter.deleteSamlProvider(providerId),
  saveOverlay: input => connectorRepo.upsertConnectorConfig(input),
  readOverlay: providerId => connectorRepo.getConnectorConfig(providerId),
};

async function createEnterpriseConnector(
  runtimeKind: ConnectorRuntimeKind,
  request: Record<string, unknown>,
  dependencies: FactoryInstantiationDependencies,
) {
  let created: unknown;
  try {
    created = runtimeKind === 'custom_oidc'
      ? await dependencies.createCustomOidc(request)
      : await dependencies.createSaml(request);
  } catch (error) {
    const contractCode = error && typeof error === 'object' && 'code' in error
      ? String(error.code || '')
      : '';
    const runtimeUnavailable = isSupaCloudApiError(error)
      && (error.status === 404 || error.status >= 500);
    if (runtimeUnavailable
      || ['capability_unavailable', 'connector_factory_runtime_unavailable'].includes(contractCode)) {
      throw new ApiContractError(
        503,
        'connector_runtime_unavailable',
        'Connector runtime capability is unavailable',
      );
    }
    throw error;
  }
  const providerId = upstreamConnectorId(created, runtimeKind);
  if (!providerId) {
    throw new ApiContractError(
      503,
      'connector_creation_outcome_unknown',
      'Connector runtime create response did not include an identity that can be reconciled',
    );
  }
  return providerId;
}

async function compensateUpstreamConnector(
  providerId: string,
  runtimeKind: ConnectorRuntimeKind,
  dependencies: FactoryInstantiationDependencies,
) {
  if (runtimeKind === 'custom_oidc') return dependencies.deleteCustomOidc(providerId);
  return dependencies.deleteSaml(providerId);
}

function connectorDisplayName(
  factory: FactoryInfo,
  data: Record<string, unknown>,
  readbackProvider: ProviderInfo,
  runtimeKind: ConnectorRuntimeKind,
) {
  if (runtimeKind === 'saml') return requiredString(data, 'name');
  return providerName(readbackProvider, factory.name);
}

function creationOutcomeUnknown() {
  return new ApiContractError(
    503,
    'connector_creation_outcome_unknown',
    'Connector creation could not be reconciled safely',
  );
}

export async function auditCommittedConnectorFactory(
  factoryId: string,
  writeAudit: typeof audit = audit,
) {
  try {
    await writeAudit('connector.factory.instantiate', 'connector_factory', factoryId);
  } catch {
    throw creationOutcomeUnknown();
  }
}

async function rollbackCreatedConnector(
  providerId: string,
  runtimeKind: ConnectorRuntimeKind,
  dependencies: FactoryInstantiationDependencies,
  failure: unknown,
): Promise<never> {
  try {
    await compensateUpstreamConnector(providerId, runtimeKind, dependencies);
  } catch {
    throw creationOutcomeUnknown();
  }
  throw failure;
}

async function readCreatedConnector(
  providerId: string,
  runtimeKind: ConnectorRuntimeKind,
  dependencies: FactoryInstantiationDependencies,
) {
  let readback: unknown;
  try {
    readback = runtimeKind === 'custom_oidc'
      ? await dependencies.readCustomOidc(providerId)
      : await dependencies.readSaml(providerId);
  } catch (readbackError) {
    return rollbackCreatedConnector(providerId, runtimeKind, dependencies, readbackError);
  }
  if (upstreamConnectorId(readback, runtimeKind) !== providerId) {
    return rollbackCreatedConnector(
      providerId,
      runtimeKind,
      dependencies,
      new ApiContractError(502, 'connector_readback_mismatch', 'Connector authoritative readback did not match the created identity'),
    );
  }
  return providerInfo(readback, providerId);
}

function connectorOverlayMatches(
  overlay: ConnectorConfigInfo | null,
  expected: connectorRepo.ConnectorConfigInput,
) {
  return overlay?.provider_id === expected.providerId
    && overlay.runtime_kind === expected.runtimeKind
    && overlay.name === expected.name
    && overlay.category === expected.category
    && overlay.enabled === expected.enabled;
}

async function persistConnectorOverlay(
  input: connectorRepo.ConnectorConfigInput,
  runtimeKind: ConnectorRuntimeKind,
  dependencies: FactoryInstantiationDependencies,
) {
  let writeError: unknown = null;
  try {
    await dependencies.saveOverlay(input);
  } catch (overlayWriteError) {
    writeError = overlayWriteError;
  }
  let overlay: ConnectorConfigInfo | null;
  try {
    overlay = await dependencies.readOverlay(input.providerId);
  } catch {
    throw creationOutcomeUnknown();
  }
  if (overlay && connectorOverlayMatches(overlay, input)) return overlay;
  if (overlay) throw creationOutcomeUnknown();
  return rollbackCreatedConnector(
    input.providerId,
    runtimeKind,
    dependencies,
    writeError || new ApiContractError(502, 'connector_overlay_readback_mismatch', 'Connector overlay write was not visible on readback'),
  );
}

export async function instantiateConnectorFactory(
  factory: FactoryInfo,
  data: Record<string, unknown>,
  dependencies: FactoryInstantiationDependencies = defaultFactoryDependencies,
) {
  if (!factory.enabled) throw new ApiContractError(409, 'connector_factory_disabled', 'Connector factory is disabled');
  if (!['oidc', 'saml'].includes(factory.protocol)) {
    throw new ApiContractError(501, 'connector_factory_runtime_unavailable', 'Connector factory has no runtime adapter');
  }
  const runtimeKind: ConnectorRuntimeKind = factory.protocol === 'oidc' ? 'custom_oidc' : 'saml';
  const request = runtimeKind === 'custom_oidc' ? customOidcFactoryRequest(data) : samlFactoryRequest(data);
  const providerId = await createEnterpriseConnector(runtimeKind, request, dependencies);
  const readbackProvider = await readCreatedConnector(providerId, runtimeKind, dependencies);
  const connectorConfig = await persistConnectorOverlay({
    providerId,
    runtimeKind,
    name: connectorDisplayName(factory, data, readbackProvider, runtimeKind),
    category: factory.category,
    enabled: data["enabled"] === true,
    config: decodeConfigurationResponse(ConnectorFactoryStoredConfigSchema, withoutSecrets(request)),
  }, runtimeKind, dependencies);
  return withoutSecrets({ ...readbackProvider, ...connectorConfig });
}

export const connectorRoutes = new Elysia({ prefix: '/v1/connectors' })
  .get('/', async () => {
    decodeConfigurationInput('listConnectors', {});
    const [upstreamProviders, connectorConfigs] = await Promise.all([
      adapter.listProviders(),
      connectorRepo.listConnectorConfigs(),
    ]);
    const providers = decodeConfigurationResponse(BuiltinOAuthProvidersSchema, pagedResponse(upstreamProviders).items);
    return pagedResponse(withoutSecrets(mergeProvidersWithConnectorConfigs(providers, connectorConfigs)));
  }, configurationContract('listConnectors', {
    detail: { summary: 'List connectors (identity providers)', tags: ['Connectors'] },
  }))
  .get('/factories', async ({ query }) => {
    const input = decodeConfigurationInput('listConnectorFactories', { query });
    const items = await tenantConfigRepo.listConnectorFactories(input.query?.category);
    return { items, total: items.length };
  }, configurationContract('listConnectorFactories', {
    detail: { summary: 'List connector factory catalog', tags: ['Connectors', 'Connector Factory'] },
  }))
  .put('/factories/:factoryId', async ({ params, body }) => {
    const { body: data } = decodeConfigurationInput('upsertConnectorFactory', { params, body });
    return tenantConfigRepo.upsertConnectorFactory(params.factoryId, definedFields({
      name: data.name,
      protocol: data.protocol,
      category: data.category,
      configSchema: data.config_schema ?? undefined,
      enabled: data.enabled ?? undefined,
    }));
  }, configurationContract('upsertConnectorFactory', {
    detail: { summary: 'Create or update connector factory definition', tags: ['Connectors', 'Connector Factory'] },
  }))
  .post('/from-factory/:factoryId', async ({ params, body }) => {
    const factory = await tenantConfigRepo.getConnectorFactory(params.factoryId);
    if (!factory) throw new ApiContractError(404, 'connector_factory_not_found', 'Connector factory was not found');
    if (!factory.enabled) throw new ApiContractError(409, 'connector_factory_disabled', 'Connector factory is disabled');
    if (!['oidc', 'saml'].includes(factory.protocol)) {
      throw new ApiContractError(501, 'connector_factory_runtime_unavailable', 'Connector factory has no runtime adapter');
    }
    if (!body || typeof body !== 'object' || Array.isArray(body)) {
      throw new ApiContractError(400, 'invalid_connector_factory_input', 'Connector factory input must be an object');
    }
    if (factory.protocol === 'oidc') customOidcFactoryRequest(Object.fromEntries(Object.entries(body)));
    else samlFactoryRequest(Object.fromEntries(Object.entries(body)));
    const { body: data } = decodeConfigurationInput('createConnectorFromFactory', { params, body });
    const connector = await instantiateConnectorFactory(factory, data);
    await auditCommittedConnectorFactory(params.factoryId);
    return connector;
  }, configurationContract('createConnectorFromFactory', {
    detail: { summary: 'Instantiate or update connector from factory', tags: ['Connectors', 'Connector Factory'] },
  }))
  .get('/:connectorId', async ({ params }) => {
    decodeConfigurationInput('getConnector', { params });
    const config = await connectorRepo.getConnectorConfig(params.connectorId);
    return verifiedConnectorState(params.connectorId, config);
  }, configurationContract('getConnector', {
    detail: { summary: 'Get connector by ID', tags: ['Connectors'] },
  }))
  .get('/:connectorId/authorization-uri', async ({ params, query }) => {
    const input = decodeConfigurationInput('getConnectorAuthorizationUri', { params, query });
    const config = await connectorRepo.getConnectorConfig(params.connectorId);
    const payload = await authoritativeConnector(
      params.connectorId,
      connectorRuntimeKind(config),
    );
    if (payload === null) return new Response('Not found', { status: 404 });
    const provider = decodeProviderReadback(payload, params.connectorId);
    const authorizationEndpoint = provider.authorization_endpoint || provider.authorizationEndpoint;
    if (!authorizationEndpoint) {
      return {
        connector_id: params.connectorId,
        status: 'unavailable',
        reason: 'authorization_endpoint_missing',
      };
    }
    const url = new URL(String(authorizationEndpoint));
    if (input.query?.redirect_uri) url.searchParams.set('redirect_uri', input.query.redirect_uri);
    if (input.query?.state) url.searchParams.set('state', input.query.state);
    if (input.query?.scope) url.searchParams.set('scope', input.query.scope);
    return {
      connector_id: params.connectorId,
      authorization_uri: url.toString(),
    };
  }, configurationContract('getConnectorAuthorizationUri', {
    detail: { summary: 'Build connector authorization URI preflight', tags: ['Connectors', 'Connector Factory'] },
  }))
  .patch('/:connectorId', async ({ params, body }) => {
    const existingConfig = await connectorRepo.getConnectorConfig(params.connectorId);
    const runtimeKind = connectorRuntimeKind(existingConfig);
    if (body && typeof body === 'object' && 'enabled' in body
      && body.enabled !== undefined && typeof body.enabled !== 'boolean') {
      throw new ApiContractError(400, 'invalid_connector_enabled_state', 'Connector enabled state must be a boolean');
    }
    if (body && typeof body === 'object' && runtimeKind !== 'builtin_oauth'
      && Object.keys(body).some(field => field !== 'enabled')) {
      throw new ApiContractError(400, 'enterprise_connector_update_requires_factory', 'Enterprise connector settings must use their typed runtime contract');
    }
    if (runtimeKind === 'builtin_oauth' && body && typeof body === 'object'
      && 'client_id' in body) builtinConnectorUpdateRequest(body);
    const { body: data } = decodeConfigurationInput('updateConnector', { params, body });
    if (typeof data.enabled === 'boolean') {
      if (runtimeKind === 'builtin_oauth') builtinConnectorUpdateRequest(data);
      const updated = await updateConnectorEnabledState({
        providerId: params.connectorId,
        runtimeKind,
        enabled: data.enabled,
        existingConfig,
      });
      await notifyCommittedConnectorUpdate(params.connectorId);
      return updated;
    }
    const upstream = await updateConnectorRuntime(params.connectorId, runtimeKind, data);
    const updated = providerInfo(upstream, params.connectorId);
    await notifyCommittedConnectorUpdate(params.connectorId);
    const config = await connectorRepo.getConnectorConfig(params.connectorId);
    return withoutSecrets(mergeProvidersWithConnectorConfigs([updated], config ? [config] : [])[0]);
  }, configurationContract('updateConnector', {
    detail: { summary: 'Update connector configuration', tags: ['Connectors'] },
  }))
  .post('/:connectorId/test', async ({ params }) => {
    decodeConfigurationInput('testConnector', { params });
    const connectorConfig = await connectorRepo.getConnectorConfig(params.connectorId);
    const runtimeKind = connectorRuntimeKind(connectorConfig);
    return adapter.preflightProviderAuthorization(params.connectorId, runtimeKind);
  }, configurationContract('testConnector', {
    detail: { summary: 'Check connector runtime configuration', tags: ['Connectors'] },
  }));
