import { Type as StrictType, decodeSchema as strictDecodeSchema } from '../../../shared/src/schema.js';
import { describe, expect, mock, test } from 'bun:test';
import { authRoutes, logoutAdminSession, type AdminLogoutDependencies } from '../auth/index.js';

function dependencies(response: Response | Error) {
  return {
    logoutUrl: 'https://internal-auth.example.test/auth/v1/logout',
    verifyToken: async () => ({ session_id: 'session-one' }),
    fetchImpl: mock(async (_input: string | URL | Request, _init?: RequestInit) => {
      if (response instanceof Error) throw response;
      return response;
    }),
  } satisfies AdminLogoutDependencies;
}

async function logoutResponse(response: Response | Error) {
  return logoutAdminSession({ authorization: 'Bearer valid-token', cookie: 'must-not-forward=1' }, dependencies(response));
}

describe('admin BFF logout', () => {
  test('deletes a development session without forwarding it to GoTrue', async () => {
    process.env.NODE_ENV = 'test';
    process.env["ADMIN_TOKEN"] = 'development-admin-token';
    const login = await authRoutes.handle(new Request('http://localhost/v1/auth/login', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ token: 'development-admin-token' }),
    }));
    const loginPayload = strictDecodeSchema(StrictType.Object({ "token": StrictType.String() }), await login.json());
    const logout = await authRoutes.handle(new Request('http://localhost/v1/auth/logout', {
      method: 'POST',
      headers: { authorization: `Bearer ${loginPayload.token}` },
    }));

    expect(logout.status).toBe(200);
    expect(await logout.json()).toEqual({ success: true, scope: 'local' });
  });

  test('revokes only the current GoTrue session with the bearer token', async () => {
    const logoutDependencies = dependencies(new Response(null, { status: 204 }));
    const response = await logoutAdminSession({
      authorization: 'Bearer valid-token',
      cookie: 'must-not-forward=1',
    }, logoutDependencies);
    const request = logoutDependencies.fetchImpl.mock.calls[0];
    if (!request) throw new Error('Expected a GoTrue logout request');
    const [requestUrl, requestInit] = request;
    const headers = new Headers(requestInit?.headers);

    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ success: true, scope: 'local' });
    expect(String(requestUrl)).toBe('https://internal-auth.example.test/auth/v1/logout?scope=local');
    expect(headers.get('authorization')).toBe('Bearer valid-token');
    expect(headers.has('cookie')).toBe(false);
  });

  test.each([401, 403, 500])('does not report upstream %i as success', async (upstreamStatus) => {
    const response = await logoutResponse(new Response(null, { status: upstreamStatus }));
    const payload = strictDecodeSchema(StrictType.Object({ "success": StrictType.Boolean(), "error": StrictType.Object({ "code": StrictType.String() }) }), await response.json());
    expect(payload.success).toBe(false);
    expect(payload.error.code).toBe('gotrue_logout_rejected');
    expect(response.status).toBe(upstreamStatus < 500 ? upstreamStatus : 502);
  });

  test('returns a structured network failure', async () => {
    const response = await logoutResponse(new TypeError('connection refused'));
    expect(response.status).toBe(502);
    expect(await response.json()).toMatchObject({
      success: false,
      error: { code: 'gotrue_logout_unavailable' },
    });
  });

  test('requires a bearer token', async () => {
    const response = await logoutAdminSession({}, dependencies(new Response(null, { status: 204 })));
    expect(response.status).toBe(401);
    expect(await response.json()).toMatchObject({ error: { code: 'missing_bearer_token' } });
  });

  test('requires a verified session id before local logout', async () => {
    const logoutDependencies: AdminLogoutDependencies = dependencies(new Response(null, { status: 204 }));
    logoutDependencies.verifyToken = async () => ({ sub: 'user-one' });
    const response = await logoutAdminSession({ authorization: 'Bearer valid-token' }, logoutDependencies);
    expect(response.status).toBe(422);
    expect(logoutDependencies.fetchImpl).not.toHaveBeenCalled();
  });
});
