import { describe, expect, test } from 'bun:test';
import { chmod, mkdtemp, rm, symlink, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  browserConfiguration, browserDiscovery, sameBrowserOrigin, permittedBrowserRequest, permittedBrowserRedirect,
  permittedToggle, permittedBrowserSdkRead, completeBrowserWebhookList, runBrowserAcceptance,
  browserChannel, browserTotpCode,
  browserConsentUrl, browserMfaUser, browserMfaVerification, permittedBrowserMfaBody,
  validateBrowserIdentityReceipt, loadBrowserIdentityReceipt,
  browserAuthorizationRequest, browserAuthorizationDetails, browserOAuthCallback,
  type BrowserAuthPost,
} from '../scripts/real-contract-browser.js';
import { parseAcceptanceTarget } from '../scripts/real-contract-acceptance-contract.js';
import { createAllocationJournal, TEST_IDENTITY_OWNER_REF } from '../scripts/real-contract-allocation.js';

const projectRef = 'supauth_contract_0123456789abcdef0123456789abcdef';
function environment(): Record<string, string | undefined> {
  return {
    REAL_ACCEPTANCE_BASE_URL: 'http://127.0.0.1:5191/api',
    REAL_ACCEPTANCE_RUNTIME_URL: 'http://127.0.0.1:5191/auth/v1',
    REAL_ACCEPTANCE_PROJECT_REF: projectRef,
    REAL_ACCEPTANCE_CONFIRM_PROJECT: projectRef,
    REAL_ACCEPTANCE_ENVIRONMENT: 'isolated-test',
    REAL_ACCEPTANCE_ADMIN_TOKEN: 'offline-admin-placeholder',
    REAL_ACCEPTANCE_USER_TOKEN: 'offline-user-placeholder',
    REAL_ACCEPTANCE_BROWSER_EMAIL: 'owned@example.invalid',
    REAL_ACCEPTANCE_BROWSER_PASSWORD: 'offline-password-placeholder',
  };
}

const origin = 'http://127.0.0.1:5191';
const writeUrl = `${origin}/api/v1/webhooks/owned-id`;
const passwordBody = JSON.stringify({
  email: 'owned@example.invalid', password: 'offline-password-placeholder', gotrue_meta_security: {},
});
const authPosts = new Map<string, BrowserAuthPost>([[
  `${origin}/auth/v1/token?grant_type=password`,
  { kind: 'password', email: 'owned@example.invalid', password: 'offline-password-placeholder' },
]]);
const webhook = {
  id: 'owned-id', url: 'https://supauth-contract.invalid/offline',
  events: [], enabled: false, has_secret: true,
  created_at: '2026-09-09T00:00:00Z', updated_at: '2026-09-09T00:00:00Z',
};
const runId = '12345678-1234-4abc-8def-1234567890ab';
const appOrigin = `https://contract-${runId}.xai.xigu.team`;
const authorityOrigin = 'https://auth.xai.xigu.team';
const ownedUserId = '12345678-1234-4abc-8def-1234567890ac';
const ownedFactorId = '12345678-1234-4abc-8def-1234567890ad';
const challengeId = '12345678-1234-4abc-8def-1234567890ae';
const ownedEmail = `admin-${runId}@xai.xigu.team`;

function identityReceipt() {
  const user = { id: ownedUserId, email: ownedEmail, createdAt: '2026-09-09T00:00:01Z' };
  const client = { id: 'owned-client', name: `supauth-contract-${runId}`, redirectUri: `${appOrigin}/admin` };
  const factor = { id: ownedFactorId, userId: ownedUserId, factorType: 'totp' };
  return {
    version: 1, runId, projectRef: 'abcdefghijklmnopqrst', authorityRef: TEST_IDENTITY_OWNER_REF,
    intent: {
      email: ownedEmail, clientName: client.name, redirectUri: client.redirectUri,
      recordedAt: '2026-09-09T00:00:00Z',
    },
    before: { matchingUserIds: [], matchingClientIds: [] },
    user: { creation: { ...user }, readback: { ...user } },
    client: { creation: { ...client }, readback: { ...client } },
    factor: { creation: { ...factor }, readback: { ...factor, status: 'verified' } },
  };
}

async function withAllocation(
  callback: (env: Record<string, string | undefined>, directory: string) => Promise<void> | void,
) {
  const root = await mkdtemp(join(tmpdir(), 'supauth-browser-offline-'));
  try {
    const receipt = identityReceipt();
    const journal = await createAllocationJournal(root, {
      runId, name: receipt.intent.clientName, projectOrigin: appOrigin,
      authorityRef: TEST_IDENTITY_OWNER_REF, authorityOrigin,
      managementOrigin: 'http://127.0.0.1:29190',
      beforeInventory: {
        complete: true, projects: [{ ref: TEST_IDENTITY_OWNER_REF, name: 'existing test owner' }],
      },
    });
    const project = {
      id: 'offline-project-id', created_at: '2026-09-09T00:00:00Z',
      ref: receipt.projectRef, name: receipt.intent.clientName, api: { url: appOrigin }, status: 'ACTIVE_HEALTHY',
    };
    await journal.createOnce(async () => project);
    await journal.bind({
      projectReadback: project, authorityOrigin,
      authorityDescriptor: {
        project_ref: project.ref, mode: 'shared', authority_project_ref: TEST_IDENTITY_OWNER_REF,
        owner_project_ref: TEST_IDENTITY_OWNER_REF, local_gotrue_enabled: false,
        public_auth_route: 'owner_proxy', user_management: 'owner_only', configuration_management: 'owner_only',
      },
    });
    const directory = join(root, runId);
    const path = join(directory, 'browser-identity.json');
    await writeFile(path, JSON.stringify(receipt), { mode: 0o600, flag: 'wx' });
    await callback({
      ...environment(),
      REAL_ACCEPTANCE_BASE_URL: `${appOrigin}/api`,
      REAL_ACCEPTANCE_RUNTIME_URL: `${authorityOrigin}/auth/v1`,
      REAL_ACCEPTANCE_PROJECT_REF: project.ref,
      REAL_ACCEPTANCE_CONFIRM_PROJECT: project.ref,
      REAL_ACCEPTANCE_ALLOCATION_JOURNAL: directory,
      REAL_ACCEPTANCE_BROWSER_IDENTITY_RECEIPT: path,
      REAL_ACCEPTANCE_BROWSER_EMAIL: ownedEmail,
      REAL_ACCEPTANCE_BROWSER_USER_ID: ownedUserId,
      REAL_ACCEPTANCE_BROWSER_MFA_FACTOR_ID: ownedFactorId,
      REAL_ACCEPTANCE_BROWSER_MFA_SECRET: 'GEZDGNBVGY3TQOJQGEZDGNBVGY3TQOJQ',
    }, directory);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
}

describe('browser acceptance offline configuration', () => {
  test('only the explicit fixed Chrome channel is accepted', () => {
    expect(browserChannel({})).toBeUndefined();
    expect(browserChannel({ REAL_ACCEPTANCE_BROWSER_CHANNEL: 'chrome' })).toBe('chrome');
    for (const value of ['', 'chromium', 'chrome-beta', '/tmp/browser', ' chrome', 'CHROME']) {
      expect(() => browserChannel({ REAL_ACCEPTANCE_BROWSER_CHANNEL: value })).toThrow('BROWSER_CONFIG_INVALID');
    }
    let reads = 0;
    const env = {};
    Object.defineProperty(env, 'REAL_ACCEPTANCE_BROWSER_CHANNEL', { get() { reads++; return 'chrome'; } });
    expect(() => browserChannel(env)).toThrow('BROWSER_CONFIG_INVALID');
    expect(reads).toBe(0);
  });

  test.each([
    [59_000, '287082'], [1_111_111_109_000, '081804'], [1_111_111_111_000, '050471'],
    [1_234_567_890_000, '005924'], [2_000_000_000_000, '279037'], [20_000_000_000_000, '353130'],
  ])('generates six-digit RFC 6238 SHA1 output at %i', async (now, expected) => {
    expect(await browserTotpCode('GEZDGNBVGY3TQOJQGEZDGNBVGY3TQOJQ', now)).toBe(expected);
  });

  test('rejects malformed TOTP seeds and timestamps without exposing values', async () => {
    for (const seed of ['', 'secret-not-for-output', 'GEZDGNBVGY3TQOJQGEZDGNBVGY3TQOJQ=', 'A'.repeat(31)]) {
      await expect(browserTotpCode(seed, 0)).rejects.toThrow('BROWSER_CONFIG_INVALID');
    }
    for (const now of [-1, NaN, Infinity, 1.5, Number.MAX_SAFE_INTEGER + 1]) {
      await expect(browserTotpCode('GEZDGNBVGY3TQOJQGEZDGNBVGY3TQOJQ', now)).rejects.toThrow('BROWSER_CONFIG_INVALID');
    }
  });

  test('validates isolated target without starting a browser', () => {
    const env = environment();
    const config = browserConfiguration(parseAcceptanceTarget(env), env);
    expect(config.origin).toBe(origin);
    expect(config.target.projectRef).toBe(projectRef);
  });

  test.each(['REAL_ACCEPTANCE_BROWSER_EMAIL', 'REAL_ACCEPTANCE_BROWSER_PASSWORD'])(
    'missing %s is blocked before launch', async (key) => {
      const env = environment();
      const target = parseAcceptanceTarget(env);
      delete env[key];
      const result = await runBrowserAcceptance(target, env);
      expect(result.status).toBe('blocked');
      expect(result.checks).toBe(0);
      expect(result.code).toStartWith('BROWSER_CONFIG_REQUIRED:');
      expect(result.code).toContain('uiPuts=0:uiListGets=0:sdkReads=0');
    },
  );

  test('does not invoke credential accessors or disclose exception text', async () => {
    const env = environment();
    const target = parseAcceptanceTarget(env);
    let reads = 0;
    Object.defineProperty(env, 'REAL_ACCEPTANCE_BROWSER_PASSWORD', {
      get() { reads++; throw new Error('secret-must-not-escape'); },
    });
    const result = await runBrowserAcceptance(target, env);
    expect(reads).toBe(0);
    expect(result.status).toBe('blocked');
    expect(JSON.stringify(result)).not.toContain('secret-must-not-escape');
  });

  test('rejects target replacement without retaining either target', async () => {
    const env = environment();
    const target = { ...parseAcceptanceTarget(env), projectRef: 'replacement-secret-project' };
    const result = await runBrowserAcceptance(target, env);
    expect(result.code).toStartWith('BROWSER_CONFIG_INVALID:');
    expect(JSON.stringify(result)).not.toContain('replacement-secret-project');
  });

  test.each(['DEBUG', 'PWDEBUG'])('rejects %s before credentials reach browser logging', async (key) => {
    const env = environment();
    env[key] = 'pw:*';
    const result = await runBrowserAcceptance(parseAcceptanceTarget(env), env);
    expect(result.code).toStartWith('BROWSER_DEBUG_FORBIDDEN:');
    expect(result.checks).toBe(0);
  });

  test('rejects production even when caller supplies matching target fields', () => {
    const env = environment();
    const target = parseAcceptanceTarget(env);
    env['REAL_ACCEPTANCE_BASE_URL'] = 'https://auth.ai.xigu.team/api';
    env['REAL_ACCEPTANCE_RUNTIME_URL'] = 'https://auth.ai.xigu.team/auth/v1';
    expect(() => browserConfiguration(target, env)).toThrow('BROWSER_CONFIG_INVALID');
  });
});

describe('browser origin, redirect and mutation guard', () => {
  test.each([
    'https://other.invalid/login', 'http://127.0.0.1:5187/admin',
    'https://127.0.0.1:5191/admin', 'http://name:secret@127.0.0.1:5191/admin',
    'javascript:alert(1)', 'data:text/html,secret', 'file:///tmp/secret',
    '//127.0.0.1:5191/admin', ' http://127.0.0.1:5191/admin',
    'http://127.0.0.1:5191\\@evil.invalid/', 'not-a-url',
  ])('rejects unsafe destination %s', (url) => {
    expect(sameBrowserOrigin(url, origin)).toBe(false);
    expect(permittedBrowserRequest(url, 'GET', origin, authPosts, writeUrl, null)).toBe(false);
  });

  test('allows same-origin real GET and exact discovered auth endpoint', () => {
    expect(permittedBrowserRequest(`${origin}/api/v1/webhooks`, 'GET', origin, authPosts, null, null)).toBe(true);
    expect(permittedBrowserRequest(`${origin}/auth/v1/token?grant_type=password`, 'POST',
      origin, authPosts, null, passwordBody, 'application/json')).toBe(true);
    expect(permittedBrowserRequest(`${origin}/auth/v1/signup`, 'POST', origin, authPosts, null, '{}')).toBe(false);
  });

  test.each([null, '{}', '{"enabled":false}', '{"enabled":true,"events":["user.created"]}',
    '{"enabled":true,"url":"https://other.invalid"}', '{"enabled":1}', 'null', '[]', 'invalid'])(
    'rejects unapproved toggle payload %s', (body) => {
      expect(permittedToggle(body)).toBe(false);
      expect(permittedBrowserRequest(writeUrl, 'PUT', origin, authPosts, writeUrl, body)).toBe(false);
    },
  );

  test('only exact owned URL and exact enabled-only body can mutate', () => {
    expect(permittedToggle('{"enabled":true}')).toBe(true);
    expect(permittedBrowserRequest(writeUrl, 'PUT', origin, authPosts, writeUrl, '{"enabled":true}')).toBe(true);
    for (const url of [`${writeUrl}?extra=1`, `${writeUrl}/test`, `${writeUrl}-other`]) {
      expect(permittedBrowserRequest(url, 'PUT', origin, authPosts, writeUrl, '{"enabled":true}')).toBe(false);
    }
    for (const method of ['DELETE', 'PATCH', 'POST']) {
      expect(permittedBrowserRequest(writeUrl, method, origin, authPosts, writeUrl, '{"enabled":true}')).toBe(false);
    }
    expect(permittedBrowserRequest(writeUrl, 'PUT', origin, authPosts, null, '{"enabled":true}')).toBe(false);
  });

  test('allows only same-origin read redirects; blocks write replays and external Location', () => {
    expect(permittedBrowserRedirect('/admin/webhooks', `${origin}/login`, 'GET', origin)).toBe(true);
    for (const location of ['//other.invalid/path', 'https://other.invalid/path', 'data:text/html,x', '\\\\other.invalid']) {
      expect(permittedBrowserRedirect(location, `${origin}/login`, 'GET', origin)).toBe(false);
    }
    for (const method of ['POST', 'PUT', 'DELETE']) {
      expect(permittedBrowserRedirect('/admin/webhooks', writeUrl, method, origin)).toBe(false);
    }
  });

  test('SDK reads use exact project/list/owned-ID paths, without queries or other management paths', () => {
    const target = parseAcceptanceTarget(environment());
    for (const url of [`${origin}/api/v1/project`, `${origin}/api/v1/webhooks`, writeUrl]) {
      expect(permittedBrowserSdkRead(url, 'GET', target, 'owned-id')).toBe(true);
      expect(permittedBrowserSdkRead(url, 'POST', target, 'owned-id')).toBe(false);
    }
    for (const url of [`${writeUrl}-other`, `${writeUrl}?extra=1`, `${origin}/api/v1/users`, `${writeUrl}/logs`]) {
      expect(permittedBrowserSdkRead(url, 'GET', target, 'owned-id')).toBe(false);
    }
    expect(permittedBrowserSdkRead(writeUrl, 'GET', target, null)).toBe(false);
  });

  test('discovery cannot grant a POST exception to an arbitrary same-origin management endpoint', () => {
    const target = parseAcceptanceTarget(environment());
    const discovery = {
      authorization_endpoint: `${origin}/auth/v1/oauth/authorize`,
      token_endpoint: `${origin}/auth/v1/oauth/token`,
      userinfo_endpoint: `${origin}/auth/v1/user`,
    };
    expect(browserDiscovery(discovery, target).token_endpoint).toBe(discovery.token_endpoint);
    expect(browserDiscovery({
      ...discovery, scopes_supported: ['openid'], claims_parameter_supported: false,
    }, target).token_endpoint).toBe(discovery.token_endpoint);
    for (const token_endpoint of [`${origin}/api/v1/users`, 'https://other.invalid/token',
      `${discovery.token_endpoint}?alternate=1`]) {
      expect(() => browserDiscovery({ ...discovery, token_endpoint }, target)).toThrow();
    }
    expect(() => browserDiscovery({ ...discovery, userinfo_endpoint: 'https://other.invalid/user' }, target)).toThrow();
  });
});

describe('R8 authentication POST ownership and payload guard', () => {
  const tokenUrl = `${authorityOrigin}/auth/v1/oauth/token`;
  const passwordUrl = `${authorityOrigin}/auth/v1/token?grant_type=password`;
  const consentUrl = `${authorityOrigin}/v1/public/oauth/authorizations/owned-authorization/consent`;
  const verifier = 'dBjftJeZ4CVP-mB92K27uhbUJU1p1r_wW1gFWFOEjXk';
  const codeChallenge = 'E9Melhoa2OwvFrEMTJguCHaoeK1t8URWbuGJSstw-cM';
  const clientId = 'owned-client';
  const redirectUri = `${appOrigin}/admin`;
  const state = 'offline-state-for-owned-run';
  const authorizationEndpoint = `${authorityOrigin}/auth/v1/oauth/authorize`;
  const authorizationQuery = {
    response_type: 'code', client_id: clientId, redirect_uri: redirectUri, scope: 'openid profile email',
    state, code_challenge: codeChallenge, code_challenge_method: 'S256',
  };
  const authorizationUrl = `${authorizationEndpoint}?${new URLSearchParams(authorizationQuery)}`;
  const attempt = browserAuthorizationRequest(authorizationUrl, authorizationEndpoint, clientId, redirectUri);
  const codeBody = {
    grant_type: 'authorization_code', client_id: clientId, code: 'owned-code',
    redirect_uri: redirectUri, code_verifier: verifier,
  };
  const codeForm = new URLSearchParams(codeBody).toString();
  const posts = new Map<string, BrowserAuthPost>([
    [passwordUrl, { kind: 'password', email: ownedEmail, password: 'offline-password' }],
    [tokenUrl, { kind: 'oauth-code', clientId, redirectUri, code: 'owned-code', codeChallenge }],
    [consentUrl, { kind: 'consent', authorizationId: 'owned-authorization', bearer: 'Bearer owned-password-session' }],
  ]);
  const origins = new Set([appOrigin, authorityOrigin]);
  const allows = (url: string, body: string | null, type = 'application/json', bearer: string | null = null) =>
    permittedBrowserRequest(url, 'POST', origins, posts, null, body, type, bearer);

  test('allows only the exact run-owned password identity and SDK JSON request shape', () => {
    const body = { email: ownedEmail, password: 'offline-password', gotrue_meta_security: {} };
    expect(allows(passwordUrl, JSON.stringify(body))).toBe(true);
    expect(allows(passwordUrl, JSON.stringify({ email: ownedEmail, password: 'offline-password' }))).toBe(true);
    for (const value of [
      null, '{}', 'not-json', '[]', '"arbitrary"',
      JSON.stringify({ ...body, email: 'existing@example.invalid' }),
      JSON.stringify({ ...body, password: 'other-password' }),
      JSON.stringify({ ...body, phone: '+10000000000' }),
      JSON.stringify({ ...body, gotrue_meta_security: { unexpected: true } }),
      JSON.stringify({ ...body, grant_type: 'refresh_token' }),
      `{"email":"existing@example.invalid","email":"${ownedEmail}","password":"offline-password"}`,
    ]) expect(allows(passwordUrl, value)).toBe(false);
    expect(allows(passwordUrl, JSON.stringify(body), 'text/plain')).toBe(false);
  });

  test('never widens the exact password query to refresh, duplicate grants or queryless token writes', () => {
    const body = JSON.stringify({ email: ownedEmail, password: 'offline-password' });
    for (const url of [
      passwordUrl.replace('?grant_type=password', ''),
      passwordUrl.replace('grant_type=password', 'grant_type=refresh_token'),
      `${passwordUrl}&grant_type=password`, `${passwordUrl}&grant_type=refresh_token`,
      `${passwordUrl}&client_id=existing-client`, `${passwordUrl}#fragment`,
    ]) expect(allows(url, body)).toBe(false);
  });

  test('binds authorization-code form to the owned client, exact callback, observed code and S256 verifier', () => {
    expect(allows(tokenUrl, codeForm, 'application/x-www-form-urlencoded;charset=UTF-8')).toBe(true);
    for (const body of [
      null, '', '{}', JSON.stringify(codeBody),
      new URLSearchParams({ ...codeBody, client_id: 'existing-client' }).toString(),
      new URLSearchParams({ ...codeBody, redirect_uri: 'https://other.invalid/callback' }).toString(),
      new URLSearchParams({ ...codeBody, code: 'unbound-code' }).toString(),
      new URLSearchParams({ ...codeBody, code_verifier: 'x'.repeat(43) }).toString(),
      new URLSearchParams({ ...codeBody, grant_type: 'refresh_token' }).toString(),
      new URLSearchParams({ ...codeBody, client_secret: 'unexpected-secret' }).toString(),
      `${codeForm}&client_id=existing-client`, `${codeForm}&client_id=${clientId}`,
      `${codeForm}&%63lient_id=${clientId}`, `${codeForm}&extra=%ZZ`, `${codeForm}&extra=%FF`,
      new URLSearchParams({ client_id: clientId, grant_type: 'refresh_token', refresh_token: 'other-session' }).toString(),
    ]) expect(allows(tokenUrl, body, 'application/x-www-form-urlencoded')).toBe(false);
    expect(allows(tokenUrl, codeForm, 'text/plain')).toBe(false);
    expect(allows(tokenUrl, codeForm, 'application/x-www-form-urlencoded', 'Basic other-client')).toBe(false);
    expect(allows(`${tokenUrl}?client_id=${clientId}`, codeForm, 'application/x-www-form-urlencoded')).toBe(false);
  });

  test('consent requires only approve, exact bound authorization and the actual owned password bearer', () => {
    expect(allows(consentUrl, '{"action":"approve"}', 'application/json', 'Bearer owned-password-session')).toBe(true);
    for (const body of [
      null, '{}', 'null', '[]', '"approve"', '{"action":"deny"}', '{"action":true}',
      '{"action":"approve","extra":"unvalidated"}',
      '{"action":"approve","authorization_id":"other"}',
      '{"action":"deny","action":"approve"}',
    ]) expect(allows(consentUrl, body, 'application/json', 'Bearer owned-password-session')).toBe(false);
    expect(allows(consentUrl, '{"action":"approve"}')).toBe(false);
    expect(allows(consentUrl, '{"action":"approve"}', 'application/json', 'Bearer other-session')).toBe(false);
    expect(allows(consentUrl.replace('owned-authorization', 'other'), '{"action":"approve"}',
      'application/json', 'Bearer owned-password-session')).toBe(false);
  });

  test('observed authorization must itself request the owned client and exact redirect with S256/state', () => {
    expect(attempt.codeChallenge).toBe(codeChallenge);
    for (const query of [
      { ...authorizationQuery, client_id: 'existing-client' },
      { ...authorizationQuery, redirect_uri: `${authorityOrigin}/admin` },
      { ...authorizationQuery, code_challenge_method: 'plain' },
      { ...authorizationQuery, code_challenge: '' },
      { ...authorizationQuery, state: '' },
      { ...authorizationQuery, scope: 'openid profile email admin' },
      { ...authorizationQuery, response_type: 'token' },
      { ...authorizationQuery, prompt: 'none' },
    ]) expect(() => browserAuthorizationRequest(
      `${authorizationEndpoint}?${new URLSearchParams(query)}`, authorizationEndpoint, clientId, redirectUri,
    )).toThrow('BROWSER_SSO_REQUIRED');
    expect(() => browserAuthorizationRequest(`${authorizationUrl}&client_id=${clientId}`,
      authorizationEndpoint, clientId, redirectUri)).toThrow('BROWSER_SSO_REQUIRED');
  });

  test('syntax-only page IDs cannot substitute for authoritative client/user/redirect authorization details', () => {
    const details = {
      authorization_id: 'owned-authorization', client: { id: clientId }, user: { id: ownedUserId },
      scope: 'openid profile email', redirect_uri: redirectUri,
    };
    expect(browserAuthorizationDetails(details, attempt, 'owned-authorization', ownedUserId)).toBe(true);
    for (const value of [
      null, {}, { redirect_url: `${redirectUri}?code=owned-code&state=${state}` },
      { ...details, authorization_id: 'other' },
      { ...details, client: { id: 'existing-client' } },
      { ...details, user: { id: ownedFactorId } },
      { ...details, redirect_uri: `${authorityOrigin}/admin` },
      { ...details, scope: 'openid admin' },
      { authorization_id: 'owned-authorization', client: { id: clientId }, user: { id: ownedUserId }, scope: 'openid profile email' },
    ]) expect(browserAuthorizationDetails(value, attempt, 'owned-authorization', ownedUserId)).toBe(false);
  });

  test('consent response must bind callback code to the current state, app path and issuer', () => {
    const url = `${redirectUri}?${new URLSearchParams({ code: 'owned-code', state })}`;
    expect(browserOAuthCallback({ redirect_url: url }, attempt, `${authorityOrigin}/auth/v1`).code).toBe('owned-code');
    for (const callback of [
      url.replace(redirectUri, 'https://other.invalid/callback'),
      url.replace(`state=${state}`, 'state=other'), `${url}&state=${state}`, `${url}&code=other`,
      `${url}&iss=https%3A%2F%2Fother.invalid`, `${url}&error=access_denied`, `${url}#fragment`,
      `${redirectUri}?state=${state}`, `${redirectUri}?code=&state=${state}`,
    ]) expect(() => browserOAuthCallback({ redirect_url: callback }, attempt, `${authorityOrigin}/auth/v1`))
      .toThrow('BROWSER_LOGIN_BLOCKED');
  });

  test('allowing a read never installs an authentication write capability', () => {
    const empty = new Map<string, BrowserAuthPost>();
    for (const url of [passwordUrl, tokenUrl, consentUrl, `${authorityOrigin}/auth/v1/admin/users`]) {
      expect(permittedBrowserRequest(url, 'GET', origins, empty, null, null)).toBe(true);
      expect(permittedBrowserRequest(url, 'POST', origins, empty, null, '{}', 'application/json')).toBe(false);
    }
    expect(empty.size).toBe(0);
  });
});

describe('allocation-bound dual-origin browser and owned identity', () => {
  test('derives exactly two origins from proof and validates the private identity receipt', async () => {
    await withAllocation((env) => {
      const target = parseAcceptanceTarget(env);
      const config = browserConfiguration(target, env);
      expect([...config.origins]).toEqual([appOrigin, authorityOrigin]);
      expect(config.mfa?.factorId).toBe(ownedFactorId);
      expect(config.identity?.client.readback.id).toBe('owned-client');
      expect(() => browserConfiguration({ ...target }, env)).toThrow('BROWSER_CONFIG_INVALID');
      for (const url of [`${appOrigin}/admin`, `${authorityOrigin}/authorize.html`]) {
        expect(permittedBrowserRequest(url, 'GET', config.origins, new Map<string, BrowserAuthPost>(), null, null)).toBe(true);
        expect(permittedBrowserRedirect(url, `${appOrigin}/admin`, 'GET', config.origins)).toBe(true);
      }
      expect(permittedBrowserRedirect(`${appOrigin}/admin`, 'https://evil.invalid/', 'GET', config.origins)).toBe(false);
      expect(permittedBrowserRedirect(`${authorityOrigin}/admin`, `${appOrigin}/admin`, 'POST', config.origins)).toBe(false);
      env['REAL_ACCEPTANCE_BROWSER_ALLOWED_ORIGINS'] = 'https://evil.invalid';
      expect(permittedBrowserRequest('https://evil.invalid/', 'GET',
        browserConfiguration(target, env).origins, new Map<string, BrowserAuthPost>(), null, null)).toBe(false);
      expect(browserDiscovery({
        authorization_endpoint: `${authorityOrigin}/auth/v1/oauth/authorize`,
        token_endpoint: `${authorityOrigin}/auth/v1/oauth/token`,
        userinfo_endpoint: `${authorityOrigin}/auth/v1/oauth/userinfo`,
        scopes_supported: ['openid'],
      }, target).token_endpoint).toBe(`${authorityOrigin}/auth/v1/oauth/token`);
      expect(browserConsentUrl(`${authorityOrigin}/authorize.html?authorization_id=owned`, target))
        .toBe(`${authorityOrigin}/v1/public/oauth/authorizations/owned/consent`);
      expect(browserConsentUrl(`${appOrigin}/oauth/authorize?authorization_id=owned`, target))
        .toBe(`${appOrigin}/api/v1/public/oauth/authorizations/owned/consent`);
      for (const page of [
        `${authorityOrigin}/other?authorization_id=owned`,
        `${authorityOrigin}/authorize.html?authorization_id=owned&authorization_id=other`,
        'https://evil.invalid/authorize.html?authorization_id=owned',
      ]) expect(() => browserConsentUrl(page, target)).toThrow('BROWSER_LOGIN_BLOCKED');
    });
  });

  test('requires both allocation provenance and main identity evidence before launch', async () => {
    await withAllocation(async (env) => {
      const target = parseAcceptanceTarget(env);
      for (const key of [
        'REAL_ACCEPTANCE_BROWSER_IDENTITY_RECEIPT', 'REAL_ACCEPTANCE_BROWSER_USER_ID',
        'REAL_ACCEPTANCE_BROWSER_MFA_FACTOR_ID', 'REAL_ACCEPTANCE_BROWSER_MFA_SECRET',
      ]) {
        const missing = { ...env };
        delete missing[key];
        const result = await runBrowserAcceptance(target, missing);
        expect(result.status).toBe('blocked');
        expect(result.checks).toBe(0);
        expect(result.code).toStartWith('BROWSER_CONFIG_INVALID:');
      }
      const changed = { ...env, REAL_ACCEPTANCE_RUNTIME_URL: 'https://evil.invalid/auth/v1' };
      expect(() => browserConfiguration(target, changed)).toThrow('BROWSER_CONFIG_INVALID');
    });
  });

  test('rejects stale, mismatched and preexisting resource receipts', async () => {
    await withAllocation((env) => {
      const target = parseAcceptanceTarget(env);
      const receipt = identityReceipt();
      expect(validateBrowserIdentityReceipt(receipt, target).factor.readback.id).toBe(ownedFactorId);
      for (const value of [
        { ...receipt, runId: ownedUserId },
        { ...receipt, projectRef: TEST_IDENTITY_OWNER_REF },
        { ...receipt, authorityRef: receipt.projectRef },
        { ...receipt, before: { matchingUserIds: [ownedUserId], matchingClientIds: [] } },
        { ...receipt, before: { matchingUserIds: [], matchingClientIds: ['owned-client'] } },
        { ...receipt, intent: { ...receipt.intent, recordedAt: '2026-09-09T00:00:02Z' } },
        { ...receipt, intent: { ...receipt.intent, recordedAt: '2026-99-99T00:00:00Z' } },
        { ...receipt, intent: { ...receipt.intent, email: 'existing@xai.xigu.team' } },
        { ...receipt, client: { ...receipt.client, readback: { ...receipt.client.readback, id: 'other' } } },
        { ...receipt, client: { ...receipt.client, readback: { ...receipt.client.readback, redirectUri: `${authorityOrigin}/admin` } } },
        { ...receipt, user: { ...receipt.user, readback: { ...receipt.user.readback, id: ownedFactorId } } },
        { ...receipt, factor: { ...receipt.factor, readback: { ...receipt.factor.readback, userId: ownedFactorId } } },
        { ...receipt, factor: { ...receipt.factor, readback: { ...receipt.factor.readback, status: 'unverified' } } },
        { ...receipt, secret: 'never-accepted' },
      ]) expect(() => validateBrowserIdentityReceipt(value, target)).toThrow('BROWSER_CONFIG_INVALID');
    });
  });

  test('receipt loader rejects public permissions, links, bad JSON and accessors', async () => {
    await withAllocation(async (env, directory) => {
      const target = parseAcceptanceTarget(env);
      const path = join(directory, 'browser-identity.json');
      await chmod(path, 0o644);
      expect(() => loadBrowserIdentityReceipt(env, target)).toThrow('BROWSER_CONFIG_INVALID');
      await chmod(path, 0o600);
      const link = join(directory, 'identity-link.json');
      await symlink(path, link);
      expect(() => loadBrowserIdentityReceipt({
        ...env, REAL_ACCEPTANCE_BROWSER_IDENTITY_RECEIPT: link,
      }, target)).toThrow('BROWSER_CONFIG_INVALID');
      await writeFile(path, '{"secret":"sentinel-not-to-be-printed"');
      expect(() => loadBrowserIdentityReceipt(env, target)).toThrow('BROWSER_CONFIG_INVALID');
      let reads = 0;
      Object.defineProperty(env, 'REAL_ACCEPTANCE_BROWSER_IDENTITY_RECEIPT', {
        get() { reads++; throw new Error('sentinel-not-to-be-printed'); },
      });
      expect(() => loadBrowserIdentityReceipt(env, target)).toThrow('BROWSER_CONFIG_INVALID');
      expect(reads).toBe(0);
    });
  });
});

describe('owned real MFA boundary', () => {
  const expected = { userId: ownedUserId, email: ownedEmail, factorId: ownedFactorId };
  const factor = { id: ownedFactorId, factor_type: 'totp', status: 'verified' };
  const user = { id: ownedUserId, email: ownedEmail, factors: [factor] };

  test('requires the exact user, email and unique verified TOTP factor in the real user response', () => {
    expect(browserMfaUser(user, expected)).toBe(true);
    for (const value of [
      null, {}, { ...user, id: ownedFactorId }, { ...user, email: 'other@xai.xigu.team' },
      { ...user, factors: [] }, { ...user, factors: [factor, factor] },
      { ...user, factors: [{ ...factor, status: 'unverified' }] },
      { ...user, factors: [{ ...factor, factor_type: 'phone' }] },
      { ...user, factors: [{ ...factor, id: challengeId }] },
    ]) expect(browserMfaUser(value, expected)).toBe(false);
  });

  test('MFA verification requires actual token material and the same owned user/factor', () => {
    const verification = { access_token: 'offline-access', refresh_token: 'offline-refresh', user };
    expect(browserMfaVerification(verification, expected)).toBe('offline-access');
    for (const value of [
      null, {}, { ...verification, access_token: '' }, { ...verification, refresh_token: '' },
      { ...verification, error: 'untrusted-error-with-secret' },
      { ...verification, user: { ...user, id: ownedFactorId } },
      { ...verification, user: { ...user, factors: [] } },
    ]) expect(() => browserMfaVerification(value, expected)).toThrow('BROWSER_MFA_FAILED');
  });

  test('permits only the exact selected factor challenge and one matching challenge/code verification body', () => {
    expect(permittedBrowserMfaBody('challenge', JSON.stringify({ factorId: ownedFactorId }),
      ownedFactorId, null, null)).toBe(true);
    expect(permittedBrowserMfaBody('verify', JSON.stringify({ challenge_id: challengeId, code: '287082' }),
      ownedFactorId, challengeId, '287082')).toBe(true);
    for (const body of [
      null, '{}', JSON.stringify({ factorId: challengeId }),
      JSON.stringify({ factorId: ownedFactorId, channel: 'sms' }),
    ]) expect(permittedBrowserMfaBody('challenge', body, ownedFactorId, null, null)).toBe(false);
    for (const body of [
      null, '{}', JSON.stringify({ challenge_id: ownedFactorId, code: '287082' }),
      JSON.stringify({ challenge_id: challengeId, code: '000000' }),
      JSON.stringify({ challenge_id: challengeId, code: '287082', factorId: ownedFactorId }),
    ]) expect(permittedBrowserMfaBody('verify', body, ownedFactorId, challengeId, '287082')).toBe(false);
    expect(permittedBrowserMfaBody('verify', JSON.stringify({ challenge_id: challengeId, code: '287082' }),
      ownedFactorId, null, '287082')).toBe(false);
  });

  test('MFA exceptions never permit enrollment, another factor, query variants or deletion', () => {
    const origins = new Set([appOrigin, authorityOrigin]);
    const base = `${authorityOrigin}/auth/v1/factors/${ownedFactorId}`;
    const posts = new Map<string, BrowserAuthPost>([
      [`${base}/challenge`, { kind: 'mfa-challenge', factorId: ownedFactorId, bearer: 'Bearer offline' }],
      [`${base}/verify`, {
        kind: 'mfa-verify', factorId: ownedFactorId, challengeId, code: '287082', bearer: 'Bearer offline',
      }],
    ]);
    expect(permittedBrowserRequest(`${base}/challenge`, 'POST', origins, posts, null,
      JSON.stringify({ factorId: ownedFactorId }), 'application/json', 'Bearer offline')).toBe(true);
    expect(permittedBrowserRequest(`${base}/challenge`, 'POST', origins, posts, null,
      JSON.stringify({ factorId: ownedFactorId }), 'application/json', 'Bearer other')).toBe(false);
    for (const url of [
      `${authorityOrigin}/auth/v1/factors`, `${base}/challenge?extra=1`,
      `${authorityOrigin}/auth/v1/factors/${challengeId}/verify`,
      `${appOrigin}/auth/v1/factors/${ownedFactorId}/challenge`,
      `${authorityOrigin}/auth/v1/admin/users`,
    ]) expect(permittedBrowserRequest(url, 'POST', origins, posts, null, '{}')).toBe(false);
    expect(permittedBrowserRequest(`${base}/verify`, 'DELETE', origins, posts, null, '{}')).toBe(false);
  });
});

describe('real webhook response completeness', () => {
  test('uses the shared wire schema for complete and empty lists', () => {
    expect(completeBrowserWebhookList({ items: [webhook], total: 1, page: 1, limit: 10 })).toHaveLength(1);
    expect(completeBrowserWebhookList({ items: [], total: 0 })).toEqual([]);
  });

  test.each([
    { items: [webhook], total: 2 },
    { items: [webhook], total: 1, page: 2, limit: 1 },
    { items: [webhook], total: 1, limit: 0 },
    { items: [webhook], total: 1, limit: 1.5 },
    { items: [webhook, webhook], total: 2 },
    { items: [{ ...webhook, id: '' }], total: 1 },
    { items: [{ ...webhook, enabled: 'true' }], total: 1 },
    { items: [{ ...webhook, events: [1] }], total: 1 },
    { items: [null], total: 1 },
  ])('rejects incomplete, ambiguous or invalid lists %#', (payload) => {
    expect(() => completeBrowserWebhookList(payload)).toThrow();
  });
});
