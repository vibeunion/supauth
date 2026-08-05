import { createHash } from 'node:crypto';
import path from 'node:path';

export const CUSTOM_UI_LIMITS = Object.freeze({
  maxFileBytes: 2 * 1024 * 1024,
  maxTotalBytes: 8 * 1024 * 1024,
  maxFiles: 100,
  maxDepth: 8,
  maxPathBytes: 512,
  maxSegmentBytes: 128,
  maxCleanupKeys: 1000,
  maxCleanupBatches: 100,
});

export const CUSTOM_UI_STORAGE_BUCKET = 'supauth-custom-ui';
export const CUSTOM_UI_CONFIG_TYPE = 'custom_ui_assets';
export const CUSTOM_UI_CONFIG_KEY = 'active';
export const CUSTOM_UI_CLEANUP_CONFIG_KEY = 'cleanup';

const CUSTOM_UI_PATH_ROOT = path.resolve('/supauth-custom-ui-assets');
const SHA256_PATTERN = /^[a-f0-9]{64}$/;
const ASSETS_ID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const AUDIT_ACTOR_ID_PATTERN = /^[A-Za-z0-9@._:+/-]{1,200}$/;
const AUDIT_REQUEST_ID_PATTERN = /^[A-Za-z0-9._:/+-]{1,200}$/;
const ADMIN_AUTHORIZATION_SOURCES = new Set(['development_token', 'admin_allowlist', 'rbac_projection']);
const AUDIT_DELIVERY_STATES = new Set(['ready', 'sending', 'delivered', 'delivery_unknown']);
const CUSTOM_UI_AUDIT_EVENT_TYPES = new Set<CustomUiAuditEventType>([
  'sign_in_experience.custom_ui_uploaded',
  'sign_in_experience.custom_ui_delete_pending',
  'sign_in_experience.custom_ui_deleted',
]);

const ASSET_CONTENT_TYPES = new Map([
  ['.css', 'text/css; charset=utf-8'],
  ['.gif', 'image/gif'],
  ['.html', 'text/html; charset=utf-8'],
  ['.ico', 'image/x-icon'],
  ['.jpeg', 'image/jpeg'],
  ['.jpg', 'image/jpeg'],
  ['.js', 'text/javascript; charset=utf-8'],
  ['.json', 'application/json; charset=utf-8'],
  ['.mjs', 'text/javascript; charset=utf-8'],
  ['.otf', 'font/otf'],
  ['.png', 'image/png'],
  ['.svg', 'image/svg+xml'],
  ['.ttf', 'font/ttf'],
  ['.txt', 'text/plain; charset=utf-8'],
  ['.webp', 'image/webp'],
  ['.woff', 'font/woff'],
  ['.woff2', 'font/woff2'],
]);

const FORBIDDEN_FILENAMES = new Set([
  '.assets-meta.json',
  '.env',
  '.htaccess',
  'bun.lock',
  'bun.lockb',
  'credentials.json',
  'package-lock.json',
  'package.json',
  'pnpm-lock.yaml',
  'secrets.json',
  'yarn.lock',
]);
const FORBIDDEN_EXTENSIONS = new Set([
  '.crt', '.db', '.jks', '.key', '.keystore', '.map', '.p12', '.pem', '.pfx', '.sqlite',
]);

export interface CustomUiManifestFile {
  path: string;
  object_key: string;
  sha256: string;
  size: number;
  content_type: string;
}

export type CustomUiAuditEventType =
  | 'sign_in_experience.custom_ui_uploaded'
  | 'sign_in_experience.custom_ui_delete_pending'
  | 'sign_in_experience.custom_ui_deleted';

export interface CustomUiAuditPendingEvent {
  event_id: string;
  event_type: CustomUiAuditEventType;
  created_at: string;
  actor_id: string;
  actor_type: 'admin';
  request_id: string;
  authorization_source: 'development_token' | 'admin_allowlist' | 'rbac_projection';
  delivery_state: 'ready' | 'sending' | 'delivered' | 'delivery_unknown';
  file_count: number;
  content_sha256: string;
  cleanup_pending: boolean;
}

export interface CustomUiManifest {
  schema_version: 1;
  assets_id: string;
  content_sha256: string;
  uploaded_at: string;
  files: CustomUiManifestFile[];
  cleanup_pending_object_keys: string[];
  lifecycle_state: 'active' | 'cleanup_pending' | 'objects_deleted';
  audit_pending_event: CustomUiAuditPendingEvent | null;
}

export interface CustomUiStatusFile {
  path: string;
  sha256: string;
  size: number;
  content_type: string;
}

export interface CustomUiStatus {
  status: 'disabled' | 'blocked_unsafe_origin' | 'cleanup_pending';
  configured: boolean;
  enabled: boolean;
  lifecycle_state: CustomUiManifest['lifecycle_state'] | null;
  assets_id: string | null;
  content_sha256: string | null;
  uploaded_at: string | null;
  file_count: number;
  files: CustomUiStatusFile[];
  cleanup_pending: boolean;
  audit_pending: boolean;
}

export interface CustomUiCleanupBatch {
  assets_id: string;
  created_at: string;
  state: 'reserved' | 'pending' | 'upload_outcome_unknown' | 'cleanup_claimed';
  lease_token?: string;
  claim_token?: string;
  claimed_at?: string;
  outcome_unknown_at?: string;
  object_keys: string[];
}

export interface CustomUiCleanupQueue {
  schema_version: 1;
  batches: CustomUiCleanupBatch[];
}

function decodedAssetPath(rawPath: string): string | null {
  let decoded = rawPath;
  try {
    for (let pass = 0; pass < 4; pass += 1) {
      const next = decodeURIComponent(decoded);
      if (next === decoded) break;
      decoded = next;
    }
  } catch {
    return null;
  }
  return /%[0-9a-f]{2}/i.test(decoded) ? null : decoded;
}

export function normalizeCustomUiAssetPath(rawPath: string): string | null {
  const decoded = decodedAssetPath(rawPath);
  if (!decoded || decoded.includes('\0') || decoded.includes('\\')) return null;
  if ([...decoded].some(character => {
    const codePoint = character.codePointAt(0)!;
    return codePoint <= 0x1f || (codePoint >= 0x7f && codePoint <= 0x9f);
  })) return null;
  if (path.posix.isAbsolute(decoded) || path.win32.isAbsolute(decoded)) return null;
  const segments = decoded.replace(/\/+$/, '').split('/');
  if (segments.some(segment => !segment || segment === '.' || segment === '..')) return null;
  const encoder = new TextEncoder();
  if (encoder.encode(decoded).length > CUSTOM_UI_LIMITS.maxPathBytes) return null;
  if (segments.some(segment => encoder.encode(segment).length > CUSTOM_UI_LIMITS.maxSegmentBytes)) return null;
  const resolved = path.resolve(CUSTOM_UI_PATH_ROOT, ...segments);
  const relative = path.relative(CUSTOM_UI_PATH_ROOT, resolved);
  if (!relative || relative.startsWith(`..${path.sep}`) || path.isAbsolute(relative)) return null;
  return relative.split(path.sep).join('/');
}

function contentTypeForPath(assetPath: string): string | null {
  return ASSET_CONTENT_TYPES.get(path.posix.extname(assetPath).toLowerCase()) || null;
}

function forbiddenAssetPath(assetPath: string): boolean {
  const segments = assetPath.split('/');
  const basename = segments.at(-1)?.toLowerCase() || '';
  return segments.some(segment => segment.startsWith('.'))
    || FORBIDDEN_FILENAMES.has(basename)
    || FORBIDDEN_EXTENSIONS.has(path.posix.extname(basename));
}

function contentSha256(
  files: Array<Pick<CustomUiManifestFile, 'path' | 'sha256' | 'size'>>,
): string {
  const hash = createHash('sha256');
  for (const file of files) hash.update(`${file.path}\0${file.sha256}\0${file.size}\n`);
  return hash.digest('hex');
}

export function customUiObjectKey(assetsId: string, file: Pick<CustomUiManifestFile, 'path' | 'sha256'>) {
  return `versions/${assetsId}/${file.sha256}/${file.path}`;
}

function validManifestFile(file: unknown, assetsId: string): file is CustomUiManifestFile {
  if (!file || typeof file !== 'object' || Array.isArray(file)) return false;
  const candidate = file as Record<string, unknown>;
  const normalizedPath = typeof candidate.path === 'string' ? normalizeCustomUiAssetPath(candidate.path) : null;
  if (!normalizedPath || normalizedPath !== candidate.path || forbiddenAssetPath(normalizedPath)) return false;
  if (normalizedPath.split('/').length > CUSTOM_UI_LIMITS.maxDepth) return false;
  if (typeof candidate.sha256 !== 'string' || !SHA256_PATTERN.test(candidate.sha256)) return false;
  if (!Number.isInteger(candidate.size) || Number(candidate.size) < 0 || Number(candidate.size) > CUSTOM_UI_LIMITS.maxFileBytes) return false;
  if (candidate.content_type !== contentTypeForPath(normalizedPath)) return false;
  return candidate.object_key === customUiObjectKey(assetsId, {
    path: normalizedPath,
    sha256: candidate.sha256,
  });
}

function validCleanupKey(objectKey: unknown): objectKey is string {
  if (typeof objectKey !== 'string' || objectKey.length > 2048) return false;
  const match = objectKey.match(/^versions\/([0-9a-f-]+)\/([a-f0-9]{64})\/(.+)$/i);
  if (!match || !ASSETS_ID_PATTERN.test(match[1])) return false;
  const normalized = normalizeCustomUiAssetPath(match[3]);
  return normalized === match[3]
    && normalized.split('/').length <= CUSTOM_UI_LIMITS.maxDepth
    && !forbiddenAssetPath(normalized)
    && Boolean(contentTypeForPath(normalized));
}

function validAuditPendingEvent(
  event: unknown,
  manifest: Pick<CustomUiManifest, 'assets_id' | 'content_sha256' | 'files'>,
): event is CustomUiAuditPendingEvent {
  if (!event || typeof event !== 'object' || Array.isArray(event)) return false;
  const candidate = event as Record<string, unknown>;
  return typeof candidate.event_id === 'string'
    && ASSETS_ID_PATTERN.test(candidate.event_id)
    && typeof candidate.event_type === 'string'
    && CUSTOM_UI_AUDIT_EVENT_TYPES.has(candidate.event_type as CustomUiAuditEventType)
    && typeof candidate.created_at === 'string'
    && Number.isFinite(Date.parse(candidate.created_at))
    && typeof candidate.actor_id === 'string'
    && AUDIT_ACTOR_ID_PATTERN.test(candidate.actor_id)
    && candidate.actor_type === 'admin'
    && typeof candidate.request_id === 'string'
    && AUDIT_REQUEST_ID_PATTERN.test(candidate.request_id)
    && typeof candidate.authorization_source === 'string'
    && ADMIN_AUTHORIZATION_SOURCES.has(candidate.authorization_source)
    && typeof candidate.delivery_state === 'string'
    && AUDIT_DELIVERY_STATES.has(candidate.delivery_state)
    && candidate.file_count === manifest.files.length
    && candidate.content_sha256 === manifest.content_sha256
    && typeof candidate.cleanup_pending === 'boolean';
}

function validManifestLifecycle(manifest: CustomUiManifest): boolean {
  const event = manifest.audit_pending_event;
  if (manifest.lifecycle_state === 'active') {
    return !event || event.event_type === 'sign_in_experience.custom_ui_uploaded';
  }
  if (manifest.lifecycle_state === 'cleanup_pending') {
    return (!event || event.event_type === 'sign_in_experience.custom_ui_delete_pending')
      && (!event || event.cleanup_pending);
  }
  return manifest.cleanup_pending_object_keys.length === 0
    && (!event || event.event_type === 'sign_in_experience.custom_ui_deleted')
    && (!event || !event.cleanup_pending);
}

export function parseCustomUiManifest(manifestValue: unknown): CustomUiManifest | null {
  if (!manifestValue || typeof manifestValue !== 'object' || Array.isArray(manifestValue)) return null;
  const candidate = manifestValue as Record<string, unknown>;
  if (candidate.schema_version !== 1 || typeof candidate.assets_id !== 'string') return null;
  if (!ASSETS_ID_PATTERN.test(candidate.assets_id)) return null;
  const assetsId = candidate.assets_id;
  if (typeof candidate.content_sha256 !== 'string' || !SHA256_PATTERN.test(candidate.content_sha256)) return null;
  if (typeof candidate.uploaded_at !== 'string' || !Number.isFinite(Date.parse(candidate.uploaded_at))) return null;
  if (!Array.isArray(candidate.files) || !candidate.files.length || candidate.files.length > CUSTOM_UI_LIMITS.maxFiles) return null;
  if (!candidate.files.every(file => validManifestFile(file, assetsId))) return null;
  const manifestFiles = candidate.files as CustomUiManifestFile[];
  const paths = new Set(manifestFiles.map(file => file.path));
  if (paths.size !== candidate.files.length || !paths.has('index.html')) return null;
  if (!manifestFiles.find(file => file.path === 'index.html')!.size) return null;
  if (manifestFiles.some(file => file.path === 'login.html' && !file.size)) return null;
  if (manifestFiles.reduce((total, file) => total + file.size, 0) > CUSTOM_UI_LIMITS.maxTotalBytes) return null;
  if (contentSha256([...manifestFiles].sort((left, right) => left.path.localeCompare(right.path))) !== candidate.content_sha256) return null;
  const pending = candidate.cleanup_pending_object_keys;
  if (!Array.isArray(pending) || pending.length > CUSTOM_UI_LIMITS.maxCleanupKeys) return null;
  if (!pending.every(validCleanupKey) || new Set(pending).size !== pending.length) return null;
  const lifecycleState = candidate.lifecycle_state ?? 'active';
  if (!['active', 'cleanup_pending', 'objects_deleted'].includes(String(lifecycleState))) return null;
  const pendingAudit = candidate.audit_pending_event ?? null;
  const manifest = {
    ...candidate,
    lifecycle_state: lifecycleState,
    audit_pending_event: pendingAudit,
  } as unknown as CustomUiManifest;
  if (pendingAudit !== null && !validAuditPendingEvent(pendingAudit, manifest)) return null;
  if (!validManifestLifecycle(manifest)) return null;
  return manifest;
}

function validCleanupLease(candidate: Record<string, unknown>) {
  const requiresLease = candidate.state === 'reserved' || candidate.state === 'upload_outcome_unknown';
  if (requiresLease) return typeof candidate.lease_token === 'string' && ASSETS_ID_PATTERN.test(candidate.lease_token);
  return candidate.lease_token === undefined
    || (typeof candidate.lease_token === 'string' && ASSETS_ID_PATTERN.test(candidate.lease_token));
}

function validUnknownUploadTimestamp(candidate: Record<string, unknown>) {
  if (candidate.state === 'upload_outcome_unknown') {
    return typeof candidate.outcome_unknown_at === 'string'
      && Number.isFinite(Date.parse(candidate.outcome_unknown_at));
  }
  return candidate.outcome_unknown_at === undefined;
}

function validCleanupBatch(batch: unknown): batch is CustomUiCleanupBatch {
  if (!batch || typeof batch !== 'object' || Array.isArray(batch)) return false;
  const candidate = batch as Record<string, unknown>;
  if (typeof candidate.assets_id !== 'string' || !ASSETS_ID_PATTERN.test(candidate.assets_id)) return false;
  if (typeof candidate.created_at !== 'string' || !Number.isFinite(Date.parse(candidate.created_at))) return false;
  if (!['reserved', 'pending', 'upload_outcome_unknown', 'cleanup_claimed'].includes(String(candidate.state))) return false;
  if (!validCleanupLease(candidate) || !validUnknownUploadTimestamp(candidate)) return false;
  if (candidate.state === 'cleanup_claimed') {
    if (typeof candidate.claim_token !== 'string' || !ASSETS_ID_PATTERN.test(candidate.claim_token)) return false;
    if (typeof candidate.claimed_at !== 'string' || !Number.isFinite(Date.parse(candidate.claimed_at))) return false;
  } else if (candidate.claim_token !== undefined || candidate.claimed_at !== undefined) {
    return false;
  }
  if (!Array.isArray(candidate.object_keys) || !candidate.object_keys.length) return false;
  if (candidate.object_keys.length > CUSTOM_UI_LIMITS.maxFiles) return false;
  return candidate.object_keys.every(objectKey => validCleanupKey(objectKey)
    && objectKey.startsWith(`versions/${candidate.assets_id}/`))
    && new Set(candidate.object_keys).size === candidate.object_keys.length;
}

export function parseCustomUiCleanupQueue(queueValue: unknown): CustomUiCleanupQueue | null {
  if (!queueValue || typeof queueValue !== 'object' || Array.isArray(queueValue)) return null;
  const candidate = queueValue as Record<string, unknown>;
  if (candidate.schema_version !== 1 || !Array.isArray(candidate.batches)) return null;
  if (candidate.batches.length > CUSTOM_UI_LIMITS.maxCleanupBatches) return null;
  if (!candidate.batches.every(validCleanupBatch)) return null;
  const batches = candidate.batches as CustomUiCleanupBatch[];
  if (new Set(batches.map(batch => batch.assets_id)).size !== batches.length) return null;
  const objectKeys = batches.flatMap(batch => batch.object_keys);
  if (objectKeys.length > CUSTOM_UI_LIMITS.maxCleanupKeys) return null;
  if (new Set(objectKeys).size !== objectKeys.length) return null;
  return candidate as unknown as CustomUiCleanupQueue;
}

export function customUiManifestFromConfig(record: unknown): CustomUiManifest | null {
  if (!record || typeof record !== 'object' || Array.isArray(record)) return null;
  const config = record as Record<string, unknown>;
  return parseCustomUiManifest(config.value);
}

export function customUiStatusFromConfig(record: unknown): CustomUiStatus | null {
  if (record === null) return disabledCustomUiStatus();
  if (!record || typeof record !== 'object' || Array.isArray(record)) return null;
  const config = record as Record<string, unknown>;
  if (typeof config.enabled !== 'boolean') return null;
  const manifest = parseCustomUiManifest(config.value);
  if (!manifest) return null;
  const blockedByUnsafeOrigin = manifest.lifecycle_state === 'active';
  return {
    status: blockedByUnsafeOrigin ? 'blocked_unsafe_origin' : 'cleanup_pending',
    configured: true,
    enabled: false,
    lifecycle_state: manifest.lifecycle_state,
    assets_id: manifest.assets_id,
    content_sha256: manifest.content_sha256,
    uploaded_at: manifest.uploaded_at,
    file_count: manifest.files.length,
    files: manifest.files.map(statusFile),
    cleanup_pending: !blockedByUnsafeOrigin || manifest.cleanup_pending_object_keys.length > 0,
    audit_pending: manifest.audit_pending_event !== null,
  };
}

function disabledCustomUiStatus(): CustomUiStatus {
  return {
    status: 'disabled',
    configured: false,
    enabled: false,
    lifecycle_state: null,
    assets_id: null,
    content_sha256: null,
    uploaded_at: null,
    file_count: 0,
    files: [],
    cleanup_pending: false,
    audit_pending: false,
  };
}

function statusFile(file: CustomUiManifestFile): CustomUiStatusFile {
  return {
    path: file.path,
    sha256: file.sha256,
    size: file.size,
    content_type: file.content_type,
  };
}
