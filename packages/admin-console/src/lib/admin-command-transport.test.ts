import { afterEach, beforeEach, expect, mock, test } from 'bun:test';
import { createSSOAuthProvider } from '@svadmin/sso';
import { Type, type SdkEndpoint } from '@supauth/shared';
import {
  adminEndpointRequest,
  adminUploadRequest,
  setAdminAuthenticatedFetch,
} from './admin-api';
import { getAdminAccessToken, setAdminAccessTokenProvider, setStoredAdminToken } from './auth-token';
import { requireAdminAuthenticatedFetch } from './admin-sso-capability';
import { deferredRequest, enabledSsoConfig } from './providers/auth-fixtures';

const originalFetch = globalThis.fetch;
const OriginalRequest = globalThis.Request;
const originalStorage = Object.getOwnPropertyDescriptor(globalThis, 'localStorage');
const origin = 'https://admin.example.test';
const inputSchema = Type.Object({
  body: Type.Object({ name: Type.String({ minLength: 1 }) }),
  headers: Type.Optional(Type.Record(Type.String(), Type.String())),
});
const resultSchema = Type.Object({ accepted: Type.Boolean() });
const uploadSchema = Type.Object({
  headers: Type.Object({ 'Content-Type': Type.Literal('text/plain') }),
  upload: Type.Object({ size: Type.Number(), type: Type.Literal('text/plain') }),
});
const uploadContract = {
  method: 'POST', path: '/v1/transport-upload', input: uploadSchema,
  result: resultSchema, responseKind: 'json',
} satisfies SdkEndpoint;

function command(method: SdkEndpoint['method'] = 'POST') {
  return {
    method, path: '/v1/transport-command', input: inputSchema,
    result: resultSchema, responseKind: 'json',
  } satisfies SdkEndpoint;
}

const readContract = {
  method: 'GET', path: '/v1/transport-command', input: Type.Object({}),
  result: resultSchema, responseKind: 'json',
} satisfies SdkEndpoint;

let provider: ReturnType<typeof createSSOAuthProvider> | undefined;
let requests: Request[] = [];
let initKeys: string[][] = [];
let refreshes = 0;
let respond: (request: Request) => Promise<Response> = async () => Response.json({ accepted: true });

beforeEach(() => {
  requests = [];
  initKeys = [];
  refreshes = 0;
  respond = async () => Response.json({ accepted: true });
  setAdminAuthenticatedFetch(null);
  setAdminAccessTokenProvider(null);
  const localValues = new Map<string, string>();
  Object.defineProperty(globalThis, 'localStorage', {
    configurable: true,
    value: {
      getItem: (key: string) => localValues.get(key) ?? null,
      setItem: (key: string, value: string) => { localValues.set(key, value); },
      removeItem: (key: string) => { localValues.delete(key); },
    },
  });
  // Bun 中模拟浏览器相对 URL，真实 SSO 的 Request 克隆和重放代码保持执行。
  globalThis.Request = class BrowserRequest extends OriginalRequest {
    constructor(input: RequestInfo | URL, init?: RequestInit) {
      super(typeof input === 'string' ? new URL(input, origin) : input, init);
    }
  };
  globalThis.fetch = mock(async (input: RequestInfo | URL, init?: RequestInit) => {
    const request = new Request(input, init);
    if (new URL(request.url).pathname === '/token') {
      refreshes += 1;
      expect(new URLSearchParams(await request.text()).get('grant_type')).toBe('refresh_token');
      return Response.json({
        access_token: 'transport-new-access', refresh_token: 'transport-new-refresh',
        token_type: 'Bearer', expires_in: 3600,
      });
    }
    requests.push(request);
    initKeys.push(Object.keys(init ?? {}));
    return respond(request);
  });
});

afterEach(() => {
  provider?.destroy();
  provider = undefined;
  setAdminAuthenticatedFetch(null);
  setAdminAccessTokenProvider(null);
  globalThis.fetch = originalFetch;
  globalThis.Request = OriginalRequest;
  if (originalStorage) Object.defineProperty(globalThis, 'localStorage', originalStorage);
  else Reflect.deleteProperty(globalThis, 'localStorage');
});

function installProvider(hasToken = true, expiresIn = 3600) {
  const values = new Map<string, string>();
  if (hasToken) {
    values.set('transport_sso_tokens', JSON.stringify({
      access_token: 'transport-old-access', refresh_token: 'transport-refresh',
      token_type: 'Bearer', expires_at: Math.floor(Date.now() / 1000) + expiresIn,
    }));
  }
  const installed = createSSOAuthProvider({
    issuer: enabledSsoConfig.issuer,
    clientId: enabledSsoConfig.client_id,
    redirectUri: enabledSsoConfig.redirect_uri,
    storageKey: 'transport_sso',
    storage: {
      getItem: key => values.get(key) ?? null,
      setItem: (key, value) => { values.set(key, value); },
      removeItem: key => { values.delete(key); },
    },
    autoRefresh: false,
    manualEndpoints: {
      authorization_endpoint: `${enabledSsoConfig.issuer}/authorize`,
      token_endpoint: `${enabledSsoConfig.issuer}/token`,
      userinfo_endpoint: `${enabledSsoConfig.issuer}/userinfo`,
    },
    fetcher: (input, init) => globalThis.fetch(input, init),
  });
  provider = installed;
  setAdminAccessTokenProvider(() => installed.getAccessToken());
  setAdminAuthenticatedFetch(requireAdminAuthenticatedFetch(installed));
}

function expireFirstRequest(request: Request): Promise<Response> {
  return Promise.resolve(request.headers.get('Authorization') === 'Bearer transport-old-access'
    ? Response.json({ code: 'expired', message: 'Unauthorized' }, { status: 401 })
    : Response.json({ accepted: true }));
}

test.each(['POST', 'PUT', 'PATCH', 'DELETE'] satisfies SdkEndpoint['method'][])(
  'default %s refreshes and replays through the installed SSO provider',
  async method => {
    installProvider();
    respond = expireFirstRequest;
    await expect(adminEndpointRequest(command(method), { body: { name: 'change' } }))
      .resolves.toEqual({ accepted: true });
    expect(refreshes).toBe(1);
    expect(requests.map(request => request.method)).toEqual([method, method]);
    expect(await Promise.all(requests.map(request => request.text())))
      .toEqual(['{"name":"change"}', '{"name":"change"}']);
  },
);

test.each(['POST', 'PUT', 'PATCH', 'DELETE'] satisfies SdkEndpoint['method'][])(
  'never sends %s once without refreshing or replaying after 401',
  async method => {
    installProvider();
    respond = expireFirstRequest;
    await expect(adminEndpointRequest(command(method), { body: { name: 'change' } }, {
      authenticationRetry: 'never',
    })).rejects.toMatchObject({ statusCode: 401, code: 'expired' });
    expect(requests.map(request => request.method)).toEqual([method]);
    expect(refreshes).toBe(0);
  },
);

test('GET authority readback retains normal refresh after a single-attempt write', async () => {
  installProvider();
  respond = expireFirstRequest;
  await expect(adminEndpointRequest(command(), { body: { name: 'change' } }, {
    authenticationRetry: 'never',
  })).rejects.toMatchObject({ statusCode: 401 });
  await expect(adminEndpointRequest(readContract, {})).resolves.toEqual({ accepted: true });
  expect(requests.map(request => request.method)).toEqual(['POST', 'GET', 'GET']);
  expect(refreshes).toBe(1);
});

test('never permits preflight token refresh but forbids refresh and replay after the write', async () => {
  installProvider(true, -60);
  respond = async request => {
    expect(refreshes).toBe(1);
    expect(request.headers.get('Authorization')).toBe('Bearer transport-new-access');
    return Response.json({ code: 'audit_unauthorized' }, { status: 401 });
  };
  await expect(adminEndpointRequest(command(), { body: { name: 'change' } }, {
    authenticationRetry: 'never',
  })).rejects.toMatchObject({ statusCode: 401, code: 'audit_unauthorized' });
  expect(requests.map(request => request.method)).toEqual(['POST']);
  expect(refreshes).toBe(1);
  expect(globalThis.fetch).toHaveBeenCalledTimes(2);
});

test('single attempt keeps credentials, current bearer, headers and JSON without leaking policy', async () => {
  installProvider();
  await expect(adminEndpointRequest(command(), {
    body: { name: 'change' },
    headers: { 'X-Command-Id': 'command-1', Authorization: 'Bearer untrusted-input' },
  }, { authenticationRetry: 'never' })).resolves.toEqual({ accepted: true });
  expect(requests).toHaveLength(1);
  const request = requests[0];
  if (!request) throw new Error('Expected command request');
  expect(request.credentials).toBe('include');
  expect(request.headers.get('Authorization')).toBe('Bearer transport-old-access');
  expect(request.headers.get('Content-Type')).toBe('application/json');
  expect(request.headers.get('X-Command-Id')).toBe('command-1');
  expect([...request.headers.keys()].some(key => /retry|timeout|signal/i.test(key))).toBe(false);
  expect(initKeys).toEqual([['method', 'headers', 'body', 'signal', 'credentials']]);
  expect(await request.json()).toEqual({ name: 'change' });
  expect(refreshes).toBe(0);
});

test('missing token fails closed with zero HTTP despite supplied Authorization', async () => {
  installProvider(false);
  await expect(adminEndpointRequest(command(), {
    body: { name: 'change' }, headers: { Authorization: 'Bearer untrusted-input' },
  }, { authenticationRetry: 'never' }))
    .rejects.toMatchObject({ statusCode: 401, code: 'session_not_found' });
  expect(globalThis.fetch).toHaveBeenCalledTimes(0);
});

test('empty installed SSO session cannot fall back to a stale legacy identity for a command or upload', async () => {
  installProvider(false);
  setStoredAdminToken('stale-legacy-access');
  for (const pending of [
    () => adminEndpointRequest(command(), { body: { name: 'change' } }, { authenticationRetry: 'never' }),
    () => adminUploadRequest(uploadContract, { headers: { 'Content-Type': 'text/plain' } },
      new Blob(['payload']), { authenticationRetry: 'never' }),
  ]) {
    await expect(pending()).rejects.toMatchObject({ statusCode: 401, code: 'session_not_found' });
  }
  expect(globalThis.fetch).toHaveBeenCalledTimes(0);
  // 旧 getter 的兼容回退不属于此次修改；仅单次写请求选择严格身份源。
  await expect(getAdminAccessToken()).resolves.toBe('stale-legacy-access');
});

test('legacy token without a configured provider still authorizes one native write', async () => {
  setStoredAdminToken('current-legacy-access');
  await expect(adminEndpointRequest(command(), { body: { name: 'change' } }, {
    authenticationRetry: 'never',
  })).resolves.toEqual({ accepted: true });
  expect(requests.map(request => request.method)).toEqual(['POST']);
  expect(requests[0]?.headers.get('Authorization')).toBe('Bearer current-legacy-access');
  expect(refreshes).toBe(0);
  expect(globalThis.fetch).toHaveBeenCalledTimes(1);
});

test('single-attempt upload preserves binary data and rejects 401 without replay', async () => {
  installProvider();
  respond = expireFirstRequest;
  await expect(adminUploadRequest(uploadContract, { headers: { 'Content-Type': 'text/plain' } },
    new Blob(['payload'], { type: 'text/plain' }), { authenticationRetry: 'never' }))
    .rejects.toMatchObject({ statusCode: 401 });
  expect(requests).toHaveLength(1);
  const request = requests[0];
  if (!request) throw new Error('Expected upload request');
  expect(await request.text()).toBe('payload');
  expect(request.headers.get('Content-Type')).toBe('text/plain');
  expect(request.credentials).toBe('include');
  expect(initKeys.flat()).not.toContain('authenticationRetry');
  expect(refreshes).toBe(0);
});

test('upload also fails closed with no token and performs no HTTP', async () => {
  installProvider(false);
  await expect(adminUploadRequest(uploadContract, { headers: { 'Content-Type': 'text/plain' } },
    new Blob(['payload']), { authenticationRetry: 'never' }))
    .rejects.toMatchObject({ code: 'session_not_found' });
  expect(globalThis.fetch).toHaveBeenCalledTimes(0);
});

test('input schema rejection happens before HTTP', async () => {
  installProvider();
  await expect(adminEndpointRequest(command(), { body: { name: '' } }, {
    authenticationRetry: 'never',
  })).rejects.toMatchObject({ code: 'invalid_request' });
  expect(globalThis.fetch).toHaveBeenCalledTimes(0);
});

test('upload schema rejection happens before HTTP', async () => {
  installProvider();
  const boundedUpload = {
    ...uploadContract,
    input: Type.Object({
      headers: uploadSchema.properties.headers,
      upload: Type.Object({ size: Type.Number({ maximum: 1 }), type: Type.Literal('text/plain') }),
    }),
  } satisfies SdkEndpoint;
  await expect(adminUploadRequest(boundedUpload, { headers: { 'Content-Type': 'text/plain' } },
    new Blob(['too large']), { authenticationRetry: 'never' }))
    .rejects.toMatchObject({ code: 'invalid_request' });
  expect(globalThis.fetch).toHaveBeenCalledTimes(0);
});

test('single-attempt JSON and upload acknowledgements still require the response schema', async () => {
  installProvider();
  respond = async () => Response.json({ accepted: 'private-invalid-value' });
  for (const pending of [
    () => adminEndpointRequest(command(), { body: { name: 'change' } }, { authenticationRetry: 'never' }),
    () => adminUploadRequest(uploadContract, { headers: { 'Content-Type': 'text/plain' } },
      new Blob(['payload']), { authenticationRetry: 'never' }),
  ]) {
    await expect(pending()).rejects.toMatchObject({
      statusCode: 502, code: 'invalid_upstream_response',
      message: 'Admin API response does not match its contract',
    });
  }
  expect(requests).toHaveLength(2);
  expect(refreshes).toBe(0);
});

test('timeout aborts the native request without refresh or replay', async () => {
  installProvider();
  const response = deferredRequest<Response>();
  respond = () => response.promise;
  await expect(adminEndpointRequest(command(), { body: { name: 'change' } }, {
    authenticationRetry: 'never', timeoutMs: 10,
  })).rejects.toMatchObject({ code: 'request_timeout' });
  expect(requests).toHaveLength(1);
  expect(requests[0]?.signal.aborted).toBe(true);
  response.resolve(Response.json({ accepted: true }));
  expect(refreshes).toBe(0);
});

test('caller abort cancels an in-flight native request without replay', async () => {
  installProvider();
  const started = deferredRequest();
  const response = deferredRequest<Response>();
  const caller = new AbortController();
  respond = () => { started.resolve(); return response.promise; };
  const pending = adminEndpointRequest(command(), { body: { name: 'change' } }, {
    authenticationRetry: 'never', signal: caller.signal,
  });
  await started.promise;
  caller.abort();
  await expect(pending).rejects.toMatchObject({ code: 'request_aborted' });
  expect(requests).toHaveLength(1);
  expect(requests[0]?.signal.aborted).toBe(true);
  response.resolve(Response.json({ accepted: true }));
  expect(refreshes).toBe(0);
});

test('pre-aborted command never performs HTTP', async () => {
  installProvider();
  const caller = new AbortController();
  caller.abort();
  await expect(adminEndpointRequest(command(), { body: { name: 'change' } }, {
    authenticationRetry: 'never', signal: caller.signal,
  })).rejects.toMatchObject({ code: 'request_aborted' });
  expect(globalThis.fetch).toHaveBeenCalledTimes(0);
});

test('token resolution after timeout cannot send a late command', async () => {
  installProvider();
  const token = deferredRequest<string | null>();
  setAdminAccessTokenProvider(() => token.promise);
  await expect(adminEndpointRequest(command(), { body: { name: 'change' } }, {
    authenticationRetry: 'never', timeoutMs: 10,
  })).rejects.toMatchObject({ code: 'request_timeout' });
  token.resolve('late-access');
  await token.promise;
  await new Promise<void>(resolve => setTimeout(resolve, 0));
  expect(globalThis.fetch).toHaveBeenCalledTimes(0);
});

test('single-attempt response body validation remains inside the timeout boundary', async () => {
  installProvider();
  const body = new ReadableStream<Uint8Array>({ pull() {} });
  respond = async () => new Response(body);
  await expect(adminEndpointRequest(command(), { body: { name: 'change' } }, {
    authenticationRetry: 'never', timeoutMs: 10,
  })).rejects.toMatchObject({ code: 'request_timeout' });
  expect(requests).toHaveLength(1);
  expect(requests[0]?.signal.aborted).toBe(true);
  expect(refreshes).toBe(0);
});
