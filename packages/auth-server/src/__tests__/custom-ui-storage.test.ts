import { beforeEach, describe, expect, it, mock } from 'bun:test';
import { createHash, randomUUID } from 'node:crypto';
import { Elysia } from 'elysia';
import {
  customUiObjectKey,
  parseCustomUiManifest,
  type CustomUiAuditPendingEvent,
  type CustomUiManifest,
  type CustomUiManifestFile,
} from '../utils/custom-ui-assets.js';
import { ApiContractError } from '../utils/api-contract.js';

process.env.SUPACLOUD_INTERNAL_API_URL = 'http://supacloud.internal';
process.env.SUPACLOUD_INTERNAL_TOKEN = 'test-token';
process.env.SUPAOAUTH_BFF_SIGNING_SECRET = 'test-bff-signing-secret-32-characters';
process.env.SUPACLOUD_PROJECT_REF = 'test-project';
process.env.SUPACLOUD_RUNTIME_URL = 'http://runtime.internal';
process.env.SUPACLOUD_DATABASE_URL = 'postgres://test';
process.env.ADMIN_AUTH_MODE = 'token';
process.env.NODE_ENV = 'test';

interface ConfigRecord {
  id: string;
  configType: string;
  key: string;
  value: Record<string, unknown> | null;
  enabled: boolean;
  updatedAt: Date;
}

type LegacyUploadAuditSeed = 'none' | 'ready' | 'delivery_unknown_with_readback';

const configRecords = new Map<string, ConfigRecord>();
let revisionCounter = 0;
let rejectObjectDeletion = false;
let rejectDeletionAfterRemovingObjects = false;
let deleteLeavesStoredObjects = false;
const storedObjects = new Map<string, Uint8Array>();
const auditEvents: Array<Record<string, unknown>> = [];
const auditEventsByIdempotencyKey = new Map<string, Record<string, unknown>>();
const rejectedAuditEventTypes = new Set<string>();

function configStorageKey(configType: string, key: string) {
  return [configType, key].join(':');
}

function activeConfig() {
  return configRecords.get(configStorageKey('custom_ui_assets', 'active')) || null;
}

function matchesRevision(record: ConfigRecord | null, revision: {
  id: string;
  updatedAt: Date;
  value: Record<string, unknown> | null;
  enabled: boolean;
} | null) {
  if (!record || !revision) return record === null && revision === null;
  return record.id === revision.id
    && record.updatedAt.getTime() === revision.updatedAt.getTime()
    && record.value === revision.value
    && record.enabled === revision.enabled;
}

function nextConfigRecord(
  configType: string,
  key: string,
  currentConfig: ConfigRecord | null,
  write: { value: Record<string, unknown>; enabled: boolean },
) {
  return {
    id: currentConfig?.id || 'config-' + key,
    configType,
    key,
    value: write.value,
    enabled: write.enabled,
    updatedAt: new Date(1_800_000_000_000 + revisionCounter++),
  };
}

const tenantConfigRepository = {
  getTenantConfig: mock(async (configType: string, key: string) => (
    configRecords.get(configStorageKey(configType, key)) || null
  )),
  compareAndSwapTenantConfig: mock(async (
    configType: string,
    key: string,
    revision: { id: string; updatedAt: Date; value: Record<string, unknown> | null; enabled: boolean } | null,
    write: { value: Record<string, unknown>; enabled: boolean },
  ) => {
    const storageKey = configStorageKey(configType, key);
    const currentConfig = configRecords.get(storageKey) || null;
    if (!matchesRevision(currentConfig, revision)) return null;
    const nextConfig = nextConfigRecord(configType, key, currentConfig, write);
    configRecords.set(storageKey, nextConfig);
    return nextConfig;
  }),
  deleteTenantConfigIfRevision: mock(async (
    configType: string,
    key: string,
    revision: { id: string; updatedAt: Date; value: Record<string, unknown> | null; enabled: boolean },
  ) => {
    const storageKey = configStorageKey(configType, key);
    const currentConfig = configRecords.get(storageKey) || null;
    if (!matchesRevision(currentConfig, revision)) return null;
    configRecords.delete(storageKey);
    return currentConfig;
  }),
};

const storageAdapter = {
  deleteFile: mock(async (_bucket: string, objectKeys: string[]) => {
    if (rejectObjectDeletion) throw new Error('/private/runtime/delete failed');
    if (!deleteLeavesStoredObjects) {
      for (const objectKey of objectKeys) storedObjects.delete(objectKey);
    }
    if (rejectDeletionAfterRemovingObjects) throw new Error('/private/runtime/delete response lost');
    return [];
  }),
  downloadFile: mock(async (_bucket: string, objectKey: string) => {
    const bytes = storedObjects.get(objectKey);
    if (!bytes) throw Object.assign(new Error('missing'), { status: 404 });
    return new Response(Uint8Array.from(bytes).buffer);
  }),
  getProject: mock(async () => ({})),
};

mock.module('../repositories/tenant-config.js', () => tenantConfigRepository);
mock.module('../repositories/audit.js', () => ({
  currentAdminAuditIdentity: () => ({
    actorId: 'test-admin',
    requestId: 'test-request',
    authorizationSource: 'development_token',
  }),
  logPersistedAdminAudit: mock(async (
    identity: { actorId: string; requestId: string },
    event: Record<string, unknown>,
  ) => {
    if (rejectedAuditEventTypes.has(String(event.eventType))) return 'rejected';
    const idempotencyKey = String(event.idempotencyKey);
    if (!auditEventsByIdempotencyKey.has(idempotencyKey)) {
      const persisted = { ...event, actorId: identity.actorId, requestId: identity.requestId };
      auditEvents.push(persisted);
      auditEventsByIdempotencyKey.set(idempotencyKey, persisted);
    }
    return 'delivered';
  }),
  queryAuditLogs: mock(async (filters: Record<string, unknown>) => {
    const matching = auditEvents.filter(event => (
      event.eventType === filters.eventType
      && event.resourceType === filters.resourceType
      && event.resourceId === filters.resourceId
      && event.actorId === filters.actorId
    ));
    return {
      items: matching.map(event => ({
        event_type: event.eventType,
        actor_id: event.actorId,
        actor_type: 'admin',
        resource_type: event.resourceType,
        resource_id: event.resourceId,
        details: event.details,
        request_id: event.requestId,
        source: 'supauth',
        method: 'EVENT',
        status: 200,
      })),
      total: matching.length,
      next_cursor: null,
    };
  }),
  logAudit: mock(async (event: Record<string, unknown>) => {
    auditEvents.push(event);
    return event;
  }),
}));
mock.module('../supacloud/adapter.js', () => ({
  getSupaCloudAdapter: () => storageAdapter,
  getSupaCloudAdapterForProject: () => storageAdapter,
  isSupaCloudApiError: (error: unknown, statuses?: number[]) => {
    const status = error && typeof error === 'object' ? (error as { status?: number }).status : undefined;
    return typeof status === 'number' && (!statuses || statuses.includes(status));
  },
}));

const {
  deleteCustomUiAssets,
  publicCustomUiRoutes,
  sieRoutes,
} = await import('../routes/sign-in-experience.js');
const { hostedPageRoutes } = await import('../routes/hosted-pages.js');
const customUiApp = new Elysia().use(hostedPageRoutes).use(publicCustomUiRoutes);
const managementApp = new Elysia()
  .onError(({ error, set }) => {
    if (!(error instanceof ApiContractError)) return;
    set.status = error.status;
    return {
      success: false,
      error: { code: error.code, message: error.message, details: error.details },
    };
  })
  .use(sieRoutes);

function sha256(bytes: Uint8Array) {
  return createHash('sha256').update(bytes).digest('hex');
}

function manifestContentHash(files: Array<Pick<CustomUiManifestFile, 'path' | 'sha256' | 'size'>>) {
  const hash = createHash('sha256');
  for (const file of files) hash.update(file.path + '\0' + file.sha256 + '\0' + file.size + '\n');
  return hash.digest('hex');
}

function legacyAssetFixture(
  assetsId: string,
  path: string,
  content: string,
  contentType: string,
) {
  const bytes = new TextEncoder().encode(content);
  const digest = sha256(bytes);
  return {
    bytes,
    file: {
      path,
      object_key: customUiObjectKey(assetsId, { path, sha256: digest }),
      sha256: digest,
      size: bytes.length,
      content_type: contentType,
    } satisfies CustomUiManifestFile,
  };
}

function legacyManifestFixture(label: string) {
  const assetsId = randomUUID();
  const assets = [
    legacyAssetFixture(assetsId, 'assets/app.js', "window.theme = '" + label + "';", 'text/javascript; charset=utf-8'),
    legacyAssetFixture(assetsId, 'assets/site.css', 'body { --theme: ' + label + '; }', 'text/css; charset=utf-8'),
    legacyAssetFixture(assetsId, 'index.html', '<h1>' + label + '</h1>', 'text/html; charset=utf-8'),
  ];
  const files = assets.map(asset => asset.file);
  const manifest: CustomUiManifest = {
    schema_version: 1,
    assets_id: assetsId,
    content_sha256: manifestContentHash(files),
    uploaded_at: '2026-08-01T00:00:00.000Z',
    files,
    cleanup_pending_object_keys: [],
    lifecycle_state: 'active',
    audit_pending_event: null,
  };
  return { assets, manifest };
}

function legacyUploadedAudit(
  manifest: CustomUiManifest,
  deliveryState: CustomUiAuditPendingEvent['delivery_state'],
): CustomUiAuditPendingEvent {
  return {
    event_id: randomUUID(),
    event_type: 'sign_in_experience.custom_ui_uploaded',
    created_at: '2026-08-01T00:00:00.000Z',
    actor_id: 'test-admin',
    actor_type: 'admin',
    request_id: 'test-request',
    authorization_source: 'development_token',
    delivery_state: deliveryState,
    file_count: manifest.files.length,
    content_sha256: manifest.content_sha256,
    cleanup_pending: false,
  };
}

function seedAuditReadBack(event: CustomUiAuditPendingEvent, manifest: CustomUiManifest) {
  const persisted = {
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
    actorId: event.actor_id,
    requestId: event.request_id,
  };
  auditEvents.push(persisted);
  auditEventsByIdempotencyKey.set(event.event_id, persisted);
}

function seedLegacyCustomUi(label: string, auditSeed: LegacyUploadAuditSeed = 'none') {
  const { assets, manifest } = legacyManifestFixture(label);
  for (const asset of assets) storedObjects.set(asset.file.object_key, asset.bytes);
  if (auditSeed !== 'none') {
    manifest.audit_pending_event = legacyUploadedAudit(
      manifest,
      auditSeed === 'ready' ? 'ready' : 'delivery_unknown',
    );
  }
  if (auditSeed === 'delivery_unknown_with_readback') {
    seedAuditReadBack(manifest.audit_pending_event!, manifest);
  }
  const active = nextConfigRecord('custom_ui_assets', 'active', null, {
    value: { ...manifest },
    enabled: true,
  });
  configRecords.set(configStorageKey('custom_ui_assets', 'active'), active);
  return manifest;
}

function currentManifest() {
  const config = activeConfig();
  if (!config?.value) throw new Error('Expected an active Custom UI manifest');
  return config.value;
}

function currentObjectKeys() {
  const files = currentManifest().files;
  if (!Array.isArray(files)) return [];
  return files.map(file => String((file as Record<string, unknown>).object_key));
}

function cleanupQueue() {
  return configRecords.get(configStorageKey('custom_ui_assets', 'cleanup'))?.value || null;
}

function cleanupAssetsId(index: number) {
  return '00000000-0000-4000-8000-' + index.toString(16).padStart(12, '0');
}

function cleanupObjectKey(index: number) {
  return 'versions/' + cleanupAssetsId(index) + '/' + 'a'.repeat(64) + '/assets/stale-' + index + '.txt';
}

function invalidActiveManifestWriteCount() {
  return tenantConfigRepository.compareAndSwapTenantConfig.mock.calls.filter((configWriteCall) => {
    const [configType, key, , configWrite] = configWriteCall;
    if (configType !== 'custom_ui_assets' || key !== 'active') return false;
    return !parseCustomUiManifest(configWrite.value);
  }).length;
}

beforeEach(() => {
  configRecords.clear();
  revisionCounter = 0;
  rejectObjectDeletion = false;
  rejectDeletionAfterRemovingObjects = false;
  deleteLeavesStoredObjects = false;
  storedObjects.clear();
  auditEvents.length = 0;
  auditEventsByIdempotencyKey.clear();
  rejectedAuditEventTypes.clear();
  for (const method of Object.values(tenantConfigRepository)) method.mockClear();
  for (const method of Object.values(storageAdapter)) method.mockClear();
});

describe('Custom UI exposure is disabled', () => {
  it('returns 501 before a management upload can mutate storage or configuration', async () => {
    const form = new FormData();
    form.append('file', new File(['not parsed'], 'custom-ui.zip', { type: 'application/zip' }));
    const response = await managementApp.handle(new Request(
      'https://auth.example.test/v1/sign-in-experience/custom-ui-assets',
      { method: 'POST', body: form },
    ));

    expect(response.status).toBe(501);
    expect(await response.json()).toMatchObject({
      error: {
        code: 'capability_unavailable',
        details: {
          capability: 'custom_ui_assets',
          reason_code: 'custom_ui_isolated_origin_required',
        },
      },
    });
    expect(storageAdapter.deleteFile).toHaveBeenCalledTimes(0);
    expect(storageAdapter.downloadFile).toHaveBeenCalledTimes(0);
    expect(tenantConfigRepository.compareAndSwapTenantConfig).toHaveBeenCalledTimes(0);
  });

  it('keeps a seeded legacy manifest inert on hosted and public routes', async () => {
    seedLegacyCustomUi('hosted');
    storageAdapter.downloadFile.mockClear();

    const statusResponse = await managementApp.handle(new Request(
      'https://auth.example.test/v1/sign-in-experience/custom-ui-assets',
    ));
    expect(statusResponse.status).toBe(200);
    expect(await statusResponse.json()).toMatchObject({
      status: 'blocked_unsafe_origin',
      configured: true,
      enabled: false,
      lifecycle_state: 'active',
    });

    const rootResponse = await customUiApp.handle(new Request('https://auth.example.test/'));
    expect(rootResponse.status).toBe(200);
    expect(await rootResponse.text()).not.toContain('<h1>hosted</h1>');

    const legacyAssetResponse = await customUiApp.handle(new Request(
      'https://auth.example.test/custom-ui/assets/app.js',
      { redirect: 'manual' },
    ));
    expect(legacyAssetResponse.status).toBe(404);
    const publicAssetResponse = await customUiApp.handle(new Request(
      'https://auth.example.test/v1/public/custom-ui/assets/app.js',
    ));
    expect(publicAssetResponse.status).toBe(404);
    expect(storageAdapter.downloadFile).toHaveBeenCalledTimes(0);
  });
});

describe('Custom UI durable deletion', () => {
  it('drains stale legacy upload reservations without an active manifest', async () => {
    const reservedKey = cleanupObjectKey(1);
    const unknownKey = cleanupObjectKey(2);
    storedObjects.set(reservedKey, new Uint8Array([1]));
    storedObjects.set(unknownKey, new Uint8Array([2]));
    const cleanupConfig = nextConfigRecord('custom_ui_assets', 'cleanup', null, {
      enabled: true,
      value: {
        schema_version: 1,
        batches: [
          {
            assets_id: cleanupAssetsId(1),
            created_at: new Date(0).toISOString(),
            state: 'reserved',
            lease_token: '10000000-0000-4000-8000-000000000001',
            object_keys: [reservedKey],
          },
          {
            assets_id: cleanupAssetsId(2),
            created_at: new Date(0).toISOString(),
            state: 'upload_outcome_unknown',
            lease_token: '20000000-0000-4000-8000-000000000002',
            outcome_unknown_at: new Date(0).toISOString(),
            object_keys: [unknownKey],
          },
        ],
      },
    });
    configRecords.set(configStorageKey('custom_ui_assets', 'cleanup'), cleanupConfig);

    await expect(deleteCustomUiAssets()).resolves.toEqual({ status: 'deleted', deleted_file_count: 0 });

    expect(storedObjects.size).toBe(0);
    expect(cleanupQueue()?.batches).toEqual([]);
  });

  it('deactivates, recursively deletes every managed object, and reads back 404', async () => {
    seedLegacyCustomUi('delete-me');
    const objectKeys = currentObjectKeys();

    const deleted = await deleteCustomUiAssets();

    expect(deleted).toEqual({ status: 'deleted', deleted_file_count: 3 });
    expect(activeConfig()).toBeNull();
    expect(objectKeys.every(key => !storedObjects.has(key))).toBe(true);
  });

  it('normalizes a disabled active manifest as blocked and keeps it deletable', async () => {
    seedLegacyCustomUi('disabled-active');
    activeConfig()!.enabled = false;

    const statusResponse = await managementApp.handle(new Request(
      'https://auth.example.test/v1/sign-in-experience/custom-ui-assets',
    ));
    expect(await statusResponse.json()).toMatchObject({
      status: 'blocked_unsafe_origin',
      enabled: false,
      lifecycle_state: 'active',
    });

    const deletionResponse = await managementApp.handle(new Request(
      'https://auth.example.test/v1/sign-in-experience/custom-ui-assets',
      { method: 'DELETE' },
    ));
    expect(deletionResponse.status).toBe(200);
    expect(await deletionResponse.json()).toEqual({ status: 'deleted', deleted_file_count: 3 });
    expect(activeConfig()).toBeNull();
    expect(storedObjects.size).toBe(0);
  });

  it('keeps a rejected upload audit valid before retrying disabled active deletion', async () => {
    rejectedAuditEventTypes.add('sign_in_experience.custom_ui_uploaded');
    seedLegacyCustomUi('disabled-rejected-audit', 'ready');
    activeConfig()!.enabled = false;

    await expect(deleteCustomUiAssets()).rejects.toMatchObject({
      status: 503,
      code: 'custom_ui_audit_pending',
    });
    expect(invalidActiveManifestWriteCount()).toBe(0);
    expect(currentManifest()).toMatchObject({
      lifecycle_state: 'active',
      audit_pending_event: {
        event_type: 'sign_in_experience.custom_ui_uploaded',
        delivery_state: 'ready',
      },
    });
    const pendingStatus = await managementApp.handle(new Request(
      'https://auth.example.test/v1/sign-in-experience/custom-ui-assets',
    ));
    expect(pendingStatus.status).toBe(200);
    expect(await pendingStatus.json()).toMatchObject({
      status: 'blocked_unsafe_origin',
      audit_pending: true,
    });

    rejectedAuditEventTypes.clear();
    await expect(deleteCustomUiAssets()).resolves.toEqual({
      status: 'deleted',
      deleted_file_count: 3,
    });
    expect(invalidActiveManifestWriteCount()).toBe(0);
    expect(activeConfig()).toBeNull();
  });

  it('keeps an unknown upload audit valid until disabled active deletion can retry', async () => {
    seedLegacyCustomUi('disabled-unknown-audit', 'delivery_unknown_with_readback');
    activeConfig()!.enabled = false;

    await expect(deleteCustomUiAssets()).rejects.toMatchObject({
      status: 503,
      code: 'custom_ui_audit_pending',
    });
    expect(invalidActiveManifestWriteCount()).toBe(0);
    expect(currentManifest()).toMatchObject({
      lifecycle_state: 'active',
      audit_pending_event: {
        event_type: 'sign_in_experience.custom_ui_uploaded',
        delivery_state: 'delivery_unknown',
      },
    });
    const pendingStatus = await managementApp.handle(new Request(
      'https://auth.example.test/v1/sign-in-experience/custom-ui-assets',
    ));
    expect(pendingStatus.status).toBe(200);
    expect(await pendingStatus.json()).toMatchObject({
      status: 'blocked_unsafe_origin',
      audit_pending: true,
    });

    activeConfig()!.updatedAt = new Date(0);
    await expect(deleteCustomUiAssets()).resolves.toEqual({
      status: 'deleted',
      deleted_file_count: 3,
    });
    expect(invalidActiveManifestWriteCount()).toBe(0);
    expect(activeConfig()).toBeNull();
  });

  it('keeps a disabled cleanup manifest after object deletion fails and succeeds on retry', async () => {
    seedLegacyCustomUi('retry-delete');
    rejectObjectDeletion = true;

    await expect(deleteCustomUiAssets()).rejects.toMatchObject({
      status: 503,
      code: 'custom_ui_cleanup_pending',
    });
    expect(activeConfig()?.enabled).toBe(false);

    rejectObjectDeletion = false;
    await expect(deleteCustomUiAssets()).resolves.toEqual({ status: 'deleted', deleted_file_count: 3 });
    expect(activeConfig()).toBeNull();
    expect(storedObjects.size).toBe(0);
  });

  it('keeps deletion pending when a successful delete response leaves an object readable', async () => {
    seedLegacyCustomUi('partial-delete');
    deleteLeavesStoredObjects = true;

    await expect(deleteCustomUiAssets()).rejects.toMatchObject({
      status: 503,
      code: 'custom_ui_cleanup_pending',
    });
    expect(activeConfig()?.enabled).toBe(false);
    expect(storedObjects.size).toBe(3);

    deleteLeavesStoredObjects = false;
    await expect(deleteCustomUiAssets()).resolves.toEqual({ status: 'deleted', deleted_file_count: 3 });
  });

  it('treats a failed delete request as idempotent success when authenticated read-back is all 404', async () => {
    seedLegacyCustomUi('lost-delete-response');
    rejectDeletionAfterRemovingObjects = true;

    await expect(deleteCustomUiAssets()).resolves.toEqual({ status: 'deleted', deleted_file_count: 3 });
    expect(activeConfig()).toBeNull();
    expect(storedObjects.size).toBe(0);
  });

  it('retains a disabled manifest until the pending delete audit is delivered', async () => {
    seedLegacyCustomUi('delete-audit-pending');
    rejectedAuditEventTypes.add('sign_in_experience.custom_ui_delete_pending');

    const response = await managementApp.handle(new Request(
      'https://auth.example.test/v1/sign-in-experience/custom-ui-assets',
      { method: 'DELETE' },
    ));
    expect(response.status).toBe(202);
    expect(await response.json()).toMatchObject({ status: 'deactivated', audit_pending: true });
    expect(activeConfig()?.enabled).toBe(false);
    expect(currentManifest().audit_pending_event).toMatchObject({
      event_type: 'sign_in_experience.custom_ui_delete_pending',
    });
    expect(storedObjects.size).toBe(3);

    rejectedAuditEventTypes.clear();
    await expect(deleteCustomUiAssets()).resolves.toEqual({ status: 'deleted', deleted_file_count: 3 });
    expect(activeConfig()).toBeNull();
  });

  it('retains the objects-deleted state until the completion audit is delivered', async () => {
    seedLegacyCustomUi('deleted-audit-pending');
    rejectedAuditEventTypes.add('sign_in_experience.custom_ui_deleted');

    const pending = await deleteCustomUiAssets();
    expect(pending).toMatchObject({ status: 'deleted', audit_pending: true, cleanup_pending: false });
    expect(activeConfig()?.enabled).toBe(false);
    expect(currentManifest()).toMatchObject({ lifecycle_state: 'objects_deleted' });
    expect(storedObjects.size).toBe(0);

    rejectedAuditEventTypes.clear();
    await expect(deleteCustomUiAssets()).resolves.toEqual({ status: 'deleted', deleted_file_count: 3 });
    expect(activeConfig()).toBeNull();
  });
});
