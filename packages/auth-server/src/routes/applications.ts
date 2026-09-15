// Application management routes with OpenAPI annotations

import { Elysia } from 'elysia';
import { managementContract, decodeEndpointBody, decodeEndpointResponse, decodeManagementQuery } from '../utils/management-contract.js';
import { definedFields, requiredRow } from '../utils/defined-fields.js';
import { getConfig } from '../config/index.js';
import { getSupaCloudAdapter, getSupaCloudAdapterForProject } from '../supacloud/adapter.js';
import * as bindingRepo from '../repositories/bindings.js';
import * as auditRepo from '../repositories/audit.js';
import * as webhookDelivery from '../repositories/webhook-delivery.js';
import * as appControlRepo from '../repositories/application-control.js';
import * as sieRepo from '../repositories/sign-in-experience.js';
import { ApiContractError, capabilityUnavailable, cursorResponse, pagedResponse, isRecord } from '../utils/api-contract.js';
import { withoutSecrets } from '../utils/secrets.js';

const adapter = getSupaCloudAdapter();
const GOTRUE_OAUTH_GRANT_TYPES = ['authorization_code', 'refresh_token'] as const;
const grantTypesOpenApiSchema = {
  type: 'array',
  minItems: 1,
  items: { type: 'string', enum: [...GOTRUE_OAUTH_GRANT_TYPES] },
  description: "Stock GoTrue supports only 'authorization_code' and 'refresh_token' OAuth client grants",
};
const editableOAuthClientProperties = {
  redirect_uris: { type: 'array', minItems: 1, maxItems: 10, uniqueItems: true, items: { type: 'string' } },
  token_endpoint_auth_method: {
    type: 'string',
    enum: ['none', 'client_secret_basic', 'client_secret_post'],
  },
  grant_types: grantTypesOpenApiSchema,
  client_name: { type: 'string' },
  client_uri: { type: 'string' },
  logo_uri: { type: 'string' },
};
const createOAuthClientRequestBody = openApiRequestBody({
  type: 'object',
  required: ['redirect_uris'],
  properties: {
    ...editableOAuthClientProperties,
    client_type: { type: 'string', enum: ['public', 'confidential'] },
  },
});
const updateOAuthClientRequestBody = openApiRequestBody({
  type: 'object',
  minProperties: 1,
  properties: {
    ...editableOAuthClientProperties,
  },
});

function openApiRequestBody(schema: Record<string, unknown>) {
  return { required: true, content: { 'application/json': { schema } } };
}

function oauthClientInput(body: unknown): Record<string, unknown> {
  if (!isRecord(body)) {
    throw new ApiContractError(400, 'invalid_request_body', 'OAuth client request body must be a JSON object');
  }
  return body;
}

function assertSupportedGrantTypes(grantTypes: unknown): asserts grantTypes is string[] {
  if (!Array.isArray(grantTypes)) throw invalidGrantTypes();
  const values: unknown[] = grantTypes;
  if (!values.every((grantType): grantType is string => typeof grantType === 'string')) throw invalidGrantTypes();
  const unsupportedGrantTypes = values.filter(
    grantType => grantType !== 'authorization_code' && grantType !== 'refresh_token',
  );
  if (unsupportedGrantTypes.length > 0) throw invalidGrantTypes(unsupportedGrantTypes);
}

function invalidGrantTypes(unsupportedGrantTypes: string[] = []) {
  return new ApiContractError(
    400,
    'unsupported_grant_type',
    "grant_types must only contain 'authorization_code' and/or 'refresh_token' for stock GoTrue",
    { allowed_grant_types: [...GOTRUE_OAUTH_GRANT_TYPES], unsupported_grant_types: unsupportedGrantTypes },
  );
}

function validateCreateGrantTypes(input: Record<string, unknown>) {
  if (!Object.hasOwn(input, 'grant_types')) return;
  const grantTypes = input["grant_types"];
  assertSupportedGrantTypes(grantTypes);
  if (grantTypes.length === 0) throw invalidGrantTypes();
}

function invalidRedirectUris() {
  return new ApiContractError(
    400,
    'invalid_redirect_uris',
    'redirect_uris must contain 1 to 10 unique URI strings',
  );
}

function validateRedirectUriList(redirectUris: unknown) {
  if (!Array.isArray(redirectUris)
    || redirectUris.length < 1
    || redirectUris.length > 10
    || redirectUris.some((uri: unknown) => typeof uri !== 'string')
    || new Set(redirectUris).size !== redirectUris.length) {
    throw invalidRedirectUris();
  }
}

function validateCreateRedirectUris(input: Record<string, unknown>) {
  if (!Object.hasOwn(input, 'redirect_uris')) throw invalidRedirectUris();
  validateRedirectUriList(input["redirect_uris"]);
}

function validateUpdateRedirectUris(input: Record<string, unknown>) {
  if (Object.hasOwn(input, 'redirect_uris')) validateRedirectUriList(input["redirect_uris"]);
}

function validateUpdateGrantTypes(input: Record<string, unknown>) {
  if (!Object.hasOwn(input, 'grant_types')) return;
  const grantTypes = input["grant_types"];
  assertSupportedGrantTypes(grantTypes);
  if (grantTypes.length === 0) throw invalidGrantTypes();
}

function oauthClientAdapter() {
  const oauthProjectRef = getConfig().oauthAuthorizationProjectRef;
  return oauthProjectRef ? getSupaCloudAdapterForProject(oauthProjectRef) : adapter;
}

async function audit(eventType: string, resourceType: string, resourceId: string, details?: Record<string, unknown>) {
  await auditRepo.logAudit({ eventType, resourceType, resourceId, actorType: 'admin', details });
}

async function fireWebhook(eventType: string, payload: Record<string, unknown>) {
  await webhookDelivery.dispatchEvent(webhookDelivery.buildEvent(eventType, payload));
}

export const applicationRoutes = new Elysia({ prefix: '/v1/applications' })
  .get('/', async ({ query: rawQuery }) => {
    const query = decodeManagementQuery('listApplications', rawQuery);
    const res = await oauthClientAdapter().listOAuthClients();
    await audit('application.list', 'application', 'all');
    return decodeEndpointResponse('listApplications', withoutSecrets(pagedResponse(res, { page: query.page, limit: query.limit })));
  }, managementContract("GET", "/v1/applications", {
    detail: { summary: 'List OAuth applications', tags: ['Applications'] },
  }))

  .post('/', async ({ body }) => {
    const input = oauthClientInput(body);
    validateCreateRedirectUris(input);
    validateCreateGrantTypes(input);
    const created = decodeEndpointResponse('createApplication',
      await oauthClientAdapter().createOAuthClient(decodeEndpointBody('createApplication', input)));
    const clientId = created.client_id;
    await audit('application.create', 'application', clientId, { name: input["client_name"] });
    await fireWebhook('application.created', { client_id: clientId });
    return created;
  }, managementContract("POST", "/v1/applications", {
    detail: {
      summary: 'Create OAuth application',
      tags: ['Applications'],
      requestBody: createOAuthClientRequestBody,
    },
  }, ({ body }) => {
    const input = oauthClientInput(body);
    validateCreateRedirectUris(input);
    validateCreateGrantTypes(input);
  }))

  .get('/:appId', async ({ params }) => decodeEndpointResponse('getApplication', withoutSecrets(
    await oauthClientAdapter().getOAuthClient(params.appId),
  )), managementContract("GET", "/v1/applications/:appId", {
    detail: { summary: 'Get application by ID', tags: ['Applications'] },
  }))

  .put('/:appId', async ({ params, body }) => {
    const input = oauthClientInput(body);
    validateUpdateRedirectUris(input);
    validateUpdateGrantTypes(input);
    const updated = await oauthClientAdapter().updateOAuthClient(params.appId, decodeEndpointBody('updateApplication', input));
    await audit('application.update', 'application', params.appId);
    await fireWebhook('application.updated', { client_id: params.appId });
    return decodeEndpointResponse('updateApplication', withoutSecrets(updated));
  }, managementContract("PUT", "/v1/applications/:appId", {
    detail: {
      summary: 'Update application',
      tags: ['Applications'],
      requestBody: updateOAuthClientRequestBody,
    },
  }, ({ body }) => {
    const input = oauthClientInput(body);
    validateUpdateRedirectUris(input);
    validateUpdateGrantTypes(input);
  }))

  .delete('/:appId', async ({ params }) => {
    await oauthClientAdapter().deleteOAuthClient(params.appId);
    await audit('application.delete', 'application', params.appId);
    await fireWebhook('application.deleted', { client_id: params.appId });
  }, managementContract("DELETE", "/v1/applications/:appId", {
    detail: { summary: 'Delete application', tags: ['Applications'] },
  }))

  .post('/:appId/rotate-secret', async ({ params }) => {
    const result = await oauthClientAdapter().regenerateClientSecret(params.appId);
    await audit('application.rotate_secret', 'application', params.appId);
    return decodeEndpointResponse('rotateApplicationSecret', result);
  }, managementContract("POST", "/v1/applications/:appId/rotate-secret", {
    detail: { summary: 'Rotate client secret', tags: ['Applications'] },
  }))

  .get('/:appId/secrets', async ({ params }) => {
    throw capabilityUnavailable('oauth_client_secret_lifecycle', `Per-client secret lists are unavailable for ${params.appId}`);
  }, managementContract("GET", "/v1/applications/:appId/secrets", {
    detail: { hide: true },
  }))

  .post('/:appId/secrets', async ({ params }) => {
    throw capabilityUnavailable('oauth_client_secret_lifecycle', `Additional client secrets are unavailable for ${params.appId}`);
  }, managementContract("POST", "/v1/applications/:appId/secrets", {
    detail: { hide: true },
  }))

  .post('/:appId/secrets/:secretId/disable', async ({ params }) => {
    throw capabilityUnavailable('oauth_client_secret_lifecycle', `Secret ${params.secretId} cannot be disabled independently`);
  }, managementContract("POST", "/v1/applications/:appId/secrets/:secretId/disable", {
    detail: { hide: true },
  }))

  .delete('/:appId/secrets/:secretId', async ({ params }) => {
    throw capabilityUnavailable('oauth_client_secret_lifecycle', `Secret ${params.secretId} cannot be deleted independently`);
  }, managementContract("DELETE", "/v1/applications/:appId/secrets/:secretId", {
    detail: { hide: true },
  }))

  .get('/:appId/consent', async ({ params }) => {
    const settings = await appControlRepo.getApplicationConsentSettings(params.appId);
    return decodeEndpointResponse('getApplicationConsentSettings', settings || {
      applicationId: params.appId,
      userScopes: [],
      organizationScopes: [],
      allowedOrganizationIds: [],
      requireExplicitConsent: true,
      customData: {},
    });
  }, managementContract("GET", "/v1/applications/:appId/consent", {
    detail: { summary: 'Get application consent configuration', tags: ['Applications', 'Consent'] },
  }))

  .put('/:appId/consent', async ({ params, body }) => {
    const data = decodeEndpointBody('updateApplicationConsentSettings', body);
    return decodeEndpointResponse('updateApplicationConsentSettings', await appControlRepo.upsertApplicationConsentSettings(params.appId, definedFields({
      userScopes: data.user_scopes ?? undefined,
      organizationScopes: data.organization_scopes ?? undefined,
      allowedOrganizationIds: data.allowed_organization_ids ?? undefined,
      requireExplicitConsent: data.require_explicit_consent ?? undefined,
      customData: data.custom_data ?? undefined,
    })));
  }, managementContract("PUT", "/v1/applications/:appId/consent", {
    detail: { summary: 'Update application consent configuration', tags: ['Applications', 'Consent'] },
  }))

  .get('/:appId/access-control', async ({ params }) => {
    const settings = await appControlRepo.getApplicationConsentSettings(params.appId);
    return decodeEndpointResponse('getApplicationAccessControl', settings || {
      applicationId: params.appId,
      userScopes: [],
      organizationScopes: [],
      allowedOrganizationIds: [],
      requireExplicitConsent: true,
      customData: {},
    });
  }, managementContract("GET", "/v1/applications/:appId/access-control", {
    detail: { summary: 'Get application access-control rules', tags: ['Applications'] },
  }))

  .put('/:appId/access-control', async ({ params, body }) => {
    const input = decodeEndpointBody('updateApplicationAccessControl', body);
    return decodeEndpointResponse('updateApplicationAccessControl', await appControlRepo.upsertApplicationConsentSettings(params.appId, definedFields({
      userScopes: input.user_scopes ?? undefined,
      organizationScopes: input.organization_scopes ?? undefined,
      allowedOrganizationIds: input.allowed_organization_ids ?? undefined,
      requireExplicitConsent: input.require_explicit_consent ?? undefined,
      customData: input.custom_data ?? undefined,
    })));
  }, managementContract("PUT", "/v1/applications/:appId/access-control", {
    detail: { summary: 'Update application access-control rules', tags: ['Applications'] },
  }))

  .get('/:appId/sign-in-experience', async ({ params }) => {
    const experience = await sieRepo.getApplicationSignInExperience(params.appId);
    return decodeEndpointResponse('getApplicationSignInExperience', experience || {
      application_id: params.appId,
      enabled: false,
      branding: {
        logo_url: null,
        favicon_url: null,
        primary_color: null,
        page_title: null,
        background_url: null,
        button_label: null,
        custom_css: null,
      },
    });
  }, managementContract("GET", "/v1/applications/:appId/sign-in-experience", {
    detail: { summary: 'Get application sign-in experience overrides', tags: ['Applications', 'Sign-in Experience'] },
  }))

  .put('/:appId/sign-in-experience', async ({ params, body }) => {
    const data = decodeEndpointBody('updateApplicationSignInExperience', body);
    const saved = await sieRepo.upsertApplicationSignInExperience(params.appId, definedFields({
      ...data, branding: data.branding ?? undefined,
    }));
    await audit('application.sign_in_experience.update', 'application', params.appId, { enabled: saved.enabled });
    return decodeEndpointResponse('updateApplicationSignInExperience', saved);
  }, managementContract("PUT", "/v1/applications/:appId/sign-in-experience", {
    detail: { summary: 'Update application sign-in experience overrides', tags: ['Applications', 'Sign-in Experience'] },
  }))

  .delete('/:appId/sign-in-experience', async ({ params }) => {
    await sieRepo.deleteApplicationSignInExperience(params.appId);
    await audit('application.sign_in_experience.delete', 'application', params.appId);
    return new Response(null, { status: 204 });
  }, managementContract("DELETE", "/v1/applications/:appId/sign-in-experience", {
    detail: { summary: 'Delete application sign-in experience overrides', tags: ['Applications', 'Sign-in Experience'] },
  }))

  // ─── Application-Resource/Scope bindings ───
  .get('/:appId/bindings', async ({ params }) => {
    const bindings = await bindingRepo.listApplicationBindings(params.appId);
    return decodeEndpointResponse('listApplicationBindings', { items: bindings, total: bindings.length });
  }, managementContract("GET", "/v1/applications/:appId/bindings", {
    detail: { summary: 'List application resource/scope bindings', tags: ['Applications', 'Bindings'] },
  }))

  .post('/:appId/bindings', async ({ params, body }) => {
    const data = decodeEndpointBody('createApplicationBinding', body);
    let binding: NonNullable<Awaited<ReturnType<typeof bindingRepo.createBinding>>>;
    try {
      binding = requiredRow(await bindingRepo.createBinding(definedFields({
        applicationId: params.appId,
        resourceId: data.resource_id,
        scopeId: data.scope_id,
      })));
    } catch (error) {
      if (error instanceof bindingRepo.BindingIntegrityError) {
        throw new ApiContractError(
          404,
          error.code,
          error.message,
          { resource_id: data.resource_id, scope_id: data.scope_id },
        );
      }
      throw error;
    }
    await audit('binding.create', 'binding', binding.id, { app_id: params.appId });
    return decodeEndpointResponse('createApplicationBinding', binding);
  }, managementContract("POST", "/v1/applications/:appId/bindings", {
    detail: { summary: 'Create application binding', tags: ['Applications', 'Bindings'] },
  }))

  .delete('/:appId/bindings/:bindingId', async ({ params }) => {
    const deleted = await bindingRepo.deleteBinding(params.appId, params.bindingId);
    if (!deleted) {
      throw new ApiContractError(404, 'binding_not_found', 'Application binding was not found');
    }
    await audit('binding.delete', 'binding', params.bindingId);
  }, managementContract("DELETE", "/v1/applications/:appId/bindings/:bindingId", {
    detail: { summary: 'Delete application binding', tags: ['Applications', 'Bindings'] },
  }))

  .get('/:appId/scopes', async ({ params }) => {
    const scopes = await bindingRepo.listApplicationScopes(params.appId);
    return decodeEndpointResponse('listApplicationScopes', { items: scopes, total: scopes.length });
  }, managementContract("GET", "/v1/applications/:appId/scopes", {
    detail: { summary: 'List application scopes', tags: ['Applications', 'Bindings'] },
  }))

  .get('/:appId/roles', async ({ params }) => {
    return decodeEndpointResponse('listApplicationRoles', pagedResponse(await adapter.listApplicationRoleAssignments(params.appId)));
  }, managementContract("GET", "/v1/applications/:appId/roles", {
    detail: { summary: 'List role assignments for an application', tags: ['Applications', 'RBAC'] },
  }))

  .get('/:appId/logs', async ({ params, query: rawQuery }) => {
    const query = decodeManagementQuery('listApplicationLogs', rawQuery);
    const logs = await adapter.queryAuditLogs({
      resource_type: 'application',
      resource_id: params.appId,
      limit: query.limit,
      cursor: query.cursor,
    });
    return decodeEndpointResponse('listApplicationLogs', cursorResponse(logs, { limit: query.limit }));
  }, managementContract("GET", "/v1/applications/:appId/logs", {
    detail: { summary: 'List audit logs for an application', tags: ['Applications', 'Audit'] },
  }))

  .get('/:appId/organizations', async ({ params }) => {
    return decodeEndpointResponse('listApplicationOrganizations', pagedResponse(await adapter.listApplicationOrganizations(params.appId)));
  }, managementContract("GET", "/v1/applications/:appId/organizations", {
    detail: { summary: 'List organizations with application access', tags: ['Applications', 'Organizations'] },
  }));
