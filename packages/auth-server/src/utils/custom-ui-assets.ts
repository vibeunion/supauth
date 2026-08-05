import { createHash } from 'node:crypto';
import path from 'node:path';
import { inflateSync } from 'fflate';

export const CUSTOM_UI_LIMITS = Object.freeze({
  maxArchiveBytes: 2 * 1024 * 1024,
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
const ZIP_CENTRAL_SIGNATURE = 0x02014b50;
const ZIP_END_SIGNATURE = 0x06054b50;
const ZIP_LOCAL_SIGNATURE = 0x04034b50;
const ZIP_DATA_DESCRIPTOR_SIGNATURE = 0x08074b50;
const ZIP_DATA_DESCRIPTOR_FLAG = 0x0008;
const ZIP_UTF8_FLAG = 0x0800;
const ZIP_ALLOWED_FLAGS = ZIP_DATA_DESCRIPTOR_FLAG | ZIP_UTF8_FLAG;
const ZIP_ENCRYPTION_FLAGS = 0x0001 | 0x0040 | 0x2000;
const ZIP64_SENTINEL = 0xffffffff;
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

export class CustomUiAssetError extends Error {
  constructor(public readonly code: string) {
    super(code);
    this.name = 'CustomUiAssetError';
  }
}

interface ZipCentralEntry {
  rawPath: string;
  compression: number;
  compressedSize: number;
  uncompressedSize: number;
  crc32: number;
  dataOffset: number;
  isDirectory: boolean;
  outputPath?: string;
}

interface LocalHeaderExpectation {
  offset: number;
  flags: number;
  compression: number;
  rawPath: string;
  crc32: number;
  compressedSize: number;
  uncompressedSize: number;
  directoryOffset: number;
}

export interface ParsedCustomUiFile {
  path: string;
  bytes: Uint8Array;
  size: number;
  sha256: string;
  contentType: string;
}

export interface ParsedCustomUiArchive {
  files: ParsedCustomUiFile[];
  contentSha256: string;
}

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

function findEndRecord(bytes: Uint8Array): number {
  const earliest = Math.max(0, bytes.length - 65_557);
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  for (let offset = bytes.length - 22; offset >= earliest; offset -= 1) {
    if (view.getUint32(offset, true) === ZIP_END_SIGNATURE) return offset;
  }
  throw new CustomUiAssetError('invalid_archive');
}

function decodeZipPath(bytes: Uint8Array, flags: number): string {
  if (!(flags & ZIP_UTF8_FLAG) && bytes.some(byte => byte > 0x7f)) {
    throw new CustomUiAssetError('unsupported_filename_encoding');
  }
  try {
    return new TextDecoder('utf-8', { fatal: true }).decode(bytes);
  } catch {
    throw new CustomUiAssetError('invalid_path');
  }
}

function unixEntryType(versionMadeBy: number, externalAttributes: number): number {
  return versionMadeBy >> 8 === 3 ? (externalAttributes >>> 16) & 0xf000 : 0;
}

function directoryEntry(versionMadeBy: number, externalAttributes: number, rawPath: string): boolean {
  const unixType = unixEntryType(versionMadeBy, externalAttributes);
  if (unixType && unixType !== 0x4000 && unixType !== 0x8000) {
    throw new CustomUiAssetError('unsupported_entry_type');
  }
  const directory = unixType === 0x4000 || (!(versionMadeBy >> 8 === 3) && Boolean(externalAttributes & 0x10));
  if (directory !== rawPath.endsWith('/')) throw new CustomUiAssetError('unsupported_entry_type');
  if (!(versionMadeBy >> 8 === 3) && (externalAttributes & 0x08)) {
    throw new CustomUiAssetError('unsupported_entry_type');
  }
  return directory;
}

function assertSupportedZipEntry(flags: number, compression: number, sizes: number[]) {
  if (flags & ZIP_ENCRYPTION_FLAGS) throw new CustomUiAssetError('encrypted_archive');
  if (flags & ~ZIP_ALLOWED_FLAGS) throw new CustomUiAssetError('unsupported_zip_flags');
  if (compression !== 0 && compression !== 8) throw new CustomUiAssetError('unsupported_compression');
  if (sizes.some(size => size === ZIP64_SENTINEL)) throw new CustomUiAssetError('zip64_unsupported');
}

function assertMatchingDataDescriptor(
  view: DataView,
  descriptorOffset: number,
  expected: LocalHeaderExpectation,
) {
  const matchesAt = (valuesOffset: number) => valuesOffset + 12 <= expected.directoryOffset
    && view.getUint32(valuesOffset, true) === expected.crc32
    && view.getUint32(valuesOffset + 4, true) === expected.compressedSize
    && view.getUint32(valuesOffset + 8, true) === expected.uncompressedSize;
  const signed = descriptorOffset + 4 <= view.byteLength
    && view.getUint32(descriptorOffset, true) === ZIP_DATA_DESCRIPTOR_SIGNATURE
    && matchesAt(descriptorOffset + 4);
  if (!signed && !matchesAt(descriptorOffset)) throw new CustomUiAssetError('invalid_archive');
}

function assertMatchingLocalHeader(
  bytes: Uint8Array,
  expected: LocalHeaderExpectation,
) {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  if (expected.offset + 30 > bytes.length || view.getUint32(expected.offset, true) !== ZIP_LOCAL_SIGNATURE) {
    throw new CustomUiAssetError('invalid_archive');
  }
  const localFlags = view.getUint16(expected.offset + 6, true);
  const nameLength = view.getUint16(expected.offset + 26, true);
  const extraLength = view.getUint16(expected.offset + 28, true);
  const nameStart = expected.offset + 30;
  const contentStart = nameStart + nameLength + extraLength;
  const localPath = decodeZipPath(bytes.subarray(nameStart, nameStart + nameLength), expected.flags);
  if (
    localPath !== expected.rawPath
    || localFlags !== expected.flags
    || view.getUint16(expected.offset + 8, true) !== expected.compression
  ) {
    throw new CustomUiAssetError('invalid_archive');
  }
  const localCrc32 = view.getUint32(expected.offset + 14, true);
  const localCompressedSize = view.getUint32(expected.offset + 18, true);
  const localUncompressedSize = view.getUint32(expected.offset + 22, true);
  if (expected.flags & ZIP_DATA_DESCRIPTOR_FLAG) {
    if (
      (localCrc32 !== 0 && localCrc32 !== expected.crc32)
      || (localCompressedSize !== 0 && localCompressedSize !== expected.compressedSize)
      || (localUncompressedSize !== 0 && localUncompressedSize !== expected.uncompressedSize)
    ) throw new CustomUiAssetError('invalid_archive');
    assertMatchingDataDescriptor(view, contentStart + expected.compressedSize, expected);
  } else if (
    localCrc32 !== expected.crc32
    || localCompressedSize !== expected.compressedSize
    || localUncompressedSize !== expected.uncompressedSize
  ) {
    throw new CustomUiAssetError('invalid_archive');
  }
  if (contentStart + expected.compressedSize > expected.directoryOffset) {
    throw new CustomUiAssetError('invalid_archive');
  }
  return contentStart;
}

function centralDirectoryBounds(bytes: Uint8Array, endOffset: number) {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const diskNumber = view.getUint16(endOffset + 4, true);
  const directoryDisk = view.getUint16(endOffset + 6, true);
  const diskEntries = view.getUint16(endOffset + 8, true);
  const entryCount = view.getUint16(endOffset + 10, true);
  const directorySize = view.getUint32(endOffset + 12, true);
  const directoryOffset = view.getUint32(endOffset + 16, true);
  const commentLength = view.getUint16(endOffset + 20, true);
  if (diskNumber || directoryDisk || diskEntries !== entryCount) throw new CustomUiAssetError('multidisk_unsupported');
  if (entryCount === 0xffff || directoryOffset === ZIP64_SENTINEL || directorySize === ZIP64_SENTINEL) {
    throw new CustomUiAssetError('zip64_unsupported');
  }
  if (directoryOffset + directorySize !== endOffset) throw new CustomUiAssetError('invalid_archive');
  if (endOffset + 22 + commentLength !== bytes.length) throw new CustomUiAssetError('invalid_archive');
  return { entryCount, directoryOffset };
}

function readCentralEntry(
  bytes: Uint8Array,
  offset: number,
  directoryOffset: number,
): { entry: ZipCentralEntry; nextOffset: number } {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  if (offset + 46 > bytes.length || view.getUint32(offset, true) !== ZIP_CENTRAL_SIGNATURE) {
    throw new CustomUiAssetError('invalid_archive');
  }
  const flags = view.getUint16(offset + 8, true);
  const compression = view.getUint16(offset + 10, true);
  const compressedSize = view.getUint32(offset + 20, true);
  const uncompressedSize = view.getUint32(offset + 24, true);
  const localOffset = view.getUint32(offset + 42, true);
  const crc32 = view.getUint32(offset + 16, true);
  assertSupportedZipEntry(flags, compression, [compressedSize, uncompressedSize, localOffset]);
  const nameLength = view.getUint16(offset + 28, true);
  const extraLength = view.getUint16(offset + 30, true);
  const commentLength = view.getUint16(offset + 32, true);
  const nextOffset = offset + 46 + nameLength + extraLength + commentLength;
  if (nextOffset > bytes.length) throw new CustomUiAssetError('invalid_archive');
  const rawPath = decodeZipPath(bytes.subarray(offset + 46, offset + 46 + nameLength), flags);
  const isDirectory = directoryEntry(
    view.getUint16(offset + 4, true),
    view.getUint32(offset + 38, true),
    rawPath,
  );
  if (isDirectory && (compressedSize || uncompressedSize)) throw new CustomUiAssetError('unsupported_entry_type');
  const dataOffset = assertMatchingLocalHeader(bytes, {
    offset: localOffset,
    flags,
    compression,
    rawPath,
    crc32,
    compressedSize,
    uncompressedSize,
    directoryOffset,
  });
  return {
    entry: {
      rawPath,
      compression,
      compressedSize,
      uncompressedSize,
      crc32,
      dataOffset,
      isDirectory,
    },
    nextOffset,
  };
}

function readCentralEntries(bytes: Uint8Array): ZipCentralEntry[] {
  const endOffset = findEndRecord(bytes);
  const { entryCount, directoryOffset } = centralDirectoryBounds(bytes, endOffset);
  if (entryCount > CUSTOM_UI_LIMITS.maxFiles * 2) throw new CustomUiAssetError('too_many_entries');
  const entries: ZipCentralEntry[] = [];
  let offset = directoryOffset;
  for (let index = 0; index < entryCount; index += 1) {
    const parsed = readCentralEntry(bytes, offset, directoryOffset);
    entries.push(parsed.entry);
    offset = parsed.nextOffset;
  }
  if (offset !== endOffset) throw new CustomUiAssetError('invalid_archive');
  return entries;
}

function commonArchiveRoot(paths: string[]): string {
  if (paths.includes('index.html')) return '';
  const roots = new Set(paths.map(assetPath => assetPath.split('/')[0]));
  if (roots.size !== 1 || paths.some(assetPath => !assetPath.includes('/'))) {
    throw new CustomUiAssetError('invalid_root_structure');
  }
  const root = `${[...roots][0]}/`;
  if (!paths.includes(`${root}index.html`)) throw new CustomUiAssetError('missing_index_html');
  return root;
}

function assertAssetBoundary(assetPath: string, size: number) {
  if (assetPath.split('/').length > CUSTOM_UI_LIMITS.maxDepth) throw new CustomUiAssetError('path_too_deep');
  if (forbiddenAssetPath(assetPath)) throw new CustomUiAssetError('forbidden_asset');
  if (!contentTypeForPath(assetPath)) throw new CustomUiAssetError('unsupported_asset_type');
  if (size > CUSTOM_UI_LIMITS.maxFileBytes) throw new CustomUiAssetError('file_too_large');
}

function prepareArchiveEntries(entries: ZipCentralEntry[]): ZipCentralEntry[] {
  const files = entries.filter(entry => !entry.isDirectory);
  if (!files.length) throw new CustomUiAssetError('empty_archive');
  if (files.length > CUSTOM_UI_LIMITS.maxFiles) throw new CustomUiAssetError('too_many_files');
  const archivePaths = new Set<string>();
  for (const entry of entries) {
    const normalized = normalizeCustomUiAssetPath(entry.rawPath);
    if (!normalized) throw new CustomUiAssetError('invalid_path');
    if (archivePaths.has(normalized)) throw new CustomUiAssetError('duplicate_path');
    archivePaths.add(normalized);
    entry.outputPath = normalized;
  }
  const root = commonArchiveRoot(files.map(entry => entry.outputPath!));
  const seen = new Set<string>();
  let expandedBytes = 0;
  for (const entry of files) {
    const outputPath = root ? entry.outputPath!.slice(root.length) : entry.outputPath!;
    if (!outputPath || seen.has(outputPath)) throw new CustomUiAssetError('duplicate_path');
    assertAssetBoundary(outputPath, entry.uncompressedSize);
    seen.add(outputPath);
    entry.outputPath = outputPath;
    expandedBytes += entry.uncompressedSize;
  }
  if (expandedBytes > CUSTOM_UI_LIMITS.maxTotalBytes) throw new CustomUiAssetError('expanded_archive_too_large');
  return files;
}

function concatenateChunks(chunks: Uint8Array[], size: number): Uint8Array {
  const bytes = new Uint8Array(size);
  let offset = 0;
  for (const chunk of chunks) {
    bytes.set(chunk, offset);
    offset += chunk.length;
  }
  return bytes;
}

function extractValidatedEntries(bytes: Uint8Array, entries: ZipCentralEntry[]): Map<string, Uint8Array> {
  const extracted = new Map<string, Uint8Array>();
  for (const entry of entries) {
    const compressed = bytes.subarray(entry.dataOffset, entry.dataOffset + entry.compressedSize);
    const content = entry.compression === 0
      ? compressed.slice()
      : inflateSync(compressed, { out: new Uint8Array(entry.uncompressedSize + 1) });
    if (
      content.length !== entry.uncompressedSize
      || content.length > CUSTOM_UI_LIMITS.maxFileBytes
      || (Bun.hash.crc32(content) >>> 0) !== entry.crc32
    ) throw new CustomUiAssetError('invalid_archive');
    extracted.set(entry.rawPath, content);
  }
  return extracted;
}

function sha256(bytes: Uint8Array): string {
  return createHash('sha256').update(bytes).digest('hex');
}

function contentSha256(files: Array<Pick<ParsedCustomUiFile, 'path' | 'sha256' | 'size'>>): string {
  const hash = createHash('sha256');
  for (const file of files) hash.update(`${file.path}\0${file.sha256}\0${file.size}\n`);
  return hash.digest('hex');
}

function assertValidEntrypoint(files: ParsedCustomUiFile[]) {
  const entrypoints = files.filter(file => file.path === 'index.html' || file.path === 'login.html');
  for (const entrypoint of entrypoints) {
    const entryName = entrypoint.path.slice(0, -'.html'.length);
    if (!entrypoint.size) throw new CustomUiAssetError(`empty_${entryName}_html`);
    try {
      new TextDecoder('utf-8', { fatal: true }).decode(entrypoint.bytes);
    } catch {
      throw new CustomUiAssetError(`invalid_${entryName}_html`);
    }
  }
}

export async function parseCustomUiArchive(file: File): Promise<ParsedCustomUiArchive> {
  if (file.size > CUSTOM_UI_LIMITS.maxArchiveBytes) throw new CustomUiAssetError('archive_too_large');
  let bytes: Uint8Array;
  try {
    bytes = new Uint8Array(await file.arrayBuffer());
  } catch {
    throw new CustomUiAssetError('invalid_archive');
  }
  if (bytes.length > CUSTOM_UI_LIMITS.maxArchiveBytes) throw new CustomUiAssetError('archive_too_large');
  try {
    const entries = readCentralEntries(bytes);
    const files = prepareArchiveEntries(entries);
    const extracted = extractValidatedEntries(bytes, entries);
    const parsedFiles = files.map((entry) => {
      const content = extracted.get(entry.rawPath)!;
      return {
        path: entry.outputPath!,
        bytes: content,
        size: content.length,
        sha256: sha256(content),
        contentType: contentTypeForPath(entry.outputPath!)!,
      };
    }).sort((left, right) => left.path.localeCompare(right.path));
    assertValidEntrypoint(parsedFiles);
    return { files: parsedFiles, contentSha256: contentSha256(parsedFiles) };
  } catch (error) {
    if (error instanceof CustomUiAssetError) throw error;
    throw new CustomUiAssetError('invalid_archive');
  }
}

export function customUiObjectKey(assetsId: string, file: Pick<ParsedCustomUiFile, 'path' | 'sha256'>) {
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

export function manifestFileForPath(manifest: CustomUiManifest, rawPath: string): CustomUiManifestFile | null {
  const normalized = normalizeCustomUiAssetPath(rawPath);
  if (!normalized) return null;
  return manifest.files.find(file => file.path === normalized) || null;
}

export function customUiManifestFromConfig(record: unknown): CustomUiManifest | null {
  if (!record || typeof record !== 'object' || Array.isArray(record)) return null;
  const config = record as Record<string, unknown>;
  return parseCustomUiManifest(config.value);
}

export function activeCustomUiManifestFromConfig(record: unknown): CustomUiManifest | null {
  if (!record || typeof record !== 'object' || Array.isArray(record)) return null;
  const config = record as Record<string, unknown>;
  if (config.enabled !== true) return null;
  const manifest = parseCustomUiManifest(config.value);
  return manifest?.lifecycle_state === 'active' ? manifest : null;
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

export async function readVerifiedStorageAsset(response: Response, file: CustomUiManifestFile) {
  if (!response.ok || !response.body) throw new CustomUiAssetError('storage_read_failed');
  const reader = response.body.getReader();
  const chunks: Uint8Array[] = [];
  let receivedBytes = 0;
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    receivedBytes += value.length;
    if (receivedBytes > file.size || receivedBytes > CUSTOM_UI_LIMITS.maxFileBytes) {
      await reader.cancel();
      throw new CustomUiAssetError('storage_asset_too_large');
    }
    chunks.push(value);
  }
  const content = concatenateChunks(chunks, receivedBytes);
  if (receivedBytes !== file.size || sha256(content) !== file.sha256) {
    throw new CustomUiAssetError('storage_asset_integrity_failed');
  }
  return content;
}
