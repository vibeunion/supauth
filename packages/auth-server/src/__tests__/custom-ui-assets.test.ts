import { describe, expect, it } from 'bun:test';
import { createHash } from 'node:crypto';
import {
  CUSTOM_UI_LIMITS,
  customUiStatusFromConfig,
  normalizeCustomUiAssetPath,
  parseCustomUiCleanupQueue,
  parseCustomUiManifest,
} from '../utils/custom-ui-assets.js';

function manifestContentHash(files: Array<{ path: string; sha256: string; size: number }>) {
  const hash = createHash('sha256');
  for (const file of files) hash.update(`${file.path}\0${file.sha256}\0${file.size}\n`);
  return hash.digest('hex');
}

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

  it('accepts only a complete, bounded manifest', () => {
    const parsed = parseCustomUiManifest(manifest);
    expect(parsed).not.toBeNull();
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

  it('exposes a safe lifecycle status without storage object keys', () => {
    const status = customUiStatusFromConfig({ enabled: true, value: manifest });

    expect(status).toMatchObject({
      status: 'blocked_unsafe_origin',
      configured: true,
      enabled: false,
      assets_id: manifest.assets_id,
      file_count: files.length,
      cleanup_pending: false,
      audit_pending: false,
    });
    expect(status?.files[0]).toEqual({
      path: files[0].path,
      sha256: files[0].sha256,
      size: files[0].size,
      content_type: files[0].content_type,
    });
    expect(JSON.stringify(status)).not.toContain('object_key');
  });

  it('distinguishes disabled, blocked, cleanup-pending, and invalid Custom UI state', () => {
    expect(customUiStatusFromConfig(null)).toMatchObject({
      status: 'disabled',
      configured: false,
      enabled: false,
    });
    expect(customUiStatusFromConfig({ enabled: false, value: manifest })).toMatchObject({
      status: 'blocked_unsafe_origin',
      configured: true,
      enabled: false,
      lifecycle_state: 'active',
      cleanup_pending: false,
    });
    expect(customUiStatusFromConfig({
      enabled: false,
      value: { ...manifest, lifecycle_state: 'cleanup_pending' },
    })).toMatchObject({
      status: 'cleanup_pending',
      configured: true,
      enabled: false,
      cleanup_pending: true,
    });
    expect(customUiStatusFromConfig({ enabled: true, value: { ...manifest, content_sha256: 'invalid' } })).toBeNull();
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
