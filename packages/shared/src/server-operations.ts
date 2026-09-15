import { Type, type Static, type TSchema } from './schema.js';
import { sdkEndpoints } from './sdk-endpoints.js';
import { CapabilitiesResponseSchema } from './core.js';
import * as Models from './sdk-models.js';
import { AdminSsoConfigSchema } from './admin-auth-contracts.js';

const optionalString = Type.Optional(Type.String());
const nullableString = Type.Union([Type.String(), Type.Null()]);
const wireNumber = Type.Union([Type.String(), Type.Number()]);
const empty = Type.Object({});
const pagination = Type.Object({
  page: Type.Optional(wireNumber), limit: Type.Optional(wireNumber), cursor: optionalString,
});
export const AuthorizationDiagnosticInputSchema = Type.Object({
  ...Models.AuthorizationCompileRequestSchema.properties,
  tables: Type.Optional(Type.Union([Type.Array(Type.Partial(Models.AuthorizationCompileRequestSchema.properties.tables.items)), Type.Null()])),
  storage_buckets: Type.Optional(Type.Union([Type.Array(Type.Partial(Models.AuthorizationCompileRequestSchema.properties.storage_buckets.items)), Type.Null()])),
  realtime_channels: Type.Optional(Type.Union([Type.Array(Type.Partial(Models.AuthorizationCompileRequestSchema.properties.realtime_channels.items)), Type.Null()])),
  edge_functions: Type.Optional(Type.Union([Type.Array(Type.Partial(Models.AuthorizationCompileRequestSchema.properties.edge_functions.items)), Type.Null()])),
});
export type AuthorizationDiagnosticInput = Static<typeof AuthorizationDiagnosticInputSchema>;

export const PublicAdminSsoConfigSchema = AdminSsoConfigSchema;

export const VersionChangeTypeSchema = Type.String();
export const VersionChangeInputSchema = Type.Object({
  version: Type.String({ maxLength: 50 }),
  change_type: VersionChangeTypeSchema,
  path: Type.String({ maxLength: 500 }),
  method: Type.String({ maxLength: 10 }),
  description: Type.Optional(nullableString),
});
export const VersionEntrySchema = Type.Object({
  id: Type.String(), version: Type.String(), changeType: VersionChangeTypeSchema,
  path: Type.String(), method: Type.String(), description: nullableString, createdAt: Type.String(),
});
export type VersionEntry = Static<typeof VersionEntrySchema>;

export const LegacyRoleMappingSchema = Type.Object({
  legacyRole: Type.String(), supaoauthRole: Type.String(), description: optionalString,
});
export const RbacMigrationPolicySchema = Type.Object({
  mappings: Type.Array(LegacyRoleMappingSchema),
  dryRun: Type.Boolean(), autoCreateRoles: Type.Boolean(), preserveLegacyRole: Type.Boolean(),
  batchSize: Type.Number(),
});
export type RbacMigrationPolicy = Static<typeof RbacMigrationPolicySchema>;
export const RbacMigrationResultSchema = Type.Object({
  total: Type.Number(), migrated: Type.Number(), skipped: Type.Number(), errors: Type.Number(),
  details: Type.Array(Type.Object({
    userId: Type.String(), legacyRole: Type.String(), targetRole: Type.String(),
    status: Type.Union([Type.Literal('migrated'), Type.Literal('skipped'), Type.Literal('error')]),
    error: optionalString,
  })),
  dryRun: Type.Boolean(),
});

export const RouteProbeSchema = Type.Object({
  name: Type.String(), path: Type.String(), method: Type.String(), expectedStatus: Type.Array(Type.Number()),
  actualStatus: Type.Union([Type.Number(), Type.Null()]), ok: Type.Boolean(),
  error: optionalString, responseSnippet: optionalString,
});
export const DomainAuditSchema = Type.Object({
  domain: Type.String(), functionReachable: Type.Boolean(), apiReachable: Type.Boolean(),
  authReachable: Type.Boolean(), tlsValid: Type.Boolean(), error: optionalString,
});
export const IntegrationGateResultSchema = Type.Object({
  timestamp: Type.String(), projectRef: Type.String(), routes: Type.Array(RouteProbeSchema),
  domainAudit: Type.Array(DomainAuditSchema),
  envAudit: Type.Object({
    supacloudApiUrl: Type.String(), oauthRuntimeUrl: Type.String(), runtimeMode: Type.String(),
    corsOrigins: Type.Array(Type.String()), supauthUrl: Type.String(), runtimeUrl: Type.String(),
    extraDomains: Type.Array(Type.String()),
  }),
  allPassed: Type.Boolean(), conflicts: Type.Array(Type.String()),
});
export type RouteProbe = Static<typeof RouteProbeSchema>;
export type DomainAudit = Static<typeof DomainAuditSchema>;
export type IntegrationGateResult = Static<typeof IntegrationGateResultSchema>;
const routeGateInput = Type.Object({
  query: Type.Optional(Type.Object({
    project_ref: optionalString, supauth_url: optionalString, runtime_url: optionalString,
    base_url: optionalString, extra_domains: optionalString,
  })),
});

function json<I extends TSchema, R extends TSchema>(method: string, path: string, input: I, result: R) {
  return { method, path, input, result, responseKind: 'json' as const };
}

export const operationEndpoints = {
  health: sdkEndpoints.health,
  getProject: sdkEndpoints.getProject,
  getCapabilities: { ...sdkEndpoints.getCapabilities, result: CapabilitiesResponseSchema },
  getRuntimeHealth: sdkEndpoints.getRuntimeHealth,
  getOAuthServerStatus: sdkEndpoints.getOAuthServerStatus,
  getDiscovery: sdkEndpoints.getDiscovery,
  getJWKS: sdkEndpoints.getJWKS,
  getPublicAdminSsoConfig: json('GET', '/v1/public/admin-sso-config', empty, PublicAdminSsoConfigSchema),
  getCompatibilityReport: sdkEndpoints.getCompatibilityReport,
  compileAuthorizationPlan: {
    ...sdkEndpoints.compileAuthorizationPlan,
    input: Type.Object({ body: Type.Optional(AuthorizationDiagnosticInputSchema) }),
  },
  getAuthorizationCompilerDemo: sdkEndpoints.getAuthorizationCompilerDemo,
  generateRLSMigration: {
    ...sdkEndpoints.generateRLSMigration,
    input: Type.Object({ body: Type.Object({ policies: Type.Optional(Type.Union([Type.Array(Models.ExistingPolicySchema), Type.Null()])) }) }),
  },
  getRLSMigrationDemo: sdkEndpoints.getRLSMigrationDemo,
  listWebhooks: { ...sdkEndpoints.listWebhooks, input: Type.Object({ query: Type.Optional(pagination) }) },
  createWebhook: sdkEndpoints.createWebhook,
  getWebhook: sdkEndpoints.getWebhook,
  updateWebhook: sdkEndpoints.updateWebhook,
  deleteWebhook: sdkEndpoints.deleteWebhook,
  rotateWebhookSecret: sdkEndpoints.rotateWebhookSecret,
  listWebhookLogs: {
    ...sdkEndpoints.listWebhookLogs,
    input: Type.Object({
      params: sdkEndpoints.listWebhookLogs.input.properties.params, query: Type.Optional(pagination),
    }),
    result: Models.CursorListResponseSchema(Models.WebhookDeliveryLogSchema),
  },
  testWebhook: {
    ...sdkEndpoints.testWebhook,
    input: Type.Object({
      params: sdkEndpoints.testWebhook.input.properties.params,
      body: Type.Optional(Type.Union([Type.Null(), Type.Object({}, { additionalProperties: false })])),
    }),
  },
  listWebhookEvents: sdkEndpoints.listWebhookEvents,
  listWebhookDeliveries: {
    ...sdkEndpoints.listWebhookDeliveries,
    input: Type.Object({
      params: sdkEndpoints.listWebhookDeliveries.input.properties.params,
      query: Type.Optional(Type.Object({ ...pagination.properties, status: optionalString })),
    }),
  },
  getWebhookDelivery: sdkEndpoints.getWebhookDelivery,
  replayWebhookDelivery: sdkEndpoints.replayWebhookDelivery,
  listAuditLogs: {
    ...sdkEndpoints.listAuditLogs,
    input: Type.Object({
      query: Type.Optional(Type.Object({
        ...sdkEndpoints.listAuditLogs.input.properties.query.properties,
        status: Type.Optional(wireNumber), limit: Type.Optional(wireNumber), offset: Type.Optional(wireNumber),
      })),
    }),
  },
  getAuditLog: sdkEndpoints.getAuditLog,
  createAuditExport: {
    ...sdkEndpoints.createAuditExport,
    input: Type.Object({ body: Type.Optional(Type.Union([Models.AuditExportInputSchema, Type.Null()])) }),
  },
  createAuditExportFromQuery: json('GET', '/v1/audit/export',
    Type.Object({ query: Type.Optional(Models.AuditExportInputSchema) }), Models.AuditExportSchema),
  getAuditExport: sdkEndpoints.getAuditExport,
  getAuditExportDownload: sdkEndpoints.getAuditExportDownload,
  getAuditIntegrity: sdkEndpoints.getAuditIntegrity,
  getProvisioningStatus: sdkEndpoints.getProvisioningStatus,
  reconcileProject: sdkEndpoints.reconcileProject,
  rollbackProvisioning: json('POST', '/v1/provisioning/:projectRef/rollback',
    Type.Object({ params: sdkEndpoints.getProvisioningStatus.input.properties.params }),
    Type.Union([
      Type.Object({ project_ref: Type.String(), status: Type.Literal('provisioning_records_reset') }),
      Type.Object({ error: Type.String(), project_ref: Type.String() }),
    ])),
  listApiVersions: json('GET', '/v1/api-versions', empty, Models.ListResponseSchema(VersionEntrySchema)),
  getApiVersion: json('GET', '/v1/api-versions/:version',
    Type.Object({ params: Type.Object({ version: Type.String() }) }),
    Type.Object({ version: Type.String(), items: Type.Array(VersionEntrySchema), total: Type.Number() })),
  createApiVersion: json('POST', '/v1/api-versions',
    Type.Object({ body: VersionChangeInputSchema }), VersionEntrySchema),
  getRbacMigrationPolicy: json('GET', '/v1/rbac-bridge/default-policy', empty, RbacMigrationPolicySchema),
  dryRunRbacMigration: json('POST', '/v1/rbac-bridge/dry-run',
    Type.Object({ body: Type.Optional(Type.Union([Type.Partial(RbacMigrationPolicySchema), Type.Null()])) }), RbacMigrationResultSchema),
  importRbacMigration: json('POST', '/v1/rbac-bridge/import',
    Type.Object({ body: Type.Optional(Type.Union([Type.Partial(RbacMigrationPolicySchema), Type.Null()])) }), RbacMigrationResultSchema),
  getRbacCompatibilityHelper: json('GET', '/v1/rbac-bridge/compatibility-helper',
    Type.Object({ query: Type.Optional(Type.Object({ project_ref: optionalString })) }), Type.Object({ sql: Type.String() })),
  getRouteGate: json('GET', '/v1/route-gate', routeGateInput, IntegrationGateResultSchema),
  getRouteGateSummary: json('GET', '/v1/route-gate/routes', routeGateInput, Type.Object({
    total: Type.Number(), passed: Type.Number(), failed: Type.Array(RouteProbeSchema),
    conflicts: Type.Array(Type.String()), allPassed: Type.Boolean(),
  })),
} as const;

export type OperationEndpointName = keyof typeof operationEndpoints;
export type OperationInput<K extends OperationEndpointName> = Static<(typeof operationEndpoints)[K]['input']>;
export type OperationResult<K extends OperationEndpointName> = Static<(typeof operationEndpoints)[K]['result']>;
