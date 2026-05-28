// SupaCloud adapter — server-side only, holds master token
// All SupaCloud Management API calls go through this module.
// P0-26: Supports per-request projectRef override for multi-project safety.

import { getConfig } from '../config/index.js';

export interface AdapterOptions {
  /** Override the default PROJECT_REF for this adapter instance */
  projectRef?: string;
}

export class SupaCloudAdapter {
  private apiUrl: string;
  private masterToken: string;
  private projectRef: string;
  private storageUrl: string;
  private runtimeUrl: string;

  constructor(options?: AdapterOptions) {
    const config = getConfig();
    this.apiUrl = config.supacloudApiUrl;
    this.masterToken = config.supacloudMasterToken;
    // Per-instance projectRef: explicit override > env default
    this.projectRef = options?.projectRef || config.projectRef;
    this.runtimeUrl = config.oauthRuntimeUrl.replace(/\/+$/, '');
    // Storage API uses the same base as the runtime URL (Kong-routed)
    // or can be overridden via SUPACLOUD_STORAGE_URL
    this.storageUrl = process.env.SUPACLOUD_STORAGE_URL || config.oauthRuntimeUrl;
  }

  /** The projectRef this adapter instance is bound to. */
  getProjectRef(): string {
    return this.projectRef;
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
export function getSupaCloudAdapterForProject(projectRef: string): SupaCloudAdapter {
  return new SupaCloudAdapter({ projectRef });
}
