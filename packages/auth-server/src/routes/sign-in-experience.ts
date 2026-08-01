// Sign-in Experience and Auth Config routes with OpenAPI annotations

import { Elysia } from 'elysia';
import { getSupaCloudAdapter, isSupaCloudApiError } from '../supacloud/adapter.js';
import * as sieRepo from '../repositories/sign-in-experience.js';
import * as connectorRepo from '../repositories/connectors.js';
import { ApiContractError } from '../utils/api-contract.js';
import { containsSecret, withoutSecrets } from '../utils/secrets.js';
import * as auditRepo from '../repositories/audit.js';
import * as consentRepo from '../repositories/consents.js';
import * as tenantConfigRepo from '../repositories/tenant-config.js';
import { getConfig } from '../config/index.js';
import { randomUUID } from 'node:crypto';
import {
  GOTRUE_PASSWORD_CHARACTER_POLICIES,
  passwordPolicyFromAuthConfig,
} from '../utils/password-policy.js';
import {
  preferredUpstreamNetworkFailure,
  upstreamNetworkFailure,
  upstreamResponseFailure,
  type PublicUpstreamFailure,
  type UpstreamBadRequestContext,
} from '../utils/upstream-failure.js';
import {
  activeCustomUiManifestFromConfig,
  CUSTOM_UI_CLEANUP_CONFIG_KEY,
  CUSTOM_UI_CONFIG_KEY,
  CUSTOM_UI_CONFIG_TYPE,
  CUSTOM_UI_LIMITS,
  CUSTOM_UI_STORAGE_BUCKET,
  CustomUiAssetError,
  customUiManifestFromConfig,
  customUiObjectKey,
  manifestFileForPath,
  normalizeCustomUiAssetPath,
  parseCustomUiArchive,
  parseCustomUiCleanupQueue,
  readVerifiedStorageAsset,
  type CustomUiAuditEventType,
  type CustomUiAuditPendingEvent,
  type CustomUiCleanupBatch,
  type CustomUiCleanupQueue,
  type CustomUiManifest,
  type CustomUiManifestFile,
  type ParsedCustomUiArchive,
} from '../utils/custom-ui-assets.js';

const adapter = getSupaCloudAdapter();
const config = getConfig();

async function audit(eventType: string, resourceType: string, resourceId: string) {
  await auditRepo.logAudit({ eventType, resourceType, resourceId, actorType: 'admin' });
}

function runtimeInternalUrl(path: string) {
  const base = config.oauthRuntimeInternalUrl.replace(/\/$/, '');
  const normalizedPath = path.startsWith('/') ? path : `/${path}`;
  return `${base}${normalizedPath}`;
}

export function buildGoTrueApiUrl(baseUrl: string, path: string) {
  const base = new URL(baseUrl);
  base.pathname = base.pathname.replace(/\/+$/, '');
  if (!base.pathname.endsWith('/auth/v1')) {
    base.pathname = `${base.pathname}/auth/v1`.replace(/\/+/g, '/');
  }
  const normalizedPath = path.startsWith('/') ? path : `/${path}`;
  base.pathname = `${base.pathname}${normalizedPath}`.replace(/\/+/g, '/');
  base.search = '';
  base.hash = '';
  return base.toString();
}

export function buildRawGoTrueApiUrl(baseUrl: string, path: string) {
  const base = new URL(baseUrl);
  base.pathname = base.pathname.replace(/\/+$/, '');
  const normalizedPath = path.startsWith('/') ? path : `/${path}`;
  base.pathname = `${base.pathname}${normalizedPath}`.replace(/\/+/g, '/');
  base.search = '';
  base.hash = '';
  return base.toString();
}

function goTrueApiBaseCandidates() {
  const values = [config.oauthRuntimeInternalUrl, config.oauthRuntimeUrl, config.publicBaseUrl].filter(Boolean);
  const seen = new Set<string>();
  return values.filter((value) => {
    const normalized = value.replace(/\/+$/, '');
    if (seen.has(normalized)) return false;
    seen.add(normalized);
    return true;
  });
}

async function readJsonResponse(response: Response) {
  const text = await response.text();
  if (!text.trim()) return null;
  try {
    return JSON.parse(text) as Record<string, unknown>;
  } catch {
    return null;
  }
}

function upstreamFailureError(failure: PublicUpstreamFailure) {
  return new ApiContractError(failure.status, failure.code, failure.message);
}

async function fetchGoTrueJson(path: string, init: RequestInit = {}, fetchImpl: typeof fetch = fetch) {
  let lastProtocolError: Error | null = null;
  let lastNetworkFailure: PublicUpstreamFailure | null = null;
  for (const base of goTrueApiBaseCandidates()) {
    const directInternal = base === config.oauthRuntimeInternalUrl
      && base !== config.oauthRuntimeUrl
      && base !== config.publicBaseUrl;
    const urls = directInternal
      ? [buildRawGoTrueApiUrl(base, path), buildGoTrueApiUrl(base, path)]
      : [buildGoTrueApiUrl(base, path)];
    for (const [index, url] of urls.entries()) {
      let response: Response;
      try {
        response = await fetchImpl(url, {
          ...init,
          signal: init.signal || AbortSignal.timeout(5000),
        });
      } catch (error) {
        lastNetworkFailure = preferredUpstreamNetworkFailure(lastNetworkFailure, error);
        continue;
      }

      let payload: Record<string, unknown> | null;
      try {
        payload = await readJsonResponse(response);
      } catch (error) {
        throw upstreamFailureError(upstreamNetworkFailure(error));
      }
      if (response.ok && !payload) {
        lastProtocolError = new Error(`GoTrue ${path} returned an empty success response`);
        continue;
      }
      if (directInternal && index === 0 && response.status === 404) {
        lastProtocolError = new Error(`GoTrue ${path} returned 404 from raw internal route`);
        continue;
      }
      return { response, payload };
    }
  }
  if (lastProtocolError) throw lastProtocolError;
  if (lastNetworkFailure) throw upstreamFailureError(lastNetworkFailure);
  throw new Error(`GoTrue ${path} request failed`);
}

async function getSupaCloudSignInSource(applicationId?: string) {
  const [projectResult, applicationResult] = await Promise.allSettled([
    adapter.getProject(),
    applicationId ? adapter.getOAuthClient(applicationId) : Promise.resolve(null),
  ]);
  return {
    project: projectResult.status === 'fulfilled' && projectResult.value && typeof projectResult.value === 'object'
      ? projectResult.value as Record<string, unknown>
      : null,
    application: applicationResult.status === 'fulfilled' && applicationResult.value && typeof applicationResult.value === 'object'
      ? applicationResult.value as Record<string, unknown>
      : null,
  };
}

interface ProviderInfo {
  id: string;
  name?: string;
  type?: string;
  [key: string]: unknown;
}

interface ConnectorConfigInfo {
  id: string;
  provider_id?: string;
  name?: string;
  category?: string;
  enabled?: boolean;
}

const CREDENTIAL_PROVIDER_IDS = new Set(['email', 'phone', 'password']);

function sanitizeConnector(provider: ProviderInfo, config?: ConnectorConfigInfo) {
  return {
    id: String(provider.id),
    name: config?.name || provider.name || provider.id,
    type: config?.category || provider.type || 'social',
  };
}

export function resolvePublicConnectors(
  providers: ProviderInfo[],
  connectorConfigs: ConnectorConfigInfo[],
) {
  const enabledByProviderId = new Map(
    connectorConfigs
      .filter(config => config.enabled === true)
      .map(config => [String(config.provider_id || config.id), config]),
  );

  return providers
    .filter(provider => {
      if (!provider.id || CREDENTIAL_PROVIDER_IDS.has(provider.id)) return false;
      return provider.enabled === true && enabledByProviderId.has(provider.id);
    })
    .map(provider => sanitizeConnector(provider, enabledByProviderId.get(provider.id)));
}

async function getEnabledConnectors(): Promise<Array<{ id: string; name: string; type: string }>> {
  try {
    const [providers, connectorConfigs] = await Promise.all([
      adapter.listProviders() as Promise<ProviderInfo[]>,
      connectorRepo.listEnabledConnectorConfigs(),
    ]);
    if (!Array.isArray(providers)) return [];
    return resolvePublicConnectors(providers, connectorConfigs);
  } catch {
    return [];
  }
}

export function resolveDesiredSignupEnabled(authConfig: Record<string, unknown>): boolean {
  if (authConfig.disable_signup === true) return false;
  if (authConfig.enable_signup === false) return false;
  if (typeof authConfig.disable_signup === 'boolean') return authConfig.disable_signup === false;
  if (typeof authConfig.enable_signup === 'boolean') return authConfig.enable_signup;
  return true;
}

export function resolveRuntimeSignupEnabled(runtimeSettings: Record<string, unknown>): boolean {
  if (typeof runtimeSettings.disable_signup === 'boolean') return runtimeSettings.disable_signup === false;
  return true;
}

export async function getAuthConfigRuntimeConsistency(fetchImpl: typeof fetch = fetch) {
  const authConfig = await adapter.getAuthConfig() as Record<string, unknown>;
  const { response: runtimeRes, payload } = await fetchGoTrueJson('/settings', {}, fetchImpl);
  const runtimeSettings = (payload || {}) as Record<string, unknown>;

  if (!runtimeRes.ok) {
    throw new Error(`Runtime settings probe failed with HTTP ${runtimeRes.status}`);
  }

  const desiredSignupEnabled = resolveDesiredSignupEnabled(authConfig);
  const runtimeSignupEnabled = resolveRuntimeSignupEnabled(runtimeSettings);

  return {
    checked_at: new Date().toISOString(),
    consistent: desiredSignupEnabled === runtimeSignupEnabled,
    desired: {
      signups_enabled: desiredSignupEnabled,
      enable_signup: authConfig.enable_signup ?? null,
      disable_signup: authConfig.disable_signup ?? null,
    },
    runtime: {
      signups_enabled: runtimeSignupEnabled,
      disable_signup: runtimeSettings.disable_signup ?? null,
    },
  };
}

async function getEnabledConnector(connectorId: string) {
  try {
    const [provider, connectorConfig] = await Promise.all([
      adapter.getProvider(connectorId) as Promise<ProviderInfo | null>,
      connectorRepo.getConnectorConfig(connectorId),
    ]);
    if (!provider || !connectorConfig) return null;
    return resolvePublicConnectors([provider], [connectorConfig])[0] || null;
  } catch {
    return null;
  }
}

type CustomUiConfigRecord = NonNullable<Awaited<ReturnType<typeof tenantConfigRepo.getTenantConfig>>>;

interface CustomUiState {
  configRecord: CustomUiConfigRecord;
  manifest: CustomUiManifest;
}

interface PreparedCustomUiUpload {
  assetsId: string;
  leaseToken: string;
  files: CustomUiManifestFile[];
  manifest: CustomUiManifest;
}

const CLEANUP_QUEUE_CAS_ATTEMPTS = 3;
const CLEANUP_READ_BATCH_SIZE = 20;
const RESERVED_CLEANUP_STALE_MS = 10 * 60 * 1000;
const UPLOAD_OUTCOME_QUIET_MS = 10 * 60 * 1000;
const AUDIT_DELIVERY_STALE_MS = 10 * 60 * 1000;
const AUDIT_READ_BACK_LIMIT = 500;
const SUPPORTED_GOTRUE_PASSWORD_CHARACTER_POLICIES = new Set<string>(
  Object.values(GOTRUE_PASSWORD_CHARACTER_POLICIES),
);

function customUiUnavailable(code: string, message: string) {
  return new ApiContractError(503, code, message);
}

function configRevision(configRecord: CustomUiConfigRecord | null) {
  return configRecord
    ? {
      id: configRecord.id,
      updatedAt: configRecord.updatedAt,
      value: configRecord.value,
      enabled: configRecord.enabled,
    }
    : null;
}

async function readCustomUiConfig(key = CUSTOM_UI_CONFIG_KEY): Promise<CustomUiConfigRecord | null> {
  try {
    return await tenantConfigRepo.getTenantConfig(CUSTOM_UI_CONFIG_TYPE, key);
  } catch {
    throw customUiUnavailable('custom_ui_config_unavailable', 'Custom UI configuration is temporarily unavailable.');
  }
}

function storageBucketExists(bucketListResponse: unknown): boolean {
  if (!Array.isArray(bucketListResponse)) throw customUiUnavailable(
    'custom_ui_storage_unavailable',
    'Custom UI asset storage is temporarily unavailable.',
  );
  return bucketListResponse.some((bucket) => {
    if (!bucket || typeof bucket !== 'object') return false;
    const record = bucket as Record<string, unknown>;
    return record.id === CUSTOM_UI_STORAGE_BUCKET || record.name === CUSTOM_UI_STORAGE_BUCKET;
  });
}

function assertPrivateCustomUiBucket(bucketResponse: unknown) {
  if (!bucketResponse || typeof bucketResponse !== 'object' || Array.isArray(bucketResponse)) {
    throw customUiUnavailable('custom_ui_storage_unavailable', 'Custom UI asset storage is temporarily unavailable.');
  }
  const bucket = bucketResponse as Record<string, unknown>;
  const bucketId = bucket.id || bucket.name;
  const rawSizeLimit = bucket.file_size_limit;
  const sizeLimit = typeof rawSizeLimit === 'number' || typeof rawSizeLimit === 'string'
    ? Number(rawSizeLimit)
    : Number.NaN;
  if (bucketId !== CUSTOM_UI_STORAGE_BUCKET || bucket.public !== false) {
    throw customUiUnavailable('custom_ui_storage_misconfigured', 'Custom UI asset storage must be private.');
  }
  if (!Number.isFinite(sizeLimit) || sizeLimit <= 0 || sizeLimit > CUSTOM_UI_LIMITS.maxFileBytes) {
    throw customUiUnavailable('custom_ui_storage_misconfigured', 'Custom UI asset storage has an unsafe file size limit.');
  }
}

async function ensureCustomUiBucket() {
  try {
    const exists = storageBucketExists(await adapter.listStorageBuckets());
    if (!exists) {
      try {
        await adapter.createStorageBucket(CUSTOM_UI_STORAGE_BUCKET, {
          public: false,
          fileSizeLimit: CUSTOM_UI_LIMITS.maxFileBytes,
        });
      } catch {
        // A concurrent upload may have created the bucket; read-back below is authoritative.
      }
    }
    assertPrivateCustomUiBucket(await adapter.getStorageBucket(CUSTOM_UI_STORAGE_BUCKET));
  } catch (error) {
    if (error instanceof ApiContractError) throw error;
    throw customUiUnavailable('custom_ui_storage_unavailable', 'Custom UI asset storage is temporarily unavailable.');
  }
}

function manifestFiles(assetsId: string, parsed: ParsedCustomUiArchive): CustomUiManifestFile[] {
  return parsed.files.map(file => ({
    path: file.path,
    object_key: customUiObjectKey(assetsId, file),
    sha256: file.sha256,
    size: file.size,
    content_type: file.contentType,
  }));
}

async function storageObjectIsMissing(objectKey: string): Promise<boolean> {
  try {
    const response = await adapter.downloadFile(CUSTOM_UI_STORAGE_BUCKET, objectKey);
    if (response.status === 404) return true;
    return false;
  } catch (error) {
    return isSupaCloudApiError(error, [404]);
  }
}

async function storageObjectsAreMissing(objectKeys: string[]): Promise<boolean> {
  for (let offset = 0; offset < objectKeys.length; offset += CLEANUP_READ_BATCH_SIZE) {
    const batch = objectKeys.slice(offset, offset + CLEANUP_READ_BATCH_SIZE);
    const missing = await Promise.all(batch.map(storageObjectIsMissing));
    if (missing.some(isMissing => !isMissing)) return false;
  }
  return true;
}

async function removeStorageObjects(objectKeys: string[]): Promise<boolean> {
  if (!objectKeys.length) return true;
  let deleteRequestFailed = false;
  try {
    await adapter.deleteFile(CUSTOM_UI_STORAGE_BUCKET, objectKeys);
  } catch {
    deleteRequestFailed = true;
  }
  const removed = await storageObjectsAreMissing(objectKeys);
  if (!removed) {
    console.error(JSON.stringify({
      level: 'error',
      msg: 'custom_ui_storage_cleanup_pending',
      object_count: objectKeys.length,
      delete_request_failed: deleteRequestFailed,
    }));
  }
  return removed;
}

async function uploadManifestFiles(parsed: ParsedCustomUiArchive, files: CustomUiManifestFile[]) {
  const uploads = await Promise.allSettled(parsed.files.map((file, index) => adapter.uploadFile(
    CUSTOM_UI_STORAGE_BUCKET,
    files[index].object_key,
    new Blob([Uint8Array.from(file.bytes).buffer], { type: file.contentType }),
    file.contentType,
  )));
  if (uploads.some(upload => upload.status === 'rejected')) {
    throw customUiUnavailable('custom_ui_storage_unavailable', 'Custom UI assets could not be staged.');
  }
}

function previousObjectKeys(manifest: CustomUiManifest | null): string[] {
  if (!manifest) return [];
  return [...new Set([
    ...manifest.files.map(file => file.object_key),
    ...manifest.cleanup_pending_object_keys,
  ])];
}

function buildCustomUiManifest(
  assetsId: string,
  parsed: ParsedCustomUiArchive,
  files: CustomUiManifestFile[],
  cleanupObjectKeys: string[],
): CustomUiManifest {
  return {
    schema_version: 1,
    assets_id: assetsId,
    content_sha256: parsed.contentSha256,
    uploaded_at: new Date().toISOString(),
    files,
    cleanup_pending_object_keys: cleanupObjectKeys,
    lifecycle_state: 'active',
    audit_pending_event: null,
  };
}

function pendingAuditEvent(
  eventType: CustomUiAuditEventType,
  manifest: CustomUiManifest,
  cleanupPending: boolean,
  identity: auditRepo.PersistedAdminAuditIdentity,
): CustomUiAuditPendingEvent {
  return {
    event_id: randomUUID(),
    event_type: eventType,
    created_at: new Date().toISOString(),
    actor_id: identity.actorId,
    actor_type: 'admin',
    request_id: identity.requestId,
    authorization_source: identity.authorizationSource,
    delivery_state: 'ready',
    file_count: manifest.files.length,
    content_sha256: manifest.content_sha256,
    cleanup_pending: cleanupPending,
  };
}

function manifestWithPendingAudit(
  manifest: CustomUiManifest,
  eventType: CustomUiAuditEventType,
  cleanupPending: boolean,
  identity: auditRepo.PersistedAdminAuditIdentity,
): CustomUiManifest {
  return { ...manifest, audit_pending_event: pendingAuditEvent(eventType, manifest, cleanupPending, identity) };
}

async function clearCompletedCleanup(configRecord: CustomUiConfigRecord, manifest: CustomUiManifest) {
  if (!manifest.cleanup_pending_object_keys.length) return { configRecord, manifest, complete: true };
  if (!await removeStorageObjects(manifest.cleanup_pending_object_keys)) {
    return { configRecord, manifest, complete: false };
  }
  const pendingEvent = manifest.audit_pending_event
    ? { ...manifest.audit_pending_event, cleanup_pending: false }
    : null;
  const nextManifest = { ...manifest, cleanup_pending_object_keys: [], audit_pending_event: pendingEvent };
  try {
    const updated = await tenantConfigRepo.compareAndSwapTenantConfig(
      CUSTOM_UI_CONFIG_TYPE,
      CUSTOM_UI_CONFIG_KEY,
      configRevision(configRecord),
      { value: { ...nextManifest }, enabled: true },
    );
    return updated
      ? { configRecord: updated, manifest: nextManifest, complete: true }
      : { configRecord, manifest, complete: false };
  } catch {
    return { configRecord, manifest, complete: false };
  }
}

async function recordCustomUiAudit(event: CustomUiAuditPendingEvent, manifest: CustomUiManifest) {
  return auditRepo.logPersistedAdminAudit({
    actorId: event.actor_id,
    requestId: event.request_id,
    authorizationSource: event.authorization_source,
  }, {
    idempotencyKey: event.event_id,
    eventType: event.event_type,
    resourceType: 'custom_ui_assets',
    resourceId: manifest.assets_id,
    details: {
      event_id: event.event_id,
      file_count: event.file_count,
      content_sha256: event.content_sha256,
      cleanup_pending: event.cleanup_pending,
    },
  });
}

async function writeAuditDeliveryState(
  configRecord: CustomUiConfigRecord,
  manifest: CustomUiManifest,
  deliveryState: CustomUiAuditPendingEvent['delivery_state'],
) {
  const event = manifest.audit_pending_event;
  if (!event) return null;
  const nextManifest = {
    ...manifest,
    audit_pending_event: { ...event, delivery_state: deliveryState },
  };
  try {
    const updated = await tenantConfigRepo.compareAndSwapTenantConfig(
      CUSTOM_UI_CONFIG_TYPE,
      CUSTOM_UI_CONFIG_KEY,
      configRevision(configRecord),
      { value: { ...nextManifest }, enabled: configRecord.enabled },
    );
    return updated ? { configRecord: updated, manifest: nextManifest } : null;
  } catch {
    return null;
  }
}

async function clearDeliveredAudit(configRecord: CustomUiConfigRecord, manifest: CustomUiManifest) {
  const clearedManifest = { ...manifest, audit_pending_event: null };
  try {
    const updated = await tenantConfigRepo.compareAndSwapTenantConfig(
      CUSTOM_UI_CONFIG_TYPE,
      CUSTOM_UI_CONFIG_KEY,
      configRevision(configRecord),
      { value: { ...clearedManifest }, enabled: configRecord.enabled },
    );
    if (updated) return { configRecord: updated, manifest: clearedManifest, pending: false };
  } catch {
    return { configRecord, manifest, pending: true };
  }
  return { configRecord, manifest, pending: true };
}

function auditDeliveryLeaseIsStale(configRecord: CustomUiConfigRecord) {
  // The CAS write timestamp is the lease; the event timestamp remains immutable for replay.
  const leaseTimestamp = configRecord.updatedAt.getTime();
  return Number.isFinite(leaseTimestamp)
    && Date.now() - leaseTimestamp >= AUDIT_DELIVERY_STALE_MS;
}

function auditDeliveryCanProgress(
  configRecord: CustomUiConfigRecord,
  event: CustomUiAuditPendingEvent,
) {
  if (event.delivery_state === 'ready') return true;
  return (event.delivery_state === 'sending' || event.delivery_state === 'delivery_unknown')
    && auditDeliveryLeaseIsStale(configRecord);
}

function auditReadBackItems(response: unknown): Record<string, unknown>[] | null {
  if (!response || typeof response !== 'object' || Array.isArray(response)) return null;
  const envelope = response as Record<string, unknown>;
  const items = envelope.items;
  const total = envelope.total;
  if (!Array.isArray(items) || typeof total !== 'number' || !Number.isInteger(total)) return null;
  if (total < 0 || total > AUDIT_READ_BACK_LIMIT) return null;
  if (items.length !== total || envelope.next_cursor !== null) return null;
  if (!items.every(item => Boolean(item) && typeof item === 'object' && !Array.isArray(item))) return null;
  return items as Record<string, unknown>[];
}

function auditReadBackMatches(
  candidate: Record<string, unknown>,
  event: CustomUiAuditPendingEvent,
  manifest: CustomUiManifest,
) {
  const details = candidate.details;
  if (!details || typeof details !== 'object' || Array.isArray(details)) return false;
  const detailRecord = details as Record<string, unknown>;
  return candidate.event_type === event.event_type
    && candidate.actor_id === event.actor_id
    && candidate.actor_type === event.actor_type
    && candidate.resource_type === 'custom_ui_assets'
    && candidate.resource_id === manifest.assets_id
    && candidate.request_id === event.request_id
    && candidate.source === 'supauth'
    && candidate.method === 'EVENT'
    && candidate.status === 200
    && detailRecord.event_id === event.event_id
    && detailRecord.file_count === event.file_count
    && detailRecord.content_sha256 === event.content_sha256
    && detailRecord.cleanup_pending === event.cleanup_pending;
}

async function auditDeliveryHasUniqueReadBack(
  event: CustomUiAuditPendingEvent,
  manifest: CustomUiManifest,
) {
  try {
    const response = await auditRepo.queryAuditLogs({
      eventType: event.event_type,
      resourceType: 'custom_ui_assets',
      resourceId: manifest.assets_id,
      actorId: event.actor_id,
      limit: AUDIT_READ_BACK_LIMIT,
      offset: 0,
    });
    const items = auditReadBackItems(response);
    if (!items) return false;
    return items.filter(item => auditReadBackMatches(item, event, manifest)).length === 1;
  } catch {
    // A failed or unauthorized read-back cannot prove delivery, so retain the outbox.
    return false;
  }
}

async function recoverStaleAuditDelivery(
  configRecord: CustomUiConfigRecord,
  manifest: CustomUiManifest,
) {
  const event = manifest.audit_pending_event;
  if (!event || !(await auditDeliveryHasUniqueReadBack(event, manifest))) {
    return { configRecord, manifest, pending: true };
  }
  const delivered = await writeAuditDeliveryState(configRecord, manifest, 'delivered');
  return delivered
    ? clearDeliveredAudit(delivered.configRecord, delivered.manifest)
    : { configRecord, manifest, pending: true };
}

async function flushPendingAudit(configRecord: CustomUiConfigRecord, manifest: CustomUiManifest) {
  const event = manifest.audit_pending_event;
  if (!event) return { configRecord, manifest, pending: false };
  if (event.delivery_state === 'delivered') return clearDeliveredAudit(configRecord, manifest);
  if (!auditDeliveryCanProgress(configRecord, event)) {
    return { configRecord, manifest, pending: true };
  }
  if (event.delivery_state !== 'ready') return recoverStaleAuditDelivery(configRecord, manifest);
  const claimed = await writeAuditDeliveryState(configRecord, manifest, 'sending');
  if (!claimed) return { configRecord, manifest, pending: true };
  let delivery: 'delivered' | 'rejected';
  try {
    delivery = await recordCustomUiAudit(claimed.manifest.audit_pending_event!, claimed.manifest);
  } catch {
    const unknown = await writeAuditDeliveryState(claimed.configRecord, claimed.manifest, 'delivery_unknown');
    return { ...(unknown || claimed), pending: true };
  }
  if (delivery === 'rejected') {
    const ready = await writeAuditDeliveryState(claimed.configRecord, claimed.manifest, 'ready');
    return { ...(ready || claimed), pending: true };
  }
  const delivered = await writeAuditDeliveryState(claimed.configRecord, claimed.manifest, 'delivered');
  if (!delivered) return { ...claimed, pending: true };
  return clearDeliveredAudit(delivered.configRecord, delivered.manifest);
}

async function requirePendingAuditDelivery(configRecord: CustomUiConfigRecord, manifest: CustomUiManifest) {
  const flushed = await flushPendingAudit(configRecord, manifest);
  if (flushed.pending) {
    throw customUiUnavailable('custom_ui_audit_pending', 'A committed Custom UI audit event is still pending delivery.');
  }
  return flushed;
}

function emptyCleanupQueue(): CustomUiCleanupQueue {
  return { schema_version: 1, batches: [] };
}

function cleanupQueueFromConfig(configRecord: CustomUiConfigRecord | null) {
  if (!configRecord) return emptyCleanupQueue();
  if (!configRecord.enabled) {
    throw new ApiContractError(409, 'custom_ui_cleanup_queue_invalid', 'The Custom UI cleanup queue is disabled.');
  }
  const queue = parseCustomUiCleanupQueue(configRecord.value);
  if (!queue) throw new ApiContractError(409, 'custom_ui_cleanup_queue_invalid', 'The Custom UI cleanup queue is invalid.');
  return queue;
}

async function writeCleanupQueue(
  previousConfig: CustomUiConfigRecord | null,
  queue: CustomUiCleanupQueue,
) {
  return tenantConfigRepo.compareAndSwapTenantConfig(
    CUSTOM_UI_CONFIG_TYPE,
    CUSTOM_UI_CLEANUP_CONFIG_KEY,
    configRevision(previousConfig),
    { value: { ...queue }, enabled: true },
  );
}

async function mutateCleanupQueue(
  mutate: (queue: CustomUiCleanupQueue) => CustomUiCleanupQueue | null,
): Promise<boolean> {
  for (let attempt = 0; attempt < CLEANUP_QUEUE_CAS_ATTEMPTS; attempt += 1) {
    const previousConfig = await readCustomUiConfig(CUSTOM_UI_CLEANUP_CONFIG_KEY);
    const queue = mutate(cleanupQueueFromConfig(previousConfig));
    if (!queue) return false;
    try {
      if (await writeCleanupQueue(previousConfig, queue)) return true;
    } catch {
      throw customUiUnavailable('custom_ui_config_unavailable', 'Custom UI cleanup state could not be persisted.');
    }
  }
  return false;
}

function cleanupQueueSize(queue: CustomUiCleanupQueue) {
  return queue.batches.reduce((total, batch) => total + batch.object_keys.length, 0);
}

function cleanupObjectKeysMatch(batch: CustomUiCleanupBatch, objectKeys: string[]) {
  return batch.object_keys.length === objectKeys.length
    && batch.object_keys.every((objectKey, index) => objectKey === objectKeys[index]);
}

function assertCleanupQueueCapacity(queue: CustomUiCleanupQueue, objectCount: number) {
  if (queue.batches.length >= CUSTOM_UI_LIMITS.maxCleanupBatches
    || cleanupQueueSize(queue) + objectCount > CUSTOM_UI_LIMITS.maxCleanupKeys) {
    throw customUiUnavailable('custom_ui_cleanup_backlog', 'Custom UI cleanup must complete before another upload.');
  }
}

function queueWithCleanupReservation(
  queue: CustomUiCleanupQueue,
  assetsId: string,
  leaseToken: string,
  objectKeys: string[],
) {
  const existing = queue.batches.find(batch => batch.assets_id === assetsId);
  if (existing) {
    if (cleanupObjectKeysMatch(existing, objectKeys) && existing.lease_token === leaseToken) return queue;
    throw new ApiContractError(409, 'custom_ui_cleanup_queue_invalid', 'The Custom UI cleanup reservation conflicts.');
  }
  assertCleanupQueueCapacity(queue, objectKeys.length);
  const batch: CustomUiCleanupBatch = {
    assets_id: assetsId,
    created_at: new Date().toISOString(),
    state: 'reserved',
    lease_token: leaseToken,
    object_keys: objectKeys,
  };
  return { ...queue, batches: [...queue.batches, batch] };
}

function queueWithUnknownUpload(
  queue: CustomUiCleanupQueue,
  assetsId: string,
  leaseToken: string,
  objectKeys: string[],
) {
  const batchIndex = queue.batches.findIndex(batch => batch.assets_id === assetsId);
  const existing = queue.batches[batchIndex];
  if (existing && (!cleanupObjectKeysMatch(existing, objectKeys) || existing.lease_token !== leaseToken)) {
    throw new ApiContractError(409, 'custom_ui_cleanup_queue_invalid', 'The Custom UI cleanup reservation conflicts.');
  }
  if (!existing) assertCleanupQueueCapacity(queue, objectKeys.length);
  const unknownBatch = uploadOutcomeUnknownBatch(existing, assetsId, leaseToken, objectKeys);
  if (!existing) return { ...queue, batches: [...queue.batches, unknownBatch] };
  const batches = [...queue.batches];
  batches[batchIndex] = unknownBatch;
  return { ...queue, batches };
}

function uploadOutcomeUnknownBatch(
  existing: CustomUiCleanupBatch | undefined,
  assetsId: string,
  leaseToken: string,
  objectKeys: string[],
): CustomUiCleanupBatch {
  const timestamp = new Date().toISOString();
  return {
    assets_id: assetsId,
    created_at: existing?.created_at || timestamp,
    state: 'upload_outcome_unknown',
    lease_token: leaseToken,
    outcome_unknown_at: timestamp,
    object_keys: objectKeys,
  };
}

async function retainUnknownUploadBatch(assetsId: string, leaseToken: string, objectKeys: string[]) {
  const retained = await mutateCleanupQueue(queue => queueWithUnknownUpload(queue, assetsId, leaseToken, objectKeys));
  if (!retained) {
    throw customUiUnavailable('custom_ui_config_unavailable', 'Custom UI cleanup state could not be retained.');
  }
}

async function reserveCleanupBatch(assetsId: string, leaseToken: string, objectKeys: string[]) {
  const reserved = await mutateCleanupQueue(queue => (
    queueWithCleanupReservation(queue, assetsId, leaseToken, objectKeys)
  ));
  if (!reserved) throw customUiUnavailable('custom_ui_config_unavailable', 'Custom UI cleanup state could not be reserved.');
}

async function updateCleanupBatch(
  assetsId: string,
  update: (batch: CustomUiCleanupBatch) => CustomUiCleanupBatch | null | undefined,
) {
  return mutateCleanupQueue((queue) => {
    let changed = false;
    const batches = queue.batches.flatMap((batch) => {
      if (batch.assets_id !== assetsId) return [batch];
      const updated = update(batch);
      if (updated === undefined) return [batch];
      changed = true;
      return updated ? [updated] : [];
    });
    return changed ? { ...queue, batches } : null;
  });
}

function claimedCleanupBatch(batch: CustomUiCleanupBatch, claimToken: string): CustomUiCleanupBatch {
  return {
    assets_id: batch.assets_id,
    created_at: batch.created_at,
    state: 'cleanup_claimed',
    lease_token: batch.lease_token,
    claim_token: claimToken,
    claimed_at: new Date().toISOString(),
    object_keys: batch.object_keys,
  };
}

async function claimOwnedCleanupReservation(assetsId: string, leaseToken: string) {
  const claimToken = randomUUID();
  const claimed = await updateCleanupBatch(assetsId, batch => (
    batch.state === 'reserved' && batch.lease_token === leaseToken
      ? claimedCleanupBatch(batch, claimToken)
      : undefined
  ));
  return claimed ? claimToken : null;
}

async function removeClaimedCleanupBatch(assetsId: string, claimToken: string) {
  return updateCleanupBatch(assetsId, batch => (
    batch.state === 'cleanup_claimed' && batch.claim_token === claimToken ? null : undefined
  ));
}

async function releaseCleanupClaim(assetsId: string, claimToken: string) {
  return updateCleanupBatch(assetsId, (batch) => {
    if (batch.state !== 'cleanup_claimed' || batch.claim_token !== claimToken) return undefined;
    return {
      assets_id: batch.assets_id,
      created_at: batch.created_at,
      state: 'pending',
      lease_token: batch.lease_token,
      object_keys: batch.object_keys,
    };
  });
}

async function finalizeOrphanBatch(assetsId: string, leaseToken: string, objectKeys: string[]) {
  const claimToken = await claimOwnedCleanupReservation(assetsId, leaseToken);
  if (!claimToken) return 'not_owned' as const;
  if (!await removeStorageObjects(objectKeys)) {
    await releaseCleanupClaim(assetsId, claimToken);
    return 'pending' as const;
  }
  return await removeClaimedCleanupBatch(assetsId, claimToken) ? 'completed' as const : 'pending' as const;
}

async function recoverUnownedOrphan(assetsId: string, leaseToken: string, objectKeys: string[]) {
  // A definite pair-CAS loss proves these immutable keys never became active, including late Storage writes.
  if (await removeStorageObjects(objectKeys)) return;
  await reserveCleanupBatch(assetsId, leaseToken, objectKeys);
  await finalizeOrphanBatch(assetsId, leaseToken, objectKeys);
}

function cleanupBatchIsOlderThan(batch: CustomUiCleanupBatch, intervalMs: number) {
  const timestamp = batch.state === 'cleanup_claimed'
    ? batch.claimed_at
    : batch.outcome_unknown_at || batch.created_at;
  if (!timestamp) return false;
  return Date.now() - Date.parse(timestamp) >= intervalMs;
}

function sameCleanupBatchOwner(current: CustomUiCleanupBatch, expected: CustomUiCleanupBatch) {
  if (current.state !== expected.state || current.created_at !== expected.created_at) return false;
  if (current.state === 'cleanup_claimed') return current.claim_token === expected.claim_token;
  if (current.state === 'upload_outcome_unknown') {
    return current.lease_token === expected.lease_token
      && current.outcome_unknown_at === expected.outcome_unknown_at;
  }
  return current.lease_token === expected.lease_token;
}

async function claimRetryCleanupBatch(batch: CustomUiCleanupBatch) {
  if (batch.state === 'reserved' && !cleanupBatchIsOlderThan(batch, RESERVED_CLEANUP_STALE_MS)) return null;
  if (batch.state === 'cleanup_claimed' && !cleanupBatchIsOlderThan(batch, RESERVED_CLEANUP_STALE_MS)) return null;
  if (batch.state === 'upload_outcome_unknown'
    && !cleanupBatchIsOlderThan(batch, UPLOAD_OUTCOME_QUIET_MS)) return null;
  const claimToken = randomUUID();
  const claimed = await updateCleanupBatch(batch.assets_id, current => (
    sameCleanupBatchOwner(current, batch) ? claimedCleanupBatch(current, claimToken) : undefined
  ));
  return claimed ? claimToken : null;
}

async function removeActiveCleanupReservation(batch: CustomUiCleanupBatch) {
  return updateCleanupBatch(batch.assets_id, current => (
    current.state === 'reserved' && sameCleanupBatchOwner(current, batch) ? null : undefined
  ));
}

async function retryCleanupQueue(activeManifest: CustomUiManifest | null) {
  const queueConfig = await readCustomUiConfig(CUSTOM_UI_CLEANUP_CONFIG_KEY);
  const queue = cleanupQueueFromConfig(queueConfig);
  for (const batch of queue.batches) {
    if (batch.assets_id === activeManifest?.assets_id) {
      if (batch.state === 'reserved') await removeActiveCleanupReservation(batch);
      continue;
    }
    const claimToken = await claimRetryCleanupBatch(batch);
    if (!claimToken) continue;
    if (await removeStorageObjects(batch.object_keys)) {
      await removeClaimedCleanupBatch(batch.assets_id, claimToken);
    } else {
      await releaseCleanupClaim(batch.assets_id, claimToken);
    }
  }
}

async function stageCustomUiAssets(parsed: ParsedCustomUiArchive, assetsId: string, leaseToken: string) {
  await ensureCustomUiBucket();
  const files = manifestFiles(assetsId, parsed);
  const objectKeys = files.map(file => file.object_key);
  await reserveCleanupBatch(assetsId, leaseToken, objectKeys);
  try {
    await uploadManifestFiles(parsed, files);
    return files;
  } catch {
    // A rejected response may follow a committed Storage write; keep the keys durable through a quiet interval.
    await retainUnknownUploadBatch(assetsId, leaseToken, objectKeys);
    await removeStorageObjects(objectKeys);
    await retainUnknownUploadBatch(assetsId, leaseToken, objectKeys);
    throw customUiUnavailable('custom_ui_storage_unavailable', 'Custom UI assets could not be staged.');
  }
}

async function uploadBaseState(): Promise<CustomUiState | null> {
  let previousConfig = await readCustomUiConfig();
  let previousManifest = customUiManifestFromConfig(previousConfig);
  if (previousConfig && !previousManifest) {
    throw new ApiContractError(409, 'custom_ui_manifest_invalid', 'The current Custom UI manifest is invalid.');
  }
  if (!previousConfig || !previousManifest) return null;
  const flushed = await requirePendingAuditDelivery(previousConfig, previousManifest);
  previousConfig = flushed.configRecord;
  previousManifest = flushed.manifest;
  if (!previousConfig.enabled || previousManifest.lifecycle_state !== 'active') {
    throw customUiUnavailable('custom_ui_cleanup_pending', 'Custom UI deletion must finish before another upload.');
  }
  return { configRecord: previousConfig, manifest: previousManifest };
}

function assertUploadCleanupCapacity(manifest: CustomUiManifest | null, incomingFileCount: number) {
  if (previousObjectKeys(manifest).length + incomingFileCount > CUSTOM_UI_LIMITS.maxCleanupKeys) {
    throw customUiUnavailable('custom_ui_cleanup_backlog', 'Custom UI cleanup must complete before another upload.');
  }
}

async function prepareCustomUiUpload(
  parsed: ParsedCustomUiArchive,
  previousManifest: CustomUiManifest | null,
  identity: auditRepo.PersistedAdminAuditIdentity,
): Promise<PreparedCustomUiUpload> {
  const cleanupObjectKeys = previousObjectKeys(previousManifest);
  const assetsId = randomUUID();
  const leaseToken = randomUUID();
  const files = await stageCustomUiAssets(parsed, assetsId, leaseToken);
  const baseManifest = buildCustomUiManifest(assetsId, parsed, files, cleanupObjectKeys);
  return {
    assetsId,
    leaseToken,
    files,
    manifest: manifestWithPendingAudit(
      baseManifest,
      'sign_in_experience.custom_ui_uploaded',
      cleanupObjectKeys.length > 0,
      identity,
    ),
  };
}

function queueAfterUploadCommit(queue: CustomUiCleanupQueue, prepared: PreparedCustomUiUpload) {
  const reservation = queue.batches.find(batch => batch.assets_id === prepared.assetsId);
  if (reservation?.state !== 'reserved' || reservation.lease_token !== prepared.leaseToken) return null;
  const expectedKeys = prepared.files.map(file => file.object_key);
  if (!cleanupObjectKeysMatch(reservation, expectedKeys)) return null;
  return { ...queue, batches: queue.batches.filter(batch => batch.assets_id !== prepared.assetsId) };
}

function uploadManifestContentMatches(current: CustomUiManifest, prepared: CustomUiManifest) {
  if (current.assets_id !== prepared.assets_id
    || current.content_sha256 !== prepared.content_sha256
    || current.uploaded_at !== prepared.uploaded_at
    || current.files.length !== prepared.files.length) return false;
  return current.files.every((file, index) => {
    const expected = prepared.files[index];
    return file.path === expected.path
      && file.object_key === expected.object_key
      && file.sha256 === expected.sha256
      && file.size === expected.size
      && file.content_type === expected.content_type;
  });
}

function committedUploadState(configRecord: CustomUiConfigRecord, prepared: PreparedCustomUiUpload) {
  const manifest = activeCustomUiManifestFromConfig(configRecord);
  return manifest && uploadManifestContentMatches(manifest, prepared.manifest)
    ? { configRecord, manifest }
    : null;
}

async function committedUploadReadBack(prepared: PreparedCustomUiUpload) {
  const currentConfig = await readCustomUiConfig();
  return currentConfig ? committedUploadState(currentConfig, prepared) : null;
}

function configStillMatches(current: CustomUiConfigRecord | null, expected: CustomUiConfigRecord | null) {
  if (!current || !expected) return current === expected;
  return current.id === expected.id
    && current.updatedAt.getTime() === expected.updatedAt.getTime()
    && current.enabled === expected.enabled;
}

async function commitPreparedUpload(
  previousConfig: CustomUiConfigRecord | null,
  prepared: PreparedCustomUiUpload,
) {
  for (let attempt = 0; attempt < CLEANUP_QUEUE_CAS_ATTEMPTS; attempt += 1) {
    const cleanupConfig = await readCustomUiConfig(CUSTOM_UI_CLEANUP_CONFIG_KEY);
    const committedQueue = queueAfterUploadCommit(cleanupQueueFromConfig(cleanupConfig), prepared);
    if (!cleanupConfig || !committedQueue) return null;
    try {
      const committed = await tenantConfigRepo.compareAndSwapTenantConfigPair({
        configType: CUSTOM_UI_CONFIG_TYPE,
        first: {
          key: CUSTOM_UI_CLEANUP_CONFIG_KEY,
          expected: configRevision(cleanupConfig),
          write: { value: { ...committedQueue }, enabled: true },
        },
        second: {
          key: CUSTOM_UI_CONFIG_KEY,
          expected: configRevision(previousConfig),
          write: { value: { ...prepared.manifest }, enabled: true },
        },
      });
      if (committed) {
        const committedState = committedUploadState(committed.second, prepared);
        if (!committedState) {
          throw customUiUnavailable('custom_ui_manifest_invalid', 'The committed Custom UI manifest is invalid.');
        }
        return committedState;
      }
      if (!configStillMatches(await readCustomUiConfig(), previousConfig)) return null;
    } catch {
      const committedReadBack = await committedUploadReadBack(prepared);
      if (committedReadBack) return committedReadBack;
      throw customUiUnavailable('custom_ui_config_unavailable', 'Custom UI configuration could not be activated.');
    }
  }
  return null;
}

async function activatePreparedUpload(
  previousConfig: CustomUiConfigRecord | null,
  prepared: PreparedCustomUiUpload,
) {
  const objectKeys = prepared.files.map(file => file.object_key);
  const activated = await commitPreparedUpload(previousConfig, prepared);
  if (activated) return activated;
  const cleanup = await finalizeOrphanBatch(prepared.assetsId, prepared.leaseToken, objectKeys);
  if (cleanup === 'not_owned') {
    await recoverUnownedOrphan(prepared.assetsId, prepared.leaseToken, objectKeys);
  }
  throw new ApiContractError(409, 'custom_ui_changed_retry', 'Custom UI assets changed concurrently; retry the upload.');
}

async function completeCustomUiUpload(activated: CustomUiState) {
  const cleanup = await clearCompletedCleanup(activated.configRecord, activated.manifest);
  const audit = await flushPendingAudit(cleanup.configRecord, cleanup.manifest);
  return {
    status: 'activated',
    assets_id: activated.manifest.assets_id,
    file_count: activated.manifest.files.length,
    content_sha256: activated.manifest.content_sha256,
    cleanup_pending: !cleanup.complete,
    maintenance_pending: false,
    audit_pending: audit.pending,
  };
}

export async function uploadCustomUiArchive(file: File) {
  const auditIdentity = auditRepo.currentAdminAuditIdentity();
  const parsed = await parseCustomUiArchive(file);
  const previousState = await uploadBaseState();
  const previousManifest = previousState?.manifest || null;
  await retryCleanupQueue(previousManifest);
  assertUploadCleanupCapacity(previousManifest, parsed.files.length);
  const prepared = await prepareCustomUiUpload(parsed, previousManifest, auditIdentity);
  const activated = await activatePreparedUpload(previousState?.configRecord || null, prepared);
  return completeCustomUiUpload(activated);
}

async function writeCustomUiManifest(
  configRecord: CustomUiConfigRecord,
  manifest: CustomUiManifest,
  enabled: boolean,
) {
  try {
    return await tenantConfigRepo.compareAndSwapTenantConfig(
      CUSTOM_UI_CONFIG_TYPE,
      CUSTOM_UI_CONFIG_KEY,
      configRevision(configRecord),
      { value: { ...manifest }, enabled },
    );
  } catch {
    throw customUiUnavailable('custom_ui_config_unavailable', 'Custom UI state could not be updated.');
  }
}

async function deleteDeactivatedConfig(configRecord: CustomUiConfigRecord) {
  try {
    return await tenantConfigRepo.deleteTenantConfigIfRevision(
      CUSTOM_UI_CONFIG_TYPE,
      CUSTOM_UI_CONFIG_KEY,
      configRevision(configRecord)!,
    );
  } catch {
    throw customUiUnavailable('custom_ui_config_unavailable', 'Custom UI cleanup could not be finalized.');
  }
}

function concurrentDeletionError() {
  return new ApiContractError(409, 'custom_ui_changed_retry', 'Custom UI assets changed concurrently; retry deletion.');
}

async function deletionBaseState(): Promise<CustomUiState | null> {
  const configRecord = await readCustomUiConfig();
  if (!configRecord) return null;
  const parsedManifest = customUiManifestFromConfig(configRecord);
  if (!parsedManifest) throw new ApiContractError(409, 'custom_ui_manifest_invalid', 'The current Custom UI manifest is invalid.');
  const manifest = !configRecord.enabled && parsedManifest.lifecycle_state === 'active'
    ? { ...parsedManifest, lifecycle_state: 'cleanup_pending' as const }
    : parsedManifest;
  const flushed = await requirePendingAuditDelivery(configRecord, manifest);
  await retryCleanupQueue(flushed.configRecord.enabled ? flushed.manifest : null);
  return { configRecord: flushed.configRecord, manifest: flushed.manifest };
}

async function removeCompletedCustomUiState(state: CustomUiState) {
  if (!await deleteDeactivatedConfig(state.configRecord)) throw concurrentDeletionError();
  return { status: 'deleted', deleted_file_count: state.manifest.files.length };
}

function deactivationAuditPendingResponse() {
  return {
    status: 'deactivated',
    deleted_file_count: 0,
    cleanup_pending: true,
    audit_pending: true,
  };
}

function deletionAuditPendingResponse(fileCount: number) {
  return {
    status: 'deleted',
    deleted_file_count: fileCount,
    cleanup_pending: false,
    audit_pending: true,
  };
}

async function deactivateCustomUiState(
  state: CustomUiState,
  identity: auditRepo.PersistedAdminAuditIdentity,
) {
  if (!state.configRecord.enabled) return { state, response: null };
  const deactivating = manifestWithPendingAudit(
    { ...state.manifest, lifecycle_state: 'cleanup_pending' },
    'sign_in_experience.custom_ui_delete_pending',
    true,
    identity,
  );
  const deactivated = await writeCustomUiManifest(state.configRecord, deactivating, false);
  if (!deactivated) throw concurrentDeletionError();
  const audit = await flushPendingAudit(deactivated, deactivating);
  return {
    state: { configRecord: audit.configRecord, manifest: audit.manifest },
    response: audit.pending ? deactivationAuditPendingResponse() : null,
  };
}

async function recordCompletedDeletion(
  state: CustomUiState,
  identity: auditRepo.PersistedAdminAuditIdentity,
) {
  const deletedManifest = manifestWithPendingAudit(
    { ...state.manifest, lifecycle_state: 'objects_deleted', cleanup_pending_object_keys: [] },
    'sign_in_experience.custom_ui_deleted',
    false,
    identity,
  );
  const objectsDeleted = await writeCustomUiManifest(state.configRecord, deletedManifest, false);
  if (!objectsDeleted) throw concurrentDeletionError();
  const audit = await flushPendingAudit(objectsDeleted, deletedManifest);
  return {
    state: { configRecord: audit.configRecord, manifest: audit.manifest },
    response: audit.pending ? deletionAuditPendingResponse(state.manifest.files.length) : null,
  };
}

async function deleteStoredCustomUi(
  state: CustomUiState,
  identity: auditRepo.PersistedAdminAuditIdentity,
) {
  if (state.manifest.lifecycle_state !== 'cleanup_pending') {
    throw new ApiContractError(409, 'custom_ui_manifest_invalid', 'The current Custom UI lifecycle state is invalid.');
  }
  if (!await removeStorageObjects(previousObjectKeys(state.manifest))) {
    throw customUiUnavailable('custom_ui_cleanup_pending', 'Custom UI is disabled; stored asset cleanup must be retried.');
  }
  const completed = await recordCompletedDeletion(state, identity);
  return completed.response || removeCompletedCustomUiState(completed.state);
}

export async function deleteCustomUiAssets() {
  const auditIdentity = auditRepo.currentAdminAuditIdentity();
  const initialState = await deletionBaseState();
  if (!initialState) {
    await retryCleanupQueue(null);
    return { status: 'deleted', deleted_file_count: 0 };
  }
  if (initialState.manifest.lifecycle_state === 'objects_deleted') {
    return removeCompletedCustomUiState(initialState);
  }
  const deactivated = await deactivateCustomUiState(initialState, auditIdentity);
  if (deactivated.response) return deactivated.response;
  return deleteStoredCustomUi(deactivated.state, auditIdentity);
}

async function activeCustomUiManifest() {
  return activeCustomUiManifestFromConfig(await readCustomUiConfig());
}

export async function customUiAssetResponse(rawPath: string): Promise<Response> {
  const normalizedPath = normalizeCustomUiAssetPath(rawPath || 'index.html');
  if (!normalizedPath) return Response.json({ error: 'not_found' }, { status: 404 });
  const manifest = await activeCustomUiManifest();
  const file = manifest ? manifestFileForPath(manifest, normalizedPath) : null;
  if (!file) return Response.json({ error: 'not_found' }, { status: 404 });
  try {
    const storageResponse = await adapter.downloadFile(CUSTOM_UI_STORAGE_BUCKET, file.object_key);
    const content = await readVerifiedStorageAsset(storageResponse, file);
    return new Response(Uint8Array.from(content).buffer, {
      headers: {
        'cache-control': 'no-store',
        'content-length': String(content.length),
        'content-type': file.content_type,
        etag: `"${file.sha256}"`,
        'x-content-type-options': 'nosniff',
      },
    });
  } catch (error) {
    if (isSupaCloudApiError(error, [404])) {
      return Response.json({ error: 'not_found' }, { status: 404 });
    }
    if (error instanceof CustomUiAssetError) {
      throw new ApiContractError(502, 'custom_ui_asset_integrity_failed', 'Custom UI asset integrity verification failed.');
    }
    throw customUiUnavailable('custom_ui_storage_unavailable', 'Custom UI asset storage is temporarily unavailable.');
  }
}

export const sieRoutes = new Elysia({ prefix: '/v1/sign-in-experience' })
  .get('/', async () => sieRepo.getSignInExperience(), {
    detail: { summary: 'Get sign-in experience configuration', tags: ['Sign-in Experience'] },
  })

  .get('/resolve', async ({ query }) => {
    const applicationId = (query as Record<string, unknown>).application_id;
    const appId = typeof applicationId === 'string' ? applicationId : undefined;
    return sieRepo.resolveSignInExperience(appId, await getSupaCloudSignInSource(appId));
  }, {
    detail: { summary: 'Resolve effective sign-in experience for an application', tags: ['Sign-in Experience', 'Applications'] },
  })

  .put('/', async ({ body }) => {
    const updated = await sieRepo.updateSignInExperience(body as Parameters<typeof sieRepo.updateSignInExperience>[0]);
    await audit('sign_in_experience.update', 'sign_in_experience', updated.id);
    return sieRepo.getSignInExperience();
  }, {
    detail: { summary: 'Update sign-in experience configuration', tags: ['Sign-in Experience'] },
  })

  // ─── Custom UI Assets management ────────────────────────────────────
  .post('/custom-ui-assets', async ({ body, set }) => {
    const upload = body as Record<string, unknown>;
    if (!(upload.file instanceof File)) {
      set.status = 400;
      return { error: 'file_required', message: 'Upload a zip file containing custom sign-in page assets (index.html required).' };
    }
    try {
      const uploadResult = await uploadCustomUiArchive(upload.file);
      if (uploadResult.audit_pending || uploadResult.maintenance_pending) set.status = 202;
      return uploadResult;
    } catch (error) {
      if (!(error instanceof CustomUiAssetError)) throw error;
      set.status = 400;
      return { error: error.code, message: 'The Custom UI archive did not pass validation.' };
    }
  }, {

    detail: { summary: 'Upload custom UI assets (zip) for hosted sign-in page', tags: ['Sign-in Experience', 'Custom UI Assets'] },
  })

  .delete('/custom-ui-assets', async ({ set }) => {
    const deletionResult = await deleteCustomUiAssets();
    if ('audit_pending' in deletionResult && deletionResult.audit_pending) set.status = 202;
    return deletionResult;
  }, {
    detail: { summary: 'Delete custom UI assets, revert to default sign-in page', tags: ['Sign-in Experience', 'Custom UI Assets'] },
  });

interface PublicSignInExperienceOptions {
  getExperience?: (applicationId?: string) => Promise<Record<string, unknown>>;
  getConnectors?: () => Promise<unknown[]>;
  getAuthConfig?: () => Promise<unknown>;
}

async function authoritativePublicPasswordPolicy(getAuthConfig: () => Promise<unknown>) {
  try {
    return passwordPolicyFromAuthConfig(await getAuthConfig());
  } catch {
    throw new ApiContractError(
      503,
      'password_policy_unavailable',
      'Password policy is temporarily unavailable.',
    );
  }
}

export async function resolvePublicSignInExperience(
  applicationId?: string,
  options: PublicSignInExperienceOptions = {},
) {
  const getExperience = options.getExperience || (async (resolvedApplicationId?: string) => (
    sieRepo.resolveSignInExperience(
      resolvedApplicationId,
      await getSupaCloudSignInSource(resolvedApplicationId),
    ) as Promise<Record<string, unknown>>
  ));
  const [experience, connectors, passwordPolicy] = await Promise.all([
    getExperience(applicationId),
    (options.getConnectors || getEnabledConnectors)(),
    authoritativePublicPasswordPolicy(options.getAuthConfig || (() => adapter.getAuthConfig())),
  ]);
  return {
    ...experience,
    connectors,
    sign_up_enabled: experience.sign_up_enabled ?? true,
    password_policy: passwordPolicy,
  };
}

export const publicSignInExperienceRoutes = new Elysia({ prefix: '/v1/public/sign-in-experience' })
  .get('/resolve', async ({ query }) => {
    const q = query as Record<string, unknown>;
    const applicationId = typeof q.application_id === 'string' ? q.application_id : undefined;
    const experience = await resolvePublicSignInExperience(applicationId);
    return typeof q.authorization_id === 'string'
      ? { ...experience, authorization_pending_authentication: true }
      : experience;
  }, {
    detail: { summary: 'Resolve public effective sign-in experience for hosted login pages', tags: ['Sign-in Experience', 'Public'] },
  });

export const publicConnectorRoutes = new Elysia({ prefix: '/v1/public/connectors' })
  .get('/:connectorId/authorize', async ({ params, query, set }) => {
    const connector = await getEnabledConnector(params.connectorId);
    if (!connector) {
      set.status = 404;
      return { error: 'connector_not_enabled' };
    }

    const q = query as Record<string, unknown>;
    const redirectUri = typeof q.redirect_uri === 'string' ? q.redirect_uri : '';
    const authorizationId = typeof q.authorization_id === 'string' ? q.authorization_id : '';
    const state = typeof q.state === 'string' ? q.state : '';

    // Build GoTrue OAuth authorize URL for this provider
    const goTrueUrl = new URL('/auth/v1/authorize', config.oauthRuntimeUrl);
    goTrueUrl.searchParams.set('provider', params.connectorId);
    if (authorizationId) {
      const authorizationReturnUrl = new URL('/oauth/authorize', config.publicBaseUrl);
      authorizationReturnUrl.searchParams.set('authorization_id', authorizationId);
      goTrueUrl.searchParams.set('redirect_to', authorizationReturnUrl.toString());
    } else if (redirectUri) {
      goTrueUrl.searchParams.set('redirect_to', redirectUri);
    }
    if (state) goTrueUrl.searchParams.set('state', state);

    // Forward any OAuth params from the original authorize request
    const forwardedParams = ['client_id', 'redirect_uri', 'response_type', 'scope', 'code_challenge', 'code_challenge_method', 'nonce', 'resource'];
    for (const p of forwardedParams) {
      const val = q[p];
      if (typeof val === 'string') goTrueUrl.searchParams.set(p, val);
    }

    set.status = 302;
    set.headers['location'] = goTrueUrl.toString();
    return { redirect: goTrueUrl.toString() };
  }, {
    detail: { summary: 'Redirect to social/SSO connector authorization', tags: ['Public', 'Connectors'] },
  });

export const publicPhrasesRoutes = new Elysia({ prefix: '/v1/public/phrases' })
  .get('/:languageTag', async ({ params }) => {
    const phrase = await tenantConfigRepo.getTenantConfig('phrase', params.languageTag);
    if (!phrase || !phrase.enabled) {
      // Return empty object so the login page can fall back to defaults
      return { language_tag: params.languageTag, phrases: {} };
    }
    return { language_tag: params.languageTag, phrases: phrase.value || {} };
  }, {
    detail: { summary: 'Get custom phrases for a language tag', tags: ['Public', 'Tenant Config'] },
  });

export const publicCustomUiRoutes = new Elysia({ prefix: '/v1/public/custom-ui' })
  .get('/*', ({ params }) => {
    const sub = (params as Record<string, string>)['*'] || 'index.html';
    return customUiAssetResponse(sub);
  }, {
    detail: { summary: 'Serve custom UI assets for hosted sign-in page', tags: ['Public', 'Custom UI Assets'] },
  });

function oauthBearerToken(headers: Record<string, string | undefined>) {
  return headers.authorization?.match(/^Bearer\s+(.+)$/i)?.[1] || null;
}

async function getGoTrueAuthorization(authorizationId: string, accessToken: string) {
  return fetchGoTrueJson(`/oauth/authorizations/${authorizationId}`, {
    headers: { Authorization: `Bearer ${accessToken}` },
  });
}

async function submitGoTrueConsent(
  authorizationId: string,
  accessToken: string,
  action: 'approve' | 'deny',
) {
  return fetchGoTrueJson(`/oauth/authorizations/${authorizationId}/consent`, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${accessToken}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({ action }),
  });
}

function oauthErrorPayload(failure: PublicUpstreamFailure) {
  return { error: failure.code, error_description: failure.message };
}

function goTrueOAuthPayload(
  result: Awaited<ReturnType<typeof fetchGoTrueJson>>,
  set: { status?: number | string },
  badRequest: UpstreamBadRequestContext,
) {
  if (result.response.ok) return result.payload || {};
  const failure = upstreamResponseFailure(result.response.status, badRequest);
  set.status = failure.status;
  return oauthErrorPayload(failure);
}

function caughtOAuthFailure(error: unknown): PublicUpstreamFailure {
  if (error instanceof ApiContractError) {
    return { ok: false, status: error.status, code: error.code, message: error.message };
  }
  return upstreamNetworkFailure(error);
}

function consentDecisionContext(payload: Record<string, unknown> | null) {
  const client = payload?.client as Record<string, unknown> | undefined;
  const user = payload?.user as Record<string, unknown> | undefined;
  if (typeof client?.id !== 'string' || typeof user?.id !== 'string') {
    throw new ApiContractError(
      502,
      'invalid_upstream_response',
      'GoTrue authorization details omitted the client or user identifier',
    );
  }
  return {
    applicationId: client.id,
    userId: user.id,
    requestedScopes: typeof payload?.scope === 'string'
      ? payload.scope.split(/\s+/).filter(Boolean)
      : [],
  };
}

async function completeGoTrueConsent(
  authorizationId: string,
  accessToken: string,
  action: 'approve' | 'deny',
) {
  const authorization = await getGoTrueAuthorization(authorizationId, accessToken);
  if (!authorization.response.ok || typeof authorization.payload?.redirect_url === 'string') {
    return authorization;
  }
  const decisionContext = consentDecisionContext(authorization.payload);
  const consent = await submitGoTrueConsent(authorizationId, accessToken, action);
  if (consent.response.ok) {
    await recordConsentDecision(authorizationId, action, decisionContext);
  }
  return consent;
}

async function recordConsentDecision(
  authorizationId: string,
  action: 'approve' | 'deny',
  context: ReturnType<typeof consentDecisionContext>,
) {
  const decision = action === 'approve' ? 'approved' : 'denied';
  await consentRepo.recordOAuthConsentDecision({ authorizationId, ...context, decision });
  await auditRepo.logAudit({
    eventType: `oauth_consent.${decision}`,
    actorId: context.userId,
    actorType: 'user',
    resourceType: 'application',
    resourceId: context.applicationId,
    details: { authorization_id: authorizationId, requested_scopes: context.requestedScopes },
  });
}

export const publicOAuthRoutes = new Elysia({ prefix: '/v1/public/oauth' })
  .get('/authorizations/:authorizationId', async ({ headers, params, set }) => {
    const accessToken = oauthBearerToken(headers);
    if (!accessToken) {
      set.status = 401;
      return { error: 'missing_bearer_token' };
    }
    try {
      return goTrueOAuthPayload(
        await getGoTrueAuthorization(params.authorizationId, accessToken),
        set,
        {
          code: 'gotrue_authorization_lookup_failed',
          message: 'GoTrue authorization lookup failed.',
        },
      );
    } catch (error) {
      const failure = caughtOAuthFailure(error);
      set.status = failure.status;
      return oauthErrorPayload(failure);
    }
  }, {
    detail: { summary: 'Get authoritative GoTrue OAuth authorization details', tags: ['Public', 'Consent'] },
  })
  .post('/authorizations/:authorizationId/consent', async ({ headers, params, body, set }) => {
    const accessToken = oauthBearerToken(headers);
    if (!accessToken) {
      set.status = 401;
      return { error: 'missing_bearer_token' };
    }
    const action = (body as { action?: unknown } | null)?.action;
    if (action !== 'approve' && action !== 'deny') {
      set.status = 400;
      return { error: 'validation_failed', message: "action must be 'approve' or 'deny'" };
    }
    try {
      return goTrueOAuthPayload(
        await completeGoTrueConsent(params.authorizationId, accessToken, action),
        set,
        {
          code: 'gotrue_consent_failed',
          message: 'GoTrue consent approval failed.',
        },
      );
    } catch (error) {
      const failure = caughtOAuthFailure(error);
      set.status = failure.status;
      return oauthErrorPayload(failure);
    }
  }, {
    detail: { summary: 'Submit an authoritative GoTrue OAuth consent decision', tags: ['Public', 'Consent'] },
  });

export const authConfigRoutes = new Elysia({ prefix: '/v1/auth-config' })
  .get('/', async () => withoutSecrets(await adapter.getAuthConfig()), {
    detail: { summary: 'Get auth configuration (GoTrue)', tags: ['Auth Config'] },
  })
  .get('/runtime-consistency', async () => getAuthConfigRuntimeConsistency(), {
    detail: { summary: 'Compare desired auth config with GoTrue runtime settings', tags: ['Auth Config'] },
  })
  .patch('/', async ({ body }) => {
    const requested = authConfigPatch(body);
    await adapter.updateAuthConfig(requested);
    const updated = await adapter.getAuthConfig() as Record<string, unknown>;
    assertAuthConfigReadBack(requested, updated);
    await audit('auth_config.update', 'auth_config', config.projectRef);
    return withoutSecrets(updated);
  }, {
    detail: { summary: 'Update auth configuration (GoTrue)', tags: ['Auth Config'] },
  });

function authConfigPatch(body: unknown): Record<string, unknown> {
  if (!body || typeof body !== 'object' || Array.isArray(body)) {
    throw new ApiContractError(400, 'invalid_auth_config', 'Auth configuration must be an object');
  }
  const requested = body as Record<string, unknown>;
  if (containsSecret(requested)) {
    throw new ApiContractError(400, 'secret_not_allowed', 'Use a secret-backed typed configuration endpoint for auth secrets');
  }
  const minimumLength = requested.password_min_length;
  if (minimumLength !== undefined && (!Number.isInteger(minimumLength) || Number(minimumLength) < 6 || Number(minimumLength) > 128)) {
    throw new ApiContractError(400, 'invalid_password_policy', 'password_min_length must be an integer from 6 to 128');
  }
  const requiredCharacters = requested.password_required_characters;
  if (requiredCharacters !== undefined && (
    typeof requiredCharacters !== 'string'
    || !SUPPORTED_GOTRUE_PASSWORD_CHARACTER_POLICIES.has(requiredCharacters)
  )) {
    throw new ApiContractError(400, 'invalid_password_policy', 'password_required_characters cannot be represented exactly by GoTrue');
  }
  return requested;
}

function assertAuthConfigReadBack(requested: Record<string, unknown>, runtime: Record<string, unknown>) {
  const mismatched = Object.entries(requested)
    .filter(([key]) => key === 'password_min_length' || key === 'password_required_characters')
    .filter(([key, value]) => runtime[key] !== value)
    .map(([key]) => key);
  if (mismatched.length > 0) {
    throw new ApiContractError(502, 'runtime_config_mismatch', 'GoTrue auth configuration read-back did not match the requested policy', {
      fields: mismatched,
    });
  }
}
