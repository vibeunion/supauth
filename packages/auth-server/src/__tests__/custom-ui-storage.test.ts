import { beforeEach, describe, expect, it, mock } from 'bun:test';
import { Elysia } from 'elysia';
import { strToU8, zipSync } from 'fflate';
import { currentAdminRequestContext, withAdminRequestContext } from '../auth/request-context.js';
import { CUSTOM_UI_LIMITS, parseCustomUiManifest } from '../utils/custom-ui-assets.js';
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

const configRecords = new Map<string, ConfigRecord>();
let revisionCounter = 0;
let rejectNextActiveManifestWrite = false;
let rejectPairResponseAfterCommit = false;
let failedUploadSuffix = '';
let lateWriteAfterRejectSuffix = '';
let rejectObjectDeletion = false;
let rejectDeletionAfterRemovingObjects = false;
let deleteLeavesStoredObjects = false;
let rejectNextAuditClearWrite = false;
const storedObjects = new Map<string, Uint8Array>();
const operationOrder: string[] = [];
const auditEvents: Array<Record<string, unknown>> = [];
const auditEventsByIdempotencyKey = new Map<string, Record<string, unknown>>();
const rejectedAuditEventTypes = new Set<string>();
const unknownAuditEventTypes = new Set<string>();
let uploadResponseGate: ReturnType<typeof deferred<void>> | null = null;
let allUploadResponsesBlocked: ReturnType<typeof deferred<void>> | null = null;
let blockedUploadResponses = 0;
let expectedBlockedUploadResponses = 3;
let uploadWriteGate: ReturnType<typeof deferred<void>> | null = null;
let allUploadWritesBlocked: ReturnType<typeof deferred<void>> | null = null;
let blockedUploadWrites = 0;
let lateUploadWriteGate: ReturnType<typeof deferred<void>> | null = null;
let lateUploadWriteCompleted: ReturnType<typeof deferred<void>> | null = null;
let deactivationWriteGate: ReturnType<typeof deferred<void>> | null = null;
let deactivationWriteBlocked: ReturnType<typeof deferred<void>> | null = null;
let pairCommitApplied: ReturnType<typeof deferred<void>> | null = null;
let pairCommitResponseGate: ReturnType<typeof deferred<void>> | null = null;
let auditReadBackGate: ReturnType<typeof deferred<void>> | null = null;
let auditReadBackBlocked: ReturnType<typeof deferred<void>> | null = null;
let blockedAuditReadBacks = 0;

function deferred<T>() {
  let resolve!: (value: T | PromiseLike<T>) => void;
  const promise = new Promise<T>((next) => { resolve = next; });
  return { promise, resolve };
}

function configStorageKey(configType: string, key: string) {
  return `${configType}:${key}`;
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
    id: currentConfig?.id || `config-${key}`,
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
    let currentConfig = configRecords.get(storageKey) || null;
    operationOrder.push(key === 'active' ? `activate:${write.enabled}` : `config:${key}`);
    if (key === 'active' && !write.enabled && deactivationWriteGate) {
      deactivationWriteBlocked?.resolve();
      await deactivationWriteGate.promise;
      currentConfig = configRecords.get(storageKey) || null;
    }
    const currentAudit = currentConfig?.value?.audit_pending_event as Record<string, unknown> | null | undefined;
    const nextAudit = write.value.audit_pending_event as Record<string, unknown> | null | undefined;
    if (key === 'active' && rejectNextAuditClearWrite
      && currentAudit?.delivery_state === 'delivered' && nextAudit === null) {
      rejectNextAuditClearWrite = false;
      return null;
    }
    if ((key === 'active' && rejectNextActiveManifestWrite) || !matchesRevision(currentConfig, revision)) {
      rejectNextActiveManifestWrite = false;
      return null;
    }
    const nextConfig = nextConfigRecord(configType, key, currentConfig, write);
    configRecords.set(storageKey, nextConfig);
    return nextConfig;
  }),
  compareAndSwapTenantConfigPair: mock(async (request: {
    configType: string;
    first: {
      key: string;
      expected: Parameters<typeof matchesRevision>[1];
      write: { value: Record<string, unknown>; enabled: boolean };
    };
    second: {
      key: string;
      expected: Parameters<typeof matchesRevision>[1];
      write: { value: Record<string, unknown>; enabled: boolean };
    };
  }) => {
    const firstKey = configStorageKey(request.configType, request.first.key);
    const secondKey = configStorageKey(request.configType, request.second.key);
    const firstCurrent = configRecords.get(firstKey) || null;
    const secondCurrent = configRecords.get(secondKey) || null;
    operationOrder.push(`activate:${request.second.write.enabled}`);
    if (rejectNextActiveManifestWrite) {
      rejectNextActiveManifestWrite = false;
      if (secondCurrent) {
        configRecords.set(secondKey, {
          ...secondCurrent,
          updatedAt: new Date(1_800_000_000_000 + revisionCounter++),
        });
      }
      return null;
    }
    if (!matchesRevision(firstCurrent, request.first.expected)
      || !matchesRevision(secondCurrent, request.second.expected)) {
      return null;
    }
    const first = nextConfigRecord(request.configType, request.first.key, firstCurrent, request.first.write);
    const second = nextConfigRecord(request.configType, request.second.key, secondCurrent, request.second.write);
    configRecords.set(firstKey, first);
    configRecords.set(secondKey, second);
    if (rejectPairResponseAfterCommit) {
      rejectPairResponseAfterCommit = false;
      pairCommitApplied?.resolve();
      await pairCommitResponseGate?.promise;
      throw new Error('pair commit response lost');
    }
    return { first, second };
  }),
  deleteTenantConfigIfRevision: mock(async (
    configType: string,
    key: string,
    revision: { id: string; updatedAt: Date; value: Record<string, unknown> | null; enabled: boolean },
  ) => {
    const storageKey = configStorageKey(configType, key);
    const currentConfig = configRecords.get(storageKey) || null;
    if (!matchesRevision(currentConfig, revision)) return null;
    const deleted = currentConfig;
    configRecords.delete(storageKey);
    return deleted;
  }),
};

const storageAdapter = {
  listStorageBuckets: mock(async () => [{ id: 'supauth-custom-ui' }]),
  getStorageBucket: mock(async (): Promise<Record<string, unknown>> => ({
    id: 'supauth-custom-ui',
    public: false,
    file_size_limit: 2 * 1024 * 1024,
  })),
  createStorageBucket: mock(async () => ({ id: 'supauth-custom-ui' })),
  uploadFile: mock(async (_bucket: string, objectKey: string, blob: Blob) => {
    operationOrder.push(`upload:${objectKey}`);
    if (failedUploadSuffix && objectKey.endsWith(failedUploadSuffix)) {
      throw new Error('/private/runtime/storage failed with token=do-not-leak');
    }
    const bytes = new Uint8Array(await blob.arrayBuffer());
    if (lateWriteAfterRejectSuffix && objectKey.endsWith(lateWriteAfterRejectSuffix)) {
      void lateUploadWriteGate?.promise.then(() => {
        storedObjects.set(objectKey, bytes);
        lateUploadWriteCompleted?.resolve();
      });
      throw new Error('/private/runtime/storage response lost');
    }
    if (uploadWriteGate) {
      blockedUploadWrites += 1;
      if (blockedUploadWrites === 3) allUploadWritesBlocked?.resolve();
      await uploadWriteGate.promise;
    }
    storedObjects.set(objectKey, bytes);
    if (uploadResponseGate) {
      blockedUploadResponses += 1;
      if (blockedUploadResponses === expectedBlockedUploadResponses) allUploadResponsesBlocked?.resolve();
      await uploadResponseGate.promise;
    }
    return { key: objectKey };
  }),
  deleteFile: mock(async (_bucket: string, objectKeys: string[]) => {
    operationOrder.push(`delete:${objectKeys.length}`);
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
  currentAdminAuditIdentity: () => {
    const context = currentAdminRequestContext();
    return context ? {
      actorId: context.principal.id,
      requestId: context.requestId,
      authorizationSource: context.principal.authorization_source,
    } : {
      actorId: 'test-admin',
      requestId: 'test-request',
      authorizationSource: 'development_token',
    };
  },
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
    if (unknownAuditEventTypes.has(String(event.eventType))) {
      throw new Error('audit response lost after commit');
    }
    return 'delivered';
  }),
  queryAuditLogs: mock(async (filters: Record<string, unknown>) => {
    if (auditReadBackGate) {
      blockedAuditReadBacks += 1;
      if (blockedAuditReadBacks === 2) auditReadBackBlocked?.resolve();
      await auditReadBackGate.promise;
    }
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
    if (rejectedAuditEventTypes.has(String(event.eventType))) {
      throw new Error('/private/runtime/audit failed with token=do-not-leak');
    }
    const requestContext = currentAdminRequestContext();
    auditEvents.push({
      ...event,
      actorId: requestContext?.principal.id,
      requestId: requestContext?.requestId,
    });
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
  uploadCustomUiArchive,
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

function customUiZip(label: string, filename = `${label}.zip`) {
  const archive = zipSync({
    [`${label}/index.html`]: strToU8(`<h1>${label}</h1>`),
    [`${label}/assets/app.js`]: strToU8(`window.theme = '${label}';`),
    [`${label}/assets/site.css`]: strToU8(`body { --theme: ${label}; }`),
  }, { level: 9 });
  return new File([Uint8Array.from(archive).buffer], filename, { type: 'application/zip' });
}

function currentManifest() {
  const config = activeConfig();
  if (!config?.value) throw new Error('Expected an active Custom UI manifest');
  return config.value;
}

function currentAssetsId() {
  return String(currentManifest().assets_id || '');
}

function currentObjectKeys() {
  const files = currentManifest().files;
  if (!Array.isArray(files)) return [];
  return files.map(file => String((file as Record<string, unknown>).object_key));
}

function cleanupQueue() {
  return configRecords.get(configStorageKey('custom_ui_assets', 'cleanup'))?.value || null;
}

function cleanupObjectKey(index: number) {
  const assetsId = `00000000-0000-4000-8000-${index.toString(16).padStart(12, '0')}`;
  return `versions/${assetsId}/${'a'.repeat(64)}/assets/stale-${index}.txt`;
}

function storedAssetText(assetPath: string) {
  const files = currentManifest().files as Array<Record<string, unknown>>;
  const file = files.find(candidate => candidate.path === assetPath);
  const content = file ? storedObjects.get(String(file.object_key)) : null;
  if (!content) throw new Error(`Expected stored Custom UI asset: ${assetPath}`);
  return new TextDecoder().decode(content);
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
  rejectNextActiveManifestWrite = false;
  rejectPairResponseAfterCommit = false;
  failedUploadSuffix = '';
  lateWriteAfterRejectSuffix = '';
  rejectObjectDeletion = false;
  rejectDeletionAfterRemovingObjects = false;
  deleteLeavesStoredObjects = false;
  rejectNextAuditClearWrite = false;
  storedObjects.clear();
  operationOrder.length = 0;
  auditEvents.length = 0;
  auditEventsByIdempotencyKey.clear();
  rejectedAuditEventTypes.clear();
  unknownAuditEventTypes.clear();
  uploadResponseGate = null;
  allUploadResponsesBlocked = null;
  blockedUploadResponses = 0;
  expectedBlockedUploadResponses = 3;
  uploadWriteGate = null;
  allUploadWritesBlocked = null;
  blockedUploadWrites = 0;
  lateUploadWriteGate = null;
  lateUploadWriteCompleted = null;
  deactivationWriteGate = null;
  deactivationWriteBlocked = null;
  pairCommitApplied = null;
  pairCommitResponseGate = null;
  auditReadBackGate = null;
  auditReadBackBlocked = null;
  blockedAuditReadBacks = 0;
  for (const method of Object.values(tenantConfigRepository)) method.mockClear();
  for (const method of Object.values(storageAdapter)) method.mockClear();
});

describe('Custom UI durable activation', () => {
  it('stages every immutable object before activating one manifest', async () => {
    const uploaded = await uploadCustomUiArchive(customUiZip('ocean'));

    expect(uploaded.file_count).toBe(3);
    expect(activeConfig()?.enabled).toBe(true);
    expect(currentObjectKeys()).toHaveLength(3);
    expect(currentObjectKeys().every(key => key.includes(uploaded.assets_id))).toBe(true);
    expect([...storedObjects.keys()].sort()).toEqual([...currentObjectKeys()].sort());
    const activationIndex = operationOrder.findIndex(entry => entry === 'activate:true');
    expect(operationOrder.slice(0, activationIndex).filter(entry => !entry.startsWith('config:'))
      .every(entry => entry.startsWith('upload:'))).toBe(true);

    expect(storedAssetText('assets/app.js')).toContain("window.theme = 'ocean'");
  });

  it('fails closed before accepting a multipart ZIP through the management route', async () => {
    const form = new FormData();
    form.append('file', customUiZip('multipart'));
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
    expect(storageAdapter.createStorageBucket).toHaveBeenCalledTimes(0);
    expect(storageAdapter.uploadFile).toHaveBeenCalledTimes(0);
    expect(tenantConfigRepository.compareAndSwapTenantConfig).toHaveBeenCalledTimes(0);
  });

  it('keeps an existing manifest inert on hosted and public routes', async () => {
    await uploadCustomUiArchive(customUiZip('hosted'));
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

  it('keeps the prior version active when staging fails and hides internal errors', async () => {
    await uploadCustomUiArchive(customUiZip('stable'));
    const stableAssetsId = currentAssetsId();
    failedUploadSuffix = '/assets/site.css';

    try {
      await uploadCustomUiArchive(customUiZip('broken', '/private/secret-name.zip'));
      throw new Error('upload unexpectedly succeeded');
    } catch (error) {
      expect((error as { code?: string }).code).toBe('custom_ui_storage_unavailable');
      expect((error as Error).message).not.toContain('/private');
      expect((error as Error).message).not.toContain('token=');
      expect((error as Error).message).not.toContain('secret-name.zip');
    }

    expect(currentAssetsId()).toBe(stableAssetsId);
    expect(storedAssetText('index.html')).toContain('stable');
    expect([...storedObjects.keys()].every(key => key.includes(stableAssetsId))).toBe(true);
  });

  it('retains an uncertain upload through cleanup read-back and removes a late Storage write', async () => {
    lateWriteAfterRejectSuffix = '/assets/site.css';
    lateUploadWriteGate = deferred<void>();
    lateUploadWriteCompleted = deferred<void>();

    await expect(uploadCustomUiArchive(customUiZip('late-after-reject'))).rejects.toMatchObject({
      status: 503,
      code: 'custom_ui_storage_unavailable',
    });
    const pendingBatch = (cleanupQueue()?.batches as Array<Record<string, unknown>>)[0];
    expect(pendingBatch).toMatchObject({ state: 'upload_outcome_unknown' });
    expect(storedObjects.size).toBe(0);
    const immediateCleanupCalls = storageAdapter.deleteFile.mock.calls.length;

    lateUploadWriteGate.resolve();
    await lateUploadWriteCompleted.promise;
    expect(storedObjects.size).toBe(1);
    await expect(deleteCustomUiAssets()).resolves.toEqual({ status: 'deleted', deleted_file_count: 0 });
    expect((cleanupQueue()?.batches as unknown[])).toHaveLength(1);
    expect(storageAdapter.deleteFile.mock.calls.length).toBe(immediateCleanupCalls);

    pendingBatch.outcome_unknown_at = '2000-01-01T00:00:00.000Z';
    await expect(deleteCustomUiAssets()).resolves.toEqual({ status: 'deleted', deleted_file_count: 0 });
    expect(storedObjects.size).toBe(0);
    expect((cleanupQueue()?.batches as unknown[])).toEqual([]);
    expect(storageAdapter.deleteFile.mock.calls.length).toBe(immediateCleanupCalls + 1);
  });

  it('refuses to persist assets when the Storage bucket is public', async () => {
    storageAdapter.getStorageBucket.mockImplementationOnce(async () => ({
      id: 'supauth-custom-ui',
      public: true,
      file_size_limit: 2 * 1024 * 1024,
    }));

    await expect(uploadCustomUiArchive(customUiZip('unsafe-bucket'))).rejects.toMatchObject({
      status: 503,
      code: 'custom_ui_storage_misconfigured',
    });
    expect(activeConfig()).toBeNull();
    expect(storageAdapter.uploadFile).toHaveBeenCalledTimes(0);
  });

  it('refuses a private Storage bucket without a bounded file size', async () => {
    storageAdapter.getStorageBucket.mockImplementationOnce(async () => ({
      id: 'supauth-custom-ui',
      public: false,
    }));

    await expect(uploadCustomUiArchive(customUiZip('unbounded-bucket'))).rejects.toMatchObject({
      status: 503,
      code: 'custom_ui_storage_misconfigured',
    });
    expect(activeConfig()).toBeNull();
    expect(storageAdapter.uploadFile).toHaveBeenCalledTimes(0);
  });

  it('keeps the prior version active when compare-and-swap detects a concurrent change', async () => {
    await uploadCustomUiArchive(customUiZip('stable'));
    const stableAssetsId = currentAssetsId();
    rejectNextActiveManifestWrite = true;

    await expect(uploadCustomUiArchive(customUiZip('racing'))).rejects.toMatchObject({
      status: 409,
      code: 'custom_ui_changed_retry',
    });
    expect(currentAssetsId()).toBe(stableAssetsId);
    expect([...storedObjects.keys()].every(key => key.includes(stableAssetsId))).toBe(true);
  });

  it('does not activate objects after stale cleanup wins their reservation', async () => {
    uploadResponseGate = deferred<void>();
    allUploadResponsesBlocked = deferred<void>();
    const upload = uploadCustomUiArchive(customUiZip('stale-race'));
    await allUploadResponsesBlocked.promise;
    const batch = (cleanupQueue()?.batches as Array<Record<string, unknown>>)[0];
    batch.created_at = '2000-01-01T00:00:00.000Z';

    await expect(deleteCustomUiAssets()).resolves.toEqual({ status: 'deleted', deleted_file_count: 0 });
    uploadResponseGate.resolve();

    await expect(upload).rejects.toMatchObject({ status: 409, code: 'custom_ui_changed_retry' });
    expect(activeConfig()).toBeNull();
    expect(storedObjects.size).toBe(0);
  });

  it('removes objects that become visible only after stale cleanup read-back', async () => {
    uploadWriteGate = deferred<void>();
    allUploadWritesBlocked = deferred<void>();
    const upload = uploadCustomUiArchive(customUiZip('late-visible-race'));
    await allUploadWritesBlocked.promise;
    const batch = (cleanupQueue()?.batches as Array<Record<string, unknown>>)[0];
    batch.created_at = '2000-01-01T00:00:00.000Z';

    await expect(deleteCustomUiAssets()).resolves.toEqual({ status: 'deleted', deleted_file_count: 0 });
    uploadWriteGate.resolve();

    await expect(upload).rejects.toMatchObject({ status: 409, code: 'custom_ui_changed_retry' });
    expect(activeConfig()).toBeNull();
    expect(storedObjects.size).toBe(0);
    expect((cleanupQueue()?.batches as unknown[])).toEqual([]);
  });

  it('allows only one of two concurrently staged uploads to activate', async () => {
    uploadResponseGate = deferred<void>();
    allUploadResponsesBlocked = deferred<void>();
    expectedBlockedUploadResponses = 6;
    const firstUpload = uploadCustomUiArchive(customUiZip('double-a'));
    const secondUpload = uploadCustomUiArchive(customUiZip('double-b'));
    await allUploadResponsesBlocked.promise;
    uploadResponseGate.resolve();

    const outcomes = await Promise.allSettled([firstUpload, secondUpload]);
    const fulfilled = outcomes.filter(outcome => outcome.status === 'fulfilled');
    const rejected = outcomes.filter(outcome => outcome.status === 'rejected');
    expect(fulfilled).toHaveLength(1);
    expect(rejected).toHaveLength(1);
    expect((rejected[0] as PromiseRejectedResult).reason).toMatchObject({
      status: 409,
      code: 'custom_ui_changed_retry',
    });
    const winningAssetsId = String((fulfilled[0] as PromiseFulfilledResult<{ assets_id: string }>).value.assets_id);
    expect(currentAssetsId()).toBe(winningAssetsId);
    expect([...storedObjects.keys()].every(key => key.includes(winningAssetsId))).toBe(true);
    expect((cleanupQueue()?.batches as unknown[])).toEqual([]);
  });

  it('keeps deletion authoritative when it commits before a replacement upload', async () => {
    await uploadCustomUiArchive(customUiZip('delete-wins-base'));
    uploadResponseGate = deferred<void>();
    allUploadResponsesBlocked = deferred<void>();
    const replacement = uploadCustomUiArchive(customUiZip('delete-wins-replacement'));
    await allUploadResponsesBlocked.promise;

    await expect(deleteCustomUiAssets()).resolves.toEqual({ status: 'deleted', deleted_file_count: 3 });
    uploadResponseGate.resolve();

    await expect(replacement).rejects.toMatchObject({ status: 409, code: 'custom_ui_changed_retry' });
    expect(activeConfig()).toBeNull();
    expect(storedObjects.size).toBe(0);
  });

  it('keeps an activated replacement when it commits before deletion', async () => {
    await uploadCustomUiArchive(customUiZip('upload-wins-base'));
    deactivationWriteGate = deferred<void>();
    deactivationWriteBlocked = deferred<void>();
    const deletion = deleteCustomUiAssets();
    await deactivationWriteBlocked.promise;

    const replacement = await uploadCustomUiArchive(customUiZip('upload-wins-replacement'));
    deactivationWriteGate.resolve();

    await expect(deletion).rejects.toMatchObject({ status: 409, code: 'custom_ui_changed_retry' });
    expect(currentAssetsId()).toBe(replacement.assets_id);
    expect([...storedObjects.keys()].every(key => key.includes(replacement.assets_id))).toBe(true);
    expect(storedAssetText('index.html')).toContain('upload-wins-replacement');
  });

  it('persists a CAS loser as an orphan batch and retries it on the next mutation', async () => {
    await uploadCustomUiArchive(customUiZip('stable'));
    const stableAssetsId = currentAssetsId();
    rejectNextActiveManifestWrite = true;
    rejectObjectDeletion = true;

    await expect(uploadCustomUiArchive(customUiZip('loser'))).rejects.toMatchObject({
      status: 409,
      code: 'custom_ui_changed_retry',
    });
    const pendingBatches = (cleanupQueue()?.batches as Array<Record<string, unknown>> | undefined) || [];
    expect(pendingBatches).toHaveLength(1);
    expect(pendingBatches[0].state).toBe('pending');
    expect((pendingBatches[0].object_keys as unknown[])).toHaveLength(3);
    expect(currentAssetsId()).toBe(stableAssetsId);

    rejectObjectDeletion = false;
    const recovered = await uploadCustomUiArchive(customUiZip('recovered'));
    expect((cleanupQueue()?.batches as unknown[])).toEqual([]);
    expect([...storedObjects.keys()].every(key => key.includes(recovered.assets_id))).toBe(true);
  });

  it('persists obsolete keys when cleanup fails and clears them on a later mutation', async () => {
    await uploadCustomUiArchive(customUiZip('first'));
    rejectObjectDeletion = true;
    const second = await uploadCustomUiArchive(customUiZip('second'));

    expect(second.cleanup_pending).toBe(true);
    expect((currentManifest().cleanup_pending_object_keys as unknown[]).length).toBe(3);
    expect(storedAssetText('index.html')).toContain('second');

    rejectObjectDeletion = false;
    const third = await uploadCustomUiArchive(customUiZip('third'));
    expect(third.cleanup_pending).toBe(false);
    expect(currentManifest().cleanup_pending_object_keys).toEqual([]);
    expect([...storedObjects.keys()].every(key => key.includes(third.assets_id))).toBe(true);
  });

  it('rejects a cleanup backlog before staging another version', async () => {
    await uploadCustomUiArchive(customUiZip('backlog'));
    currentManifest().cleanup_pending_object_keys = Array.from(
      { length: CUSTOM_UI_LIMITS.maxCleanupKeys },
      (_, index) => cleanupObjectKey(index),
    );
    storageAdapter.uploadFile.mockClear();

    await expect(uploadCustomUiArchive(customUiZip('blocked'))).rejects.toMatchObject({
      status: 503,
      code: 'custom_ui_cleanup_backlog',
    });
    expect(storageAdapter.uploadFile).toHaveBeenCalledTimes(0);
    expect(currentAssetsId()).not.toBe('');
  });

  it('does not read or serve stored bytes from the public route', async () => {
    await uploadCustomUiArchive(customUiZip('verified'));
    const indexKey = currentObjectKeys().find(key => key.endsWith('/index.html'))!;
    storedObjects.set(indexKey, strToU8('<h1>tampered</h1>'));
    storageAdapter.downloadFile.mockClear();

    const response = await customUiApp.handle(new Request(
      'https://auth.example.test/v1/public/custom-ui/index.html',
    ));
    expect(response.status).toBe(404);
    expect(storageAdapter.downloadFile).toHaveBeenCalledTimes(0);
  });

  it('records only asset identifiers, counts, hashes, and cleanup state in upload audit', async () => {
    const uploaded = await uploadCustomUiArchive(customUiZip('audit', 'customer-secret-name.zip'));
    const audit = auditEvents.at(-1)!;
    expect(audit.resourceId).toBe(uploaded.assets_id);
    expect(audit.details).toEqual({
      event_id: expect.stringMatching(/^[0-9a-f-]{36}$/),
      file_count: 3,
      content_sha256: uploaded.content_sha256,
      cleanup_pending: false,
    });
    expect(JSON.stringify(audit)).not.toContain('customer-secret-name.zip');
    expect(JSON.stringify(audit)).not.toContain('index.html');
  });

  it('returns an explicit accepted state and persists the event when upload audit delivery fails', async () => {
    rejectedAuditEventTypes.add('sign_in_experience.custom_ui_uploaded');
    const response = await uploadCustomUiArchive(customUiZip('audit-pending'));

    expect(response).toMatchObject({ status: 'activated', audit_pending: true });
    expect(currentManifest().audit_pending_event).toMatchObject({
      event_type: 'sign_in_experience.custom_ui_uploaded',
      delivery_state: 'ready',
    });
    expect(storedAssetText('index.html')).toContain('audit-pending');

    storageAdapter.uploadFile.mockClear();
    await expect(uploadCustomUiArchive(customUiZip('blocked-by-audit'))).rejects.toMatchObject({
      status: 503,
      code: 'custom_ui_audit_pending',
    });
    expect(storageAdapter.uploadFile).toHaveBeenCalledTimes(0);

    rejectedAuditEventTypes.clear();
    await uploadCustomUiArchive(customUiZip('audit-recovered'));
    expect(currentManifest().audit_pending_event).toBeNull();
    expect(auditEvents.some(event => event.eventType === 'sign_in_experience.custom_ui_uploaded')).toBe(true);
  });

  it('replays a pending audit with the original admin and request identity', async () => {
    rejectedAuditEventTypes.add('sign_in_experience.custom_ui_uploaded');
    await withAdminRequestContext({
      requestId: 'request-a',
      principal: {
        id: 'admin-a',
        email: 'admin-a@example.test',
        name: 'Admin A',
        roles: [],
        permissions: ['security.manage'],
        authorization_source: 'rbac_projection',
      },
    }, () => uploadCustomUiArchive(customUiZip('audit-owner-a')));
    const eventId = String((currentManifest().audit_pending_event as Record<string, unknown>).event_id);
    rejectedAuditEventTypes.clear();

    await withAdminRequestContext({
      requestId: 'request-b',
      principal: {
        id: 'admin-b',
        email: 'admin-b@example.test',
        name: 'Admin B',
        roles: [],
        permissions: ['security.manage'],
        authorization_source: 'rbac_projection',
      },
    }, () => uploadCustomUiArchive(customUiZip('audit-owner-b')));

    const replayed = auditEvents.find((event) => (
      (event.details as Record<string, unknown> | undefined)?.event_id === eventId
    ));
    expect(replayed).toMatchObject({ actorId: 'admin-a', requestId: 'request-a' });
  });

  it('clears a delivered audit on retry without posting the same event again', async () => {
    rejectNextAuditClearWrite = true;
    const first = await uploadCustomUiArchive(customUiZip('audit-clear-retry'));
    const pendingEvent = currentManifest().audit_pending_event as Record<string, unknown>;
    const eventId = String(pendingEvent.event_id);

    expect(first.audit_pending).toBe(true);
    expect(pendingEvent.delivery_state).toBe('delivered');
    expect(auditEvents.filter(event => (
      (event.details as Record<string, unknown> | undefined)?.event_id === eventId
    ))).toHaveLength(1);

    await uploadCustomUiArchive(customUiZip('after-audit-clear-retry'));
    expect(auditEvents.filter(event => (
      (event.details as Record<string, unknown> | undefined)?.event_id === eventId
    ))).toHaveLength(1);
  });

  it('continues from the authoritative manifest after a lost pair-commit response', async () => {
    rejectPairResponseAfterCommit = true;
    pairCommitApplied = deferred<void>();
    pairCommitResponseGate = deferred<void>();
    const firstUpload = uploadCustomUiArchive(customUiZip('lost-pair-response'));
    await pairCommitApplied.promise;
    const eventId = String((currentManifest().audit_pending_event as Record<string, unknown>).event_id);

    storageAdapter.getStorageBucket.mockImplementationOnce(async () => ({
      id: 'supauth-custom-ui',
      public: true,
      file_size_limit: 2 * 1024 * 1024,
    }));
    await expect(uploadCustomUiArchive(customUiZip('concurrent-audit-clear'))).rejects.toMatchObject({
      status: 503,
      code: 'custom_ui_storage_misconfigured',
    });
    expect(currentManifest().audit_pending_event).toBeNull();

    pairCommitResponseGate.resolve();
    await expect(firstUpload).resolves.toMatchObject({ status: 'activated', audit_pending: false });
    expect(currentManifest().audit_pending_event).toBeNull();
    expect(auditEvents.filter(event => (
      (event.details as Record<string, unknown> | undefined)?.event_id === eventId
    ))).toHaveLength(1);
  });

  it('fails closed after an audit response is lost and never reposts the event', async () => {
    unknownAuditEventTypes.add('sign_in_experience.custom_ui_uploaded');
    const first = await uploadCustomUiArchive(customUiZip('audit-response-lost'));
    const pendingEvent = currentManifest().audit_pending_event as Record<string, unknown>;
    const eventId = String(pendingEvent.event_id);

    expect(first.audit_pending).toBe(true);
    expect(pendingEvent.delivery_state).toBe('delivery_unknown');
    await expect(uploadCustomUiArchive(customUiZip('blocked-after-unknown'))).rejects.toMatchObject({
      status: 503,
      code: 'custom_ui_audit_pending',
    });
    expect(auditEvents.filter(event => (
      (event.details as Record<string, unknown> | undefined)?.event_id === eventId
    ))).toHaveLength(1);
  });

  it('recovers a stale delivery_unknown event from one authoritative audit read-back', async () => {
    unknownAuditEventTypes.add('sign_in_experience.custom_ui_uploaded');
    const first = await uploadCustomUiArchive(customUiZip('audit-unknown-recovery'));
    const pendingEvent = currentManifest().audit_pending_event as Record<string, unknown>;
    const eventId = String(pendingEvent.event_id);

    expect(first.audit_pending).toBe(true);
    expect(pendingEvent.delivery_state).toBe('delivery_unknown');
    activeConfig()!.updatedAt = new Date(0);
    unknownAuditEventTypes.clear();

    await uploadCustomUiArchive(customUiZip('audit-after-unknown-recovery'));

    expect(currentManifest().audit_pending_event).toBeNull();
    expect(auditEvents.filter(event => (
      (event.details as Record<string, unknown> | undefined)?.event_id === eventId
    ))).toHaveLength(1);
  });

  it('recovers a stale sending event after a crash following platform commit', async () => {
    unknownAuditEventTypes.add('sign_in_experience.custom_ui_uploaded');
    await uploadCustomUiArchive(customUiZip('audit-sending-recovery'));
    unknownAuditEventTypes.clear();
    const pendingEvent = currentManifest().audit_pending_event as Record<string, unknown>;
    const eventId = String(pendingEvent.event_id);
    pendingEvent.delivery_state = 'sending';
    activeConfig()!.updatedAt = new Date(0);

    await uploadCustomUiArchive(customUiZip('audit-after-sending-recovery'));

    expect(currentManifest().audit_pending_event).toBeNull();
    expect(auditEvents.filter(event => (
      (event.details as Record<string, unknown> | undefined)?.event_id === eventId
    ))).toHaveLength(1);
  });

  it('keeps stale delivery_unknown pending when authoritative read-back has no event', async () => {
    unknownAuditEventTypes.add('sign_in_experience.custom_ui_uploaded');
    await uploadCustomUiArchive(customUiZip('audit-unknown-no-readback'));
    unknownAuditEventTypes.clear();
    auditEvents.length = 0;
    auditEventsByIdempotencyKey.clear();
    activeConfig()!.updatedAt = new Date(0);
    storageAdapter.uploadFile.mockClear();

    await expect(uploadCustomUiArchive(customUiZip('audit-unknown-still-pending'))).rejects.toMatchObject({
      status: 503,
      code: 'custom_ui_audit_pending',
    });

    expect((currentManifest().audit_pending_event as Record<string, unknown>).delivery_state).toBe('delivery_unknown');
    expect(storageAdapter.uploadFile).toHaveBeenCalledTimes(0);
  });

  it('keeps stale sending pending when a pre-delivery crash left no audit event', async () => {
    rejectedAuditEventTypes.add('sign_in_experience.custom_ui_uploaded');
    await uploadCustomUiArchive(customUiZip('audit-sending-no-readback'));
    rejectedAuditEventTypes.clear();
    const pendingEvent = currentManifest().audit_pending_event as Record<string, unknown>;
    pendingEvent.delivery_state = 'sending';
    activeConfig()!.updatedAt = new Date(0);
    storageAdapter.uploadFile.mockClear();

    await expect(uploadCustomUiArchive(customUiZip('audit-sending-still-pending'))).rejects.toMatchObject({
      status: 503,
      code: 'custom_ui_audit_pending',
    });

    expect(pendingEvent.delivery_state).toBe('sending');
    expect(auditEvents).toHaveLength(0);
    expect(storageAdapter.uploadFile).toHaveBeenCalledTimes(0);
  });

  it('allows one concurrent CAS winner to clear a uniquely read-back event', async () => {
    unknownAuditEventTypes.add('sign_in_experience.custom_ui_uploaded');
    await uploadCustomUiArchive(customUiZip('audit-concurrent-readback'));
    unknownAuditEventTypes.clear();
    const eventId = String((currentManifest().audit_pending_event as Record<string, unknown>).event_id);
    activeConfig()!.updatedAt = new Date(0);
    auditReadBackGate = deferred<void>();
    auditReadBackBlocked = deferred<void>();

    const first = uploadCustomUiArchive(customUiZip('audit-concurrent-a'));
    const second = uploadCustomUiArchive(customUiZip('audit-concurrent-b'));
    await auditReadBackBlocked.promise;
    auditReadBackGate.resolve();
    const outcomes = await Promise.allSettled([first, second]);

    expect(outcomes.filter(outcome => outcome.status === 'fulfilled')).toHaveLength(1);
    const rejected = outcomes.find(outcome => outcome.status === 'rejected');
    expect(rejected && rejected.status === 'rejected' ? rejected.reason : null).toMatchObject({
      status: 503,
      code: 'custom_ui_audit_pending',
    });
    expect(auditEvents.filter(event => (
      (event.details as Record<string, unknown> | undefined)?.event_id === eventId
    ))).toHaveLength(1);
  });
});

describe('Custom UI durable deletion', () => {
  it('deactivates, recursively deletes every managed object, and reads back 404', async () => {
    await uploadCustomUiArchive(customUiZip('delete-me'));
    const objectKeys = currentObjectKeys();

    const deleted = await deleteCustomUiAssets();

    expect(deleted).toEqual({ status: 'deleted', deleted_file_count: 3 });
    expect(activeConfig()).toBeNull();
    expect(objectKeys.every(key => !storedObjects.has(key))).toBe(true);
  });

  it('normalizes a disabled active manifest as blocked and keeps it deletable', async () => {
    await uploadCustomUiArchive(customUiZip('disabled-active'));
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
    await uploadCustomUiArchive(customUiZip('disabled-rejected-audit'));
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
    unknownAuditEventTypes.add('sign_in_experience.custom_ui_uploaded');
    await uploadCustomUiArchive(customUiZip('disabled-unknown-audit'));
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
    unknownAuditEventTypes.clear();
    await expect(deleteCustomUiAssets()).resolves.toEqual({
      status: 'deleted',
      deleted_file_count: 3,
    });
    expect(invalidActiveManifestWriteCount()).toBe(0);
    expect(activeConfig()).toBeNull();
  });

  it('keeps a disabled cleanup manifest after object deletion fails and succeeds on retry', async () => {
    await uploadCustomUiArchive(customUiZip('retry-delete'));
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
    await uploadCustomUiArchive(customUiZip('partial-delete'));
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
    await uploadCustomUiArchive(customUiZip('lost-delete-response'));
    rejectDeletionAfterRemovingObjects = true;

    await expect(deleteCustomUiAssets()).resolves.toEqual({ status: 'deleted', deleted_file_count: 3 });
    expect(activeConfig()).toBeNull();
    expect(storedObjects.size).toBe(0);
  });

  it('retains a disabled manifest until the pending delete audit is delivered', async () => {
    await uploadCustomUiArchive(customUiZip('delete-audit-pending'));
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
    await uploadCustomUiArchive(customUiZip('deleted-audit-pending'));
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
