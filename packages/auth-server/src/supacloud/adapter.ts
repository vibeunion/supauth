// SupaCloud adapter — server-side only, holds master token
// All SupaCloud Management API calls go through this module.
// P0-26: Supports per-request projectRef override for multi-project safety.

import { createHash, createHmac, randomUUID } from 'node:crypto';
import { currentAdminRequestContext, getCurrentRequestId } from '../auth/request-context.js';
import { getConfig, validateBffSigningSecret } from '../config/index.js';
import { capabilityUnavailable } from '../utils/api-contract.js';

const DELEGATED_HEADER_NAMES = [
  'x-request-id',
  'x-supaoauth-actor-id',
  'x-supaoauth-actor-type',
  'x-supaoauth-actor-timestamp',
  'x-supaoauth-body-sha256',
  'x-supaoauth-actor-nonce',
  'x-supaoauth-actor-signature',
  'x-supaoauth-authorization-source',
] as const;
const REQUEST_ID_PATTERN = /^[A-Za-z0-9._:/+-]{1,200}$/;
const ACTOR_ID_PATTERN = /^[A-Za-z0-9@._:+/-]{1,200}$/;
type BffActorType = 'admin' | 'user' | 'system';

interface BffActorContext {
  requestId: string;
  actorId: string;
  actorType: BffActorType;
  authorizationSource: string;
}

interface BffProofInput extends BffActorContext {
  method: string;
  outboundUrl: string;
  body: BodyInit | null | undefined;
}

interface BffSignatureInput extends BffProofInput {
  timestamp: string;
  bodySha256: string;
  nonce: string;
}

interface SupaCloudAuditEvent {
  event_type: string;
  actor_id?: string | null;
  actor_type: BffActorType;
  resource_type: string;
  resource_id: string;
  details?: Record<string, unknown>;
}

function canonicalBffProof(input: {
  method: string;
  url: URL;
  timestamp: string;
  requestId: string;
  actorId: string;
  actorType: string;
  bodySha256: string;
  nonce: string;
}) {
  return [
    input.method.toUpperCase(),
    `${input.url.pathname}${input.url.search}`,
    input.timestamp,
    input.requestId,
    input.actorId,
    input.actorType,
    input.bodySha256,
    input.nonce,
  ].join('\n');
}

function requireBffSigningSecret(): string {
  const config = getConfig();
  const validationError = validateBffSigningSecret(config);
  if (validationError) throw new Error(validationError);
  return config.supaoauthBffSigningSecret;
}

function assertProofField(name: string, value: string, pattern: RegExp): void {
  if (!pattern.test(value)) throw new Error(`Invalid ${name} for SupaCloud BFF proof`);
}

function proofBodySha256(body: BodyInit | null | undefined, method: string): string {
  if (method.toUpperCase() === 'GET' || method.toUpperCase() === 'HEAD' || body == null) {
    return createHash('sha256').update(Buffer.alloc(0)).digest('hex');
  }
  if (typeof body === 'string') return createHash('sha256').update(Buffer.from(body)).digest('hex');
  if (body instanceof ArrayBuffer) return createHash('sha256').update(Buffer.from(body)).digest('hex');
  if (ArrayBuffer.isView(body)) {
    return createHash('sha256')
      .update(Buffer.from(body.buffer, body.byteOffset, body.byteLength))
      .digest('hex');
  }
  if (body instanceof URLSearchParams) {
    return createHash('sha256').update(Buffer.from(body.toString())).digest('hex');
  }
  throw new TypeError('SupaCloud BFF proof requires a replayable non-stream body');
}

function bffProofSignature(input: BffSignatureInput): string {
  const canonical = canonicalBffProof({
    method: input.method,
    url: new URL(input.outboundUrl),
    timestamp: input.timestamp,
    requestId: input.requestId,
    actorId: input.actorId,
    actorType: input.actorType,
    bodySha256: input.bodySha256,
    nonce: input.nonce,
  });
  return `v2=${createHmac('sha256', requireBffSigningSecret()).update(canonical).digest('hex')}`;
}

function bffProofHeaders(input: BffProofInput): Record<string, string> {
  assertProofField('request ID', input.requestId, REQUEST_ID_PATTERN);
  assertProofField('actor ID', input.actorId, ACTOR_ID_PATTERN);
  const timestamp = String(Math.floor(Date.now() / 1000));
  const bodySha256 = proofBodySha256(input.body, input.method);
  const nonce = randomUUID();
  return {
    'x-request-id': input.requestId,
    'x-supaoauth-actor-id': input.actorId,
    'x-supaoauth-actor-type': input.actorType,
    'x-supaoauth-actor-timestamp': timestamp,
    'x-supaoauth-body-sha256': bodySha256,
    'x-supaoauth-actor-nonce': nonce,
    'x-supaoauth-actor-signature': bffProofSignature({
      ...input,
      timestamp,
      bodySha256,
      nonce,
    }),
    'x-supaoauth-authorization-source': input.authorizationSource,
  };
}

function adminProofActor(): BffActorContext | undefined {
  const context = currentAdminRequestContext();
  if (!context) return undefined;
  return {
    requestId: context.requestId,
    actorId: context.principal.id,
    actorType: 'admin',
    authorizationSource: context.principal.authorization_source,
  };
}

function auditProofActor(event: SupaCloudAuditEvent): BffActorContext {
  const adminActor = adminProofActor();
  if (adminActor) return adminActor;
  if (event.actor_type === 'admin') {
    throw new Error('A trusted admin request context is required for admin audit events');
  }
  if (!event.actor_id?.trim()) {
    throw new Error(`actorId is required for ${event.actor_type} audit events`);
  }
  return {
    requestId: getCurrentRequestId() || randomUUID(),
    actorId: event.actor_id,
    actorType: event.actor_type,
    authorizationSource: `supaoauth_audit_${event.actor_type}`,
  };
}

export interface AdapterOptions {
  /** Override the default PROJECT_REF for this adapter instance */
  projectRef?: string;
  /** Explicit runtime URL for this project. */
  runtimeUrl?: string;
  /** Explicit storage URL for this project. */
  storageUrl?: string;
}

export interface AdapterTargetInfo {
  projectRef: string;
  runtimeUrl: string;
  storageUrl: string;
  runtimeProjectScoped: boolean;
  storageProjectScoped: boolean;
}

export type ConnectorRuntimeKind = 'builtin_oauth' | 'custom_oidc' | 'saml';

export interface ManagedWebhookEvent {
  id: string;
  type: string;
  occurred_at: string;
  api_version: string;
  payload: Record<string, unknown>;
}

interface OrganizationJitSettings {
  enabled: boolean;
  domains: string[];
}

type GatewayRouteProbe = {
  name: string;
  path: string;
  acceptedStatuses: readonly number[];
};

const SUPABASE_RUNTIME_ROUTE_PROBES = [
  { name: 'gotrue_health', path: '/auth/v1/health', acceptedStatuses: [200] },
  { name: 'postgrest_root', path: '/rest/v1/', acceptedStatuses: [200, 401, 406] },
  { name: 'storage_buckets', path: '/storage/v1/bucket', acceptedStatuses: [200, 401] },
  { name: 'realtime_ws', path: '/realtime/v1/websocket', acceptedStatuses: [200, 400, 403, 426] },
  { name: 'functions_root', path: '/functions/v1/', acceptedStatuses: [200, 401, 404] },
] as const satisfies readonly GatewayRouteProbe[];

export class SupaCloudApiError extends Error {
  status: number;
  body: string;
  path: string;

  constructor(status: number, body: string, path: string) {
    super(`SupaCloud ${status}: ${body}`);
    this.name = 'SupaCloudApiError';
    this.status = status;
    this.body = body;
    this.path = path;
  }
}

export function isSupaCloudApiError(error: unknown, statuses?: number[]): error is SupaCloudApiError {
  if (!(error instanceof SupaCloudApiError)) return false;
  return statuses ? statuses.includes(error.status) : true;
}

function pathSegment(value: string) {
  return encodeURIComponent(value);
}

const STORAGE_PATH_SEPARATOR = /[\\/]/u;
const STORAGE_PATH_CONTROL = /[\u0000-\u001f\u007f]/u;
const ENCODED_STORAGE_PATH_SEPARATOR = /%(?:25)*(?:2f|5c)/iu;
const ENCODED_STORAGE_PATH_CONTROL = /%(?:25)*(?:0[0-9a-f]|1[0-9a-f]|7f)/iu;
const ENCODED_STORAGE_DOT_SEGMENT = /^(?:\.|%(?:25)*2e){1,2}$/iu;
const SUPABASE_STORAGE_BUCKET_ID = /^[\w!.*'() &$@=;:+,?-]{1,100}$/u;

function storageBucketSegment(bucketId: string) {
  if (bucketId === '.' || bucketId === '..' || !SUPABASE_STORAGE_BUCKET_ID.test(bucketId)) {
    throw new TypeError('Storage bucket ID is invalid');
  }
  return pathSegment(bucketId);
}

function unsafeStorageObjectSegment(segment: string) {
  if (!segment) return true;
  const normalized = segment.normalize('NFKC');
  if (normalized === '.' || normalized === '..'
    || STORAGE_PATH_SEPARATOR.test(normalized)
    || STORAGE_PATH_CONTROL.test(normalized)
    || ENCODED_STORAGE_PATH_SEPARATOR.test(normalized)
    || ENCODED_STORAGE_PATH_CONTROL.test(normalized)
    || ENCODED_STORAGE_DOT_SEGMENT.test(normalized)) return true;

  try {
    const decoded = decodeURIComponent(segment).normalize('NFKC');
    return decoded === '.' || decoded === '..'
      || STORAGE_PATH_SEPARATOR.test(decoded)
      || STORAGE_PATH_CONTROL.test(decoded);
  } catch {
    // Malformed percent text is encoded as a literal percent by pathSegment().
    return false;
  }
}

function storageObjectPath(bucketId: string, filePath: string) {
  const fileSegments = filePath.split('/');
  if (fileSegments.some(unsafeStorageObjectSegment)) {
    throw new TypeError('Storage object path contains an unsafe segment');
  }
  return [storageBucketSegment(bucketId), ...fileSegments.map(pathSegment)].join('/');
}

function storageSignedUrlExpiry(expiresIn: number) {
  if (!Number.isSafeInteger(expiresIn) || expiresIn <= 0) {
    throw new TypeError('Storage signed URL expiry must be a positive safe integer');
  }
  return expiresIn;
}

function storageSignedUrl(value: unknown, storageUrl: string) {
  if (typeof value !== 'string' || value !== value.trim() || !value
    || STORAGE_PATH_CONTROL.test(value)
    || (!value.startsWith('/') && !/^https?:\/\//i.test(value))
    || value.startsWith('//')) {
    throw new Error('Storage sign URL response did not contain a valid signedURL');
  }
  try {
    const parsed = new URL(value, storageUrl);
    if (!['http:', 'https:'].includes(parsed.protocol) || parsed.username || parsed.password) throw new Error();
  } catch {
    throw new Error('Storage sign URL response did not contain a valid signedURL');
  }
  return value;
}

function queryString(params: Record<string, unknown>) {
  const query = new URLSearchParams();
  for (const [key, value] of Object.entries(params)) {
    if (value === undefined || value === null || value === '') continue;
    query.set(key, value instanceof Date ? value.toISOString() : String(value));
  }
  const text = query.toString();
  return text ? `?${text}` : '';
}

function runtimeAuthorizationRequest(
  providerId: string,
  runtimeKind: ConnectorRuntimeKind,
  redirectTo?: string,
): { path: string; init: RequestInit } {
  if (runtimeKind === 'saml') {
    return {
      path: '/auth/v1/sso',
      init: {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          provider_id: providerId,
          ...(redirectTo ? { redirect_to: redirectTo } : {}),
          skip_http_redirect: true,
        }),
      },
    };
  }
  const query = new URLSearchParams({ provider: providerId, skip_http_redirect: 'true' });
  if (redirectTo) query.set('redirect_to', redirectTo);
  return { path: `/auth/v1/authorize?${query}`, init: { method: 'GET' } };
}

function runtimeApiUrl(baseUrl: string, requestPath: string) {
  const runtimeUrl = new URL(baseUrl);
  const parsedRequest = new URL(requestPath, 'http://runtime.invalid');
  const basePath = runtimeUrl.pathname.replace(/\/+$/, '');
  const normalizedPath = parsedRequest.pathname;
  const appendedPath = basePath.endsWith('/auth/v1') && normalizedPath.startsWith('/auth/v1/')
    ? normalizedPath.slice('/auth/v1'.length)
    : normalizedPath;
  runtimeUrl.pathname = `${basePath}${appendedPath}`.replace(/\/+/g, '/');
  runtimeUrl.search = parsedRequest.search;
  runtimeUrl.hash = '';
  return runtimeUrl.toString();
}

function safeRuntimeAuthorizationUrl(response: Response, payload: unknown) {
  const payloadUrl = payload && typeof payload === 'object' && 'url' in payload
    ? (payload as { url?: unknown }).url
    : null;
  const candidate = response.headers.get('location') || payloadUrl;
  if (typeof candidate !== 'string') throw new Error('Authentication runtime did not return an authorization URL');

  const authorizationUrl = new URL(candidate);
  if (!['http:', 'https:'].includes(authorizationUrl.protocol)
    || authorizationUrl.username
    || authorizationUrl.password) {
    throw new Error('Authentication runtime returned an unsafe authorization URL');
  }
  return authorizationUrl.toString();
}

export class SupaCloudAdapter {
  private apiUrl: string;
  private masterToken: string;
  private projectRef: string;
  private storageUrl: string;
  private runtimeUrl: string;
  private runtimeProjectScoped: boolean;
  private storageProjectScoped: boolean;

  constructor(options?: AdapterOptions) {
    const config = getConfig();
    this.apiUrl = config.supacloudApiUrl;
    this.masterToken = config.supacloudMasterToken;
    // Per-instance projectRef: explicit override > env default
    this.projectRef = options?.projectRef || config.projectRef;

    const runtimeTarget = resolveProjectUrl({
      explicitUrl: options?.runtimeUrl,
      baseUrl: config.oauthRuntimeUrl,
      template: process.env.SUPACLOUD_RUNTIME_URL_TEMPLATE,
      defaultProjectRef: config.projectRef,
      targetProjectRef: this.projectRef,
    });
    const storageTarget = resolveProjectUrl({
      explicitUrl: options?.storageUrl,
      baseUrl: process.env.SUPACLOUD_STORAGE_URL || config.oauthRuntimeUrl,
      template: process.env.SUPACLOUD_STORAGE_URL_TEMPLATE || process.env.SUPACLOUD_RUNTIME_URL_TEMPLATE,
      defaultProjectRef: config.projectRef,
      targetProjectRef: this.projectRef,
    });

    this.runtimeUrl = runtimeTarget.url;
    this.storageUrl = storageTarget.url;
    this.runtimeProjectScoped = runtimeTarget.projectScoped;
    this.storageProjectScoped = storageTarget.projectScoped;
  }

  /** The projectRef this adapter instance is bound to. */
  getProjectRef(): string {
    return this.projectRef;
  }

  getTargetInfo(): AdapterTargetInfo {
    return {
      projectRef: this.projectRef,
      runtimeUrl: this.runtimeUrl,
      storageUrl: this.storageUrl,
      runtimeProjectScoped: this.runtimeProjectScoped,
      storageProjectScoped: this.storageProjectScoped,
    };
  }

  private requestHeaders(
    outboundUrl: string,
    options: RequestInit,
    auditActor?: BffActorContext,
  ): Headers {
    const headers = new Headers(options.headers);
    for (const name of DELEGATED_HEADER_NAMES) headers.delete(name);
    headers.set('Content-Type', 'application/json');
    headers.set('Authorization', `Bearer ${this.masterToken}`);
    const proofActor = adminProofActor() || auditActor;
    if (!proofActor) return headers;

    const proofHeaders = bffProofHeaders({
      method: options.method || 'GET',
      outboundUrl,
      ...proofActor,
      body: options.body,
    });
    for (const [name, value] of Object.entries(proofHeaders)) headers.set(name, value);
    return headers;
  }

  private bearerHeaders(authorization: string): Headers {
    const token = authorization.match(/^Bearer +([^\s]+)$/i)?.[1];
    if (!token) {
      throw new Error('A GoTrue user bearer token is required');
    }
    return new Headers({
      'Content-Type': 'application/json',
      Authorization: `Bearer ${token}`,
    });
  }

  private async fetchResponse(
    path: string,
    options: RequestInit = {},
    userAuthorization?: string,
    auditActor?: BffActorContext,
  ): Promise<Response> {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 30_000);
    const outboundUrl = `${this.apiUrl}${path}`;
    try {
      const res = await fetch(outboundUrl, {
        ...options,
        headers: userAuthorization
          ? this.bearerHeaders(userAuthorization)
          : this.requestHeaders(outboundUrl, options, auditActor),
        signal: controller.signal,
      });
      if (!res.ok) {
        const body = await res.text();
        throw new SupaCloudApiError(res.status, body, path);
      }
      return res;
    } finally {
      clearTimeout(timeout);
    }
  }

  private async request(path: string, options: RequestInit = {}): Promise<unknown> {
    const response = await this.fetchResponse(path, options);
    return this.responsePayload(response);
  }

  private async requestAsGoTrueUser(
    path: string,
    authorization: string,
    options: RequestInit,
  ): Promise<unknown> {
    const response = await this.fetchResponse(path, options, authorization);
    return this.responsePayload(response);
  }

  private async requestWithAuditActor(
    path: string,
    options: RequestInit,
    actor: BffActorContext,
  ): Promise<unknown> {
    const response = await this.fetchResponse(path, options, undefined, actor);
    return this.responsePayload(response);
  }

  private async responsePayload(response: Response): Promise<unknown> {
    if (response.status === 204) return null;
    const body = await response.text();
    return body ? JSON.parse(body) : null;
  }

  private async requestCapability(path: string, capability: string, options: RequestInit = {}) {
    try {
      return await this.request(path, options);
    } catch (error) {
      if (isSupaCloudApiError(error, [404, 501])) throw capabilityUnavailable(capability);
      throw error;
    }
  }

  // ─── Project ──────────────────────────────────────────────────────

  async getProject() {
    return this.request(`/v1/projects/${this.projectRef}`);
  }

  async getCapabilities() {
    return this.requestCapability(`/v1/projects/${this.projectRef}/capabilities`, 'project_capabilities_v1');
  }

  async runDatabaseMigration(name: string, sql: string) {
    return this.request(`/v1/projects/${this.projectRef}/database/migrations`, {
      method: 'POST',
      body: JSON.stringify({ name, sql }),
    });
  }

  async verifyGatewayRoutes(): Promise<{
    ok: boolean;
    probes: Array<{ name: string; path: string; status: number | null; ok: boolean; error?: string }>;
  }> {
    const probes = await Promise.all(
      SUPABASE_RUNTIME_ROUTE_PROBES.map((probe) =>
        this.probeRuntimeRoute(probe.name, probe.path, probe.acceptedStatuses),
      ),
    );
    return { ok: probes.every((probe) => probe.ok), probes };
  }

  private async probeRuntimeRoute(
    name: string,
    path: string,
    acceptedStatuses: readonly number[],
  ): Promise<{ name: string; path: string; status: number | null; ok: boolean; error?: string }> {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 5000);
    try {
      const res = await fetch(`${this.runtimeUrl}${path}`, { signal: controller.signal });
      const body = await res.text().catch(() => '');
      const kongRouteMiss = body.includes('no Route matched with those values');
      const upstreamFailure = res.status === 502 || res.status === 503 || res.status === 504;
      const ok = acceptedStatuses.includes(res.status) && !kongRouteMiss && !upstreamFailure;
      return {
        name,
        path,
        status: res.status,
        ok,
        error: ok
          ? undefined
          : `expected HTTP status in [${acceptedStatuses.join(', ')}], got HTTP ${res.status}${body ? `: ${body.slice(0, 240)}` : ''}`,
      };
    } catch (e) {
      return {
        name,
        path,
        status: null,
        ok: false,
        error: e instanceof Error ? e.message : String(e),
      };
    } finally {
      clearTimeout(timeout);
    }
  }

  // ─── Auth config ──────────────────────────────────────────────────

  async getAuthConfig() {
    return this.request(`/v1/projects/${this.projectRef}/config/auth`);
  }

  async updateAuthConfig(data: Record<string, unknown>) {
    return this.request(`/v1/projects/${this.projectRef}/config/auth`, {
      method: 'PATCH',
      body: JSON.stringify(data),
    });
  }

  // ─── OAuth server ─────────────────────────────────────────────────

  async getOAuthServerStatus() {
    return this.request(`/v1/projects/${this.projectRef}/auth/oauth-server`);
  }

  // ─── OAuth clients ────────────────────────────────────────────────

  async listOAuthClients() {
    return this.request(`/v1/projects/${this.projectRef}/auth/oauth-clients`);
  }

  async createOAuthClient(data: Record<string, unknown>) {
    return this.request(`/v1/projects/${this.projectRef}/auth/oauth-clients`, {
      method: 'POST',
      body: JSON.stringify(data),
    });
  }

  async getOAuthClient(clientId: string) {
    return this.request(`/v1/projects/${this.projectRef}/auth/oauth-clients/${pathSegment(clientId)}`);
  }

  async updateOAuthClient(clientId: string, data: Record<string, unknown>) {
    return this.request(`/v1/projects/${this.projectRef}/auth/oauth-clients/${pathSegment(clientId)}`, {
      method: 'PUT',
      body: JSON.stringify(data),
    });
  }

  async deleteOAuthClient(clientId: string) {
    return this.request(`/v1/projects/${this.projectRef}/auth/oauth-clients/${pathSegment(clientId)}`, {
      method: 'DELETE',
    });
  }

  async regenerateClientSecret(clientId: string) {
    return this.request(`/v1/projects/${this.projectRef}/auth/oauth-clients/${pathSegment(clientId)}/regenerate-secret`, {
      method: 'POST',
    });
  }

  // ─── SSO Providers ────────────────────────────────────────────────

  async listProviders() {
    return this.request(`/v1/projects/${this.projectRef}/auth/providers`);
  }

  async getProvider(providerId: string) {
    return this.request(`/v1/projects/${this.projectRef}/auth/providers/${pathSegment(providerId)}`);
  }

  async updateProvider(providerId: string, data: Record<string, unknown>) {
    return this.request(`/v1/projects/${this.projectRef}/auth/providers/${pathSegment(providerId)}`, {
      method: 'PATCH',
      body: JSON.stringify(data),
    });
  }

  async createCustomOidcProvider(data: Record<string, unknown>) {
    return this.requestCapability(
      `/v1/projects/${this.projectRef}/auth/custom-providers`,
      'gotrue_custom_oidc_providers_v1',
      { method: 'POST', body: JSON.stringify(data) },
    );
  }

  async getCustomOidcProvider(identifier: string) {
    return this.requestCapability(
      `/v1/projects/${this.projectRef}/auth/custom-providers/${pathSegment(identifier)}`,
      'gotrue_custom_oidc_providers_v1',
    );
  }

  async updateCustomOidcProvider(identifier: string, data: Record<string, unknown>) {
    return this.requestCapability(
      `/v1/projects/${this.projectRef}/auth/custom-providers/${pathSegment(identifier)}`,
      'gotrue_custom_oidc_providers_v1',
      { method: 'PUT', body: JSON.stringify(data) },
    );
  }

  async deleteCustomOidcProvider(identifier: string) {
    return this.requestCapability(
      `/v1/projects/${this.projectRef}/auth/custom-providers/${pathSegment(identifier)}`,
      'gotrue_custom_oidc_providers_v1',
      { method: 'DELETE' },
    );
  }

  async createSamlProvider(data: Record<string, unknown>) {
    return this.requestCapability(
      `/v1/projects/${this.projectRef}/auth/sso/providers`,
      'gotrue_saml_providers_v1',
      { method: 'POST', body: JSON.stringify(data) },
    );
  }

  async getSamlProvider(providerId: string) {
    return this.requestCapability(
      `/v1/projects/${this.projectRef}/auth/sso/providers/${pathSegment(providerId)}`,
      'gotrue_saml_providers_v1',
    );
  }

  async updateSamlProvider(providerId: string, data: Record<string, unknown>) {
    return this.requestCapability(
      `/v1/projects/${this.projectRef}/auth/sso/providers/${pathSegment(providerId)}`,
      'gotrue_saml_providers_v1',
      { method: 'PUT', body: JSON.stringify(data) },
    );
  }

  async deleteSamlProvider(providerId: string) {
    return this.requestCapability(
      `/v1/projects/${this.projectRef}/auth/sso/providers/${pathSegment(providerId)}`,
      'gotrue_saml_providers_v1',
      { method: 'DELETE' },
    );
  }

  async preflightProviderAuthorization(providerId: string, runtimeKind: ConnectorRuntimeKind) {
    const authorizationUrl = await this.runtimeProviderAuthorizationUrl(providerId, runtimeKind);
    return {
      status: 'reachable',
      check_kind: 'runtime_configuration',
      runtime_kind: runtimeKind,
      authorization_url: authorizationUrl,
    };
  }

  async startSamlProviderAuthorization(providerId: string, redirectTo: string) {
    return this.runtimeProviderAuthorizationUrl(providerId, 'saml', redirectTo);
  }

  private async runtimeProviderAuthorizationUrl(
    providerId: string,
    runtimeKind: ConnectorRuntimeKind,
    redirectTo?: string,
  ) {
    const request = runtimeAuthorizationRequest(providerId, runtimeKind, redirectTo);
    const response = await fetch(runtimeApiUrl(this.runtimeUrl, request.path), {
      ...request.init,
      redirect: 'manual',
      signal: AbortSignal.timeout(5000),
    });
    if (!response.ok && (response.status < 300 || response.status >= 400)) {
      throw new Error(`Authentication runtime preflight failed with HTTP ${response.status}`);
    }
    const payload = response.status >= 300 ? null : await response.json();
    return safeRuntimeAuthorizationUrl(response, payload);
  }

  // ─── Users ────────────────────────────────────────────────────────

  async listUsers(params: Record<string, unknown> = {}) {
    return this.request(`/v1/projects/${this.projectRef}/auth/users${queryString(params)}`);
  }

  async createUser(data: Record<string, unknown>) {
    return this.request(`/v1/projects/${this.projectRef}/auth/users`, {
      method: 'POST',
      body: JSON.stringify(data),
    });
  }

  async getUser(userId: string) {
    return this.request(`/v1/projects/${this.projectRef}/auth/users/${userId}`);
  }

  async deleteUser(userId: string) {
    return this.request(`/v1/projects/${this.projectRef}/auth/users/${userId}`, {
      method: 'DELETE',
    });
  }

  async updateUser(userId: string, data: Record<string, unknown>) {
    return this.request(`/v1/projects/${this.projectRef}/auth/users/${userId}`, {
      method: 'PUT',
      body: JSON.stringify(data),
    });
  }

  async suspendUser(userId: string, data: Record<string, unknown> = {}) {
    return this.request(`/v1/projects/${this.projectRef}/auth/users/${userId}/suspend`, {
      method: 'POST',
      body: JSON.stringify(data),
    });
  }

  async unsuspendUser(userId: string) {
    return this.request(`/v1/projects/${this.projectRef}/auth/users/${userId}/unsuspend`, {
      method: 'POST',
    });
  }

  async revokeUserSession(_userId: string, _sessionId: string) {
    throw capabilityUnavailable('gotrue_admin_user_sessions');
  }

  async unlinkUserIdentity(_userId: string, _identityId: string) {
    throw capabilityUnavailable('gotrue_admin_identity_unlink');
  }

  async resetUserMfa(userId: string, factorId: string) {
    return this.request(`/v1/projects/${this.projectRef}/auth/users/${userId}/mfa/${factorId}/reset`, {
      method: 'POST',
    });
  }

  async listUserSessions(_userId: string) {
    throw capabilityUnavailable('gotrue_admin_user_sessions');
  }

  async getUserRoleAssignments(userId: string, applicationId?: string) {
    return this.request(
      `/v1/projects/${this.projectRef}/auth/users/${pathSegment(userId)}/roles${queryString({ application_id: applicationId })}`,
    );
  }

  async resolveUserPermissions(userId: string, orgId?: string, applicationId?: string) {
    return this.request(
      `/v1/projects/${this.projectRef}/auth/users/${pathSegment(userId)}/permissions${queryString({
        org_id: orgId,
        application_id: applicationId,
      })}`,
    );
  }

  async listUserOrganizations(userId: string) {
    return this.request(`/v1/projects/${this.projectRef}/auth/users/${pathSegment(userId)}/organizations`);
  }

  async listUserOAuthGrants(userId: string, params: { include_revoked?: unknown } = {}) {
    return this.request(
      `/v1/projects/${pathSegment(this.projectRef)}/auth/users/${pathSegment(userId)}/grants${queryString({ include_revoked: params.include_revoked })}`,
    );
  }

  async revokeUserOAuthGrant(_userId: string, _clientId: string) {
    throw capabilityUnavailable('gotrue_admin_oauth_grants');
  }

  async listApplicationOAuthGrants(_applicationId: string) {
    throw capabilityUnavailable('gotrue_admin_oauth_grants');
  }

  // ─── Organizations ────────────────────────────────────────────────

  async listOrganizations(params: Record<string, unknown> = {}) {
    return this.request(`/v1/projects/${this.projectRef}/organizations${queryString(params)}`);
  }

  async createOrganization(data: Record<string, unknown>) {
    return this.request(`/v1/projects/${this.projectRef}/organizations`, {
      method: 'POST',
      body: JSON.stringify(data),
    });
  }

  async getOrganization(orgId: string) {
    return this.request(`/v1/projects/${this.projectRef}/organizations/${pathSegment(orgId)}`);
  }

  async updateOrganization(orgId: string, data: Record<string, unknown>) {
    return this.request(`/v1/projects/${this.projectRef}/organizations/${pathSegment(orgId)}`, {
      method: 'PATCH',
      body: JSON.stringify(data),
    });
  }

  async deleteOrganization(orgId: string) {
    return this.request(`/v1/projects/${this.projectRef}/organizations/${pathSegment(orgId)}`, {
      method: 'DELETE',
    });
  }

  async addOrganizationMember(orgId: string, data: Record<string, unknown>) {
    return this.request(`/v1/projects/${this.projectRef}/organizations/${pathSegment(orgId)}/members`, {
      method: 'POST',
      body: JSON.stringify(data),
    });
  }

  async listOrganizationMembers(orgId: string, params: Record<string, unknown> = {}) {
    return this.request(`/v1/projects/${this.projectRef}/organizations/${pathSegment(orgId)}/members${queryString(params)}`);
  }

  async removeOrganizationMember(orgId: string, memberKey: string) {
    return this.request(`/v1/projects/${this.projectRef}/organizations/${pathSegment(orgId)}/members/${pathSegment(memberKey)}`, {
      method: 'DELETE',
    });
  }

  async updateOrganizationMember(orgId: string, memberKey: string, data: { role: string }) {
    return this.requestCapability(`/v1/projects/${this.projectRef}/organizations/${pathSegment(orgId)}/members/${pathSegment(memberKey)}`, 'business_organization_member_roles_v1', {
      method: 'PATCH',
      body: JSON.stringify(data),
    });
  }

  async getOrgRoleAssignments(orgId: string) {
    return this.request(`/v1/projects/${this.projectRef}/organizations/${pathSegment(orgId)}/roles`);
  }

  async listOrganizationInvitations(orgId: string) {
    return this.request(`/v1/projects/${this.projectRef}/organizations/${pathSegment(orgId)}/invitations`);
  }

  async createOrganizationInvitation(orgId: string, data: Record<string, unknown>) {
    return this.request(`/v1/projects/${this.projectRef}/organizations/${pathSegment(orgId)}/invitations`, {
      method: 'POST',
      body: JSON.stringify(data),
    });
  }

  async acceptOrganizationInvitation(
    orgId: string,
    invitationId: string,
    data: { token: string },
    userAuthorization: string,
  ) {
    const invitationPath = `/v1/projects/${this.projectRef}/organizations/${pathSegment(orgId)}/invitations/${pathSegment(invitationId)}`;
    return this.requestAsGoTrueUser(`${invitationPath}/accept`, userAuthorization, {
      method: 'POST',
      body: JSON.stringify(data),
    });
  }

  async revokeOrganizationInvitation(orgId: string, invitationId: string) {
    const invitationPath = `/v1/projects/${this.projectRef}/organizations/${pathSegment(orgId)}/invitations/${pathSegment(invitationId)}`;
    return this.request(invitationPath, { method: 'DELETE' });
  }

  async getOrganizationJitSettings(orgId: string): Promise<unknown> {
    return this.request(`/v1/projects/${this.projectRef}/organizations/${pathSegment(orgId)}/jit`);
  }

  async updateOrganizationJitSettings(orgId: string, data: OrganizationJitSettings) {
    return this.request(`/v1/projects/${this.projectRef}/organizations/${pathSegment(orgId)}/jit`, {
      method: 'PUT',
      body: JSON.stringify(data),
    });
  }

  async reconcileOrganizationJitMemberships(userId: string) {
    return this.request(`/v1/projects/${this.projectRef}/organizations/jit/reconcile`, {
      method: 'POST',
      body: JSON.stringify({ user_id: userId }),
    });
  }

  async listOrganizationApplications(orgId: string) {
    return this.request(`/v1/projects/${this.projectRef}/organizations/${pathSegment(orgId)}/applications`);
  }

  async bindOrganizationApplication(orgId: string, appId: string) {
    return this.request(`/v1/projects/${this.projectRef}/organizations/${pathSegment(orgId)}/applications`, {
      method: 'POST',
      body: JSON.stringify({ application_id: appId }),
    });
  }

  async deleteOrganizationApplication(orgId: string, appId: string) {
    return this.request(`/v1/projects/${this.projectRef}/organizations/${pathSegment(orgId)}/applications/${pathSegment(appId)}`, {
      method: 'DELETE',
    });
  }

  async getOrganizationBranding(orgId: string) {
    return this.requestCapability(
      `/v1/projects/${this.projectRef}/organizations/${pathSegment(orgId)}/branding`,
      'business_organization_branding_v1',
    );
  }

  async updateOrganizationBranding(orgId: string, data: Record<string, unknown>) {
    return this.requestCapability(`/v1/projects/${this.projectRef}/organizations/${pathSegment(orgId)}/branding`, 'business_organization_branding_v1', {
      method: 'PUT',
      body: JSON.stringify(data),
    });
  }

  // ─── RBAC ─────────────────────────────────────────────────────────

  async listRoles() {
    return this.request(`/v1/projects/${this.projectRef}/rbac/roles`);
  }

  async createRole(data: Record<string, unknown>) {
    return this.request(`/v1/projects/${this.projectRef}/rbac/roles`, {
      method: 'POST',
      body: JSON.stringify(data),
    });
  }

  async getRole(roleId: string) {
    return this.request(`/v1/projects/${this.projectRef}/rbac/roles/${pathSegment(roleId)}`);
  }

  async updateRole(roleId: string, data: Record<string, unknown>) {
    return this.request(`/v1/projects/${this.projectRef}/rbac/roles/${pathSegment(roleId)}`, {
      method: 'PUT',
      body: JSON.stringify(data),
    });
  }

  async deleteRole(roleId: string) {
    return this.request(`/v1/projects/${this.projectRef}/rbac/roles/${pathSegment(roleId)}`, {
      method: 'DELETE',
    });
  }

  async listRolePermissions(roleId: string) {
    return this.request(`/v1/projects/${this.projectRef}/rbac/roles/${pathSegment(roleId)}/permissions`);
  }

  async createPermission(roleId: string, data: Record<string, unknown>) {
    return this.request(`/v1/projects/${this.projectRef}/rbac/roles/${pathSegment(roleId)}/permissions`, {
      method: 'POST',
      body: JSON.stringify(data),
    });
  }

  async deletePermission(roleId: string, permissionId: string) {
    return this.request(`/v1/projects/${this.projectRef}/rbac/roles/${pathSegment(roleId)}/permissions/${pathSegment(permissionId)}`, {
      method: 'DELETE',
    });
  }

  async assignRole(roleId: string, data: Record<string, unknown>) {
    return this.request(`/v1/projects/${this.projectRef}/rbac/roles/${pathSegment(roleId)}/assign`, {
      method: 'POST',
      body: JSON.stringify(data),
    });
  }

  async listRoleAssignments(roleId: string, params: Record<string, unknown> = {}) {
    return this.request(`/v1/projects/${this.projectRef}/rbac/roles/${pathSegment(roleId)}/assign${queryString(params)}`);
  }

  async revokeRole(roleId: string, assignmentId: string) {
    return this.request(`/v1/projects/${this.projectRef}/rbac/roles/${pathSegment(roleId)}/assign/${pathSegment(assignmentId)}`, {
      method: 'DELETE',
    });
  }

  async listApplicationRoleAssignments(applicationId: string) {
    return this.request(`/v1/projects/${this.projectRef}/rbac/applications/${pathSegment(applicationId)}/roles`);
  }

  async listApplicationOrganizations(applicationId: string) {
    return this.listOrganizations({ application_id: applicationId });
  }

  // ─── Audit ────────────────────────────────────────────────────────

  async queryAuditLogs(params: Record<string, unknown>) {
    return this.request(`/v1/projects/${this.projectRef}/audit${queryString(params)}`);
  }

  async getAuditLog(logId: string) {
    return this.request(`/v1/projects/${this.projectRef}/audit/${pathSegment(logId)}`);
  }

  async recordAuditEvent(event: SupaCloudAuditEvent, idempotencyKey?: string) {
    const actor = auditProofActor(event);
    const payload = {
      ...event,
      actor_id: actor.actorId,
      actor_type: actor.actorType,
    };
    return this.requestWithAuditActor(`/v1/projects/${this.projectRef}/audit/events`, {
      method: 'POST',
      headers: idempotencyKey ? { 'Idempotency-Key': idempotencyKey } : undefined,
      body: JSON.stringify(payload),
    }, actor);
  }

  async exportAuditLogs(params: Record<string, unknown>) {
    const auditExport = await this.requestCapability(`/v1/projects/${this.projectRef}/audit/exports`, 'audit_export_v1', {
      method: 'POST',
      body: JSON.stringify(params),
    });
    return bffAuditExport(auditExport);
  }

  async getAuditExport(exportId: string) {
    const auditExport = await this.request(`/v1/projects/${this.projectRef}/audit/exports/${pathSegment(exportId)}`);
    return bffAuditExport(auditExport);
  }

  async downloadAuditExport(exportId: string) {
    const response = await this.fetchResponse(`/v1/projects/${this.projectRef}/audit/exports/${pathSegment(exportId)}/download`);
    return auditDownloadResponse(response);
  }

  async getAuditIntegrity() {
    return this.requestCapability(`/v1/projects/${this.projectRef}/audit/integrity`, 'audit_integrity_v1');
  }

  // ─── Webhooks ─────────────────────────────────────────────────────

  async listWebhooks() {
    return this.request(`/v1/projects/${this.projectRef}/webhooks`);
  }

  async createWebhook(data: Record<string, unknown>) {
    return this.request(`/v1/projects/${this.projectRef}/webhooks`, {
      method: 'POST',
      body: JSON.stringify(data),
    });
  }

  async getWebhook(webhookId: string) {
    return this.request(`/v1/projects/${this.projectRef}/webhooks/${pathSegment(webhookId)}`);
  }

  async updateWebhook(webhookId: string, data: Record<string, unknown>) {
    return this.request(`/v1/projects/${this.projectRef}/webhooks/${pathSegment(webhookId)}`, {
      method: 'PUT',
      body: JSON.stringify(data),
    });
  }

  async deleteWebhook(webhookId: string) {
    return this.request(`/v1/projects/${this.projectRef}/webhooks/${pathSegment(webhookId)}`, {
      method: 'DELETE',
    });
  }

  async rotateWebhookSecret(webhookId: string) {
    return this.request(`/v1/projects/${this.projectRef}/webhooks/${pathSegment(webhookId)}/rotate-secret`, {
      method: 'POST',
    });
  }

  async listWebhookLogs(webhookId: string, params: Record<string, unknown> = {}) {
    return this.request(`/v1/projects/${this.projectRef}/webhooks/${pathSegment(webhookId)}/logs${queryString(params)}`);
  }

  async testWebhook(webhookId: string) {
    return this.request(`/v1/projects/${this.projectRef}/webhooks/${pathSegment(webhookId)}/test`, {
      method: 'POST',
      body: '{}',
    });
  }

  async enqueueWebhookEvent(event: ManagedWebhookEvent) {
    return this.request(`/v1/projects/${this.projectRef}/webhooks/events`, {
      method: 'POST',
      headers: { 'Idempotency-Key': event.id },
      body: JSON.stringify(event),
    });
  }

  async listWebhookDeliveries(webhookId: string, params: Record<string, unknown> = {}) {
    return this.requestCapability(
      `/v1/projects/${this.projectRef}/webhooks/${pathSegment(webhookId)}/deliveries${queryString(params)}`,
      'webhook_delivery_v2',
    );
  }

  async getWebhookDelivery(webhookId: string, deliveryId: string) {
    return this.request(`/v1/projects/${this.projectRef}/webhooks/${pathSegment(webhookId)}/deliveries/${pathSegment(deliveryId)}`);
  }

  async replayWebhookDelivery(webhookId: string, deliveryId: string) {
    return this.request(`/v1/projects/${this.projectRef}/webhooks/${pathSegment(webhookId)}/deliveries/${pathSegment(deliveryId)}/replay`, {
      method: 'POST',
    });
  }

  async listTenantMembers(params: Record<string, unknown> = {}) {
    return this.requestCapability(`/v1/projects/${this.projectRef}/collaborators${queryString(params)}`, 'tenant_collaborators_v1');
  }

  async updateTenantMember(memberId: string, data: Record<string, unknown>) {
    return this.request(`/v1/projects/${this.projectRef}/collaborators/${pathSegment(memberId)}`, {
      method: 'PATCH',
      body: JSON.stringify(data),
    });
  }

  async removeTenantMember(memberId: string) {
    return this.request(`/v1/projects/${this.projectRef}/collaborators/${pathSegment(memberId)}`, { method: 'DELETE' });
  }

  async listTenantInvitations(params: Record<string, unknown> = {}) {
    return this.requestCapability(
      `/v1/projects/${this.projectRef}/collaborator-invitations${queryString(params)}`,
      'tenant_collaborators_v1',
    );
  }

  async createTenantInvitation(data: Record<string, unknown>) {
    return this.request(`/v1/projects/${this.projectRef}/collaborator-invitations`, {
      method: 'POST',
      body: JSON.stringify(data),
    });
  }

  async verifySignupInvitation(data: { invitation_id?: string; invitation_token?: string; email?: string | null }) {
    return this.request(`/v1/projects/${this.projectRef}/auth/invitations/verify`, {
      method: 'POST',
      body: JSON.stringify(data),
    });
  }

  async getAuthHookStatus(hookName: string) {
    return this.requestCapability(
      `/v1/projects/${this.projectRef}/auth/hooks/${pathSegment(hookName)}/status`,
      'gotrue_auth_hooks_v1',
    );
  }

  async getAuthHooks() {
    return this.requestCapability(
      `/v1/projects/${this.projectRef}/auth/hooks`,
      'gotrue_auth_hooks_v1',
    );
  }

  async updateAuthHooks(authHooks: Record<string, unknown>) {
    return this.requestCapability(
      `/v1/projects/${this.projectRef}/auth/hooks`,
      'gotrue_auth_hooks_v1',
      { method: 'PATCH', body: JSON.stringify(authHooks) },
    );
  }

  async verifyAuthHook(hookName: string) {
    return this.requestCapability(
      `/v1/projects/${this.projectRef}/auth/hooks/${pathSegment(hookName)}/verify`,
      'gotrue_auth_hook_synthetic_verify_v1',
      { method: 'POST', body: '{}' },
    );
  }

  async verifyAuthHookMessage(hookName: string, message: {
    webhook_id: string;
    webhook_timestamp: string;
    webhook_signature: string;
    body_base64: string;
  }): Promise<{ verified: boolean; consumed: boolean; reason_code: string | null }> {
    const payload = await this.request(
      `/v1/projects/${this.projectRef}/auth/hooks/${pathSegment(hookName)}/messages/verify`,
      { method: 'POST', body: JSON.stringify(message) },
    );
    if (
      !payload
      || typeof payload !== 'object'
      || Array.isArray(payload)
      || typeof (payload as Record<string, unknown>).verified !== 'boolean'
      || typeof (payload as Record<string, unknown>).consumed !== 'boolean'
      || (
        (payload as Record<string, unknown>).reason_code !== null
        && typeof (payload as Record<string, unknown>).reason_code !== 'string'
      )
    ) {
      throw new Error('SupaCloud auth hook verification response has an invalid shape');
    }
    return payload as { verified: boolean; consumed: boolean; reason_code: string | null };
  }

  async checkCustomDomain(domain: string) {
    return this.request(`/v1/projects/${this.projectRef}/domains/${encodeURIComponent(domain)}/health`);
  }

  // ─── Storage ──────────────────────────────────────────────────────
  // Uses Supabase Storage API via Kong or direct URL.
  // The service_role key (master token) gives full bucket access.

  async listStorageBuckets() {
    const url = `${this.storageUrl}/storage/v1/bucket`;
    const res = await fetch(url, {
      headers: { Authorization: `Bearer ${this.masterToken}` },
    });
    if (!res.ok) throw new Error(`Storage list buckets: ${res.status}`);
    return res.json();
  }

  async getStorageBucket(bucketId: string) {
    const path = `/storage/v1/bucket/${bucketId}`;
    const url = `${this.storageUrl}${path}`;
    const res = await fetch(url, {
      headers: { Authorization: `Bearer ${this.masterToken}` },
    });
    if (!res.ok) {
      throw new SupaCloudApiError(res.status, await res.text(), path);
    }
    return res.json();
  }

  async createStorageBucket(bucketId: string, options?: { public?: boolean; fileSizeLimit?: number }) {
    const url = `${this.storageUrl}/storage/v1/bucket`;
    const res = await fetch(url, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${this.masterToken}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        id: bucketId,
        name: bucketId,
        public: options?.public ?? false,
        file_size_limit: options?.fileSizeLimit,
      }),
    });
    if (!res.ok) {
      const body = await res.text();
      throw new Error(`Storage create bucket: ${res.status} ${body}`);
    }
    return res.json();
  }

  async deleteStorageBucket(bucketId: string) {
    const url = `${this.storageUrl}/storage/v1/bucket/${bucketId}`;
    const res = await fetch(url, {
      method: 'DELETE',
      headers: { Authorization: `Bearer ${this.masterToken}` },
    });
    if (!res.ok) {
      const body = await res.text();
      throw new Error(`Storage delete bucket: ${res.status} ${body}`);
    }
    return res.json();
  }

  /**
   * Upload a file to Supabase Storage.
   * Returns the public URL if the bucket is public, or the key path.
   */
  async uploadFile(bucketId: string, filePath: string, file: File | Blob, contentType: string): Promise<{ key: string; url?: string }> {
    const url = `${this.storageUrl}/storage/v1/object/${storageObjectPath(bucketId, filePath)}`;
    const res = await fetch(url, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${this.masterToken}`,
        'Content-Type': contentType,
        'x-upsert': 'true',
      },
      body: file,
    });
    if (!res.ok) {
      const body = await res.text();
      throw new Error(`Storage upload: ${res.status} ${body}`);
    }
    const result = await res.json() as Record<string, unknown>;
    const key = (result.Key as string) || `${bucketId}/${filePath}`;
    return { key };
  }

  /**
   * Delete a file from Supabase Storage.
   */
  async deleteFile(bucketId: string, filePaths: string[]) {
    const url = `${this.storageUrl}/storage/v1/object/${storageBucketSegment(bucketId)}`;
    const res = await fetch(url, {
      method: 'DELETE',
      headers: {
        Authorization: `Bearer ${this.masterToken}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ prefixes: filePaths }),
    });
    if (!res.ok) {
      const body = await res.text();
      throw new Error(`Storage delete: ${res.status} ${body}`);
    }
    return res.json();
  }

  async downloadFile(bucketId: string, filePath: string): Promise<Response> {
    const url = `${this.storageUrl}/storage/v1/object/authenticated/${storageObjectPath(bucketId, filePath)}`;
    const res = await fetch(url, {
      headers: { Authorization: `Bearer ${this.masterToken}` },
      signal: AbortSignal.timeout(5000),
    });
    if (!res.ok) {
      const body = await res.text();
      throw new SupaCloudApiError(res.status, body, `/storage/v1/object/authenticated/${bucketId}`);
    }
    return res;
  }

  /**
   * Get a signed URL for private bucket access.
   */
  async createSignedUrl(bucketId: string, filePath: string, expiresIn: number = 3600): Promise<string> {
    const objectPath = storageObjectPath(bucketId, filePath);
    const safeExpiresIn = storageSignedUrlExpiry(expiresIn);
    const url = `${this.storageUrl}/storage/v1/object/sign/${objectPath}`;
    const res = await fetch(url, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${this.masterToken}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ expiresIn: safeExpiresIn }),
    });
    if (!res.ok) {
      const body = await res.text();
      throw new Error(`Storage sign URL: ${res.status} ${body}`);
    }
    const result = await res.json() as Record<string, unknown>;
    return storageSignedUrl(result.signedURL, this.storageUrl);
  }

  /**
   * Get the public URL for a file in a public bucket.
   */
  getPublicUrl(bucketId: string, filePath: string): string {
    return `${this.storageUrl}/storage/v1/object/public/${storageObjectPath(bucketId, filePath)}`;
  }
}

// Singleton (default projectRef from env)
let _adapter: SupaCloudAdapter | null = null;

/** Get or create the default singleton adapter (uses env PROJECT_REF). */
export function getSupaCloudAdapter(): SupaCloudAdapter {
  if (!_adapter) _adapter = new SupaCloudAdapter();
  return _adapter;
}

/** Create an adapter bound to a specific projectRef (for multi-project safety). */
export function getSupaCloudAdapterForProject(projectRef: string, options?: Omit<AdapterOptions, 'projectRef'>): SupaCloudAdapter {
  return new SupaCloudAdapter({ ...options, projectRef });
}

function bffAuditExport(payload: unknown): unknown {
  if (!payload || typeof payload !== 'object') return payload;
  const record = { ...(payload as Record<string, unknown>) };
  if (!Object.hasOwn(record, 'download_url')) return record;
  const exportId = typeof record.id === 'string' ? record.id : null;
  record.download_url = exportId ? `/v1/audit/export/${pathSegment(exportId)}/download` : null;
  return record;
}

function auditDownloadResponse(response: Response): Response {
  const headers = new Headers();
  for (const name of ['content-type', 'content-disposition', 'x-content-sha256', 'cache-control']) {
    const value = response.headers.get(name);
    if (value) headers.set(name, value);
  }
  return new Response(response.body, { status: response.status, headers });
}

function trimTrailingSlash(url: string): string {
  return url.replace(/\/+$/, '');
}

function resolveProjectUrl(input: {
  explicitUrl?: string;
  baseUrl: string;
  template?: string;
  defaultProjectRef: string;
  targetProjectRef: string;
}): { url: string; projectScoped: boolean } {
  if (input.explicitUrl) {
    return { url: trimTrailingSlash(input.explicitUrl), projectScoped: true };
  }

  if (input.template) {
    return {
      url: trimTrailingSlash(input.template.replaceAll('{projectRef}', input.targetProjectRef)),
      projectScoped: true,
    };
  }

  const baseUrl = trimTrailingSlash(input.baseUrl);
  if (!input.targetProjectRef || input.targetProjectRef === input.defaultProjectRef) {
    return { url: baseUrl, projectScoped: true };
  }

  if (!input.defaultProjectRef) {
    return { url: baseUrl, projectScoped: false };
  }

  try {
    const url = new URL(baseUrl);
    if (url.hostname === input.defaultProjectRef || url.hostname.startsWith(`${input.defaultProjectRef}.`)) {
      // hostname is {defaultRef} or {defaultRef}.*.host — replace only the leading segment
      url.hostname = url.hostname.replace(input.defaultProjectRef, input.targetProjectRef);
      return { url: trimTrailingSlash(url.toString()), projectScoped: true };
    }
  } catch {
    // Fall through to conservative string replacement.
  }

  if (baseUrl.includes(input.defaultProjectRef)) {
    return {
      url: trimTrailingSlash(baseUrl.replace(input.defaultProjectRef, input.targetProjectRef)),
      projectScoped: true,
    };
  }

  return { url: baseUrl, projectScoped: false };
}
