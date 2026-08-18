import { beforeEach, describe, expect, mock, test } from 'bun:test';
import { Elysia } from 'elysia';

type BrandingSnapshot = {
  branding: {
    logo_url: string | null;
    favicon_url: string | null;
  };
};

let brandingSnapshot: BrandingSnapshot | null = {
  branding: { logo_url: null, favicon_url: null },
};

const getSignInExperience = mock(async () => brandingSnapshot);
const updateSignInExperience = mock(async (input: { branding?: BrandingSnapshot['branding'] }) => {
  if (!brandingSnapshot) throw new Error('Sign-in experience is not configured');
  brandingSnapshot = {
    branding: { ...brandingSnapshot.branding, ...input.branding },
  };
  return brandingSnapshot;
});
const uploadFile = mock(async (
  _bucket: string,
  path: string,
  _file: Blob,
  _contentType: string,
) => ({ key: path }));
const downloadFile = mock(async () => new Response(pngBytes, {
  headers: { 'content-type': 'image/png' },
}));
const getStorageBucket = mock(async () => ({ id: 'branding' }));
const createStorageBucket = mock(async () => ({ id: 'branding' }));
const getPublicUrl = mock((bucket: string, path: string) => (
  `https://assets.example.test/storage/v1/object/public/${bucket}/${path}`
));
const logAudit = mock(async () => ({}));

class MockSupaCloudApiError extends Error {
  constructor(public status: number) {
    super(`SupaCloud ${status}`);
  }
}

mock.module('../supacloud/adapter.js', () => ({
  isSupaCloudApiError: (error: unknown, statuses?: number[]) => (
    error instanceof MockSupaCloudApiError
    && (!statuses || statuses.includes(error.status))
  ),
  getSupaCloudAdapter: () => ({
    getStorageBucket,
    createStorageBucket,
    uploadFile,
    downloadFile,
    getPublicUrl,
  }),
}));
mock.module('../repositories/audit.js', () => ({ logAudit }));
mock.module('../repositories/sign-in-experience.js', () => ({
  getSignInExperience,
  updateSignInExperience,
}));

const { storageRoutes } = await import('../storage/index.js');
const app = new Elysia().use(storageRoutes);
const pngBytes = Uint8Array.from([
  0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0x01,
]);

function brandingUploadRequest(assetType: 'logo' | 'favicon' | 'apple_touch_icon', bytes = pngBytes) {
  return new Request(`http://supauth.local/v1/storage/branding/${assetType}`, {
    method: 'POST',
    headers: { 'content-type': 'image/png' },
    body: bytes,
  });
}

beforeEach(() => {
  brandingSnapshot = { branding: { logo_url: null, favicon_url: null } };
  getSignInExperience.mockClear();
  updateSignInExperience.mockClear();
  uploadFile.mockClear();
  downloadFile.mockClear();
  getStorageBucket.mockClear();
  createStorageBucket.mockClear();
  getPublicUrl.mockClear();
  logAudit.mockClear();
});

describe('branding upload route', () => {
  test('reads image media bodies and persists the versioned authoritative URL', async () => {
    const response = await app.handle(brandingUploadRequest('logo'));
    const payload = await response.json() as Record<string, unknown>;

    expect(response.status).toBe(200);
    expect(payload).toMatchObject({ assetType: 'logo', content_type: 'image/png' });
    expect(uploadFile).toHaveBeenCalledTimes(1);
    const [bucket, path, file, contentType] = uploadFile.mock.calls[0];
    expect(bucket).toBe('branding');
    expect(path).toMatch(/^logo\/[a-f0-9]{24}\.png$/);
    expect(file).toBeInstanceOf(Blob);
    expect(contentType).toBe('image/png');
    expect(payload.url).toBe(
      `https://assets.example.test/storage/v1/object/public/branding/${path}`,
    );
    expect(brandingSnapshot?.branding.logo_url).toBe(payload.url as string);
    expect(getSignInExperience).toHaveBeenCalledTimes(2);
    expect(logAudit).toHaveBeenCalledTimes(1);
  });

  test('fails before upload when sign-in experience is not configured', async () => {
    brandingSnapshot = null;

    const response = await app.handle(brandingUploadRequest('favicon'));

    expect(response.status).toBe(409);
    expect(await response.json()).toMatchObject({ code: 'sign_in_experience_not_configured' });
    expect(uploadFile).not.toHaveBeenCalled();
    expect(updateSignInExperience).not.toHaveBeenCalled();
  });

  test('preserves apple touch icon upload without a non-existent repository field', async () => {
    brandingSnapshot = null;

    const response = await app.handle(brandingUploadRequest('apple_touch_icon'));
    const payload = await response.json() as Record<string, unknown>;

    expect(response.status).toBe(200);
    expect(payload).toMatchObject({ assetType: 'apple_touch_icon' });
    expect(uploadFile.mock.calls[0]?.[1]).toMatch(/^apple_touch_icon\/[a-f0-9]{24}\.png$/);
    expect(getSignInExperience).not.toHaveBeenCalled();
    expect(updateSignInExperience).not.toHaveBeenCalled();
  });

  test('creates the branding bucket only after an explicit not-found response', async () => {
    getStorageBucket.mockRejectedValueOnce(new MockSupaCloudApiError(404));

    const response = await app.handle(brandingUploadRequest('logo'));

    expect(response.status).toBe(200);
    expect(createStorageBucket).toHaveBeenCalledTimes(1);
    expect(uploadFile).toHaveBeenCalledTimes(1);
  });

  test('returns a structured service-unavailable response when bucket creation is unavailable', async () => {
    getStorageBucket.mockRejectedValueOnce(new MockSupaCloudApiError(404));
    createStorageBucket.mockRejectedValueOnce(new MockSupaCloudApiError(404));

    const response = await app.handle(brandingUploadRequest('logo'));

    expect(response.status).toBe(503);
    expect(await response.json()).toMatchObject({ code: 'branding_storage_unavailable' });
    expect(uploadFile).not.toHaveBeenCalled();
  });

  test('propagates non-not-found bucket failures without attempting creation', async () => {
    getStorageBucket.mockRejectedValueOnce(new MockSupaCloudApiError(503));

    const response = await app.handle(brandingUploadRequest('logo'));

    expect(response.status).toBe(503);
    expect(await response.json()).toMatchObject({ code: 'branding_storage_unavailable' });
    expect(createStorageBucket).not.toHaveBeenCalled();
    expect(uploadFile).not.toHaveBeenCalled();
  });

  test('rejects a media type whose body signature does not match', async () => {
    const response = await app.handle(brandingUploadRequest(
      'logo',
      new TextEncoder().encode('<svg xmlns="http://www.w3.org/2000/svg"/>'),
    ));

    expect(response.status).toBe(400);
    expect(await response.json()).toMatchObject({ code: 'branding_image_signature_mismatch' });
    expect(getSignInExperience).not.toHaveBeenCalled();
    expect(uploadFile).not.toHaveBeenCalled();
  });

  test('streams branding asset reads from Storage through the same-origin BFF', async () => {
    const assetHash = 'a'.repeat(24);
    brandingSnapshot = {
      branding: {
        logo_url: `https://assets.example.test/storage/v1/object/public/branding/logo/${assetHash}.png`,
        favicon_url: null,
      },
    };

    const response = await app.handle(
      new Request('http://supauth.local/v1/storage/branding/logo.png'),
    );

    expect(response.status).toBe(200);
    expect(response.headers.get('content-type')).toBe('image/png');
    expect(response.headers.get('cache-control')).toBe('private, no-store');
    expect(response.headers.get('x-content-type-options')).toBe('nosniff');
    expect(new Uint8Array(await response.arrayBuffer())).toEqual(pngBytes);
    expect(downloadFile).toHaveBeenCalledWith('branding', `logo/${assetHash}.png`);
  });

  test('keeps legacy branding read paths on the same streamed asset contract', async () => {
    const assetHash = 'b'.repeat(24);
    brandingSnapshot = {
      branding: {
        logo_url: `https://assets.example.test/storage/v1/object/public/branding/logo/${assetHash}.png`,
        favicon_url: null,
      },
    };

    const response = await app.handle(
      new Request('http://supauth.local/v1/storage/branding/logo-1723000000000.png'),
    );

    expect(response.status).toBe(200);
    expect(downloadFile).toHaveBeenCalledWith('branding', `logo/${assetHash}.png`);
  });

  test('rejects an unexpected Storage media type instead of serving sniffable content', async () => {
    const assetHash = 'c'.repeat(24);
    brandingSnapshot = {
      branding: {
        logo_url: `https://assets.example.test/storage/v1/object/public/branding/logo/${assetHash}.png`,
        favicon_url: null,
      },
    };
    downloadFile.mockResolvedValueOnce(new Response('<html></html>', {
      headers: { 'content-type': 'text/html' },
    }));

    const response = await app.handle(
      new Request('http://supauth.local/v1/storage/branding/logo'),
    );

    expect(response.status).toBe(502);
    expect(await response.json()).toMatchObject({ code: 'branding_asset_invalid_content_type' });
  });

  test('returns a clear 404 for unconfigured branding assets instead of a 500', async () => {
    const response = await app.handle(
      new Request('http://supauth.local/v1/storage/branding/favicon'),
    );

    expect(response.status).toBe(404);
    expect(await response.json()).toMatchObject({ code: 'branding_asset_not_found' });
  });
});
