import { afterAll, beforeEach, describe, expect, mock, test } from 'bun:test';
import { Elysia } from 'elysia';
import { AdminLoginResponseSchema } from '../../../shared/src/admin-auth-contracts.js';
import { decodeSchema } from '../../../shared/src/schema.js';

const fixtureEnvironment = {
  NODE_ENV: 'test',
  ADMIN_AUTH_MODE: 'token',
  ADMIN_TOKEN: 'avatar-contract-fixture-token',
  SUPACLOUD_INTERNAL_API_URL: 'http://supacloud.internal',
  SUPACLOUD_INTERNAL_TOKEN: 'avatar-contract-internal-fixture',
  SUPACLOUD_PROJECT_REF: 'avatar-test-project',
  SUPACLOUD_RUNTIME_URL: 'http://runtime.internal',
  OAUTH_RUNTIME_URL: 'http://runtime.internal',
  SUPACLOUD_DATABASE_URL: 'postgres://unused-avatar-fixture',
  SUPABASE_SERVICE_ROLE_KEY: 'avatar-contract-storage-fixture',
  SUPAOAUTH_BFF_SIGNING_SECRET: 'avatar-contract-signing-fixture-32-characters',
};
const originalEnvironment = Object.fromEntries(
  Object.keys(fixtureEnvironment).map(name => [name, process.env[name]]),
);
Object.assign(process.env, fixtureEnvironment);

const events: string[] = [];
const outbound: Request[] = [];
const logAudit = mock(async (_input: Parameters<typeof import('../repositories/audit.js').logAudit>[0]) => {
  events.push('audit');
});
mock.module('../repositories/security-config.js', () => ({ getSecurityConfig: async () => null }));
mock.module('../repositories/audit.js', () => ({ logAudit }));

const originalFetch = globalThis.fetch;
// 只替换出站传输，不替换真实路由、鉴权守卫或 adapter；未知请求直接失败，绝不访问网络。
const fakeTransport = mock(async (input: Parameters<typeof fetch>[0], init?: RequestInit) => {
  const request = new Request(input, init);
  outbound.push(request);
  const path = new URL(request.url).pathname;
  if (request.method === 'GET' && path === '/storage/v1/bucket/avatars') {
    events.push('bucket');
    return Response.json({ id: 'avatars', public: false });
  }
  if (request.method === 'POST' && path === '/storage/v1/object/avatars/user-one/avatar') {
    events.push('upload');
    return Response.json({ Key: 'avatars/user-one/avatar' });
  }
  if (request.method === 'PUT' && path === '/v1/projects/avatar-test-project/auth/users/user-one') {
    events.push('metadata');
    return Response.json({
      id: 'user-one', user_metadata: { avatar_storage_key: 'user-one/avatar' },
    });
  }
  throw new Error(`Unexpected offline avatar transport request: ${request.method} ${path}`);
});
globalThis.fetch = Object.assign(fakeTransport, { preconnect: originalFetch.preconnect });

const { authRoutes, adminAuthGuard } = await import('../auth/index.js');
const { storageRoutes } = await import('../storage/index.js');
const app = new Elysia().use(authRoutes).use(adminAuthGuard).use(storageRoutes);
const pngBytes = Uint8Array.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0x01]);

function avatarRequest(contentType: string | null, token?: string) {
  const headers = new Headers();
  if (contentType !== null) headers.set('content-type', contentType);
  if (token !== undefined) headers.set('authorization', `Bearer ${token}`);
  return new Request('http://supauth.local/v1/storage/avatar/user-one', {
    method: 'POST', headers, body: pngBytes,
  });
}

async function sessionToken() {
  const response = await app.handle(new Request('http://supauth.local/v1/auth/login', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ token: fixtureEnvironment.ADMIN_TOKEN }),
  }));
  expect(response.status).toBe(200);
  const result = decodeSchema(AdminLoginResponseSchema, await response.json());
  if (!result.success) throw new Error('Expected a real local fixture session');
  return result.token;
}

function expectNoMutationsOrStorageAccess() {
  expect(fakeTransport).not.toHaveBeenCalled();
  expect(outbound).toEqual([]);
  expect(logAudit).not.toHaveBeenCalled();
  expect(events).toEqual([]);
}

beforeEach(() => {
  outbound.length = 0;
  events.length = 0;
  fakeTransport.mockClear();
  logAudit.mockClear();
});

afterAll(() => {
  globalThis.fetch = originalFetch;
  for (const [name, value] of Object.entries(originalEnvironment)) {
    if (value === undefined) delete process.env[name];
    else process.env[name] = value;
  }
});

describe('avatar contract through the real guard and routes with offline transport', () => {
  test.each([null, 'application/octet-stream', 'image/png'])(
    'rejects anonymous MIME %s before storage, user metadata or audit',
    async (contentType) => {
      const response = await app.handle(avatarRequest(contentType));
      expect(response.status).toBe(401);
      expectNoMutationsOrStorageAccess();
    },
  );

  test('rejects an invalid bearer without uploading a valid image', async () => {
    const response = await app.handle(avatarRequest('image/png', 'invalid-avatar-session'));
    expect(response.status).toBe(401);
    expectNoMutationsOrStorageAccess();
  });

  test.each([
    null,
    'application/octet-stream',
    'image/png-invalid',
    'image/png, image/jpeg',
    'IMAGE/PNG',
    'image/png; charset=utf-8',
  ])('rejects authenticated missing/unsupported MIME %s without side effects', async (contentType) => {
    const request = avatarRequest(contentType, await sessionToken());
    if (contentType === null) expect(request.headers.has('content-type')).toBe(false);
    const response = await app.handle(request);
    expect(response.status).toBe(400);
    expectNoMutationsOrStorageAccess();
  });

  test('uploads PNG once and then writes its storage key and audit, without claiming persistence', async () => {
    const response = await app.handle(avatarRequest('image/png', await sessionToken()));
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({
      storage_key: 'user-one/avatar', userId: 'user-one', bucket: 'avatars',
    });
    expect(fakeTransport).toHaveBeenCalledTimes(3);
    expect(events).toEqual(['bucket', 'upload', 'metadata', 'audit']);
    expect(outbound.map(request => [request.method, new URL(request.url).pathname])).toEqual([
      ['GET', '/storage/v1/bucket/avatars'],
      ['POST', '/storage/v1/object/avatars/user-one/avatar'],
      ['PUT', '/v1/projects/avatar-test-project/auth/users/user-one'],
    ]);
    const upload = outbound[1];
    const metadata = outbound[2];
    if (!upload || !metadata) throw new Error('Expected upload and metadata requests');
    expect(upload.headers.get('content-type')).toBe('image/png');
    expect(upload.headers.get('x-upsert')).toBe('true');
    expect(new Uint8Array(await upload.arrayBuffer())).toEqual(pngBytes);
    expect(await metadata.json()).toEqual({ user_metadata: { avatar_storage_key: 'user-one/avatar' } });
    expect(logAudit).toHaveBeenCalledTimes(1);
    expect(logAudit).toHaveBeenCalledWith({
      eventType: 'storage.avatar_upload',
      resourceType: 'user',
      resourceId: 'user-one',
      actorType: 'admin',
      details: { storage_key: 'user-one/avatar', strategy: 'key_only' },
    });
  });
});
