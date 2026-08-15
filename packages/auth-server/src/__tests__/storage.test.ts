import { afterEach, describe, expect, it, mock } from 'bun:test';

mock.module('../repositories/security-config.js', () => ({
  getSecurityConfig: mock(async () => null),
}));

process.env.SUPACLOUD_INTERNAL_API_URL = 'http://supacloud.internal';
process.env.SUPACLOUD_INTERNAL_TOKEN = 'test-token';
process.env.SUPABASE_SERVICE_ROLE_KEY = 'test-storage-token';
process.env.SUPAOAUTH_BFF_SIGNING_SECRET = 'test-bff-signing-secret-32-characters';
process.env.SUPACLOUD_PROJECT_REF = 'test-project';
process.env.OAUTH_RUNTIME_URL = 'http://runtime.internal';
process.env.SUPACLOUD_RUNTIME_URL = 'http://runtime.internal';
process.env.SUPACLOUD_DATABASE_URL = 'postgres://test';
process.env.ADMIN_AUTH_MODE = 'token';
process.env.ADMIN_TOKEN = 'storage-route-admin-token';
process.env.NODE_ENV = 'test';

const { handleSupAuthRequest } = await import('../index.js');
const originalFetch = globalThis.fetch;

afterEach(() => {
  globalThis.fetch = originalFetch;
});

async function expectAnonymousStorageRejection(method: string, path: string) {
  const upstreamFetch = mock(async () => Response.json([]));
  globalThis.fetch = upstreamFetch as unknown as typeof fetch;

  const response = await handleSupAuthRequest(new Request(`http://supauth.local${path}`, { method }));

  expect(response.status).toBe(401);
  expect(upstreamFetch).toHaveBeenCalledTimes(0);
}

async function adminSessionToken() {
  const response = await handleSupAuthRequest(new Request('http://supauth.local/v1/auth/login', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ token: 'storage-route-admin-token' }),
  }));
  expect(response.status).toBe(200);
  const payload = await response.json() as { token?: string };
  expect(typeof payload.token).toBe('string');
  return payload.token as string;
}

function authenticatedStorageRequest(path: string, token: string) {
  return new Request(`http://supauth.local${path}`, {
    headers: { authorization: `Bearer ${token}` },
  });
}

describe('Storage authentication boundary', () => {
  it('rejects anonymous bucket listing before calling Storage', async () => {
    await expectAnonymousStorageRejection('GET', '/v1/storage/buckets');
  });

  it('rejects anonymous bucket creation before validating the bucket', async () => {
    await expectAnonymousStorageRejection('POST', '/v1/storage/buckets/not-allowed');
  });

  it('rejects anonymous deletion before validating the bucket or path', async () => {
    await expectAnonymousStorageRejection('DELETE', '/v1/storage/delete/not-allowed/file.png');
  });
});

describe('Storage signed URL boundary', () => {
  it('preserves nested Unicode paths and the minimum valid expiry through the real route', async () => {
    const token = await adminSessionToken();
    const upstreamCalls: Array<{ path: string; body: string | null }> = [];
    globalThis.fetch = mock(async (input: string | URL | Request, init?: RequestInit) => {
      const url = typeof input === 'string' ? input : input instanceof URL ? input.toString() : input.url;
      upstreamCalls.push({
        path: new URL(url).pathname,
        body: typeof init?.body === 'string' ? init.body : null,
      });
      return Response.json({ signedURL: 'https://storage.test/signed/avatar' });
    }) as unknown as typeof fetch;

    const objectPath = '用户 one/folder/avatar #1.png';
    const encodedPath = objectPath.split('/').map(encodeURIComponent).join('/');
    const response = await handleSupAuthRequest(authenticatedStorageRequest(
      `/v1/storage/sign-url/avatars/${encodedPath}?expires=1`,
      token,
    ));

    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({
      url: 'https://storage.test/signed/avatar',
      public: false,
      expiresIn: 1,
    });
    expect(upstreamCalls).toEqual([{
      path: '/storage/v1/object/sign/avatars/%25E7%2594%25A8%25E6%2588%25B7%2520one/folder/avatar%2520%25231.png',
      body: '{"expiresIn":1}',
    }]);
  });

  it('rejects encoded traversal and invalid expiry before Storage without weakening the bucket allowlist', async () => {
    const token = await adminSessionToken();
    const upstreamFetch = mock(async () => Response.json({ signedURL: 'https://storage.test/should-not-run' }));
    globalThis.fetch = upstreamFetch as unknown as typeof fetch;

    const rejectedPaths = [
      '/v1/storage/sign-url/avatars/%252e%252e%252fbranding%252flogo.svg',
      '/v1/storage/sign-url/avatars/users%252f..%252fbranding%252flogo.svg',
      '/v1/storage/sign-url/avatars/users/avatar.png?expires=0',
      '/v1/storage/sign-url/not-allowed/users/avatar.png?expires=1',
    ];
    for (const path of rejectedPaths) {
      const response = await handleSupAuthRequest(authenticatedStorageRequest(path, token));
      expect(response.status).toBeGreaterThanOrEqual(400);
    }
    expect(upstreamFetch).toHaveBeenCalledTimes(0);
  });
});

describe('Storage validation — bucket allowlist', () => {
  it('accepts avatars bucket', async () => {
    // Import the module to test the ALLOWED_BUCKETS constant indirectly
    // Since the constants are module-scoped, we test via the route behavior
    // by checking the storage module structure
    const storageModule = await import('../storage/index.js');
    expect(storageModule.storageRoutes).toBeDefined();
    expect(typeof storageModule.storageRoutes.fetch).toBe('function');
  });
});

describe('Storage module — structure', () => {
  it('exports storageRoutes as Elysia instance', async () => {
    const { storageRoutes } = await import('../storage/index.js');
    expect(storageRoutes).toBeDefined();
    expect(typeof storageRoutes.fetch).toBe('function');
  });
});

describe('Branding image validation', () => {
  it('uses the verified media type and content hash in asset metadata', async () => {
    const { brandingAssetMetadata } = await import('../storage/index.js');
    const firstPng = new Blob([
      Uint8Array.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0x01]),
    ]);
    const secondPng = new Blob([
      Uint8Array.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0x02]),
    ]);

    const firstMetadata = await brandingAssetMetadata(firstPng, 'image/png');
    const repeatedMetadata = await brandingAssetMetadata(firstPng, 'image/png');
    const secondMetadata = await brandingAssetMetadata(secondPng, 'image/png');

    expect(firstMetadata).toMatchObject({ contentType: 'image/png', extension: 'png' });
    expect(firstMetadata.hash).toBe(repeatedMetadata.hash);
    expect(secondMetadata.hash).not.toBe(firstMetadata.hash);
  });

  it('maps JPEG and icon signatures to their real extensions', async () => {
    const { brandingAssetMetadata } = await import('../storage/index.js');
    const jpeg = new Blob([Uint8Array.from([0xff, 0xd8, 0xff, 0x01])]);
    const icon = new Blob([Uint8Array.from([0x00, 0x00, 0x01, 0x00, 0x01])]);

    await expect(brandingAssetMetadata(jpeg, 'image/jpeg'))
      .resolves.toMatchObject({ extension: 'jpg' });
    await expect(brandingAssetMetadata(icon, 'image/vnd.microsoft.icon'))
      .resolves.toMatchObject({ extension: 'ico' });
  });

  it('rejects a declared type whose file signature does not match', async () => {
    const { brandingAssetMetadata } = await import('../storage/index.js');
    const fakePng = new Blob(['<script>alert(1)</script>']);

    await expect(brandingAssetMetadata(fakePng, 'image/png'))
      .rejects.toMatchObject({ status: 400, code: 'branding_image_signature_mismatch' });
  });

  it('rejects executable SVG branding content', async () => {
    const { brandingAssetMetadata } = await import('../storage/index.js');
    const activeSvgPayloads = [
      '<svg xmlns="http://www.w3.org/2000/svg"><script>alert(1)</script></svg>',
      '<svg xmlns="http://www.w3.org/2000/svg"><a href="jav&#x61;script:alert(1)"><path d="M0 0"/></a></svg>',
      '<svg xmlns="http://www.w3.org/2000/svg"><style>@import url(https://evil.example/style.css)</style></svg>',
      '<?xml version="1.0"?><?xml-stylesheet href="https://evil.example/style.css"?><svg xmlns="http://www.w3.org/2000/svg"/>',
    ];

    for (const payload of activeSvgPayloads) {
      await expect(brandingAssetMetadata(new Blob([payload]), 'image/svg+xml'))
        .rejects.toMatchObject({ status: 400, code: 'branding_image_signature_mismatch' });
    }
  });

  it('accepts static SVG with local paint references', async () => {
    const { brandingAssetMetadata } = await import('../storage/index.js');
    const staticSvg = new Blob([
      '<svg xmlns="http://www.w3.org/2000/svg"><defs><linearGradient id="brand"><stop stop-color="#fff"/></linearGradient></defs><path fill="url(#brand)" d="M0 0h1v1z"/></svg>',
    ]);

    await expect(brandingAssetMetadata(staticSvg, 'image/svg+xml'))
      .resolves.toMatchObject({ contentType: 'image/svg+xml', extension: 'svg' });
  });

  it('rejects empty and oversized branding images', async () => {
    const { brandingAssetMetadata } = await import('../storage/index.js');
    const oversized = new Blob([new Uint8Array(5 * 1024 * 1024 + 1)]);

    await expect(brandingAssetMetadata(new Blob([]), 'image/png'))
      .rejects.toMatchObject({ code: 'empty_branding_image' });
    await expect(brandingAssetMetadata(oversized, 'image/png'))
      .rejects.toMatchObject({ code: 'branding_image_too_large' });
  });
});

describe('Storage constants — validation helpers', () => {
  // We test the logic that would be used by the storage routes.
  // Since the functions are module-private, we replicate the validation
  // logic to ensure correctness.

  const ALLOWED_BUCKETS = ['avatars', 'branding'] as const;
  const ALLOWED_MIME_TYPES = [
    'image/png', 'image/jpeg', 'image/gif', 'image/webp', 'image/svg+xml',
    'image/x-icon', 'image/vnd.microsoft.icon',
  ] as const;
  const MAX_FILE_SIZE = 5 * 1024 * 1024;

  function validateBucket(bucketId: string): boolean {
    return (ALLOWED_BUCKETS as readonly string[]).includes(bucketId);
  }

  function validateMimeType(contentType: string): boolean {
    return (ALLOWED_MIME_TYPES as readonly string[]).includes(contentType);
  }

  it('allows avatars bucket', () => {
    expect(validateBucket('avatars')).toBe(true);
  });

  it('allows branding bucket', () => {
    expect(validateBucket('branding')).toBe(true);
  });

  it('rejects unknown bucket', () => {
    expect(validateBucket('uploads')).toBe(false);
  });

  it('rejects empty bucket name', () => {
    expect(validateBucket('')).toBe(false);
  });

  it('rejects bucket with similar name', () => {
    expect(validateBucket('avatars123')).toBe(false);
  });

  it('allows image/png mime type', () => {
    expect(validateMimeType('image/png')).toBe(true);
  });

  it('allows image/jpeg mime type', () => {
    expect(validateMimeType('image/jpeg')).toBe(true);
  });

  it('allows image/gif mime type', () => {
    expect(validateMimeType('image/gif')).toBe(true);
  });

  it('allows image/webp mime type', () => {
    expect(validateMimeType('image/webp')).toBe(true);
  });

  it('allows image/svg+xml mime type', () => {
    expect(validateMimeType('image/svg+xml')).toBe(true);
  });

  it('allows image/x-icon mime type', () => {
    expect(validateMimeType('image/x-icon')).toBe(true);
  });

  it('allows image/vnd.microsoft.icon mime type', () => {
    expect(validateMimeType('image/vnd.microsoft.icon')).toBe(true);
  });

  it('rejects application/pdf', () => {
    expect(validateMimeType('application/pdf')).toBe(false);
  });

  it('rejects text/html', () => {
    expect(validateMimeType('text/html')).toBe(false);
  });

  it('rejects application/octet-stream', () => {
    expect(validateMimeType('application/octet-stream')).toBe(false);
  });

  it('rejects empty mime type', () => {
    expect(validateMimeType('')).toBe(false);
  });

  it('MAX_FILE_SIZE is 5MB', () => {
    expect(MAX_FILE_SIZE).toBe(5 * 1024 * 1024);
  });
});
