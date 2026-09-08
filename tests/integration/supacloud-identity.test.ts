import { beforeAll, describe, expect, test } from 'bun:test';
import { createLocalJWKSet, exportJWK, generateKeyPair, SignJWT, type JWTVerifyGetKey } from 'jose';
import { handleCustomAccessToken } from '../../packages/auth-server/src/auth/hooks-bridge';
import { AuthorizationForbiddenError, AuthorizationUnavailableError, assertCan, permission, resolveAuthorization } from '../../packages/authorization-core/src/index';

const enabled = process.env.RUN_SUPACLOUD_IDENTITY_CONTRACTS === '1';
const issuer = 'https://identity.example.test/auth/v1';
const clientId = '00000000-0000-4000-8000-000000000001';
const projectId = 'fa-project-ref';
const applicationId = 'xigu-fa';
const subject = '00000000-0000-4000-8000-000000000002';
const tenantId = 'tenant-a';
const requiredPermission = permission('case:read');

interface Identity {
  subject: string;
  issuer: string;
  clientId: string;
}
interface Access {
  projectId: string;
  tenantId: string;
  permissions: readonly string[];
}
interface Context {
  identity: Identity;
  access: Access;
}
interface IdentityOptions {
  issuer: string;
  audience: string;
  clientId: string;
  projectId: string;
  jwksUrl: string;
  keyResolver: JWTVerifyGetKey;
  resolveAccess(identity: Identity, request: Request): Promise<Access | null>;
}
interface CandidateRuntime {
  createSupAuthRequestContext(options: IdentityOptions): (request: Request) => Promise<Context>;
  createApplication(options: {
    errorMapper(error: unknown): Response | undefined;
    requestContext(request: Request): Promise<Context>;
    modules: Array<{
      name: string;
      createServices(): Record<string, unknown>;
      controllers: Array<{
        path: string;
        serviceKey: string;
        scope: 'application';
        routes: Array<{ method: 'POST'; path: string; handler: string }>;
      }>;
    }>;
  }): { handle(request: Request): Promise<Response> };
}

describe.skipIf(!enabled)('SupAuth hook -> signed token -> SupaCloud -> application-local authorization', () => {
  let runtime: CandidateRuntime;
  let keys: Awaited<ReturnType<typeof generateKeyPair>>;
  let resolver: JWTVerifyGetKey;

  beforeAll(async () => {
    const entry = process.env.SUPACLOUD_ELYSIA_ENTRY;
    if (!entry) throw new Error('SUPACLOUD_ELYSIA_ENTRY is required; the enabled gate must not skip');
    // 仅加载可信构建目录；不复制或模拟上游令牌验证实现。
    runtime = await import(entry);
    expect(typeof runtime.createSupAuthRequestContext).toBe('function');
    expect(typeof runtime.createApplication).toBe('function');
    keys = await generateKeyPair('ES256');
    resolver = createLocalJWKSet({ keys: [{ ...await exportJWK(keys.publicKey), kid: 'local-test', alg: 'ES256' }] });
  });

  async function token(patch: Record<string, unknown> = {}) {
    const now = Math.floor(Date.now() / 1000);
    const claims = {
      iss: issuer, aud: 'authenticated', sub: subject, exp: now + 300, iat: now,
      role: 'authenticated', aal: 'aal1', session_id: 'local-session',
      email: 'user@example.test', phone: '', is_anonymous: false,
      client_id: clientId, scope: 'openid email', ...patch,
    };
    const output = handleCustomAccessToken({ claims }, { items: [], total: 0, truncated: false }, projectId);
    if (!('claims' in output)) throw new Error('Hook rejected the fixture before signing');
    expect(output.claims.client_id).toBe(claims.client_id);
    expect(output.claims.azp).toBe(patch.azp);
    expect(output.claims.scope).toBe(claims.scope);
    // 本地测试密钥代替 GoTrue 签名，不代表已经验证线上签发或刷新流程。
    return new SignJWT(output.claims).setProtectedHeader({ alg: 'ES256', kid: 'local-test' }).sign(keys.privateKey);
  }

  function request(credential: string) {
    return new Request('https://fa.example.test/cases/read', {
      method: 'POST',
      headers: {
        authorization: `Bearer ${credential}`,
        'x-supacloud-jwt-sub': 'forged-admin',
        'x-tenant-id': 'other-tenant',
      },
    });
  }

  function host() {
    const state = { member: true, grant: true, outage: false, lookups: 0, writes: 0 };
    const options: IdentityOptions = {
      issuer, audience: 'authenticated', clientId, projectId,
      jwksUrl: `${issuer}/.well-known/jwks.json`,
      keyResolver: resolver,
      resolveAccess: async identity => {
        state.lookups++;
        expect(identity).toMatchObject({ issuer, subject, clientId });
        if (!state.member) return null;
        const authorization = await resolveAuthorization({
          principal: { kind: 'user', issuer: identity.issuer, subject: identity.subject },
          applicationId,
          domain: { type: 'tenant', id: tenantId },
        }, async trusted => {
          expect(trusted.applicationId).toBe(applicationId);
          if (state.outage) throw new Error('private database diagnostic');
          return state.grant ? ['case:read'] : [];
        });
        assertCan(authorization, requiredPermission);
        return { projectId, tenantId, permissions: authorization.permissions };
      },
    };
    const application = (overrides: Partial<IdentityOptions> = {}) => runtime.createApplication({
      errorMapper(error) {
        if (error instanceof AuthorizationForbiddenError) {
          return Response.json({ code: 'APPLICATION_ACCESS_DENIED' }, { status: 403 });
        }
        if (error instanceof AuthorizationUnavailableError) {
          return Response.json({ code: 'AUTHORIZATION_UNAVAILABLE' }, { status: 503 });
        }
        return undefined;
      },
      requestContext: runtime.createSupAuthRequestContext({ ...options, ...overrides }),
      modules: [{
        name: 'consumer',
        createServices: () => ({ controller: { read: () => { state.writes++; return { ok: true }; } } }),
        controllers: [{ path: '', serviceKey: 'controller', scope: 'application',
          routes: [{ method: 'POST', path: '/cases/read', handler: 'read' }] }],
      }],
    });
    return { state, options, application };
  }

  test('client_id, azp-only and matching dual claims preserve signed identity across the actual hook', async () => {
    for (const patch of [{}, { client_id: undefined, azp: clientId }, { azp: clientId }]) {
      const { options } = host();
      const context = await runtime.createSupAuthRequestContext(options)(request(await token(patch)));
      expect(context.identity).toMatchObject({ issuer, subject, clientId });
      expect(context.access).toEqual({ projectId, tenantId, permissions: ['case:read'] });
    }
  });

  test('wrong or missing application binding and non-user roles fail before local access lookup', async () => {
    const { state, application } = host();
    const app = application();
    for (const patch of [
      { client_id: 'other-client' }, { client_id: undefined }, { azp: 'other-client' },
      { azp: null }, { azp: 42 }, { role: 'service_role' }, { role: 'anon' },
    ]) {
      const response = await app.handle(request(await token(patch)));
      expect(response.status).toBe(401);
      expect(await response.json()).toMatchObject({ code: 'AUTHENTICATION_REQUIRED' });
    }
    expect(state.lookups).toBe(0);
    expect(state.writes).toBe(0);
  });

  test('invalid issuer, audience, expiry and signature never become application authorization', async () => {
    const { state, application } = host();
    const app = application();
    const credential = await token();
    const other = await generateKeyPair('ES256');
    const forged = await new SignJWT({ iss: issuer, aud: 'authenticated', sub: subject,
      iat: Math.floor(Date.now() / 1000), exp: Math.floor(Date.now() / 1000) + 300,
      client_id: clientId, role: 'authenticated' })
      .setProtectedHeader({ alg: 'ES256', kid: 'local-test' }).sign(other.privateKey);
    for (const credential of [forged, 'invalid', await token({ iss: 'https://other.example.test/auth/v1' }),
      await token({ aud: 'other' }), await token({ exp: 1 })]) {
      expect((await app.handle(request(credential))).status).toBe(401);
    }
    expect(state.lookups).toBe(0);
    expect(state.writes).toBe(0);
    expect((await app.handle(request(credential))).status).toBe(200);
  });

  test('a valid session does not grant membership or permission after revocation', async () => {
    const { state, application } = host();
    const app = application();
    const credential = await token();
    expect((await app.handle(request(credential))).status).toBe(200);
    state.grant = false;
    const denied = await app.handle(request(credential));
    expect(denied.status).toBe(403);
    expect(await denied.json()).toEqual({ code: 'APPLICATION_ACCESS_DENIED' });
    state.grant = true;
    state.member = false;
    expect((await app.handle(request(credential))).status).toBe(403);
    expect(state.lookups).toBe(3);
    expect(state.writes).toBe(1);
  });

  test('JWKS and local authorization outages remain sanitized 503, not 401 or 403', async () => {
    const { state, application } = host();
    const credential = await token();
    const keyFailure = await application({
      keyResolver: async () => { throw new Error('private JWKS endpoint diagnostic'); },
    }).handle(request(credential));
    expect(keyFailure.status).toBe(503);
    expect(await keyFailure.text()).not.toContain('private JWKS');
    expect(state.lookups).toBe(0);
    state.outage = true;
    const accessFailure = await application().handle(request(credential));
    expect(accessFailure.status).toBe(503);
    expect(await accessFailure.text()).not.toContain('private database');
    expect(state.writes).toBe(0);
  });
});
