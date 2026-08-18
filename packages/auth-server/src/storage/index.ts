// Storage routes — proxy to SupaCloud Storage for avatars and branding assets
// Browser never touches the service_role key directly.
// P0-12: avatars store storage key, not signed URL, in user metadata.

import { Elysia } from 'elysia';
import { getSupaCloudAdapter, isSupaCloudApiError } from '../supacloud/adapter.js';
import * as auditRepo from '../repositories/audit.js';
import * as sieRepo from '../repositories/sign-in-experience.js';
import { ApiContractError } from '../utils/api-contract.js';

const ALLOWED_BUCKETS = ['avatars', 'branding'] as const;
const ALLOWED_MIME_TYPES = [
  'image/png', 'image/jpeg', 'image/gif', 'image/webp', 'image/svg+xml',
  'image/x-icon', 'image/vnd.microsoft.icon',
] as const;

const MAX_FILE_SIZE = 5 * 1024 * 1024; // 5MB

type BrandingAssetType = 'logo' | 'favicon' | 'apple_touch_icon';
type ManagedBrandingAssetType = Exclude<BrandingAssetType, 'apple_touch_icon'>;

const BRANDING_IMAGE_TYPES = {
  'image/png': { extension: 'png', signature: pngSignature },
  'image/jpeg': { extension: 'jpg', signature: jpegSignature },
  'image/gif': { extension: 'gif', signature: gifSignature },
  'image/webp': { extension: 'webp', signature: webpSignature },
  'image/svg+xml': { extension: 'svg', signature: svgSignature },
  'image/x-icon': { extension: 'ico', signature: iconSignature },
  'image/vnd.microsoft.icon': { extension: 'ico', signature: iconSignature },
} as const;
const BRANDING_OBJECT_FILE = /^[a-f0-9]{24}\.(?:png|jpg|gif|webp|svg|ico)$/;

function startsWithBytes(bytes: Uint8Array, expected: number[]) {
  return expected.every((byte, index) => bytes[index] === byte);
}

function pngSignature(bytes: Uint8Array) {
  return startsWithBytes(bytes, [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
}

function jpegSignature(bytes: Uint8Array) {
  return startsWithBytes(bytes, [0xff, 0xd8, 0xff]);
}

function gifSignature(bytes: Uint8Array) {
  const header = new TextDecoder().decode(bytes.slice(0, 6));
  return header === 'GIF87a' || header === 'GIF89a';
}

function webpSignature(bytes: Uint8Array) {
  const riff = new TextDecoder().decode(bytes.slice(0, 4));
  const webp = new TextDecoder().decode(bytes.slice(8, 12));
  return riff === 'RIFF' && webp === 'WEBP';
}

const ACTIVE_SVG_ELEMENT = /<\s*(?:[a-z][\w.-]*:)?(?:script|style|foreignObject|iframe|object|embed|image|use|a|animate(?:Motion|Transform)?|set|mpath)\b/i;

function containsActiveSvgContent(svgDocument: string) {
  const localPaintUrlsRemoved = svgDocument.replace(
    /url\(\s*#[a-z_][\w:.-]*\s*\)/gi,
    '',
  );
  return ACTIVE_SVG_ELEMENT.test(svgDocument)
    || /\son[a-z]+\s*=/i.test(svgDocument)
    || /(?:href|xlink:href)\s*=/i.test(svgDocument)
    || /<\?|<!\s*(?:doctype|entity)\b/i.test(svgDocument)
    || /(?:javascript|vbscript|data)\s*:/i.test(svgDocument)
    || /(?:@import|expression\s*\(|url\s*\()/i.test(localPaintUrlsRemoved);
}

function svgSignature(bytes: Uint8Array) {
  const source = new TextDecoder('utf-8', { fatal: true })
    .decode(bytes)
    .replace(/^\uFEFF/, '')
    .trimStart();
  const svgDocument = source.replace(/^<\?xml\s+[^?]*\?>\s*/i, '').trimStart();
  return /^<svg(?:\s|>)/i.test(svgDocument) && !containsActiveSvgContent(svgDocument);
}

function iconSignature(bytes: Uint8Array) {
  return startsWithBytes(bytes, [0x00, 0x00, 0x01, 0x00]);
}

function brandingContentType(rawContentType: string) {
  return rawContentType.split(';', 1)[0]?.trim().toLowerCase() || '';
}

async function contentHash(file: Blob) {
  const digest = await crypto.subtle.digest('SHA-256', await file.arrayBuffer());
  return Array.from(new Uint8Array(digest).slice(0, 12))
    .map(byte => byte.toString(16).padStart(2, '0'))
    .join('');
}

export async function brandingAssetMetadata(file: Blob, rawContentType: string) {
  const contentType = brandingContentType(rawContentType);
  const imageType = BRANDING_IMAGE_TYPES[contentType as keyof typeof BRANDING_IMAGE_TYPES];
  if (!imageType) throw new ApiContractError(400, 'invalid_branding_image_type', 'Unsupported branding image type');
  if (file.size === 0) throw new ApiContractError(400, 'empty_branding_image', 'Branding image is empty');
  if (file.size > MAX_FILE_SIZE) throw new ApiContractError(400, 'branding_image_too_large', 'Branding image exceeds 5MB');
  const signatureBytes = new Uint8Array(await (
    contentType === 'image/svg+xml' ? file : file.slice(0, 1024)
  ).arrayBuffer());
  if (!imageType.signature(signatureBytes)) {
    throw new ApiContractError(400, 'branding_image_signature_mismatch', 'Branding image content does not match its media type');
  }
  return { contentType, extension: imageType.extension, hash: await contentHash(file) };
}

function brandingAssetType(candidate: string): BrandingAssetType {
  if (candidate === 'logo' || candidate === 'favicon' || candidate === 'apple_touch_icon') return candidate;
  throw new ApiContractError(400, 'invalid_branding_asset_type', 'assetType must be logo, favicon, or apple_touch_icon');
}

function brandingAssetReadType(candidate: string): BrandingAssetType {
  const matchedType = ['apple_touch_icon', 'favicon', 'logo'].find(
    (assetType) => candidate === assetType || candidate.startsWith(`${assetType}.`) || candidate.startsWith(`${assetType}-`),
  );
  return brandingAssetType(matchedType || candidate);
}

function managedBrandingAssetType(assetType: BrandingAssetType): assetType is ManagedBrandingAssetType {
  return assetType === 'logo' || assetType === 'favicon';
}

function brandingAssetUrlInput(assetType: ManagedBrandingAssetType, publicUrl: string) {
  return assetType === 'logo'
    ? { branding: { logo_url: publicUrl } }
    : { branding: { favicon_url: publicUrl } };
}

function brandingAssetUrl(snapshot: Awaited<ReturnType<typeof sieRepo.getSignInExperience>>, assetType: ManagedBrandingAssetType) {
  return assetType === 'logo' ? snapshot?.branding.logo_url : snapshot?.branding.favicon_url;
}

function brandingAssetObjectPath(assetType: ManagedBrandingAssetType, publicUrl: string) {
  const pathPrefix = `/storage/v1/object/public/branding/${assetType}/`;
  let assetUrl: URL;
  try {
    assetUrl = new URL(publicUrl);
  } catch {
    throw new ApiContractError(404, 'branding_asset_not_found', 'Branding asset is not configured');
  }
  const prefixIndex = assetUrl.pathname.lastIndexOf(pathPrefix);
  if (prefixIndex < 0) {
    throw new ApiContractError(404, 'branding_asset_not_found', 'Branding asset is not configured');
  }
  let fileName: string;
  try {
    fileName = decodeURIComponent(assetUrl.pathname.slice(prefixIndex + pathPrefix.length));
  } catch {
    throw new ApiContractError(404, 'branding_asset_not_found', 'Branding asset is not configured');
  }
  if (!BRANDING_OBJECT_FILE.test(fileName)) {
    throw new ApiContractError(404, 'branding_asset_not_found', 'Branding asset is not configured');
  }
  return `${assetType}/${fileName}`;
}

async function brandingAssetResponse(assetType: ManagedBrandingAssetType, publicUrl: string) {
  const filePath = brandingAssetObjectPath(assetType, publicUrl);
  let storageResponse: Response;
  try {
    storageResponse = await getSupaCloudAdapter().downloadFile('branding', filePath);
  } catch (error) {
    if (isSupaCloudApiError(error, [404])) {
      throw new ApiContractError(404, 'branding_asset_not_found', 'Branding asset is not configured');
    }
    if (isSupaCloudApiError(error) || error instanceof TypeError) {
      throw new ApiContractError(503, 'branding_storage_unavailable', 'Branding storage is unavailable');
    }
    throw error;
  }
  const contentType = brandingContentType(storageResponse.headers.get('content-type') || '');
  if (!(contentType in BRANDING_IMAGE_TYPES)) {
    throw new ApiContractError(502, 'branding_asset_invalid_content_type', 'Branding asset returned an invalid media type');
  }
  return new Response(storageResponse.body, {
    headers: {
      'Cache-Control': 'private, no-store',
      'Content-Type': contentType,
      'X-Content-Type-Options': 'nosniff',
    },
  });
}

async function persistBrandingAssetUrl(assetType: ManagedBrandingAssetType, publicUrl: string) {
  await sieRepo.updateSignInExperience(brandingAssetUrlInput(assetType, publicUrl));
  const readBack = await sieRepo.getSignInExperience();
  if (brandingAssetUrl(readBack, assetType) !== publicUrl) {
    throw new ApiContractError(503, 'branding_asset_readback_failed', 'Branding image update could not be verified');
  }
}

async function requireSignInExperience() {
  if (await sieRepo.getSignInExperience()) return;
  throw new ApiContractError(409, 'sign_in_experience_not_configured', 'Sign-in experience is not configured');
}

async function storeBrandingFile(
  assetType: BrandingAssetType,
  file: Blob,
  image: Awaited<ReturnType<typeof brandingAssetMetadata>>,
) {
  const adapter = getSupaCloudAdapter();
  const filePath = `${assetType}/${image.hash}.${image.extension}`;
  try {
    try {
      await adapter.getStorageBucket('branding');
    } catch (error) {
      if (!isSupaCloudApiError(error, [404])) throw error;
      await adapter.createStorageBucket('branding', { public: true, fileSizeLimit: MAX_FILE_SIZE });
    }
    await adapter.uploadFile('branding', filePath, file, image.contentType);
  } catch (error) {
    if (isSupaCloudApiError(error) || error instanceof TypeError) {
      throw new ApiContractError(
        503,
        'branding_storage_unavailable',
        'Branding storage is unavailable. Ask an administrator to check the Storage deployment.',
      );
    }
    throw error;
  }
  return adapter.getPublicUrl('branding', filePath);
}

function validateBucket(bucketId: string): boolean {
  return (ALLOWED_BUCKETS as readonly string[]).includes(bucketId);
}

function validateMimeType(contentType: string): boolean {
  return (ALLOWED_MIME_TYPES as readonly string[]).includes(contentType);
}

export const storageRoutes = new Elysia({ prefix: '/v1/storage' })
  // adapter 对非法 bucket/对象路径/expiry 抛 TypeError；这些是请求输入问题，
  // 必须映射为 400 而不是全局 500，其他错误继续交给全局错误处理。
  .onError(({ error }) => {
    if (error instanceof ApiContractError) {
      return Response.json({ code: error.code, message: error.message }, { status: error.status });
    }
    if (error instanceof TypeError) {
      return new Response('Invalid storage path or parameters', { status: 400 });
    }
  })
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

  // ─── Branding asset read (admin console accesses it via /api/v1) ──
  // Keep the browser on the authenticated BFF origin because the configured
  // Storage URL can be internal even though the stored object is public.
  .get('/branding/:assetType', async ({ params }) => {
    const assetType = brandingAssetReadType(params.assetType);
    if (!managedBrandingAssetType(assetType)) {
      throw new ApiContractError(404, 'branding_asset_not_found', 'Branding asset is not configured');
    }
    const snapshot = await sieRepo.getSignInExperience();
    const assetUrl = brandingAssetUrl(snapshot, assetType);
    if (!assetUrl) {
      throw new ApiContractError(404, 'branding_asset_not_found', 'Branding asset is not configured');
    }
    return brandingAssetResponse(assetType, assetUrl);
  })

  // ─── Branding upload (convenience endpoint) ──────────────────────
  .post('/branding/:assetType', async ({ params, request, headers }) => {
    const assetType = brandingAssetType(params.assetType);
    const file = await request.blob();
    const image = await brandingAssetMetadata(file, headers['content-type'] || '');
    if (managedBrandingAssetType(assetType)) await requireSignInExperience();
    const publicUrl = await storeBrandingFile(assetType, file, image);
    if (managedBrandingAssetType(assetType)) {
      await persistBrandingAssetUrl(assetType, publicUrl);
    }

    await auditRepo.logAudit({
      eventType: 'storage.branding_upload',
      resourceType: 'sign_in_experience',
      resourceId: assetType,
      actorType: 'admin',
    });

    return { url: publicUrl, assetType, content_type: image.contentType };
  });
