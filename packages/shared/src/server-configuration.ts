import { Type, JsonObjectSchema, type Static, type TSchema } from './schema.js';
import { TypeGuard } from '@sinclair/typebox';
import { sdkEndpoints } from './sdk-endpoints.js';
import { adminEndpoints } from './admin-endpoints.js';
import { tenantConfigurationValues, ProviderSchema } from './sdk-models.js';
export { tenantConfigurationValues } from './sdk-models.js';
import { commonServerErrors, commonServerErrorResponse, type ServerResponseContract, type ServerRouteContract } from './server-contracts.js';

const optionalString = Type.Optional(Type.String());
const nullableString = Type.Union([Type.String(), Type.Null()]);
const empty = Type.Object({});
const path = Type.String();
const json = (schema: TSchema): ServerResponseContract => ({
  kind: 'validated', schema, contentTypes: ['application/json'],
});
const text = (value: string): ServerResponseContract => ({
  kind: 'protocol', schema: Type.Literal(value), contentTypes: ['text/plain'],
});

// 上游 provider 列表不含 overlay；所有参与配置判断的历史别名也在这里校验。
export const BuiltinOAuthProviderSchema = Type.Composite([
  Type.Pick(ProviderSchema, ['id', 'name', 'type', 'enabled', 'client_id', 'secret_configured']),
  Type.Object({
    redirect_uri: optionalString, clientId: optionalString,
    client_secret: optionalString, clientSecret: optionalString,
  }),
]);
export const BuiltinOAuthProvidersSchema = Type.Array(BuiltinOAuthProviderSchema);
export type BuiltinOAuthProvider = Static<typeof BuiltinOAuthProviderSchema>;

export const ConnectorFactoryStoredConfigSchema = Type.Union([
  Type.Object({
    provider_type: Type.Literal('oidc'), identifier: Type.String(), name: Type.String(),
    client_id: Type.String(), issuer: Type.String(), enabled: Type.Boolean(),
    pkce_enabled: Type.Literal(true), scopes: Type.Optional(Type.Array(Type.String())),
    secret_configured: Type.Optional(Type.Boolean()),
  }),
  Type.Object({
    type: Type.Literal('saml'), disabled: Type.Boolean(),
    metadata_url: optionalString, metadata_xml: optionalString, resource_id: optionalString,
    name_id_format: optionalString, domains: Type.Optional(Type.Array(Type.String())),
    attribute_mapping: Type.Optional(JsonObjectSchema),
  }),
]);
export type ConnectorFactoryStoredConfig = Static<typeof ConnectorFactoryStoredConfigSchema>;

export const OAuthAuthorizationDetailsSchema = Type.Object({
  authorization_id: optionalString,
  client: Type.Object({
    id: Type.String(), name: optionalString, uri: Type.Optional(nullableString),
    logo_uri: Type.Optional(nullableString),
  }),
  user: Type.Object({ id: Type.String(), email: optionalString }),
  scope: Type.String(),
  redirect_uri: optionalString,
});
export const OAuthRedirectResultSchema = Type.Object({ redirect_url: Type.String({ minLength: 1 }) });
export const ConfigurationRedirectHeadersSchema = Type.Object({ location: Type.String({ minLength: 1 }) });
export const OAuthAuthorizationResultSchema = Type.Union([
  OAuthAuthorizationDetailsSchema, OAuthRedirectResultSchema,
]);
export const PublicOAuthErrorSchema = Type.Object({
  error: Type.String(), error_description: optionalString, message: optionalString,
});
const oauthResponses = Object.fromEntries([400, 401, 403, 404, 409, 422, 429, 500, 502, 503, 504]
  .map(status => [status, json(PublicOAuthErrorSchema)]));

export type TenantConfigurationType = keyof typeof tenantConfigurationValues;
export type TenantConfigurationValue<K extends TenantConfigurationType> = Static<(typeof tenantConfigurationValues)[K]>;

export const ConfigurationSecurityInputSchema = Type.Partial(Type.Object({
  ...adminEndpoints.updateSecurityConfig.input.properties.body.properties,
  adminAllowedEmails: Type.Array(Type.String({ minLength: 1, maxLength: 320, pattern: '^\\S(?:[\\s\\S]*\\S)?$' }), { maxItems: 1000 }),
  adminAllowedDomains: Type.Array(Type.String(), { maxItems: 0 }),
  rateLimitRpm: Type.Integer({ minimum: 1, maximum: 1_000_000 }),
  rateLimitBurst: Type.Integer({ minimum: 1, maximum: 1_000_000 }),
  maxLoginAttempts: Type.Integer({ minimum: 1, maximum: 10_000 }),
  lockoutDurationSec: Type.Integer({ minimum: 1, maximum: 2_592_000 }),
  secretRotationReminderDays: Type.Integer({ minimum: 1, maximum: 3650 }),
}), { additionalProperties: false, minProperties: 1 });
export type ConfigurationSecurityInput = Static<typeof ConfigurationSecurityInputSchema>;

const connectorAuthorizeInput = Type.Object({
  params: Type.Object({ connectorId: path }),
  query: Type.Object({
    redirect_uri: optionalString, authorization_id: optionalString, state: optionalString,
    client_id: optionalString, response_type: optionalString, scope: optionalString,
    code_challenge: optionalString, code_challenge_method: optionalString,
    nonce: optionalString, resource: optionalString,
  }),
});
const authorizationParams = Type.Object({ authorizationId: path });
const oauthHeaders = Type.Object({ authorization: optionalString });
const enterpriseId = Type.Object({ id: path });

// 只有 C 组的实际路由；此清单不代表所有公共 API。
export const configurationEndpoints = {
  listConnectors: sdkEndpoints.listConnectors,
  getConnector: sdkEndpoints.getConnector,
  updateConnector: sdkEndpoints.updateConnector,
  testConnector: sdkEndpoints.testConnector,
  getConnectorAuthorizationUri: sdkEndpoints.getConnectorAuthorizationUri,
  listConnectorFactories: sdkEndpoints.listConnectorFactories,
  upsertConnectorFactory: sdkEndpoints.upsertConnectorFactory,
  createConnectorFromFactory: adminEndpoints.createConnectorFromFactory,
  listEnterpriseSSOConfigs: sdkEndpoints.listEnterpriseSSOConfigs,
  createEnterpriseSSOConfig: sdkEndpoints.createEnterpriseSSOConfig,
  getEnterpriseSSOConfig: {
    ...adminEndpoints.getEnterpriseSSOConfig, path: '/v1/enterprise-sso/:id',
    input: Type.Object({ params: enterpriseId }),
  },
  updateEnterpriseSSOConfig: {
    ...adminEndpoints.updateEnterpriseSSOConfig, path: '/v1/enterprise-sso/:id',
    input: Type.Object({ params: enterpriseId, body: adminEndpoints.updateEnterpriseSSOConfig.input.properties.body }),
  },
  deleteEnterpriseSSOConfig: {
    ...adminEndpoints.deleteEnterpriseSSOConfig, path: '/v1/enterprise-sso/:id',
    input: Type.Object({ params: enterpriseId }),
  },
  discoverEnterpriseSSO: {
    method: 'GET', path: '/v1/enterprise-sso/domain/:domain',
    input: Type.Object({ params: Type.Object({ domain: path }) }),
    result: sdkEndpoints.createEnterpriseSSOConfig.result, responseKind: 'json',
  },
  getSignInExperience: sdkEndpoints.getSignInExperience,
  resolveSignInExperience: sdkEndpoints.resolveSignInExperience,
  updateSignInExperience: sdkEndpoints.updateSignInExperience,
  getCustomUiStatus: adminEndpoints.getCustomUiStatus,
  deleteCustomUiAssets: adminEndpoints.deleteCustomUiAssets,
  uploadCustomUiAssets: {
    method: 'POST', path: '/v1/sign-in-experience/custom-ui-assets',
    input: empty, result: Type.Never(), responseKind: 'json',
  },
  resolvePublicSignInExperience: sdkEndpoints.resolvePublicSignInExperience,
  authorizePublicConnector: {
    method: 'GET', path: '/v1/public/connectors/:connectorId/authorize',
    input: connectorAuthorizeInput, result: Type.Object({ redirect: Type.String({ minLength: 1 }) }), responseKind: 'json',
  },
  getPublicPhrases: sdkEndpoints.getPublicPhrases,
  getPublicCustomUi: {
    method: 'GET', path: '/v1/public/custom-ui/*',
    input: Type.Object({ params: Type.Object({ '*': Type.String() }) }),
    result: Type.Never(), responseKind: 'json',
  },
  getOAuthAuthorization: {
    method: 'GET', path: '/v1/public/oauth/authorizations/:authorizationId',
    input: Type.Object({ params: authorizationParams, headers: oauthHeaders }),
    result: OAuthAuthorizationResultSchema, responseKind: 'json',
  },
  submitOAuthConsent: {
    method: 'POST', path: '/v1/public/oauth/authorizations/:authorizationId/consent',
    input: Type.Object({
      params: authorizationParams, headers: oauthHeaders,
      body: Type.Object({ action: Type.Union([Type.Literal('approve'), Type.Literal('deny')]) }),
    }),
    result: OAuthRedirectResultSchema, responseKind: 'json',
  },
  getAuthConfig: sdkEndpoints.getAuthConfig,
  updateAuthConfig: sdkEndpoints.updateAuthConfig,
  getAuthConfigRuntimeConsistency: adminEndpoints.getAuthConfigRuntimeConsistency,
  listTenantConfigs: sdkEndpoints.listTenantConfigs,
  getTenantConfig: sdkEndpoints.getTenantConfig,
  upsertTenantConfig: sdkEndpoints.upsertTenantConfig,
  deleteTenantConfig: sdkEndpoints.deleteTenantConfig,
  checkTenantDomain: sdkEndpoints.checkTenantDomain,
  getSecurityConfig: adminEndpoints.getSecurityConfig,
  updateSecurityConfig: {
    ...adminEndpoints.updateSecurityConfig,
    input: Type.Object({ body: ConfigurationSecurityInputSchema }),
  },
  getSecurityStatus: sdkEndpoints.getSecurityStatus,
} as const;

export type ConfigurationEndpointName = keyof typeof configurationEndpoints;
export type ConfigurationEndpointInput<K extends ConfigurationEndpointName> =
  Static<(typeof configurationEndpoints)[K]['input']>;

function isConfigurationEndpointName(value: string): value is ConfigurationEndpointName {
  return Object.hasOwn(configurationEndpoints, value);
}

function responseOverrides(name: ConfigurationEndpointName): Record<number, ServerResponseContract> {
  switch (name) {
    case 'getSignInExperience':
    case 'resolveSignInExperience':
      return { 200: {
        kind: 'protocol', alternatives: [json(configurationEndpoints[name].result), { kind: 'empty' }],
      } };
    case 'getConnectorAuthorizationUri': return { 404: text('Not found') };
    case 'discoverEnterpriseSSO': return { 404: text('No SSO config found for domain') };
    case 'getSecurityConfig': return { 404: text('Security config not found. Run migration first.') };
    case 'getTenantConfig':
    case 'deleteTenantConfig':
      return { 400: text('Invalid config type'), 404: text('Not found') };
    case 'upsertTenantConfig': return { 400: {
      kind: 'protocol', alternatives: [text('Invalid config type'), commonServerErrorResponse],
    } };
    case 'deleteCustomUiAssets': return { 202: json(adminEndpoints.deleteCustomUiAssets.result) };
    case 'getPublicCustomUi': return { 404: json(Type.Object({ error: Type.Literal('not_found') })) };
    case 'authorizePublicConnector': return {
      302: { ...json(configurationEndpoints.authorizePublicConnector.result), headers: ConfigurationRedirectHeadersSchema },
      404: json(Type.Object({ error: Type.Literal('connector_not_enabled') })),
    };
    case 'getOAuthAuthorization':
    case 'submitOAuthConsent': return oauthResponses;
    default: return {};
  }
}

export const serverConfigurationContracts: Readonly<Record<string, {
  source: string; contract: ServerRouteContract;
}>> = Object.fromEntries(Object.entries(configurationEndpoints).map(([key, endpoint]) => {
  if (!isConfigurationEndpointName(key)) throw new Error(`Unknown configuration endpoint: ${key}`);
  const name = key;
  const noSuccess = name === 'uploadCustomUiAssets' || name === 'getPublicCustomUi' || name === 'authorizePublicConnector';
  return [`${endpoint.method} ${endpoint.path}`, {
    source: `configurationEndpoints.${name}`,
    contract: {
      request: TypeGuard.IsUnion(endpoint.input)
        || (TypeGuard.IsObject(endpoint.input) && Object.keys(endpoint.input.properties).length > 0) ? 'validated' : 'none',
      input: endpoint.input,
      responses: {
        ...commonServerErrors,
        ...(!noSuccess ? { 200: endpoint.responseKind === 'void' ? { kind: 'empty' as const } : json(endpoint.result) } : {}),
        ...responseOverrides(name),
      },
      ...(name === 'getPublicCustomUi' ? { hidden: true, retired: true } : {}),
    },
  }];
}));
