// Storage routes — proxy to SupaCloud Storage for avatars and branding assets
// Browser never touches the service_role key directly.
// P0-12: avatars store storage key, not signed URL, in user metadata.

import { Elysia } from 'elysia';
import { getSupaCloudAdapter } from '../supacloud/adapter.js';
import * as auditRepo from '../repositories/audit.js';

const ALLOWED_BUCKETS = ['avatars', 'branding'] as const;
const ALLOWED_MIME_TYPES = [
  'image/png', 'image/jpeg', 'image/gif', 'image/webp', 'image/svg+xml',
  'image/x-icon', 'image/vnd.microsoft.icon',
] as const;

const MAX_FILE_SIZE = 5 * 1024 * 1024; // 5MB

function validateBucket(bucketId: string): boolean {
  return (ALLOWED_BUCKETS as readonly string[]).includes(bucketId);
}

function validateMimeType(contentType: string): boolean {
  return (ALLOWED_MIME_TYPES as readonly string[]).includes(contentType);
}

export const storageRoutes = new Elysia({ prefix: '/v1/storage' })
  // ─── List buckets ────────────────────────────────────────────────
  .get('/buckets', async () => {
    const adapter = getSupaCloudAdapter();
    const buckets = await adapter.listStorageBuckets();
    return { buckets };
  })

  // ─── Create bucket (idempotent) ──────────────────────────────────
  .post('/buckets/:bucketId', async ({ params }) => {
    const { bucketId } = params;
    if (!validateBucket(bucketId)) {
      return new Response('Bucket not allowed. Allowed: avatars, branding', { status: 400 });
    }
    const adapter = getSupaCloudAdapter();
    try {
      const existing = await adapter.getStorageBucket(bucketId);
      return { bucket: existing };
    } catch {
      const isPublic = bucketId === 'branding';
      const created = await adapter.createStorageBucket(bucketId, {
        public: isPublic,
        fileSizeLimit: MAX_FILE_SIZE,
      });
      return { bucket: created };
    }
  })

  // ─── Upload file ─────────────────────────────────────────────────
  .post('/upload/:bucketId/*', async ({ params, body, headers }) => {
    const { bucketId } = params;
    const filePath = params['*'];

    if (!validateBucket(bucketId)) {
      return new Response('Bucket not allowed', { status: 400 });
    }

    const contentType = (headers['content-type'] as string) || 'application/octet-stream';
    if (!validateMimeType(contentType)) {
      return new Response(`Content-Type ${contentType} not allowed. Allowed: ${ALLOWED_MIME_TYPES.join(', ')}`, { status: 400 });
    }

    const file = body as Blob;
    if (file.size > MAX_FILE_SIZE) {
      return new Response(`File too large. Max: ${MAX_FILE_SIZE / 1024 / 1024}MB`, { status: 400 });
    }

    const adapter = getSupaCloudAdapter();

    try {
      await adapter.getStorageBucket(bucketId);
    } catch {
      const isPublic = bucketId === 'branding';
      await adapter.createStorageBucket(bucketId, { public: isPublic, fileSizeLimit: MAX_FILE_SIZE });
    }

    const result = await adapter.uploadFile(bucketId, filePath, file, contentType);

    // Return storage key + appropriate URL type
    let url: string;
    if (bucketId === 'branding') {
      url = adapter.getPublicUrl(bucketId, filePath);
    } else {
      // For private buckets, return the storage key for metadata storage
      // Signed URLs are generated on-demand via GET /sign-url/...
      url = `${bucketId}/${filePath}`;
    }

    await auditRepo.logAudit({
      eventType: 'storage.upload',
      resourceType: 'storage',
      resourceId: `${bucketId}/${filePath}`,
      actorType: 'admin',
      details: { bucket: bucketId, path: filePath, contentType, size: file.size },
    });

    return { key: result.key, url, bucket: bucketId, path: filePath, public: bucketId === 'branding' };
  })

  // ─── Get signed URL (private buckets) ────────────────────────────
  .get('/sign-url/:bucketId/*', async ({ params, query }) => {
    const { bucketId } = params;
    const filePath = params['*'];

    if (!validateBucket(bucketId)) {
      return new Response('Bucket not allowed', { status: 400 });
    }

    const expiresIn = parseInt((query.expires as string) || '3600', 10);
    const adapter = getSupaCloudAdapter();

    if (bucketId === 'branding') {
      return { url: adapter.getPublicUrl(bucketId, filePath), public: true };
    }

    const signedUrl = await adapter.createSignedUrl(bucketId, filePath, expiresIn);
    return { url: signedUrl, public: false, expiresIn };
  })

  // ─── Delete file ─────────────────────────────────────────────────
  .delete('/delete/:bucketId/*', async ({ params }) => {
    const { bucketId } = params;
    const filePath = params['*'];

    if (!validateBucket(bucketId)) {
      return new Response('Bucket not allowed', { status: 400 });
    }

    const adapter = getSupaCloudAdapter();
    await adapter.deleteFile(bucketId, [filePath]);

    await auditRepo.logAudit({
      eventType: 'storage.delete',
      resourceType: 'storage',
      resourceId: `${bucketId}/${filePath}`,
      actorType: 'admin',
    });

    return { deleted: true, bucket: bucketId, path: filePath };
  })

  // ─── Avatar upload (P0-12 fix: store storage key, not signed URL) ─
  .post('/avatar/:userId', async ({ params, body, headers }) => {
    const { userId } = params;
    const contentType = (headers['content-type'] as string) || 'application/octet-stream';

    if (!validateMimeType(contentType)) {
      return new Response('Invalid image type', { status: 400 });
    }

    const file = body as Blob;
    if (file.size > MAX_FILE_SIZE) {
      return new Response('File too large', { status: 400 });
    }

    const adapter = getSupaCloudAdapter();
    const storageKey = `${userId}/avatar`;

    // Ensure avatars bucket exists (private)
    try {
      await adapter.getStorageBucket('avatars');
    } catch {
      await adapter.createStorageBucket('avatars', { public: false, fileSizeLimit: MAX_FILE_SIZE });
    }

    await adapter.uploadFile('avatars', storageKey, file, contentType);

    // P0-12: Store the storage key in user_metadata, not the signed URL.
    // Signed URLs are generated on-demand via GET /v1/storage/sign-url/avatars/:userId/avatar
    try {
      await adapter.updateUser(userId, {
        user_metadata: { avatar_storage_key: storageKey },
      });
    } catch {
      // Don't fail the upload if user metadata update fails
    }

    await auditRepo.logAudit({
      eventType: 'storage.avatar_upload',
      resourceType: 'user',
      resourceId: userId,
      actorType: 'admin',
      details: { storage_key: storageKey, strategy: 'key_only' },
    });

    return { storage_key: storageKey, userId, bucket: 'avatars' };
  })

  // ─── Branding upload (convenience endpoint) ──────────────────────
  .post('/branding/:assetType', async ({ params, body, headers }) => {
    const { assetType } = params;
    const contentType = (headers['content-type'] as string) || 'application/octet-stream';

    if (!['logo', 'favicon', 'apple_touch_icon'].includes(assetType)) {
      return new Response('assetType must be logo, favicon, or apple_touch_icon', { status: 400 });
    }

    if (!validateMimeType(contentType)) {
      return new Response('Invalid image type', { status: 400 });
    }

    const file = body as Blob;
    if (file.size > MAX_FILE_SIZE) {
      return new Response('File too large', { status: 400 });
    }

    const adapter = getSupaCloudAdapter();
    const ext = contentType.includes('svg') ? 'svg' : contentType.includes('png') ? 'png' : contentType.includes('gif') ? 'gif' : 'webp';
    const filePath = `${assetType}.${ext}`;

    try {
      await adapter.getStorageBucket('branding');
    } catch {
      await adapter.createStorageBucket('branding', { public: true, fileSizeLimit: MAX_FILE_SIZE });
    }

    await adapter.uploadFile('branding', filePath, file, contentType);
    const publicUrl = adapter.getPublicUrl('branding', filePath);

    // Update sign-in experience with the public URL (branding bucket is public)
    const { getDb } = await import('../db/index.js');
    const { signInExperience } = await import('../db/schema.js');
    const { eq } = await import('drizzle-orm');
    const db = getDb();
    const rows = await db.select().from(signInExperience).limit(1);
    if (rows[0]) {
      const update: Record<string, unknown> = { updatedAt: new Date() };
      if (assetType === 'logo') update.logoUrl = publicUrl;
      if (assetType === 'favicon') update.faviconUrl = publicUrl;
      await db.update(signInExperience).set(update).where(eq(signInExperience.id, rows[0].id));
    }

    await auditRepo.logAudit({
      eventType: 'storage.branding_upload',
      resourceType: 'sign_in_experience',
      resourceId: assetType,
      actorType: 'admin',
    });

    return { url: publicUrl, assetType };
  });
