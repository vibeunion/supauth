import { describe, expect, test } from 'bun:test';
import { mkdtemp, readFile, readdir, rm, stat } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  createRunIdentityFixture, IdentityFixtureError, type IdentityFixtureOptions,
} from '../scripts/real-contract-identities.js';
import {
  createAllocationJournal, loadAllocationProof, TEST_IDENTITY_OWNER_REF,
} from '../scripts/real-contract-allocation.js';
import { parseAcceptanceTarget } from '../scripts/real-contract-acceptance-contract.js';
import { validateBrowserIdentityReceipt } from '../scripts/real-contract-browser.js';
import { requireRecord } from '../scripts/tooling-values.js';

const RUN = '34567890-1234-4abc-8def-1234567890ab';
const REF = 'cdefghijklmnopqrstuv';
const ORIGIN = `https://contract-${RUN}.xai.xigu.team`;
const OWNER = 'https://auth.xai.xigu.team';
const ADMIN = '11111111-1111-4111-8111-111111111111';
const USER = '22222222-2222-4222-8222-222222222222';
const FACTOR = '33333333-3333-4333-8333-333333333333';
const CHALLENGE = '44444444-4444-4444-8444-444444444444';
const SEED = 'JBSWY3DPEHPK3PXPJBSWY3DPEHPK3PXP';
const MANAGEMENT_KEY = 'offline-management-secret';
const OWNER_KEY = 'offline-owner-service-secret';
const PUBLIC_KEY = 'offline-owner-public-key';
const NAME = `supauth-contract-${RUN}`;
type MockFactor = { id: string; factor_type: string; status: string; friendly_name: string };
type MockUser = {
  id: string; email: string; created_at: string; email_confirmed_at: string; factors: MockFactor[];
};
type MockClient = {
  client_id: string; client_name: string; client_type: string;
  token_endpoint_auth_method: string; redirect_uris: string[]; grant_types: string[];
};
type Call = { url: URL; init: RequestInit; method: string; headers: Headers; body: unknown };
type State = {
  calls: Call[]; users: Map<string, MockUser>; clients: Map<string, MockClient>;
  sessions: Map<string, string>;
};
type Hook = (call: Call, state: State) => Response | undefined | Promise<Response | undefined>;

function missing(): Response { return Response.json({ error: 'not_found' }, { status: 404 }); }
function userFixture(id: string, email: string): MockUser {
  const now = new Date().toISOString();
  return { id, email, created_at: now, email_confirmed_at: now, factors: [] };
}
function textField(body: unknown, field: string): string {
  const value = requireRecord(body)[field];
  if (typeof value !== 'string') throw new Error('offline fixture field missing');
  return value;
}
function mockTransport(state: State, hook: Hook): IdentityFixtureOptions['fetchImpl'] {
  return async (url, init) => {
    const call: Call = {
      url, init, method: init.method ?? 'GET', headers: new Headers(init.headers),
      body: typeof init.body === 'string' ? JSON.parse(init.body) : null,
    };
    state.calls.push(call);
    const override = await hook(call, state);
    if (override) return override;
    const path = url.pathname.replace(`/v1/projects/${TEST_IDENTITY_OWNER_REF}/auth`, '')
      .replace(/^\/auth\/v1/, '');
    if (url.origin === 'http://127.0.0.1:29190') {
      if (path === '/runtime') return Response.json({
        project_ref: TEST_IDENTITY_OWNER_REF, authority_project_ref: TEST_IDENTITY_OWNER_REF,
        owner_project_ref: TEST_IDENTITY_OWNER_REF, mode: 'owner', local_gotrue_enabled: true,
      });
      if (path === '/oauth-server') return Response.json({
        project_ref: TEST_IDENTITY_OWNER_REF, enabled: true, issuer: `${OWNER}/auth/v1`,
      });
      if (path === '/users' && call.method === 'GET') {
        const search = url.searchParams.get('search');
        const users = [...state.users.values()].filter(user => user.email === search);
        return Response.json({ users, total: users.length, page: 1, per_page: 100 });
      }
      if (path === '/users' && call.method === 'POST') {
        const email = textField(call.body, 'email');
        const user = userFixture(email.startsWith('admin-') ? ADMIN : USER, email);
        state.users.set(user.id, user);
        return Response.json(user, { status: 201 });
      }
      if (path.startsWith('/users/')) {
        const id = path.split('/')[2] ?? '';
        const user = state.users.get(id);
        if (!user) return missing();
        if (path.endsWith(`/mfa/${FACTOR}/reset`) && call.method === 'POST') {
          user.factors = user.factors.filter(factor => factor.id !== FACTOR);
          return Response.json({ reset: true, factor_id: FACTOR });
        }
        if (call.method === 'GET') return Response.json(user);
        if (call.method === 'DELETE') {
          state.users.delete(id);
          return new Response(null, { status: 204 });
        }
      }
      if (path === '/oauth-clients' && call.method === 'POST') {
        const body = requireRecord(call.body);
        const client: MockClient = {
          client_id: 'owned-public-client', client_name: textField(body, 'client_name'),
          client_type: 'public', token_endpoint_auth_method: 'none',
          redirect_uris: [`${ORIGIN}/admin`], grant_types: ['authorization_code', 'refresh_token'],
        };
        state.clients.set(client.client_id, client);
        return Response.json(client, { status: 201 });
      }
      if (path.startsWith('/oauth-clients/')) {
        const id = path.split('/')[2] ?? '';
        const client = state.clients.get(id);
        if (!client) return missing();
        if (call.method === 'GET') return Response.json(client);
        if (call.method === 'DELETE') {
          state.clients.delete(id);
          return new Response(null, { status: 204 });
        }
      }
    } else if (url.origin === OWNER) {
      if (path === '/admin/oauth/clients') {
        const page = Number(url.searchParams.get('page'));
        const clients = [...state.clients.values()];
        return Response.json({ clients: clients.slice((page - 1) * 100, page * 100) },
          { headers: { 'x-total-count': String(clients.length) } });
      }
      if (path === '/token' && url.searchParams.get('grant_type') === 'password') {
        const email = textField(call.body, 'email');
        const user = [...state.users.values()].find(user => user.email === email);
        if (!user) return missing();
        const token = `offline-${user.id}-password-access`;
        state.sessions.set(token, user.id);
        return Response.json({ access_token: token, refresh_token: `${token}-refresh`, user });
      }
      const token = call.headers.get('authorization')?.replace(/^Bearer /, '') ?? '';
      const id = state.sessions.get(token);
      const user = id ? state.users.get(id) : undefined;
      if (!user) return new Response(null, { status: 401 });
      if (path === '/user') return Response.json(user);
      if (path === '/logout' && url.searchParams.get('scope') === 'local') {
        state.sessions.delete(token);
        return new Response(null, { status: 204 });
      }
      if (path === '/factors') {
        user.factors.push({ id: FACTOR, factor_type: 'totp', status: 'unverified', friendly_name: NAME });
        return Response.json({ id: FACTOR, type: 'totp', totp: { secret: SEED } });
      }
      if (path === `/factors/${FACTOR}/challenge`) return Response.json({
        id: CHALLENGE, type: 'totp', expires_at: Math.floor(Date.now() / 1000) + 60,
      });
      if (path === `/factors/${FACTOR}/verify`) {
        for (const factor of user.factors) factor.status = 'verified';
        const access = 'offline-admin-aal2-access';
        state.sessions.set(access, user.id);
        return Response.json({ access_token: access, refresh_token: `${access}-refresh`, user });
      }
    }
    throw new Error('offline unexpected request');
  };
}

async function withFixture(
  callback: (context: {
    options: IdentityFixtureOptions; state: State; root: string; journalPath: string;
  }) => Promise<void>,
  hook: Hook = () => undefined,
) {
  const root = await mkdtemp(join(tmpdir(), 'supauth-identity-offline-'));
  try {
    const project = {
      id: 'offline-id', created_at: new Date().toISOString(), ref: REF,
      name: NAME, api: { url: ORIGIN }, status: 'ACTIVE_HEALTHY',
    };
    const journal = await createAllocationJournal(root, {
      runId: RUN, name: NAME, projectOrigin: ORIGIN,
      managementOrigin: 'http://127.0.0.1:29190', authorityOrigin: OWNER,
      authorityRef: TEST_IDENTITY_OWNER_REF,
      beforeInventory: { complete: true, projects: [{ ref: TEST_IDENTITY_OWNER_REF, name: 'existing owner' }] },
    });
    await journal.createOnce(async () => project);
    await journal.bind({
      projectReadback: project, authorityOrigin: OWNER, authorityDescriptor: {
        project_ref: REF, mode: 'shared', authority_project_ref: TEST_IDENTITY_OWNER_REF,
        owner_project_ref: TEST_IDENTITY_OWNER_REF, local_gotrue_enabled: false,
        public_auth_route: 'owner_proxy', user_management: 'owner_only', configuration_management: 'owner_only',
      },
    });
    const journalPath = join(root, RUN);
    const proof = loadAllocationProof({ REAL_ACCEPTANCE_ALLOCATION_JOURNAL: journalPath });
    if (!proof) throw new Error('offline allocation proof missing');
    const state: State = { calls: [], users: new Map(), clients: new Map(), sessions: new Map() };
    await callback({
      root, state, journalPath, options: {
        root, allocationProof: proof, fetchImpl: mockTransport(state, hook),
        managementToken: MANAGEMENT_KEY, publicKey: PUBLIC_KEY,
        ownerServiceRoleKey: OWNER_KEY, timeoutMs: 100,
      },
    });
  } finally { await rm(root, { recursive: true, force: true }); }
}
function writes(state: State) { return state.calls.filter(call => call.method !== 'GET'); }
async function journalText(directory: string) {
  const files = await readdir(directory);
  const contents = await Promise.all(files.map(file => readFile(join(directory, file), 'utf8')));
  return contents.join('\n');
}

describe('owned identity preparation with offline platform and native GoTrue transport', () => {
  test('prepares two users, public client, native sessions and verified TOTP with compatible secret-free receipts', async () => {
    await withFixture(async ({ options, state, journalPath }) => {
      const fixture = await createRunIdentityFixture(options);
      expect(state.calls).toHaveLength(0);
      const prepared = await fixture.prepare();
      expect(prepared.admin.userId).toBe(ADMIN);
      expect(prepared.user.userId).toBe(USER);
      expect(prepared.admin.password).not.toBe(prepared.user.password);
      expect(prepared.mfa).toEqual({ userId: ADMIN, factorId: FACTOR, secret: SEED });
      const target = parseAcceptanceTarget({
        REAL_ACCEPTANCE_ALLOCATION_JOURNAL: journalPath,
        REAL_ACCEPTANCE_PROJECT_REF: REF, REAL_ACCEPTANCE_CONFIRM_PROJECT: REF,
        REAL_ACCEPTANCE_ENVIRONMENT: 'isolated-test', REAL_ACCEPTANCE_BASE_URL: `${ORIGIN}/api`,
        REAL_ACCEPTANCE_RUNTIME_URL: `${OWNER}/auth/v1`,
        REAL_ACCEPTANCE_ADMIN_TOKEN: prepared.admin.accessToken,
        REAL_ACCEPTANCE_USER_TOKEN: prepared.user.accessToken,
      });
      expect(validateBrowserIdentityReceipt(prepared.receipt, target)).toEqual(prepared.receipt);
      const text = await journalText(fixture.journalDirectory);
      for (const secret of [MANAGEMENT_KEY, OWNER_KEY, PUBLIC_KEY, SEED, prepared.admin.password,
        prepared.user.password, prepared.admin.accessToken, prepared.admin.refreshToken,
        prepared.user.accessToken, prepared.user.refreshToken]) expect(text).not.toContain(secret);
      expect(text).toContain('baseline-zero');
      expect(text).toContain('factor-baseline-zero');
      expect((await stat(prepared.receiptPath)).mode & 0o7777).toBe(0o600);
      expect((await stat(fixture.journalDirectory)).mode & 0o7777).toBe(0o700);
      const created = state.calls.filter(call => call.method === 'POST' && call.url.pathname.endsWith('/auth/users'));
      expect(created).toHaveLength(2);
      for (const call of state.calls) {
        expect(call.init.redirect).toBe('error');
        expect(call.init.credentials).toBe('omit');
        expect(call.headers.has('cookie')).toBe(false);
        if (call.url.origin === OWNER) {
          expect(call.headers.get('authorization')).not.toBe(`Bearer ${MANAGEMENT_KEY}`);
          if (call.url.pathname.endsWith('/admin/oauth/clients')) {
            expect(call.method).toBe('GET');
            expect(call.headers.get('apikey')).toBe(OWNER_KEY);
          } else expect(call.headers.get('apikey')).toBe(PUBLIC_KEY);
        } else expect(call.url.origin).toBe('http://127.0.0.1:29190');
        expect(call.url.origin).not.toBe(ORIGIN);
      }
      expect(await fixture.cleanup()).toEqual({ status: 'complete', code: 'IDENTITY_CLEANUP_COMPLETE' });
      expect(state.users.size).toBe(0);
      expect(state.clients.size).toBe(0);
      expect(state.calls.some(call => /policy|cors|config|migrate/.test(call.url.pathname))).toBe(false);
      const reset = state.calls.find(call => call.url.pathname.endsWith(`/mfa/${FACTOR}/reset`));
      expect(reset?.method).toBe('POST');
    });
  });

  test.each(['managementToken', 'publicKey', 'ownerServiceRoleKey'])('rejects missing %s without network', async field => {
    await withFixture(async ({ options, state }) => {
      await expect(createRunIdentityFixture({ ...options, [field]: '' })).rejects.toThrow('IDENTITY_CONFIG_INVALID');
      expect(state.calls).toHaveLength(0);
    });
  });

  test('copied allocation evidence cannot authorize identities', async () => {
    await withFixture(async ({ options, state }) => {
      await expect(createRunIdentityFixture({ ...options, allocationProof: { ...options.allocationProof } }))
        .rejects.toThrow('IDENTITY_CONFIG_INVALID');
      expect(state.calls).toHaveLength(0);
    });
  });

  test('the owner service key must not be reused as the public session key', async () => {
    await withFixture(async ({ options, state }) => {
      await expect(createRunIdentityFixture({ ...options, publicKey: OWNER_KEY })).rejects.toThrow('IDENTITY_CONFIG_INVALID');
      expect(state.calls).toHaveLength(0);
    });
  });

  test('durable exclusive intent and in-memory prepare state both prevent write replay', async () => {
    await withFixture(async ({ options, state }) => {
      const fixture = await createRunIdentityFixture(options);
      await expect(createRunIdentityFixture(options)).rejects.toThrow('IDENTITY_JOURNAL_FAILED');
      await fixture.prepare();
      const count = writes(state).length;
      await expect(fixture.prepare()).rejects.toThrow('IDENTITY_ALREADY_STARTED');
      expect(writes(state)).toHaveLength(count);
      await fixture.cleanup();
    });
  });

  test('baseline conflicts preserve existing users and block every write', async () => {
    await withFixture(async ({ options, state }) => {
      state.users.set(ADMIN, userFixture(ADMIN, `admin-${RUN}@xai.xigu.team`));
      const fixture = await createRunIdentityFixture(options);
      await expect(fixture.prepare()).rejects.toThrow('IDENTITY_BASELINE_CONFLICT');
      expect(writes(state)).toHaveLength(0);
      expect((await fixture.cleanup()).status).toBe('complete');
      expect(state.users.size).toBe(1);
    });
  });

  test('OAuth baseline marker collisions block before users are created', async () => {
    await withFixture(async ({ options, state }) => {
      state.clients.set('existing', {
        client_id: 'existing', client_name: NAME, client_type: 'public',
        token_endpoint_auth_method: 'none', redirect_uris: [`${ORIGIN}/admin`], grant_types: ['authorization_code'],
      });
      const fixture = await createRunIdentityFixture(options);
      await expect(fixture.prepare()).rejects.toThrow('IDENTITY_BASELINE_CONFLICT');
      expect(writes(state)).toHaveLength(0);
      await fixture.cleanup();
      expect(state.clients.size).toBe(1);
    });
  });

  test('reads all OAuth inventory pages without sending a create or leaking service key into sessions', async () => {
    await withFixture(async ({ options, state }) => {
      for (let index = 0; index < 101; index++) state.clients.set(`foreign-${index}`, {
        client_id: `foreign-${index}`, client_name: `foreign-${index}`, client_type: 'public',
        token_endpoint_auth_method: 'none', redirect_uris: ['https://foreign.invalid/callback'],
        grant_types: ['authorization_code'],
      });
      const fixture = await createRunIdentityFixture(options);
      await fixture.prepare();
      const pages = state.calls.filter(call => call.url.pathname.endsWith('/admin/oauth/clients'));
      expect(pages.map(call => call.url.searchParams.get('page'))).toEqual(['1', '2']);
      await fixture.cleanup();
      expect(state.clients.size).toBe(101);
    });
  });

  test.each(['missing-total', 'changed-total', 'truncated', 'repeated-id'])('rejects incomplete OAuth inventory: %s', async mode => {
    await withFixture(async ({ options, state }) => {
      const fixture = await createRunIdentityFixture(options);
      await expect(fixture.prepare()).rejects.toBeInstanceOf(IdentityFixtureError);
      expect(writes(state)).toHaveLength(0);
    }, call => {
      if (!call.url.pathname.endsWith('/admin/oauth/clients')) return undefined;
      if (mode === 'missing-total') return Response.json({ clients: [] });
      if (mode === 'truncated') return Response.json({ clients: [] }, { headers: { 'x-total-count': '1' } });
      if (mode === 'repeated-id') return Response.json({
        clients: [{ client_id: 'same', client_name: 'foreign' }, { client_id: 'same', client_name: 'foreign' }],
      }, { headers: { 'x-total-count': '2' } });
      const page = call.url.searchParams.get('page');
      return Response.json({ clients: page === '1'
        ? Array.from({ length: 100 }, (_, i) => ({ client_id: `foreign-${i}`, client_name: 'foreign' }))
        : [{ client_id: 'last', client_name: 'foreign' }] }, { headers: { 'x-total-count': page === '1' ? '101' : '102' } });
    });
  });

  test('wrong live owner descriptor cannot authorize writes', async () => {
    await withFixture(async ({ options, state }) => {
      const fixture = await createRunIdentityFixture(options);
      await expect(fixture.prepare()).rejects.toThrow('IDENTITY_RESPONSE_INVALID');
      expect(writes(state)).toHaveLength(0);
    }, call => call.url.pathname.endsWith('/runtime') ? Response.json({ project_ref: REF, mode: 'shared' }) : undefined);
  });

  test('redirects and secret-bearing transport exceptions are fixed-code failures before writes', async () => {
    for (const mode of ['redirect', 'exception']) await withFixture(async ({ options, state }) => {
      const fixture = await createRunIdentityFixture(options);
      const error: unknown = await fixture.prepare().catch((error: unknown) => error);
      expect(error).toBeInstanceOf(IdentityFixtureError);
      expect(String(error)).not.toContain(MANAGEMENT_KEY);
      expect(writes(state)).toHaveLength(0);
      expect(await journalText(fixture.journalDirectory)).not.toContain(MANAGEMENT_KEY);
    }, () => {
      if (mode === 'exception') throw new Error(MANAGEMENT_KEY);
      return new Response(null, { status: 302, headers: { Location: `https://foreign.invalid/${MANAGEMENT_KEY}` } });
    });
  });

  test('unresponsive transport times out without automatic retry', async () => {
    await withFixture(async ({ options, state }) => {
      const fixture = await createRunIdentityFixture({ ...options, timeoutMs: 5 });
      await expect(fixture.prepare()).rejects.toThrow('IDENTITY_TRANSPORT_FAILED');
      expect(state.calls).toHaveLength(1);
    }, async () => new Promise<Response>(() => {}));
  });

  test.each(['timeout', 'invalid-ack', '403'])('unknown user create %s is never replayed or blindly deleted', async mode => {
    await withFixture(async ({ options, state }) => {
      const fixture = await createRunIdentityFixture(options);
      await expect(fixture.prepare()).rejects.toThrow('IDENTITY_WRITE_UNKNOWN');
      await expect(fixture.prepare()).rejects.toThrow('IDENTITY_ALREADY_STARTED');
      expect(writes(state)).toHaveLength(1);
      expect((await fixture.cleanup()).status).toBe('unresolved');
      expect(state.users.size).toBe(1);
      expect(state.calls.some(call => call.method === 'DELETE')).toBe(false);
    }, (call, state) => {
      if (call.method !== 'POST' || !call.url.pathname.endsWith('/auth/users')) return undefined;
      state.users.set(ADMIN, userFixture(ADMIN, `admin-${RUN}@xai.xigu.team`));
      if (mode === 'timeout') throw new Error('secret-after-write');
      return Response.json(mode === '403' ? { error: 'post-write-denied' } : { invalid: true },
        { status: mode === '403' ? 403 : 201 });
    });
  });

  test('user readback mismatch prevents further creates and own-ID cleanup refuses changed identity', async () => {
    await withFixture(async ({ options, state }) => {
      const fixture = await createRunIdentityFixture(options);
      await expect(fixture.prepare()).rejects.toThrow('IDENTITY_OWNERSHIP_MISMATCH');
      expect(writes(state)).toHaveLength(1);
      expect((await fixture.cleanup()).status).toBe('unresolved');
      expect(state.calls.some(call => call.method === 'DELETE')).toBe(false);
    }, call => call.method === 'GET' && call.url.pathname.endsWith(`/users/${ADMIN}`)
      ? Response.json(userFixture(ADMIN, 'foreign@xai.xigu.team')) : undefined);
  });

  test('MFA starts only after a zero-factor readback and does not clear foreign factors', async () => {
    await withFixture(async ({ options, state }) => {
      const fixture = await createRunIdentityFixture(options);
      await expect(fixture.prepare()).rejects.toThrow('IDENTITY_BASELINE_CONFLICT');
      expect(state.calls.some(call => call.url.pathname.endsWith('/factors'))).toBe(false);
      expect((await fixture.cleanup()).status).toBe('unresolved');
      expect(state.users.has(ADMIN)).toBe(true);
      expect(state.calls.some(call => call.method === 'DELETE' && call.url.pathname.endsWith(ADMIN))).toBe(false);
    }, (call, state) => {
      if (call.url.pathname === '/auth/v1/user') {
        const user = state.users.get(ADMIN);
        const token = call.headers.get('authorization') ?? '';
        if (user && token.includes(ADMIN)) user.factors = [{
          id: FACTOR, factor_type: 'totp', status: 'verified', friendly_name: 'foreign',
        }];
      }
      return undefined;
    });
  });

  test('factor receipt must be read back on its exact user before a challenge is sent', async () => {
    await withFixture(async ({ options, state }) => {
      const fixture = await createRunIdentityFixture(options);
      await expect(fixture.prepare()).rejects.toThrow('IDENTITY_OWNERSHIP_MISMATCH');
      expect(state.calls.some(call => call.url.pathname.endsWith('/challenge'))).toBe(false);
      expect((await fixture.cleanup()).status).toBe('unresolved');
      expect(state.users.has(ADMIN)).toBe(true);
    }, (call, state) => {
      if (call.url.pathname === '/auth/v1/factors') {
        const user = state.users.get(ADMIN);
        if (!user) throw new Error('offline admin missing');
        user.factors.push({ id: FACTOR, factor_type: 'totp', status: 'unverified', friendly_name: 'foreign' });
        return Response.json({ id: FACTOR, type: 'totp', totp: { secret: SEED } });
      }
      return undefined;
    });
  });

  test('expired MFA challenge stops without verification replay', async () => {
    await withFixture(async ({ options, state }) => {
      const fixture = await createRunIdentityFixture(options);
      await expect(fixture.prepare()).rejects.toThrow('IDENTITY_RESPONSE_INVALID');
      expect(state.calls.some(call => call.url.pathname.endsWith('/verify'))).toBe(false);
      expect((await fixture.cleanup()).status).toBe('complete');
    }, call => call.url.pathname.endsWith('/challenge')
      ? Response.json({ id: CHALLENGE, type: 'totp', expires_at: 1 }) : undefined);
  });

  test('MFA verification cannot substitute a different subject', async () => {
    await withFixture(async ({ options, state }) => {
      const fixture = await createRunIdentityFixture(options);
      await expect(fixture.prepare()).rejects.toThrow('IDENTITY_OWNERSHIP_MISMATCH');
      expect(await readdir(fixture.journalDirectory)).not.toContain('browser-identity-receipt.json');
      expect(state.calls.filter(call => call.url.pathname.endsWith('/verify'))).toHaveLength(1);
    }, (call, state) => call.url.pathname.endsWith('/verify')
      ? Response.json({
        access_token: 'offline-wrong-user-access', refresh_token: 'offline-wrong-user-refresh',
        user: state.users.get(USER),
      }) : undefined);
  });

  test.each(['redirect', 'confidential', 'wrong-id'])('client readback %s cannot be treated as owned', async mode => {
    await withFixture(async ({ options, state }) => {
      const fixture = await createRunIdentityFixture(options);
      await expect(fixture.prepare()).rejects.toBeInstanceOf(IdentityFixtureError);
      expect(state.calls.some(call => call.url.pathname.endsWith('/token'))).toBe(false);
      expect((await fixture.cleanup()).status).toBe('unresolved');
      expect(state.clients.has('owned-public-client')).toBe(true);
    }, (call, state) => {
      if (call.method === 'GET' && call.url.pathname.endsWith('/oauth-clients/owned-public-client')) {
        const client = state.clients.get('owned-public-client');
        if (!client) return missing();
        return Response.json({
          ...client,
          ...(mode === 'redirect' ? { redirect_uris: ['https://foreign.invalid/callback'] } : {}),
          ...(mode === 'confidential' ? { client_type: 'confidential' } : {}),
          ...(mode === 'wrong-id' ? { client_id: 'foreign-id' } : {}),
        });
      }
      return undefined;
    });
  });

  test('a foreign factor added after preparation blocks user cascade deletion', async () => {
    await withFixture(async ({ options, state }) => {
      const fixture = await createRunIdentityFixture(options);
      await fixture.prepare();
      const admin = state.users.get(ADMIN);
      if (!admin) throw new Error('offline prepared admin missing');
      admin.factors.push({ id: CHALLENGE, factor_type: 'totp', status: 'verified', friendly_name: 'foreign' });
      expect((await fixture.cleanup()).status).toBe('unresolved');
      expect(state.users.has(ADMIN)).toBe(true);
      expect(admin.factors).toHaveLength(2);
      expect(state.calls.some(call => call.url.pathname.endsWith('/reset'))).toBe(false);
    });
  });

  test('pre-existing timestamp in a create acknowledgment is not an owned user receipt', async () => {
    await withFixture(async ({ options, state }) => {
      const fixture = await createRunIdentityFixture(options);
      await expect(fixture.prepare()).rejects.toThrow('IDENTITY_WRITE_UNKNOWN');
      expect((await fixture.cleanup()).status).toBe('unresolved');
      expect(state.calls.some(call => call.method === 'DELETE')).toBe(false);
    }, call => call.method === 'POST' && call.url.pathname.endsWith('/auth/users')
      ? Response.json({ ...userFixture(ADMIN, `admin-${RUN}@xai.xigu.team`), created_at: '2000-01-01T00:00:00Z' })
      : undefined);
  });

  test('cleanup refuses renamed client and changed user but still handles other known run resources', async () => {
    await withFixture(async ({ options, state }) => {
      const fixture = await createRunIdentityFixture(options);
      await fixture.prepare();
      const admin = state.users.get(ADMIN);
      const client = state.clients.get('owned-public-client');
      if (!admin || !client) throw new Error('offline prepared resources missing');
      admin.email = 'foreign@xai.xigu.team';
      client.client_name = 'foreign-name';
      const result = await fixture.cleanup();
      expect(result.status).toBe('unresolved');
      expect(state.users.has(ADMIN)).toBe(true);
      expect(state.users.has(USER)).toBe(false);
      expect(state.clients.has('owned-public-client')).toBe(true);
      expect(state.calls.some(call => call.method === 'DELETE' && call.url.pathname.endsWith(ADMIN))).toBe(false);
    });
  });

  test('cleanup confirms deletions by reads and never replays an unknown DELETE', async () => {
    await withFixture(async ({ options, state }) => {
      const fixture = await createRunIdentityFixture(options);
      await fixture.prepare();
      expect((await fixture.cleanup()).status).toBe('unresolved');
      const deletes = state.calls.filter(call => call.method === 'DELETE' && call.url.pathname.endsWith(ADMIN));
      expect(deletes).toHaveLength(1);
      await expect(fixture.cleanup()).rejects.toThrow('IDENTITY_ALREADY_STARTED');
    }, (call, state) => {
      if (call.method === 'DELETE' && call.url.pathname.endsWith(ADMIN)) {
        state.users.delete(ADMIN);
        throw new Error('unknown-delete');
      }
      return undefined;
    });
  });
});
