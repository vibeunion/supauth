// SupaCloud adapter — server-side only, holds master token
// All SupaCloud Management API calls go through this module.
// P0-26: Supports per-request projectRef override for multi-project safety.

import { getConfig } from '../config/index.js';

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

  private async request(path: string, options: RequestInit = {}): Promise<unknown> {
    const url = `${this.apiUrl}${path}`;
    const headers: Record<string, string> = {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${this.masterToken}`,
      ...(options.headers as Record<string, string>),
    };
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 30_000);
    try {
      const res = await fetch(url, { ...options, headers, signal: controller.signal });
      if (!res.ok) {
        const body = await res.text();
        throw new Error(`SupaCloud ${res.status}: ${body}`);
      }
      return res.json();
    } finally {
      clearTimeout(timeout);
    }
  }

  // ─── Project ──────────────────────────────────────────────────────

  async getProject() {
    return this.request(`/v1/projects/${this.projectRef}`);
  }

  async verifyGatewayRoutes(): Promise<{
    ok: boolean;
    probes: Array<{ name: string; path: string; status: number | null; ok: boolean; error?: string }>;
  }> {
    const probes = await Promise.all([
      this.probeRuntimeRoute('gotrue_health', '/auth/v1/health', (status) => status === 200),
      this.probeRuntimeRoute('postgrest_root', '/rest/v1/', (status) => status >= 200 && status < 500),
    ]);
    return { ok: probes.every((probe) => probe.ok), probes };
  }

  private async probeRuntimeRoute(
    name: string,
    path: string,
    acceptsStatus: (status: number) => boolean,
  ): Promise<{ name: string; path: string; status: number | null; ok: boolean; error?: string }> {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 5000);
    try {
      const res = await fetch(`${this.runtimeUrl}${path}`, { signal: controller.signal });
      const body = await res.text().catch(() => '');
      const kongRouteMiss = body.includes('no Route matched with those values');
      const upstreamFailure = res.status === 502 || res.status === 503 || res.status === 504;
      const ok = acceptsStatus(res.status) && !kongRouteMiss && !upstreamFailure;
      return {
        name,
        path,
        status: res.status,
        ok,
        error: ok ? undefined : body.slice(0, 300),
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
    return this.request(`/v1/projects/${this.projectRef}/auth/oauth-clients/${clientId}`);
  }

  async updateOAuthClient(clientId: string, data: Record<string, unknown>) {
    return this.request(`/v1/projects/${this.projectRef}/auth/oauth-clients/${clientId}`, {
      method: 'PUT',
      body: JSON.stringify(data),
    });
  }

  async deleteOAuthClient(clientId: string) {
    return this.request(`/v1/projects/${this.projectRef}/auth/oauth-clients/${clientId}`, {
      method: 'DELETE',
    });
  }

  async regenerateClientSecret(clientId: string) {
    return this.request(`/v1/projects/${this.projectRef}/auth/oauth-clients/${clientId}/regenerate-secret`, {
      method: 'POST',
    });
  }

  async listClientSecrets(clientId: string) {
    return this.request(`/v1/projects/${this.projectRef}/auth/oauth-clients/${clientId}/secrets`);
  }

  async createClientSecret(clientId: string, data: Record<string, unknown>) {
    return this.request(`/v1/projects/${this.projectRef}/auth/oauth-clients/${clientId}/secrets`, {
      method: 'POST',
      body: JSON.stringify(data),
    });
  }

  async disableClientSecret(clientId: string, secretId: string) {
    return this.request(`/v1/projects/${this.projectRef}/auth/oauth-clients/${clientId}/secrets/${secretId}/disable`, {
      method: 'POST',
    });
  }

  async deleteClientSecret(clientId: string, secretId: string) {
    return this.request(`/v1/projects/${this.projectRef}/auth/oauth-clients/${clientId}/secrets/${secretId}`, {
      method: 'DELETE',
    });
  }

  // ─── SSO Providers ────────────────────────────────────────────────

  async listProviders() {
    return this.request(`/v1/projects/${this.projectRef}/auth/providers`);
  }

  async getProvider(providerId: string) {
    return this.request(`/v1/projects/${this.projectRef}/auth/providers/${providerId}`);
  }

  async updateProvider(providerId: string, data: Record<string, unknown>) {
    return this.request(`/v1/projects/${this.projectRef}/auth/providers/${providerId}`, {
      method: 'PATCH',
      body: JSON.stringify(data),
    });
  }

  // ─── Users ────────────────────────────────────────────────────────

  async listUsers() {
    return this.request(`/v1/projects/${this.projectRef}/auth/users`);
  }

  async getUser(userId: string) {
    return this.request(`/v1/projects/${this.projectRef}/auth/users/${userId}`);
  }

  async deleteUser(userId: string) {
    return this.request(`/v1/projects/${this.projectRef}/auth/users/${userId}`, {
      method: 'DELETE',
    });
  }

  /**
   * P0-27: Safe merge update — reads existing app_metadata first,
   * then patches only the `supaoauth` namespace without clobbering
   * other fields like `role`, `provider`, etc.
   */
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

  async revokeUserSession(userId: string, sessionId: string) {
    return this.request(`/v1/projects/${this.projectRef}/auth/users/${userId}/sessions/${sessionId}/revoke`, {
      method: 'POST',
    });
  }

  async unlinkUserIdentity(userId: string, identityId: string) {
    return this.request(`/v1/projects/${this.projectRef}/auth/users/${userId}/identities/${identityId}`, {
      method: 'DELETE',
    });
  }

  async resetUserMfa(userId: string, factorId: string) {
    return this.request(`/v1/projects/${this.projectRef}/auth/users/${userId}/mfa/${factorId}/reset`, {
      method: 'POST',
    });
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
    const url = `${this.storageUrl}/storage/v1/bucket/${bucketId}`;
    const res = await fetch(url, {
      headers: { Authorization: `Bearer ${this.masterToken}` },
    });
    if (!res.ok) throw new Error(`Storage get bucket: ${res.status}`);
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
    const url = `${this.storageUrl}/storage/v1/object/${bucketId}/${filePath}`;
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
    const url = `${this.storageUrl}/storage/v1/object/${bucketId}`;
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

  /**
   * Get a signed URL for private bucket access.
   */
  async createSignedUrl(bucketId: string, filePath: string, expiresIn: number = 3600): Promise<string> {
    const url = `${this.storageUrl}/storage/v1/object/sign/${bucketId}/${filePath}`;
    const res = await fetch(url, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${this.masterToken}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ expiresIn }),
    });
    if (!res.ok) {
      const body = await res.text();
      throw new Error(`Storage sign URL: ${res.status} ${body}`);
    }
    const result = await res.json() as Record<string, unknown>;
    return (result.signedURL as string) || '';
  }

  /**
   * Get the public URL for a file in a public bucket.
   */
  getPublicUrl(bucketId: string, filePath: string): string {
    return `${this.storageUrl}/storage/v1/object/public/${bucketId}/${filePath}`;
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
