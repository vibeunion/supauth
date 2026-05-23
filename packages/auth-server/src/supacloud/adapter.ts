// SupaCloud adapter — server-side only, holds master token
// All SupaCloud Management API calls go through this module.

import { getConfig } from '../config/index.js';

export class SupaCloudAdapter {
  private apiUrl: string;
  private masterToken: string;
  private projectRef: string;
  private storageUrl: string;

  constructor() {
    const config = getConfig();
    this.apiUrl = config.supacloudApiUrl;
    this.masterToken = config.supacloudMasterToken;
    this.projectRef = config.projectRef;
    // Storage API uses the same base as the runtime URL (Kong-routed)
    // or can be overridden via SUPACLOUD_STORAGE_URL
    this.storageUrl = process.env.SUPACLOUD_STORAGE_URL || config.oauthRuntimeUrl;
  }

  private async request(path: string, options: RequestInit = {}): Promise<unknown> {
    const url = `${this.apiUrl}${path}`;
    const headers: Record<string, string> = {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${this.masterToken}`,
      ...(options.headers as Record<string, string>),
    };
    const res = await fetch(url, { ...options, headers });
    if (!res.ok) {
      const body = await res.text();
      throw new Error(`SupaCloud ${res.status}: ${body}`);
    }
    return res.json();
  }

  // ─── Project ──────────────────────────────────────────────────────

  async getProject() {
    return this.request(`/v1/projects/${this.projectRef}`);
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

  async updateUser(userId: string, data: Record<string, unknown>) {
    return this.request(`/v1/projects/${this.projectRef}/auth/users/${userId}`, {
      method: 'PUT',
      body: JSON.stringify(data),
    });
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

// Singleton
let _adapter: SupaCloudAdapter | null = null;

export function getSupaCloudAdapter(): SupaCloudAdapter {
  if (!_adapter) _adapter = new SupaCloudAdapter();
  return _adapter;
}
