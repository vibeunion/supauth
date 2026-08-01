import { describe, expect, it } from 'bun:test';
import { createHash } from 'node:crypto';
import { strFromU8, strToU8, zipSync } from 'fflate';
import {
  activeCustomUiManifestFromConfig,
  CUSTOM_UI_LIMITS,
  CustomUiAssetError,
  manifestFileForPath,
  normalizeCustomUiAssetPath,
  parseCustomUiArchive,
  parseCustomUiCleanupQueue,
  parseCustomUiManifest,
} from '../utils/custom-ui-assets.js';

function archiveFile(entries: Record<string, Uint8Array>, name = 'custom-ui.zip') {
  return new File([Uint8Array.from(zipSync(entries, { level: 9 })).buffer], name, { type: 'application/zip' });
}

function centralEntryOffset(bytes: Uint8Array) {
  for (let offset = 0; offset <= bytes.length - 4; offset += 1) {
    if (
      bytes[offset] === 0x50
      && bytes[offset + 1] === 0x4b
      && bytes[offset + 2] === 0x01
      && bytes[offset + 3] === 0x02
    ) return offset;
  }
  throw new Error('central directory entry not found');
}

function localEntryOffset(bytes: Uint8Array) {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  return view.getUint32(centralEntryOffset(bytes) + 42, true);
}

function endRecordOffset(bytes: Uint8Array) {
  for (let offset = bytes.length - 22; offset >= 0; offset -= 1) {
    if (
      bytes[offset] === 0x50
      && bytes[offset + 1] === 0x4b
      && bytes[offset + 2] === 0x05
      && bytes[offset + 3] === 0x06
    ) return offset;
  }
  throw new Error('end record not found');
}

type DescriptorLocalFields = 'zero' | 'matching' | 'mismatch';

function descriptorOffset(bytes: Uint8Array) {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const localOffset = localEntryOffset(bytes);
  const nameLength = view.getUint16(localOffset + 26, true);
  const extraLength = view.getUint16(localOffset + 28, true);
  const compressedSize = view.getUint32(centralEntryOffset(bytes) + 20, true);
  return localOffset + 30 + nameLength + extraLength + compressedSize;
}

function writeDescriptorLocalFields(
  view: DataView,
  localOffset: number,
  centralOffset: number,
  mode: DescriptorLocalFields,
) {
  for (const [localField, centralField] of [[14, 16], [18, 20], [22, 24]] as const) {
    const expected = view.getUint32(centralOffset + centralField, true);
    view.setUint32(localOffset + localField, mode === 'zero' ? 0 : expected ^ (mode === 'mismatch' ? 1 : 0), true);
  }
}

function descriptorArchive(level: 0 | 6 | 9, signed: boolean, localFields: DescriptorLocalFields = 'zero') {
  const original = zipSync({ 'index.html': strToU8('descriptor-matrix') }, { level });
  const originalCentralOffset = centralEntryOffset(original);
  const descriptorLength = signed ? 16 : 12;
  const bytes = new Uint8Array(original.length + descriptorLength);
  bytes.set(original.subarray(0, originalCentralOffset));
  bytes.set(original.subarray(originalCentralOffset), originalCentralOffset + descriptorLength);
  const view = new DataView(bytes.buffer);
  const centralOffset = originalCentralOffset + descriptorLength;
  const localOffset = view.getUint32(centralOffset + 42, true);
  view.setUint16(localOffset + 6, view.getUint16(localOffset + 6, true) | 0x0008, true);
  view.setUint16(centralOffset + 8, view.getUint16(centralOffset + 8, true) | 0x0008, true);
  writeDescriptorLocalFields(view, localOffset, centralOffset, localFields);
  let valuesOffset = originalCentralOffset;
  if (signed) {
    view.setUint32(valuesOffset, 0x08074b50, true);
    valuesOffset += 4;
  }
  view.setUint32(valuesOffset, view.getUint32(centralOffset + 16, true), true);
  view.setUint32(valuesOffset + 4, view.getUint32(centralOffset + 20, true), true);
  view.setUint32(valuesOffset + 8, view.getUint32(centralOffset + 24, true), true);
  view.setUint32(endRecordOffset(bytes) + 16, centralOffset, true);
  return new File([bytes.buffer], `descriptor-${level}-${signed ? 'signed' : 'unsigned'}.zip`, {
    type: 'application/zip',
  });
}

function mutateArchive(file: File, mutation: (bytes: Uint8Array, view: DataView) => void) {
  return file.arrayBuffer().then((buffer) => {
    const bytes = new Uint8Array(buffer);
    const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
    mutation(bytes, view);
    return new File([Uint8Array.from(bytes).buffer], file.name, { type: file.type });
  });
}

function withUnixEntryType(file: File, unixMode: number) {
  return mutateArchive(file, (bytes, view) => {
    const offset = centralEntryOffset(bytes);
    bytes[offset + 5] = 3;
    view.setUint32(offset + 38, unixMode * 0x10000, true);
  });
}

async function expectArchiveError(file: File, code: string) {
  try {
    await parseCustomUiArchive(file);
    throw new Error('archive unexpectedly accepted');
  } catch (error) {
    expect(error).toBeInstanceOf(CustomUiAssetError);
    expect((error as CustomUiAssetError).code).toBe(code);
  }
}

function manifestContentHash(files: Array<{ path: string; sha256: string; size: number }>) {
  const hash = createHash('sha256');
  for (const file of files) hash.update(`${file.path}\0${file.sha256}\0${file.size}\n`);
  return hash.digest('hex');
}

describe('Custom UI ZIP validation', () => {
  it('flattens one common root and keeps index plus nested assets', async () => {
    const parsed = await parseCustomUiArchive(archiveFile({
      'theme/index.html': strToU8('<h1>Custom</h1>'),
      'theme/assets/app.js': strToU8('console.log("custom")'),
      'theme/assets/site.css': strToU8('body { color: navy; }'),
    }));

    expect(parsed.files.map(file => file.path)).toEqual([
      'assets/app.js',
      'assets/site.css',
      'index.html',
    ]);
    expect(strFromU8(parsed.files.find(file => file.path === 'index.html')!.bytes)).toBe('<h1>Custom</h1>');
    expect(parsed.contentSha256).toMatch(/^[a-f0-9]{64}$/);
  });

  it('accepts a root-level index with sibling asset directories', async () => {
    const parsed = await parseCustomUiArchive(archiveFile({
      'index.html': strToU8('<h1>Root</h1>'),
      'assets/app.js': strToU8('console.log("root")'),
    }));

    expect(parsed.files.map(file => file.path)).toEqual(['assets/app.js', 'index.html']);
  });

  it('rejects empty root-level and flattened entry HTML', async () => {
    await expectArchiveError(archiveFile({ 'index.html': new Uint8Array() }), 'empty_index_html');
    await expectArchiveError(archiveFile({ 'theme/index.html': new Uint8Array() }), 'empty_index_html');
  });

  it('rejects entry HTML that is not valid UTF-8', async () => {
    await expectArchiveError(archiveFile({ 'index.html': new Uint8Array([0xff]) }), 'invalid_index_html');
    await expectArchiveError(archiveFile({ 'theme/index.html': new Uint8Array([0xc3, 0x28]) }), 'invalid_index_html');
  });

  it('validates login HTML when it overrides the required index', async () => {
    await expectArchiveError(archiveFile({
      'index.html': strToU8('fallback'),
      'login.html': new Uint8Array(),
    }), 'empty_login_html');
    await expectArchiveError(archiveFile({
      'index.html': strToU8('fallback'),
      'login.html': new Uint8Array([0xff]),
    }), 'invalid_login_html');
  });

  it('rejects an empty archive', async () => {
    await expectArchiveError(archiveFile({}), 'empty_archive');
  });

  it('rejects multiple unrelated roots when no root-level index exists', async () => {
    await expectArchiveError(archiveFile({
      'theme-a/index.html': strToU8('a'),
      'theme-b/app.js': strToU8('b'),
    }), 'invalid_root_structure');
  });

  it('rejects absolute and parent traversal paths', async () => {
    await expectArchiveError(archiveFile({ '/index.html': strToU8('absolute') }), 'invalid_path');
    await expectArchiveError(archiveFile({ '../index.html': strToU8('parent') }), 'invalid_path');
    await expectArchiveError(archiveFile({ 'theme/../../index.html': strToU8('nested parent') }), 'invalid_path');
    await expectArchiveError(archiveFile({ 'theme\\index.html': strToU8('windows path') }), 'invalid_path');
  });

  it('rejects symlinks and other non-regular Unix entries', async () => {
    const regularZip = archiveFile({ 'index.html': strToU8('entry') });
    await expectArchiveError(await withUnixEntryType(regularZip, 0o120777), 'unsupported_entry_type');
    await expectArchiveError(await withUnixEntryType(regularZip, 0o010644), 'unsupported_entry_type');
  });

  it('rejects archives over the compressed byte limit before parsing', async () => {
    const oversized = new File(
      [new Uint8Array(CUSTOM_UI_LIMITS.maxArchiveBytes + 1)],
      'oversized.zip',
      { type: 'application/zip' },
    );
    await expectArchiveError(oversized, 'archive_too_large');
  });

  it('rejects too many regular files', async () => {
    const entries: Record<string, Uint8Array> = { 'index.html': strToU8('index') };
    for (let index = 0; index < CUSTOM_UI_LIMITS.maxFiles; index += 1) {
      entries[`assets/file-${index}.txt`] = strToU8(String(index));
    }
    await expectArchiveError(archiveFile(entries), 'too_many_files');
  });

  it('rejects per-file and total expanded byte limits', async () => {
    await expectArchiveError(archiveFile({
      'index.html': new Uint8Array(CUSTOM_UI_LIMITS.maxFileBytes + 1),
    }), 'file_too_large');

    const entries: Record<string, Uint8Array> = { 'index.html': strToU8('index') };
    const chunkSize = Math.floor(CUSTOM_UI_LIMITS.maxTotalBytes / 4);
    for (let index = 0; index < 5; index += 1) {
      entries[`assets/chunk-${index}.txt`] = new Uint8Array(chunkSize);
    }
    await expectArchiveError(archiveFile(entries), 'expanded_archive_too_large');
  });

  it('rejects paths beyond the nesting limit', async () => {
    const nested = `${Array.from({ length: CUSTOM_UI_LIMITS.maxDepth + 1 }, () => 'deep').join('/')}/app.js`;
    await expectArchiveError(archiveFile({
      'index.html': strToU8('index'),
      [nested]: strToU8('nested'),
    }), 'path_too_deep');
  });

  it('rejects path and segment names beyond byte limits', async () => {
    const oversizedSegment = `${'a'.repeat(CUSTOM_UI_LIMITS.maxSegmentBytes - 2)}.js`;
    await expectArchiveError(archiveFile({
      'index.html': strToU8('index'),
      [`assets/${oversizedSegment}`]: strToU8('segment'),
    }), 'invalid_path');

    const longPath = [
      ...Array.from({ length: CUSTOM_UI_LIMITS.maxDepth - 1 }, () => 'a'.repeat(64)),
      `${'b'.repeat(61)}.js`,
    ].join('/');
    await expectArchiveError(archiveFile({
      'index.html': strToU8('index'),
      [longPath]: strToU8('path'),
    }), 'invalid_path');
  });

  it('rejects central-directory path, size, and CRC forgery', async () => {
    const validArchive = archiveFile({ 'index.html': strToU8('integrity') });
    const forgedPath = await mutateArchive(validArchive, (bytes) => {
      bytes[centralEntryOffset(bytes) + 46] = 'x'.charCodeAt(0);
    });
    await expectArchiveError(forgedPath, 'invalid_archive');

    const forgedSize = await mutateArchive(validArchive, (bytes, view) => {
      const offset = centralEntryOffset(bytes);
      view.setUint32(offset + 24, view.getUint32(offset + 24, true) + 1, true);
    });
    await expectArchiveError(forgedSize, 'invalid_archive');

    const forgedCrc = await mutateArchive(validArchive, (bytes, view) => {
      const offset = centralEntryOffset(bytes);
      view.setUint32(offset + 16, view.getUint32(offset + 16, true) ^ 1, true);
    });
    await expectArchiveError(forgedCrc, 'invalid_archive');
  });

  it('rejects local-header CRC and size mismatches without a data descriptor', async () => {
    const validArchive = archiveFile({ 'index.html': strToU8('local-integrity') });
    for (const fieldOffset of [14, 18, 22]) {
      const forged = await mutateArchive(validArchive, (bytes, view) => {
        const offset = localEntryOffset(bytes);
        view.setUint32(offset + fieldOffset, view.getUint32(offset + fieldOffset, true) ^ 1, true);
      });
      await expectArchiveError(forged, 'invalid_archive');
    }
  });

  it('accepts signed and unsigned data descriptors for stored and deflated entries', async () => {
    for (const level of [0, 6, 9] as const) {
      for (const signed of [true, false]) {
        const parsed = await parseCustomUiArchive(descriptorArchive(level, signed));
        expect(strFromU8(parsed.files[0].bytes)).toBe('descriptor-matrix');
      }
    }
  });

  it('accepts zero or matching local descriptor fields and rejects mismatches', async () => {
    for (const localFields of ['zero', 'matching'] as const) {
      await expect(parseCustomUiArchive(descriptorArchive(6, false, localFields))).resolves.toBeDefined();
    }
    await expectArchiveError(descriptorArchive(6, false, 'mismatch'), 'invalid_archive');
  });

  it('rejects descriptor CRC and compressed or uncompressed size mismatches', async () => {
    for (const fieldOffset of [0, 4, 8]) {
      const forged = await mutateArchive(descriptorArchive(6, false), (bytes, view) => {
        const offset = descriptorOffset(bytes);
        view.setUint32(offset + fieldOffset, view.getUint32(offset + fieldOffset, true) ^ 1, true);
      });
      await expectArchiveError(forged, 'invalid_archive');
    }
  });

  it('rejects strong encryption and unsupported general-purpose flags', async () => {
    const validArchive = archiveFile({ 'index.html': strToU8('flags') });
    for (const [flag, code] of [[0x0040, 'encrypted_archive'], [0x0010, 'unsupported_zip_flags']] as const) {
      const forged = await mutateArchive(validArchive, (bytes, view) => {
        const centralOffset = centralEntryOffset(bytes);
        const localOffset = localEntryOffset(bytes);
        view.setUint16(centralOffset + 8, view.getUint16(centralOffset + 8, true) | flag, true);
        view.setUint16(localOffset + 6, view.getUint16(localOffset + 6, true) | flag, true);
      });
      await expectArchiveError(forged, code);
    }
  });

  it('rejects encrypted, ZIP64, and multi-disk archive metadata', async () => {
    const validArchive = archiveFile({ 'index.html': strToU8('metadata') });
    const encrypted = await mutateArchive(validArchive, (bytes, view) => {
      const offset = centralEntryOffset(bytes);
      view.setUint16(offset + 8, view.getUint16(offset + 8, true) | 1, true);
    });
    await expectArchiveError(encrypted, 'encrypted_archive');

    const zip64 = await mutateArchive(validArchive, (bytes, view) => {
      view.setUint32(centralEntryOffset(bytes) + 24, 0xffffffff, true);
    });
    await expectArchiveError(zip64, 'zip64_unsupported');

    const multiDisk = await mutateArchive(validArchive, (bytes, view) => {
      view.setUint16(endRecordOffset(bytes) + 4, 1, true);
    });
    await expectArchiveError(multiDisk, 'multidisk_unsupported');
  });

  it('rejects hidden metadata, secret material, and unsupported extensions', async () => {
    await expectArchiveError(archiveFile({
      'index.html': strToU8('index'),
      '.assets-meta.json': strToU8('{}'),
    }), 'forbidden_asset');
    await expectArchiveError(archiveFile({
      'index.html': strToU8('index'),
      'assets/private.pem': strToU8('secret'),
    }), 'forbidden_asset');
    await expectArchiveError(archiveFile({
      'index.html': strToU8('index'),
      'assets/program.exe': strToU8('binary'),
    }), 'unsupported_asset_type');
  });

  it('rejects a corrupt ZIP without exposing parser details', async () => {
    await expectArchiveError(
      new File([Uint8Array.from(strToU8('not a zip')).buffer], 'corrupt.zip', { type: 'application/zip' }),
      'invalid_archive',
    );
  });
});

describe('Custom UI manifest and request paths', () => {
  const files = [
    {
      path: 'assets/app.js',
      object_key: `versions/b3da34de-b368-472d-8ff6-dbd53ae2fbaa/${'b'.repeat(64)}/assets/app.js`,
      sha256: 'b'.repeat(64),
      size: 18,
      content_type: 'text/javascript; charset=utf-8',
    },
    {
      path: 'index.html',
      object_key: `versions/b3da34de-b368-472d-8ff6-dbd53ae2fbaa/${'c'.repeat(64)}/index.html`,
      sha256: 'c'.repeat(64),
      size: 20,
      content_type: 'text/html; charset=utf-8',
    },
  ];
  const manifest = {
    schema_version: 1,
    assets_id: 'b3da34de-b368-472d-8ff6-dbd53ae2fbaa',
    content_sha256: manifestContentHash(files),
    uploaded_at: '2026-07-31T00:00:00.000Z',
    files,
    cleanup_pending_object_keys: [],
    lifecycle_state: 'active',
    audit_pending_event: null,
  };

  it('uses resolve-based containment and rejects encoded traversal', () => {
    expect(normalizeCustomUiAssetPath('assets/app.js')).toBe('assets/app.js');
    expect(normalizeCustomUiAssetPath('assets%2Fapp.js')).toBe('assets/app.js');
    expect(normalizeCustomUiAssetPath('../app.js')).toBeNull();
    expect(normalizeCustomUiAssetPath('%2e%2e%2fapp.js')).toBeNull();
    expect(normalizeCustomUiAssetPath('/etc/passwd')).toBeNull();
    expect(normalizeCustomUiAssetPath('assets\\app.js')).toBeNull();
    expect(normalizeCustomUiAssetPath('assets/bad\nname.js')).toBeNull();
  });

  it('accepts only a complete, bounded manifest and resolves exact files', () => {
    const parsed = parseCustomUiManifest(manifest);
    expect(parsed).not.toBeNull();
    expect(manifestFileForPath(parsed!, 'assets/app.js')?.sha256).toBe('b'.repeat(64));
    expect(manifestFileForPath(parsed!, 'assets/app.js/extra')).toBeNull();
    expect(manifestFileForPath(parsed!, '../assets/app.js')).toBeNull();
    expect(parseCustomUiManifest({ ...manifest, files: [{ ...manifest.files[0], size: CUSTOM_UI_LIMITS.maxFileBytes + 1 }] })).toBeNull();
    expect(parseCustomUiManifest({ ...manifest, assets_id: '../secret' })).toBeNull();
    expect(parseCustomUiManifest({ ...manifest, content_sha256: 'd'.repeat(64) })).toBeNull();
    const emptyIndexFiles = manifest.files.map(file => file.path === 'index.html' ? { ...file, size: 0 } : file);
    expect(parseCustomUiManifest({
      ...manifest,
      files: emptyIndexFiles,
      content_sha256: manifestContentHash(emptyIndexFiles),
    })).toBeNull();
    const emptyLogin = {
      path: 'login.html',
      object_key: `versions/${manifest.assets_id}/${'d'.repeat(64)}/login.html`,
      sha256: 'd'.repeat(64),
      size: 0,
      content_type: 'text/html; charset=utf-8',
    };
    expect(parseCustomUiManifest({
      ...manifest,
      files: [...manifest.files, emptyLogin],
      content_sha256: manifestContentHash([...manifest.files, emptyLogin]),
    })).toBeNull();

    const oversizedFiles = Array.from({ length: 5 }, (_, index) => {
      const assetPath = index === 0 ? 'index.html' : `assets/chunk-${index}.txt`;
      const digest = (index + 1).toString(16).repeat(64);
      return {
        path: assetPath,
        object_key: `versions/${manifest.assets_id}/${digest}/${assetPath}`,
        sha256: digest,
        size: CUSTOM_UI_LIMITS.maxFileBytes,
        content_type: index === 0 ? 'text/html; charset=utf-8' : 'text/plain; charset=utf-8',
      };
    });
    expect(parseCustomUiManifest({
      ...manifest,
      files: oversizedFiles,
      content_sha256: manifestContentHash(oversizedFiles),
    })).toBeNull();

    expect(parseCustomUiManifest({
      ...manifest,
      cleanup_pending_object_keys: Array.from(
        { length: CUSTOM_UI_LIMITS.maxCleanupKeys + 1 },
        (_, index) => `overflow-${index}`,
      ),
    })).toBeNull();
  });

  it('validates durable audit events and lifecycle transitions', () => {
    const uploadedEvent = {
      event_id: '85c77fc5-82a4-4e72-b946-880e245f2948',
      event_type: 'sign_in_experience.custom_ui_uploaded',
      created_at: '2026-08-01T00:00:00.000Z',
      actor_id: 'admin-a',
      actor_type: 'admin',
      request_id: 'request-a',
      authorization_source: 'rbac_projection',
      delivery_state: 'ready',
      file_count: files.length,
      content_sha256: manifest.content_sha256,
      cleanup_pending: false,
    };
    expect(parseCustomUiManifest({ ...manifest, audit_pending_event: uploadedEvent })).not.toBeNull();
    expect(parseCustomUiManifest({
      ...manifest,
      audit_pending_event: { ...uploadedEvent, event_id: '../bad' },
    })).toBeNull();
    expect(parseCustomUiManifest({
      ...manifest,
      audit_pending_event: { ...uploadedEvent, actor_id: 'bad actor' },
    })).toBeNull();
    expect(parseCustomUiManifest({
      ...manifest,
      audit_pending_event: { ...uploadedEvent, delivery_state: 'retry_forever' },
    })).toBeNull();
    expect(parseCustomUiManifest({
      ...manifest,
      lifecycle_state: 'cleanup_pending',
      audit_pending_event: uploadedEvent,
    })).toBeNull();

    const deletedEvent = {
      ...uploadedEvent,
      event_type: 'sign_in_experience.custom_ui_deleted',
    };
    expect(parseCustomUiManifest({
      ...manifest,
      lifecycle_state: 'objects_deleted',
      audit_pending_event: deletedEvent,
    })).not.toBeNull();
    expect(activeCustomUiManifestFromConfig({
      enabled: true,
      value: { ...manifest, lifecycle_state: 'objects_deleted', audit_pending_event: deletedEvent },
    })).toBeNull();
    expect(parseCustomUiManifest({
      ...manifest,
      lifecycle_state: 'objects_deleted',
      cleanup_pending_object_keys: [files[0].object_key],
      audit_pending_event: deletedEvent,
    })).toBeNull();
  });

  it('accepts only bounded cleanup batches with exact managed object keys', () => {
    const queue = {
      schema_version: 1,
      batches: [{
        assets_id: manifest.assets_id,
        created_at: '2026-08-01T00:00:00.000Z',
        state: 'pending',
        object_keys: [files[0].object_key],
      }],
    };
    expect(parseCustomUiCleanupQueue(queue)).not.toBeNull();
    expect(parseCustomUiCleanupQueue({
      ...queue,
      batches: [{
        ...queue.batches[0],
        state: 'cleanup_claimed',
        claim_token: '78e76c15-d483-465b-bd2d-52a317681d4a',
        claimed_at: '2026-08-01T00:01:00.000Z',
      }],
    })).not.toBeNull();
    expect(parseCustomUiCleanupQueue({
      ...queue,
      batches: [{ ...queue.batches[0], state: 'cleanup_claimed' }],
    })).toBeNull();
    const unknownUpload = {
      ...queue.batches[0],
      state: 'upload_outcome_unknown',
      lease_token: '78e76c15-d483-465b-bd2d-52a317681d4a',
      outcome_unknown_at: '2026-08-01T00:01:00.000Z',
    };
    expect(parseCustomUiCleanupQueue({ ...queue, batches: [unknownUpload] })).not.toBeNull();
    expect(parseCustomUiCleanupQueue({
      ...queue,
      batches: [{ ...unknownUpload, outcome_unknown_at: undefined }],
    })).toBeNull();
    expect(parseCustomUiCleanupQueue({
      ...queue,
      batches: [{ ...unknownUpload, lease_token: undefined }],
    })).toBeNull();
    expect(parseCustomUiCleanupQueue({
      ...queue,
      batches: [{ ...queue.batches[0], outcome_unknown_at: '2026-08-01T00:01:00.000Z' }],
    })).toBeNull();
    expect(parseCustomUiCleanupQueue({
      ...queue,
      batches: [{ ...queue.batches[0], assets_id: '9edb2f1d-6efd-4d44-952c-9b760f2d1701' }],
    })).toBeNull();
    expect(parseCustomUiCleanupQueue({
      ...queue,
      batches: [{ ...queue.batches[0], object_keys: [files[0].object_key, files[0].object_key] }],
    })).toBeNull();
  });
});
