import { Type, type TSchema } from './schema.js';
import { TypeGuard, type TObject } from '@sinclair/typebox';
import { sdkEndpoints } from './sdk-endpoints.js';
import * as Models from './sdk-models.js';
import { commonServerErrors, commonServerErrorResponse, type ServerRouteContract, type ServerResponseContract } from './server-contracts.js';

const nullableString = Type.Union([Type.String(), Type.Null()]);
const optionalString = Type.Optional(Type.String());
const optionalDate = Type.Optional(Type.String());

const organizationFields = {
  slug: optionalString,
  jit_enabled: Type.Optional(Type.Boolean()),
  jit_domains: Type.Optional(Type.Array(Type.String())),
  branding: Type.Optional(Models.OrganizationBrandingSchema),
};
// 保留字面键与具体 schema 类型，供 handler 读取；运行时表也引用同一实例。
export const serverManagementBodySchemas = {
  createOrganization: Type.Object({ ...sdkEndpoints.createOrganization.input.properties.body.properties, ...organizationFields }),
  updateOrganization: Type.Object({ ...sdkEndpoints.updateOrganization.input.properties.body.properties, ...organizationFields }),
  updateOrgTemplate: Type.Partial(sdkEndpoints.createOrgTemplate.input.properties.body),
};
export const serverManagementResultSchemas = {
  unsuspendUser: Models.UserSchema,
  getOrgTemplate: Models.OrganizationTemplateSchema,
  updateOrgTemplate: Models.OrganizationTemplateSchema,
  getDefaultOrgTemplate: Models.OrganizationTemplateSchema,
  listUserGrants: Type.Object({
    items: Type.Array(Type.Object({
      client_id: Type.String(),
      scopes: Type.Optional(Type.Array(Type.String())),
      created_at: optionalDate,
      updated_at: optionalDate,
      revoked_at: Type.Optional(nullableString),
    })),
    total: Type.Number(), page: Type.Optional(Type.Number()), limit: Type.Optional(Type.Number()),
  }),
};
const paginationFields = {
  page: Type.Optional(Type.Union([Type.String(), Type.Number()])),
  limit: Type.Optional(Type.Union([Type.String(), Type.Number()])),
};
const cursorFields = { limit: paginationFields.limit, cursor: optionalString };
export const serverManagementQuerySchemas = {
  listApplications: Type.Object(paginationFields),
  listUsers: Type.Object({ ...paginationFields, search: optionalString, email: optionalString }),
  listOrganizations: Type.Object({ ...paginationFields, search: optionalString, application_id: optionalString }),
  listOrganizationMembers: Type.Object({ ...paginationFields, search: optionalString }),
  listRoleAssignments: Type.Object({ ...paginationFields, target_type: optionalString }),
  listTenantMembers: Type.Object({ ...paginationFields, search: optionalString }),
  listTenantInvitations: Type.Object({ ...paginationFields, status: optionalString }),
  listUserLogs: Type.Object(cursorFields),
  listApplicationLogs: Type.Object(cursorFields),
  listUserGrants: Type.Object({ include_revoked: Type.Optional(Type.Union([Type.String(), Type.Boolean()])) }),
};

const emptyResponse: ServerResponseContract = { kind: 'empty' };
const textNotFound: ServerResponseContract = {
  kind: 'protocol',
  schema: Type.Union([
    Type.Literal('Not found'),
    Type.Literal('No default template found'),
    commonServerErrorResponse.schema,
  ]),
  contentTypes: ['application/json', 'text/plain'],
};
const managementPrefixes = [
  '/v1/applications', '/v1/resources', '/v1/users', '/v1/organizations',
  '/v1/roles', '/v1/tenant/', '/v1/org-templates',
];

export interface NamedServerContract {
  source: string;
  contract: ServerRouteContract;
  gap?: string;
}

function json(schema: TSchema): ServerResponseContract {
  return { kind: 'validated', schema, contentTypes: ['application/json'] };
}

const resultOverrides: Readonly<Record<string, TSchema>> = {
  listResources: Models.ListResponseSchema(Models.WireResourceSchema),
  createResource: Models.WireResourceSchema,
  getResource: Models.WireResourceSchema,
  updateResource: Models.UpdatedResourceSchema,
  addScope: Models.WireScopeSchema,
  updateScope: Models.WireScopeSchema,
  listResourceApplications: Models.ListResponseSchema(Models.ApplicationBindingSchema),
  getApplicationConsentSettings: Models.ApplicationConsentSettingsSchema,
  updateApplicationConsentSettings: Models.ApplicationConsentSettingsSchema,
  getApplicationAccessControl: Models.ApplicationConsentSettingsSchema,
  updateApplicationAccessControl: Models.ApplicationConsentSettingsSchema,
  listApplicationBindings: Models.ListResponseSchema(Models.ApplicationBindingSchema),
  createApplicationBinding: Models.ApplicationBindingSchema,
};

const table: Record<string, NamedServerContract> = {};
function requiredEntry(key: string): NamedServerContract {
  const entry = table[key];
  if (!entry) throw new Error(`Missing management contract: ${key}`);
  return entry;
}

for (const [name, endpoint] of Object.entries(sdkEndpoints)) {
  if (!managementPrefixes.some(prefix => endpoint.path.startsWith(prefix))) continue;
  const wireResult = 'wireResult' in endpoint ? endpoint.wireResult : undefined;
  const result = wireResult || resultOverrides[name] || endpoint.result;
  if (!TypeGuard.IsObject(endpoint.input)) throw new Error(`Expected object input schema: ${name}`);
  const input: TObject = {
    ...endpoint.input,
    properties: { ...endpoint.input.properties },
    required: [...(endpoint.input.required || [])],
  };
  // URL query 在线上是字符串。保留各路由原有的分页回退/拒绝策略，不改变 handler 值。
  const query = input.properties['query'];
  if (TypeGuard.IsObject(query)) {
    const normalizedQuery: TObject = { ...query, properties: { ...query.properties } };
    input.properties['query'] = normalizedQuery;
    for (const [key, property] of Object.entries(query.properties)) {
      if (TypeGuard.IsNumber(property) || TypeGuard.IsInteger(property)) {
        normalizedQuery.properties[key] = Type.Optional(Type.Union([Type.String(), Type.Number()]));
      }
    }
  }
  // 幂等键已有 x-request-id 回退；不能把 SDK 要求直接提升为服务端新必填条件。
  if (name === 'instantiateOrgTemplate') {
    delete input.properties['headers'];
    input.required = input.required?.filter((key: string) => key !== 'headers');
  }
  if (name === 'bindOrganizationApplication') {
    delete input.properties['body'];
    input.required = input.required?.filter((key: string) => key !== 'body');
  }
  const { required, ...inputWithoutRequired } = input;
  const requestInput = { ...inputWithoutRequired, ...(required?.length ? { required } : {}) };
  table[`${endpoint.method} ${endpoint.path}`] = {
    source: resultOverrides[name] ? `server:${name}` : `sdk:${name}`,
    contract: {
      input: requestInput,
      request: Object.keys(input.properties).length ? 'validated' : 'none',
      responses: {
        ...commonServerErrors,
        200: endpoint.responseKind === 'void' && !wireResult ? emptyResponse : json(result),
        ...(endpoint.responseKind === 'void' && !wireResult ? { 204: emptyResponse } : {}),
      },
    },
  };
}

function add(method: string, path: string, body: TSchema | undefined, response: TSchema | undefined, retired = false) {
  const params = Object.fromEntries([...path.matchAll(/:([A-Za-z0-9_]+)/g)].map(match => {
    const name = match[1];
    if (!name) throw new Error(`Invalid path parameter: ${path}`);
    return [name, Type.String()];
  }));
  const input = Type.Object({
    ...(Object.keys(params).length ? { params: Type.Object(params) } : {}),
    ...(body ? { body } : {}),
  });
  table[`${method} ${path}`] = {
    source: `server:${method}:${path}`,
    contract: {
      input,
      request: retired ? 'none' : Object.keys(input.properties).length ? 'validated' : 'none',
      responses: { ...commonServerErrors, ...(response ? { 200: json(response) } : retired ? {} : { 200: emptyResponse, 204: emptyResponse }) },
      ...(retired ? { hidden: true, retired: true } : {}),
    },
  };
}

for (const [method, path] of [
  ['GET', '/v1/applications/:appId/secrets'],
  ['POST', '/v1/applications/:appId/secrets'],
  ['POST', '/v1/applications/:appId/secrets/:secretId/disable'],
  ['DELETE', '/v1/applications/:appId/secrets/:secretId'],
  ['GET', '/v1/users/:userId/sessions'],
  ['POST', '/v1/users/:userId/sessions'],
  ['POST', '/v1/users/:userId/sessions/:sessionId/revoke'],
  ['DELETE', '/v1/users/:userId/identities/:identityId'],
  ['DELETE', '/v1/users/:userId/grants/:clientId'],
] as const) add(method, path, undefined, undefined, true);

add('POST', '/v1/users/:userId/unsuspend', undefined, serverManagementResultSchemas.unsuspendUser);
add('GET', '/v1/users/:userId/grants', undefined, serverManagementResultSchemas.listUserGrants);
add('GET', '/v1/org-templates/default', undefined, serverManagementResultSchemas.getDefaultOrgTemplate);
add('GET', '/v1/org-templates/:templateId', undefined, serverManagementResultSchemas.getOrgTemplate);
add('PUT', '/v1/org-templates/:templateId', serverManagementBodySchemas.updateOrgTemplate, serverManagementResultSchemas.updateOrgTemplate);
add('DELETE', '/v1/org-templates/:templateId', undefined, undefined);
add('POST', '/v1/organizations/:orgId/invitations/:invitationId/:action', undefined, Models.RevokedOrganizationInvitationSchema);
requiredEntry('POST /v1/organizations/:orgId/invitations/:invitationId/:action').contract.hidden = true;

for (const path of ['/v1/resources/:resourceId', '/v1/org-templates/default', '/v1/org-templates/:templateId']) {
  for (const method of ['GET', 'PUT']) {
    const entry = table[`${method} ${path}`];
    if (entry) entry.contract = { ...entry.contract, responses: { ...entry.contract.responses, 404: textNotFound } };
  }
}
const templateDeletion = requiredEntry('DELETE /v1/org-templates/:templateId');
templateDeletion.contract = {
  ...templateDeletion.contract,
  responses: {
    ...templateDeletion.contract.responses,
    404: json(Type.Object({ message: Type.String(), code: Type.Literal('not_found') })),
    409: json(Type.Object({ message: Type.String(), code: Type.Literal('default_organization_template_protected') })),
  },
};

function inputFields(key: string, fields: Record<string, TSchema>) {
  const entry = requiredEntry(key);
  const input = entry.contract.input;
  if (!TypeGuard.IsObject(input)) throw new Error(`Expected object input schema: ${key}`);
  entry.contract = {
    ...entry.contract,
    request: 'validated',
    input: Type.Object({ ...input.properties, ...fields }),
  };
}
for (const [name, query] of Object.entries(serverManagementQuerySchemas)) {
  const endpoint = Object.entries(sdkEndpoints).find(([key]) => key === name)?.[1];
  const path = name === 'listUserGrants' ? '/v1/users/:userId/grants' : endpoint?.path;
  if (!path) throw new Error(`Missing query endpoint: ${name}`);
  inputFields(`GET ${path}`, { query: Type.Optional(query) });
}
inputFields('POST /v1/organizations/:orgId/invitations/:invitationId/accept', {
  headers: Type.Optional(Type.Object({ authorization: optionalString })),
});
inputFields('POST /v1/org-templates/:templateId/instantiate', {
  headers: Type.Optional(Type.Object({ 'idempotency-key': optionalString, 'x-request-id': optionalString })),
});
for (const method of ['POST', 'PUT'] as const) {
  const key = `${method} /v1/organizations${method === 'PUT' ? '/:orgId' : ''}`;
  inputFields(key, {
    body: serverManagementBodySchemas[method === 'POST' ? 'createOrganization' : 'updateOrganization'],
  });
}

for (const key of [
  'PUT /v1/resources/:resourceId',
  'PUT /v1/resources/:resourceId/scopes/:scopeId',
]) {
  const entry = requiredEntry(key);
  const response = entry.contract.responses[200];
  if (!response) throw new Error(`Missing success response: ${key}`);
  entry.contract = {
    ...entry.contract,
    responses: {
      ...entry.contract.responses,
      200: { kind: 'protocol', alternatives: [response, emptyResponse] },
    },
  };
}

export const serverManagementContracts: Readonly<Record<string, NamedServerContract>> = table;
