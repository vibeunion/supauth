import { assertOAuthSessionGrants, type OAuthApplicationSessionOptions, type CreateOAuthClientInput } from './oauth-session-grants.js';
export {
  assertOAuthSessionGrants, SupaOAuthSessionConfigurationError,
  type OAuthSessionRequirement, type OAuthApplicationSessionOptions, type CreateOAuthClientInput,
} from './oauth-session-grants.js';
import { sdkEndpoints, decodeSchema, Type, JsonValueSchema, type SdkEndpoint, type SdkEndpointInput, type Static, type TSchema } from '@supauth/shared';
export type { ExistingPolicy, WrapperPolicy, MigrationResult, AuthorizationOperation, AuthorizationCompileRequest, AuthorizationCompileResult, SdkEndpointName, SdkEndpointInput, SdkEndpointResult } from '@supauth/shared';
export { sdkEndpoints } from '@supauth/shared';
import { SupaOAuthResponseContractError, SupaOAuthRequestContractError, type ResponseDecoder, type RequestContract } from './response-contracts.js';
export { SupaOAuthResponseContractError, SupaOAuthRequestContractError, type ResponseDecoder, type RequestContract } from './response-contracts.js';

export class SupaOAuthAPIError extends Error {
  status: number;
  body: string;
  path: string;

  constructor(status: number, body: string, path: string) {
    super(`SupaOAuth API ${status}: ${body}`);
    this.name = 'SupaOAuthAPIError';
    this.status = status;
    this.body = body;
    this.path = path;
  }
}

function pathSegment(value: string): string {
  if (value.length === 0 || value === '.' || value === '..') {
    throw new TypeError('Path segments must be non-empty and cannot be "." or "..".');
  }
  return encodeURIComponent(value);
}

function queryString(params: Record<string, string | number | undefined>): string {
  const search = new URLSearchParams();
  for (const [key, value] of Object.entries(params)) {
    if (value === undefined || value === '' || value === 0) continue;
    search.set(key, String(value));
  }
  const encoded = search.toString();
  return encoded ? `?${encoded}` : '';
}

export type SupaOAuthFetch = (input: string | URL | Request, init?: RequestInit) => Promise<Response>;
export interface SupaOAuthClientOptions {
  baseUrl: string;
  accessToken?: string;
  fetch?: SupaOAuthFetch;
}

// Transport structure only. Every field is first checked against the concrete endpoint input.
const RequestEnvelopeSchema = Type.Object({
  params: Type.Optional(Type.Record(Type.String(), Type.String())),
  query: Type.Optional(Type.Record(Type.String(), Type.Union([Type.String(), Type.Number()]))),
  body: Type.Optional(JsonValueSchema),
  headers: Type.Optional(Type.Record(Type.String(), Type.String())),
});

// ─── Client ──────────────────────────────────────────────
export class SupaOAuthClient {
  private baseUrl: string;
  private accessToken: string | null = null;
  private transport: SupaOAuthFetch;

  constructor(options: SupaOAuthClientOptions) {
    this.baseUrl = options.baseUrl.replace(/\/+$/, '');
    if (options.accessToken) this.accessToken = options.accessToken;
    this.transport = options.fetch ?? ((input, init) => globalThis.fetch(input, init));
  }

  /** Set or update the access token (e.g. after login) */
  setAccessToken(token: string | null) {
    this.accessToken = token;
  }

  private requestHeaders(options: RequestInit): Headers {
    const headers = new Headers(options.headers);
    if (!headers.has('Content-Type')) headers.set('Content-Type', 'application/json');
    if (this.accessToken) {
      headers.set('Authorization', `Bearer ${this.accessToken}`);
    }
    return headers;
  }

  private async response(path: string, options: RequestInit = {}): Promise<Response> {
    const res = await this.transport(`${this.baseUrl}${path}`, { ...options, headers: this.requestHeaders(options) });
    if (!res.ok) {
      const body = await res.text();
      throw new SupaOAuthAPIError(res.status, body, path);
    }
    return res;
  }

  private async jsonResponse(path: string, options: RequestInit): Promise<{ value: unknown; status: number }> {
    const res = await this.response(path, options);
    if (res.status === 204 || res.status === 205) {
      throw new SupaOAuthResponseContractError(path, res.status, 'unexpected_no_content');
    }
    try {
      const value: unknown = await res.json();
      options.signal?.throwIfAborted();
      return { value, status: res.status };
    } catch (error) {
      options.signal?.throwIfAborted();
      if (!(error instanceof SyntaxError)) throw error;
      throw new SupaOAuthResponseContractError(path, res.status, 'invalid_json');
    }
  }

  /** Result types are inferred from a decoder which must validate unknown input. */
  async requestDecoded<T>(path: string, decoder: ResponseDecoder<T>, options: RequestInit = {}): Promise<T> {
    const { value, status } = await this.jsonResponse(path, options);
    try {
      return decoder(value);
    } catch {
      throw new SupaOAuthResponseContractError(path, status, 'invalid_payload');
    }
  }

  /** 请求先校验，回执后校验；不更改会话，也不自动重放写请求。 */
  async execute<Input, Result>(contract: RequestContract<Input, Result>, input: NoInfer<Input>): Promise<Result> {
    let validated: Input;
    try {
      validated = contract.input(input);
    } catch {
      throw new SupaOAuthRequestContractError();
    }
    const request = contract.request(validated);
    return this.requestDecoded(request.path, contract.result, request.options);
  }

  private endpointRequest<I extends TSchema, R extends TSchema>(
    contract: SdkEndpoint<I, R>, input: NoInfer<Static<I>>,
  ): { path: string; options: RequestInit } {
    try {
      const validated = decodeSchema(RequestEnvelopeSchema, decodeSchema(contract.input, input));
      const path = contract.path.replace(/:([A-Za-z][A-Za-z0-9_]*)/g, (_match, name: string) => {
        const value = validated.params?.[name];
        if (value === undefined) throw new SupaOAuthRequestContractError();
        return pathSegment(value);
      }) + queryString(validated.query ?? {});
      return {
        path,
        options: {
          ...(contract.method === 'GET' ? {} : { method: contract.method }),
          ...(validated.body === undefined ? {} : { body: JSON.stringify(validated.body) }),
          ...(validated.headers === undefined ? {} : { headers: validated.headers }),
        },
      };
    } catch {
      throw new SupaOAuthRequestContractError();
    }
  }

  private endpointJson<I extends TSchema, R extends TSchema>(
    contract: SdkEndpoint<I, R> & { responseKind: 'json' }, input: NoInfer<Static<I>>,
  ): Promise<Static<R>> {
    const { path, options } = this.endpointRequest(contract, input);
    return this.requestDecoded(path, value => decodeSchema(contract.result, value), options);
  }

  private async endpointVoid<I extends TSchema, R extends TSchema>(
    contract: SdkEndpoint<I, R> & { responseKind: 'void' }, input: NoInfer<Static<I>>,
  ): Promise<void> {
    const { path, options } = this.endpointRequest(contract, input);
    const response = await this.response(path, options);
    await response.body?.cancel();
  }

  private async endpointBlob<I extends TSchema, R extends TSchema>(
    contract: SdkEndpoint<I, R> & { responseKind: 'blob' }, input: NoInfer<Static<I>>,
  ): Promise<Blob> {
    const { path, options } = this.endpointRequest(contract, input);
    return (await this.response(path, options)).blob();
  }

  health() {
    return this.endpointJson(sdkEndpoints.health, {}).then(({ status, runtime_mode, project_ref }) => ({ status, runtime_mode, project_ref }));
  }

  getProject() {
    return this.endpointJson(sdkEndpoints.getProject, {  });
  }

  getCapabilities() {
    return this.endpointJson(sdkEndpoints.getCapabilities, {  });
  }

  getRuntimeHealth() {
    return this.endpointJson(sdkEndpoints.getRuntimeHealth, {  });
  }

  getOAuthServerStatus() {
    return this.endpointJson(sdkEndpoints.getOAuthServerStatus, {  });
  }

  getDiscovery() {
    return this.endpointJson(sdkEndpoints.getDiscovery, {  });
  }

  getJWKS() {
    return this.endpointJson(sdkEndpoints.getJWKS, {  });
  }

  listApplications() {
    return this.endpointJson(sdkEndpoints.listApplications, {  });
  }

  createApplication(data: SdkEndpointInput<'createApplication'>['body'] | CreateOAuthClientInput, options: OAuthApplicationSessionOptions = {}) {
    if (options.sessionRequirement !== undefined) assertOAuthSessionGrants(data, options.sessionRequirement);
    try {
      const body = decodeSchema(sdkEndpoints.createApplication.input, { body: data }).body;
      return this.endpointJson(sdkEndpoints.createApplication, { body });
    } catch {
      throw new SupaOAuthRequestContractError();
    }
  }

  getApplication(appId: string) {
    return this.endpointJson(sdkEndpoints.getApplication, { params: { appId } });
  }

  updateApplication(appId: string, data: SdkEndpointInput<'updateApplication'>['body'] | Partial<CreateOAuthClientInput>, options: OAuthApplicationSessionOptions = {}) {
    if (options.sessionRequirement !== undefined) assertOAuthSessionGrants(data, options.sessionRequirement);
    try {
      const body = decodeSchema(sdkEndpoints.updateApplication.input, { params: { appId }, body: data }).body;
      return this.endpointJson(sdkEndpoints.updateApplication, { params: { appId }, body });
    } catch {
      throw new SupaOAuthRequestContractError();
    }
  }

  deleteApplication(appId: string) {
    return this.endpointVoid(sdkEndpoints.deleteApplication, { params: { appId } });
  }

  rotateApplicationSecret(appId: string) {
    return this.endpointJson(sdkEndpoints.rotateApplicationSecret, { params: { appId } });
  }

  getApplicationConsentSettings(appId: string) {
    return this.endpointJson(sdkEndpoints.getApplicationConsentSettings, { params: { appId } });
  }

  updateApplicationConsentSettings(appId: string, data: SdkEndpointInput<'updateApplicationConsentSettings'>['body']) {
    return this.endpointJson(sdkEndpoints.updateApplicationConsentSettings, { params: { appId }, body: data });
  }

  getApplicationSignInExperience(appId: string) {
    return this.endpointJson(sdkEndpoints.getApplicationSignInExperience, { params: { appId } });
  }

  updateApplicationSignInExperience(appId: string, data: SdkEndpointInput<'updateApplicationSignInExperience'>['body']) {
    return this.endpointJson(sdkEndpoints.updateApplicationSignInExperience, { params: { appId }, body: data });
  }

  deleteApplicationSignInExperience(appId: string) {
    return this.endpointVoid(sdkEndpoints.deleteApplicationSignInExperience, { params: { appId } });
  }

  listApplicationBindings(appId: string) {
    return this.endpointJson(sdkEndpoints.listApplicationBindings, { params: { appId } });
  }

  createApplicationBinding(appId: string, data: SdkEndpointInput<'createApplicationBinding'>['body']) {
    return this.endpointJson(sdkEndpoints.createApplicationBinding, { params: { appId }, body: data });
  }

  deleteApplicationBinding(appId: string, bindingId: string) {
    return this.endpointVoid(sdkEndpoints.deleteApplicationBinding, { params: { appId, bindingId } });
  }

  listApplicationScopes(appId: string) {
    return this.endpointJson(sdkEndpoints.listApplicationScopes, { params: { appId } });
  }

  listApplicationRoles(appId: string) {
    return this.endpointJson(sdkEndpoints.listApplicationRoles, { params: { appId } });
  }

  listApplicationLogs(appId: string, params: NonNullable<SdkEndpointInput<'listApplicationLogs'>['query']> = {}) {
    return this.endpointJson(sdkEndpoints.listApplicationLogs, { params: { appId }, query: params });
  }

  listApplicationOrganizations(appId: string) {
    return this.endpointJson(sdkEndpoints.listApplicationOrganizations, { params: { appId } });
  }

  getApplicationAccessControl(appId: string) {
    return this.endpointJson(sdkEndpoints.getApplicationAccessControl, { params: { appId } });
  }

  updateApplicationAccessControl(appId: string, data: SdkEndpointInput<'updateApplicationAccessControl'>['body']) {
    return this.endpointJson(sdkEndpoints.updateApplicationAccessControl, { params: { appId }, body: data });
  }

  listConnectors() {
    return this.endpointJson(sdkEndpoints.listConnectors, {  });
  }

  getConnector(connectorId: string) {
    return this.endpointJson(sdkEndpoints.getConnector, { params: { connectorId } });
  }

  updateConnector(connectorId: string, data: SdkEndpointInput<'updateConnector'>['body']) {
    return this.endpointJson(sdkEndpoints.updateConnector, { params: { connectorId }, body: data });
  }

  testConnector(connectorId: string) {
    return this.endpointJson(sdkEndpoints.testConnector, { params: { connectorId } });
  }

  getConnectorAuthorizationUri(connectorId: string, params?: NonNullable<SdkEndpointInput<'getConnectorAuthorizationUri'>['query']>) {
    return this.endpointJson(sdkEndpoints.getConnectorAuthorizationUri, { params: { connectorId }, ...(params === undefined ? {} : { query: params }) });
  }

  listConnectorFactories(category?: string) {
    return this.endpointJson(sdkEndpoints.listConnectorFactories, { query: { ...(category === undefined ? {} : { category: category }) } });
  }

  upsertConnectorFactory(factoryId: string, data: SdkEndpointInput<'upsertConnectorFactory'>['body']) {
    return this.endpointJson(sdkEndpoints.upsertConnectorFactory, { params: { factoryId }, body: data });
  }

  listResources() {
    return this.endpointJson(sdkEndpoints.listResources, {  });
  }

  createResource(data: SdkEndpointInput<'createResource'>['body']) {
    return this.endpointJson(sdkEndpoints.createResource, { body: data });
  }

  getResource(resourceId: string) {
    return this.endpointJson(sdkEndpoints.getResource, { params: { resourceId } });
  }

  updateResource(resourceId: string, data?: SdkEndpointInput<'updateResource'>['body']) {
    return this.endpointJson(sdkEndpoints.updateResource, { params: { resourceId }, ...(data === undefined ? {} : { body: data }) });
  }

  deleteResource(resourceId: string) {
    return this.endpointVoid(sdkEndpoints.deleteResource, { params: { resourceId } });
  }

  addScope(resourceId: string, data: SdkEndpointInput<'addScope'>['body']) {
    return this.endpointJson(sdkEndpoints.addScope, { params: { resourceId }, body: data });
  }

  updateScope(resourceId: string, scopeId: string, data: SdkEndpointInput<'updateScope'>['body']) {
    return this.endpointJson(sdkEndpoints.updateScope, { params: { resourceId, scopeId }, body: data });
  }

  removeScope(resourceId: string, scopeId: string) {
    return this.endpointVoid(sdkEndpoints.removeScope, { params: { resourceId, scopeId } });
  }

  listResourceApplications(resourceId: string) {
    return this.endpointJson(sdkEndpoints.listResourceApplications, { params: { resourceId } });
  }

  listUsers(params: NonNullable<SdkEndpointInput<'listUsers'>['query']> = {}) {
    return this.endpointJson(sdkEndpoints.listUsers, { query: params });
  }

  createUser(data: SdkEndpointInput<'createUser'>['body']) {
    return this.endpointJson(sdkEndpoints.createUser, { body: data });
  }

  getUser(userId: string) {
    return this.endpointJson(sdkEndpoints.getUser, { params: { userId } });
  }

  updateUser(userId: string, data: SdkEndpointInput<'updateUser'>['body']) {
    return this.endpointJson(sdkEndpoints.updateUser, { params: { userId }, body: data });
  }

  suspendUser(userId: string, data: SdkEndpointInput<'suspendUser'>['body'] = {}) {
    return this.endpointJson(sdkEndpoints.suspendUser, { params: { userId }, body: data });
  }

  deleteUser(userId: string) {
    return this.endpointVoid(sdkEndpoints.deleteUser, { params: { userId } });
  }

  resetUserMfa(userId: string, factorId: string) {
    return this.endpointJson(sdkEndpoints.resetUserMfa, { params: { userId, factorId } });
  }

  listUserLogs(userId: string, params: NonNullable<SdkEndpointInput<'listUserLogs'>['query']> = {}) {
    return this.endpointJson(sdkEndpoints.listUserLogs, { params: { userId }, query: params });
  }

  listUserOrganizations(userId: string) {
    return this.endpointJson(sdkEndpoints.listUserOrganizations, { params: { userId } });
  }

  getUserPermissions(userId: string, orgId?: string, applicationId?: string) {
    return this.endpointJson(sdkEndpoints.getUserPermissions, { params: { userId }, query: { ...(orgId === undefined ? {} : { org_id: orgId }), ...(applicationId === undefined ? {} : { application_id: applicationId }) } });
  }

  getUserRoles(userId: string, applicationId?: string) {
    return this.endpointJson(sdkEndpoints.getUserRoles, { params: { userId }, query: { ...(applicationId === undefined ? {} : { application_id: applicationId }) } });
  }

  listOrganizations(params: NonNullable<SdkEndpointInput<'listOrganizations'>['query']> = {}) {
    return this.endpointJson(sdkEndpoints.listOrganizations, { query: params });
  }

  createOrganization(data: SdkEndpointInput<'createOrganization'>['body']) {
    return this.endpointJson(sdkEndpoints.createOrganization, { body: data });
  }

  getOrganization(orgId: string) {
    return this.endpointJson(sdkEndpoints.getOrganization, { params: { orgId } });
  }

  updateOrganization(orgId: string, data: SdkEndpointInput<'updateOrganization'>['body']) {
    return this.endpointJson(sdkEndpoints.updateOrganization, { params: { orgId }, body: data });
  }

  deleteOrganization(orgId: string) {
    return this.endpointVoid(sdkEndpoints.deleteOrganization, { params: { orgId } });
  }

  addOrganizationMember(orgId: string, data: SdkEndpointInput<'addOrganizationMember'>['body']) {
    return this.endpointJson(sdkEndpoints.addOrganizationMember, { params: { orgId }, body: data });
  }

  listOrganizationMembers(orgId: string, params: NonNullable<SdkEndpointInput<'listOrganizationMembers'>['query']> = {}) {
    return this.endpointJson(sdkEndpoints.listOrganizationMembers, { params: { orgId }, query: params });
  }

  removeOrganizationMember(orgId: string, userId: string) {
    return this.endpointVoid(sdkEndpoints.removeOrganizationMember, { params: { orgId, userId } });
  }

  updateOrganizationMemberRole(orgId: string, userId: string, data: SdkEndpointInput<'updateOrganizationMemberRole'>['body']) {
    return this.endpointJson(sdkEndpoints.updateOrganizationMemberRole, { params: { orgId, userId }, body: data });
  }

  listOrganizationInvitations(orgId: string) {
    return this.endpointJson(sdkEndpoints.listOrganizationInvitations, { params: { orgId } });
  }

  createOrganizationInvitation(orgId: string, data: SdkEndpointInput<'createOrganizationInvitation'>['body']) {
    return this.endpointJson(sdkEndpoints.createOrganizationInvitation, { params: { orgId }, body: data });
  }

  acceptOrganizationInvitation(orgId: string, invitationId: string, data: SdkEndpointInput<'acceptOrganizationInvitation'>['body']) {
    return this.endpointJson(sdkEndpoints.acceptOrganizationInvitation, { params: { orgId, invitationId }, body: data });
  }

  revokeOrganizationInvitation(orgId: string, invitationId: string) {
    return this.endpointJson(sdkEndpoints.revokeOrganizationInvitation, { params: { orgId, invitationId } });
  }

  getOrganizationJitSettings(orgId: string) {
    return this.endpointJson(sdkEndpoints.getOrganizationJitSettings, { params: { orgId } });
  }

  updateOrganizationJitSettings(orgId: string, data: SdkEndpointInput<'updateOrganizationJitSettings'>['body']) {
    return this.endpointJson(sdkEndpoints.updateOrganizationJitSettings, { params: { orgId }, body: data });
  }

  listOrganizationApplications(orgId: string) {
    return this.endpointJson(sdkEndpoints.listOrganizationApplications, { params: { orgId } });
  }

  bindOrganizationApplication(orgId: string, appId: string) {
    return this.endpointJson(sdkEndpoints.bindOrganizationApplication, { params: { orgId, appId }, body: {} });
  }

  removeOrganizationApplication(orgId: string, appId: string) {
    return this.endpointJson(sdkEndpoints.removeOrganizationApplication, { params: { orgId, appId } });
  }

  getOrganizationBranding(orgId: string) {
    return this.endpointJson(sdkEndpoints.getOrganizationBranding, { params: { orgId } });
  }

  updateOrganizationBranding(orgId: string, data: SdkEndpointInput<'updateOrganizationBranding'>['body']) {
    return this.endpointJson(sdkEndpoints.updateOrganizationBranding, { params: { orgId }, body: data });
  }

  listRoles() {
    return this.endpointJson(sdkEndpoints.listRoles, {  });
  }

  createRole(data: SdkEndpointInput<'createRole'>['body']) {
    return this.endpointJson(sdkEndpoints.createRole, { body: data });
  }

  getRole(roleId: string) {
    return this.endpointJson(sdkEndpoints.getRole, { params: { roleId } });
  }

  updateRole(roleId: string, data: SdkEndpointInput<'updateRole'>['body']) {
    return this.endpointJson(sdkEndpoints.updateRole, { params: { roleId }, body: data });
  }

  deleteRole(roleId: string) {
    return this.endpointVoid(sdkEndpoints.deleteRole, { params: { roleId } });
  }

  listRolePermissions(roleId: string) {
    return this.endpointJson(sdkEndpoints.listRolePermissions, { params: { roleId } });
  }

  createRolePermission(roleId: string, data: SdkEndpointInput<'createRolePermission'>['body']) {
    return this.endpointJson(sdkEndpoints.createRolePermission, { params: { roleId }, body: data });
  }

  deleteRolePermission(roleId: string, permissionId: string) {
    return this.endpointVoid(sdkEndpoints.deleteRolePermission, { params: { roleId, permissionId } });
  }

  assignRole(roleId: string, data: SdkEndpointInput<'assignRole'>['body']) {
    return this.endpointJson(sdkEndpoints.assignRole, { params: { roleId }, body: data });
  }

  listRoleAssignments(roleId: string) {
    return this.endpointJson(sdkEndpoints.listRoleAssignments, { params: { roleId } });
  }

  revokeRole(roleId: string, assignmentId: string) {
    return this.endpointVoid(sdkEndpoints.revokeRole, { params: { roleId, assignmentId } });
  }

  getOrgRoleAssignments(orgId: string) {
    return this.endpointJson(sdkEndpoints.getOrgRoleAssignments, { params: { orgId } });
  }

  getSignInExperience() {
    return this.endpointJson(sdkEndpoints.getSignInExperience, {  });
  }

  resolveSignInExperience(applicationId?: string) {
    return this.endpointJson(sdkEndpoints.resolveSignInExperience, { query: { ...(applicationId === undefined ? {} : { application_id: applicationId }) } });
  }

  resolvePublicSignInExperience(params: NonNullable<SdkEndpointInput<'resolvePublicSignInExperience'>['query']> = {}) {
    return this.endpointJson(sdkEndpoints.resolvePublicSignInExperience, { query: params });
  }

  getPublicPhrases(languageTag: string) {
    return this.endpointJson(sdkEndpoints.getPublicPhrases, { params: { languageTag } });
  }

  updateSignInExperience(data: SdkEndpointInput<'updateSignInExperience'>['body']) {
    return this.endpointJson(sdkEndpoints.updateSignInExperience, { body: data });
  }

  getAuthConfig() {
    return this.endpointJson(sdkEndpoints.getAuthConfig, {  });
  }

  updateAuthConfig(data: SdkEndpointInput<'updateAuthConfig'>['body']) {
    return this.endpointJson(sdkEndpoints.updateAuthConfig, { body: data });
  }

  getCompatibilityReport() {
    return this.endpointJson(sdkEndpoints.getCompatibilityReport, {  });
  }

  listTenantConfigs(type?: string) {
    return this.endpointJson(sdkEndpoints.listTenantConfigs, { query: { ...(type === undefined ? {} : { type: type }) } });
  }

  getTenantConfig(type: string, key: string) {
    return this.endpointJson(sdkEndpoints.getTenantConfig, { params: { type, key } });
  }

  upsertTenantConfig(type: string, key: string, data: SdkEndpointInput<'upsertTenantConfig'>['body']) {
    return this.endpointJson(sdkEndpoints.upsertTenantConfig, { params: { type, key }, body: data });
  }

  deleteTenantConfig(type: string, key: string) {
    return this.endpointJson(sdkEndpoints.deleteTenantConfig, { params: { type, key } });
  }

  checkTenantDomain(domain: string) {
    return this.endpointJson(sdkEndpoints.checkTenantDomain, { params: { domain } });
  }

  getAuthHookRegistrationGuide() {
    return this.endpointJson(sdkEndpoints.getAuthHookRegistrationGuide, {  });
  }

  getAuthHookStatus() {
    return this.endpointJson(sdkEndpoints.getAuthHookStatus, {  });
  }

  verifyAuthHook() {
    return this.endpointJson(sdkEndpoints.verifyAuthHook, {  });
  }

  getBeforeUserCreatedHookStatus() {
    return this.endpointJson(sdkEndpoints.getBeforeUserCreatedHookStatus, {  });
  }

  verifyBeforeUserCreatedHook() {
    return this.endpointJson(sdkEndpoints.verifyBeforeUserCreatedHook, {  });
  }

  listTenantMembers(params: NonNullable<SdkEndpointInput<'listTenantMembers'>['query']> = {}) {
    return this.endpointJson(sdkEndpoints.listTenantMembers, { query: params });
  }

  updateTenantMember(memberId: string, data: SdkEndpointInput<'updateTenantMember'>['body']) {
    return this.endpointJson(sdkEndpoints.updateTenantMember, { params: { memberId }, body: data });
  }

  removeTenantMember(memberId: string) {
    return this.endpointVoid(sdkEndpoints.removeTenantMember, { params: { memberId } });
  }

  listTenantInvitations(params: NonNullable<SdkEndpointInput<'listTenantInvitations'>['query']> = {}) {
    return this.endpointJson(sdkEndpoints.listTenantInvitations, { query: params });
  }

  createTenantInvitation(data: SdkEndpointInput<'createTenantInvitation'>['body']) {
    return this.endpointJson(sdkEndpoints.createTenantInvitation, { body: data });
  }

  listWebhooks() {
    return this.endpointJson(sdkEndpoints.listWebhooks, {  });
  }

  createWebhook(data: SdkEndpointInput<'createWebhook'>['body']) {
    return this.endpointJson(sdkEndpoints.createWebhook, { body: data });
  }

  getWebhook(webhookId: string) {
    return this.endpointJson(sdkEndpoints.getWebhook, { params: { webhookId } });
  }

  updateWebhook(webhookId: string, data: SdkEndpointInput<'updateWebhook'>['body']) {
    return this.endpointJson(sdkEndpoints.updateWebhook, { params: { webhookId }, body: data });
  }

  deleteWebhook(webhookId: string) {
    return this.endpointVoid(sdkEndpoints.deleteWebhook, { params: { webhookId } });
  }

  rotateWebhookSecret(webhookId: string) {
    return this.endpointJson(sdkEndpoints.rotateWebhookSecret, { params: { webhookId } });
  }

  listWebhookLogs(webhookId: string, limit?: number) {
    return this.endpointJson(sdkEndpoints.listWebhookLogs, { params: { webhookId }, query: { ...(limit === undefined ? {} : { limit: limit }) } });
  }

  testWebhook(webhookId: string) {
    return this.endpointJson(sdkEndpoints.testWebhook, { params: { webhookId }, body: {} });
  }

  listWebhookEvents() {
    return this.endpointJson(sdkEndpoints.listWebhookEvents, {  });
  }

  listWebhookDeliveries(webhookId: string, params: NonNullable<SdkEndpointInput<'listWebhookDeliveries'>['query']> = {}) {
    return this.endpointJson(sdkEndpoints.listWebhookDeliveries, { params: { webhookId }, query: params });
  }

  getWebhookDelivery(webhookId: string, deliveryId: string) {
    return this.endpointJson(sdkEndpoints.getWebhookDelivery, { params: { webhookId, deliveryId } });
  }

  replayWebhookDelivery(webhookId: string, deliveryId: string) {
    return this.endpointJson(sdkEndpoints.replayWebhookDelivery, { params: { webhookId, deliveryId } });
  }

  syncUserMetadata(userId: string, orgId?: string) {
    return this.endpointJson(sdkEndpoints.syncUserMetadata, { params: { userId }, query: { ...(orgId === undefined ? {} : { org_id: orgId }) } });
  }

  syncOrgMetadata(orgId: string) {
    return this.endpointJson(sdkEndpoints.syncOrgMetadata, { params: { orgId } });
  }

  listAuditLogs(params?: NonNullable<SdkEndpointInput<'listAuditLogs'>['query']>) {
    return this.endpointJson(sdkEndpoints.listAuditLogs, { ...(params === undefined ? {} : { query: params }) });
  }

  getAuditLog(logId: string) {
    return this.endpointJson(sdkEndpoints.getAuditLog, { params: { logId } });
  }

  createAuditExport(params: SdkEndpointInput<'createAuditExport'>['body'] = {}) {
    return this.endpointJson(sdkEndpoints.createAuditExport, { body: params });
  }

  getAuditExport(exportId: string) {
    return this.endpointJson(sdkEndpoints.getAuditExport, { params: { exportId } });
  }

  getAuditExportDownload(exportId: string) {
    return this.endpointBlob(sdkEndpoints.getAuditExportDownload, { params: { exportId } });
  }

  getAuditIntegrity() {
    return this.endpointJson(sdkEndpoints.getAuditIntegrity, {  });
  }

  compileAuthorizationPlan(data: SdkEndpointInput<'compileAuthorizationPlan'>['body']) {
    return this.endpointJson(sdkEndpoints.compileAuthorizationPlan, { body: data });
  }

  getAuthorizationCompilerDemo() {
    return this.endpointJson(sdkEndpoints.getAuthorizationCompilerDemo, {  });
  }

  generateRLSMigration(policies: SdkEndpointInput<'generateRLSMigration'>['body']['policies']) {
    return this.endpointJson(sdkEndpoints.generateRLSMigration, { body: { policies } });
  }

  getRLSMigrationDemo() {
    return this.endpointJson(sdkEndpoints.getRLSMigrationDemo, {  });
  }

  listOrgTemplates() {
    return this.endpointJson(sdkEndpoints.listOrgTemplates, {  });
  }

  createOrgTemplate(data: SdkEndpointInput<'createOrgTemplate'>['body']) {
    return this.endpointJson(sdkEndpoints.createOrgTemplate, { body: data });
  }

  instantiateOrgTemplate(templateId: string, data: SdkEndpointInput<'instantiateOrgTemplate'>['body'], idempotencyKey: string = globalThis.crypto?.randomUUID?.() || `${Date.now()}-${Math.random().toString(36).slice(2)}`) {
    return this.endpointJson(sdkEndpoints.instantiateOrgTemplate, { params: { templateId }, body: data, headers: { 'Idempotency-Key': idempotencyKey } });
  }

  getSecurityStatus() {
    return this.endpointJson(sdkEndpoints.getSecurityStatus, {  });
  }

  getProvisioningStatus(projectRef: string) {
    return this.endpointJson(sdkEndpoints.getProvisioningStatus, { params: { projectRef } });
  }

  reconcileProject(projectRef: string) {
    return this.endpointJson(sdkEndpoints.reconcileProject, { params: { projectRef } });
  }

  listEnterpriseSSOConfigs() {
    return this.endpointJson(sdkEndpoints.listEnterpriseSSOConfigs, {  });
  }

  createEnterpriseSSOConfig(data: SdkEndpointInput<'createEnterpriseSSOConfig'>['body']) {
    return this.endpointJson(sdkEndpoints.createEnterpriseSSOConfig, { body: data });
  }

}
