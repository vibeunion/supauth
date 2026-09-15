import { describe, expect, test } from 'bun:test';
import { mkdtemp, readFile, readdir, rm, stat, symlink } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  createServiceAcceptanceRunner, createFileFixtureLedgerSink, serviceAcceptanceCode,
  type FixtureLedger, type FixtureLedgerSink,
} from '../scripts/real-contract-services.js';
import {
  parseAcceptanceTarget, type AcceptanceTarget,
} from '../scripts/real-contract-acceptance-contract.js';
import {
  createAllocationJournal, TEST_IDENTITY_OWNER_REF,
} from '../scripts/real-contract-allocation.js';
import type { SdkEndpointResult } from '../packages/shared/src/index.js';
import type { SupaOAuthFetch } from '../packages/sdks/typescript/src/index.js';
import { requireRecord as record } from '../scripts/tooling-values.js';

const target: AcceptanceTarget = {
  baseUrl: 'https://localhost:8443/project/api',
  runtimeUrl: 'https://localhost:8443/project/auth/v1',
  projectRef: `supauth_contract_${'a'.repeat(32)}`,
  adminToken: 'fixture-admin-token',
  userToken: 'fixture-user-token',
};
type Webhook = SdkEndpointResult<'getWebhook'>;
type Call = { url: URL; method: string; headers: Headers; body: unknown; init: RequestInit };
type State = { rows: Webhook[]; calls: Call[]; nextId: number };
type Hook = (call: Call, state: State) => Response | undefined | Promise<Response | undefined>;

function row(id: string, url = `https://other.invalid/${id}`): Webhook {
  return {
    id, url, events: [], enabled: false, secret_configured: false,
    created_at: '2026-09-09T00:00:00Z', updated_at: '2026-09-09T00:00:00Z',
  };
}

function fixture(hook: Hook = () => undefined, activeTarget: AcceptanceTarget = target) {
  const state: State = { rows: [], calls: [], nextId: 1 };
  const ledger: FixtureLedger[] = [];
  const sink: FixtureLedgerSink = async initial => {
    ledger.push({ ...initial });
    return { write: async record => { ledger.push({ ...record }); } };
  };
  const fetch: SupaOAuthFetch = async (input, init = {}) => {
    const url = new URL(input instanceof Request ? input.url : input);
    const body: unknown = typeof init.body === 'string' ? JSON.parse(init.body) : null;
    const call: Call = { url, method: init.method ?? 'GET', headers: new Headers(init.headers), body, init };
    state.calls.push(call);
    const override = await hook(call, state);
    if (override) return override;
    const runtime = new URL(activeTarget.runtimeUrl);
    const runtimeHealth = runtime.pathname.endsWith('/auth/v1')
      ? `${runtime.pathname}/health` : `${runtime.pathname}/auth/v1/health`;
    if (url.origin === runtime.origin && url.pathname === runtimeHealth) {
      return Response.json({ name: 'GoTrue', version: 'fixture-version', description: 'fixture GoTrue health' });
    }
    const path = url.pathname.slice(new URL(activeTarget.baseUrl).pathname.length);
    if (path === '/v1/health') {
      return Response.json({ status: 'ok', runtime_mode: 'gotrue', project_ref: activeTarget.projectRef });
    }
    if (path === '/v1/project') return Response.json({ id: 'project-id', ref: activeTarget.projectRef, name: 'isolated fixture' });
    if (path === '/v1/webhooks' && call.method === 'GET') {
      if (!call.headers.has('Authorization')) return new Response('Unauthorized', { status: 401 });
      if (call.headers.get('Authorization') === `Bearer ${activeTarget.userToken}`) {
        return Response.json({ success: false, error: { code: 'admin_access_forbidden', message: 'denied' } }, { status: 403 });
      }
      return Response.json({ items: state.rows, total: state.rows.length });
    }
    if (path === '/v1/webhooks' && call.method === 'POST') {
      const payload = record(body);
      const url = payload['url'];
      if (typeof url !== 'string') throw new Error('fixture url required');
      const created = row(`owned-${state.nextId++}`, url);
      state.rows.push(created);
      return Response.json(created, { status: 201 });
    }
    const id = path.split('/').at(-1);
    const existing = state.rows.find(item => item.id === id);
    if (!existing) return Response.json({ success: false, error: { code: 'not_found', message: 'missing' } }, { status: 404 });
    if (call.method === 'GET') return Response.json(existing);
    if (call.method === 'PUT') {
      const payload = record(body);
      if (typeof payload['url'] === 'string') existing.url = payload['url'];
      if (typeof payload['enabled'] === 'boolean') existing.enabled = payload['enabled'];
      return Response.json(existing);
    }
    if (call.method === 'DELETE') {
      state.rows = state.rows.filter(item => item.id !== id);
      return new Response(null, { status: 204 });
    }
    throw new Error('unexpected fixture path');
  };
  return { state, ledger, runner: createServiceAcceptanceRunner(fetch, 100, sink), fetch };
}

function writes(state: State, method?: string) {
  return state.calls.filter(call => method ? call.method === method : call.method !== 'GET');
}

async function withAllocatedTarget(callback: (target: AcceptanceTarget) => Promise<void>): Promise<void> {
  const root = await mkdtemp(join(tmpdir(), 'supauth-service-allocation-'));
  const runId = '23456789-1234-4abc-8def-1234567890ab';
  const projectOrigin = `https://contract-${runId}.xai.xigu.team`;
  const ref = 'bcdefghijklmnopqrstu';
  const name = `supauth-contract-${runId}`;
  try {
    const journal = await createAllocationJournal(root, {
      runId, name, projectOrigin, authorityRef: TEST_IDENTITY_OWNER_REF,
      managementOrigin: 'http://127.0.0.1:29190',
      authorityOrigin: 'https://auth.xai.xigu.team',
      beforeInventory: {
        complete: true, projects: [{ ref: TEST_IDENTITY_OWNER_REF, name: 'existing identity owner' }],
      },
    });
    const project = {
      id: 'offline-service-project-id', created_at: '2026-09-09T00:00:00Z',
      ref, name, api: { url: projectOrigin }, status: 'ACTIVE_HEALTHY',
    };
    await journal.createOnce(async () => project);
    await journal.bind({
      projectReadback: project, authorityOrigin: 'https://auth.xai.xigu.team',
      authorityDescriptor: {
        project_ref: ref, mode: 'shared', authority_project_ref: TEST_IDENTITY_OWNER_REF,
        owner_project_ref: TEST_IDENTITY_OWNER_REF, local_gotrue_enabled: false,
        public_auth_route: 'owner_proxy', user_management: 'owner_only',
        configuration_management: 'owner_only',
      },
    });
    await callback(parseAcceptanceTarget({
      REAL_ACCEPTANCE_BASE_URL: `${projectOrigin}/api`,
      REAL_ACCEPTANCE_RUNTIME_URL: 'https://auth.xai.xigu.team/auth/v1',
      REAL_ACCEPTANCE_PROJECT_REF: ref,
      REAL_ACCEPTANCE_CONFIRM_PROJECT: ref,
      REAL_ACCEPTANCE_ENVIRONMENT: 'isolated-test',
      REAL_ACCEPTANCE_ADMIN_TOKEN: target.adminToken,
      REAL_ACCEPTANCE_USER_TOKEN: target.userToken,
      REAL_ACCEPTANCE_ALLOCATION_JOURNAL: join(root, runId),
    }));
  } finally {
    await rm(root, { recursive: true, force: true });
  }
}

describe('service allocation binding with offline transport', () => {
  test('uses only the allocated app and owner origins and never sends bearer tokens to owner health', async () => {
    await withAllocatedTarget(async allocated => {
      const { state, runner } = fixture(undefined, allocated);
      const results = await runner.runServiceAcceptance(allocated);
      expect(results.map(result => result.status)).toEqual(['passed', 'passed']);
      expect(writes(state).map(call => call.method)).toEqual(['POST', 'PUT', 'DELETE']);
      const base = new URL(allocated.baseUrl);
      const runtime = new URL(allocated.runtimeUrl);
      for (const call of state.calls) {
        expect(call.init.redirect).toBe('error');
        expect(call.init.credentials).toBe('omit');
        if (call.url.origin === runtime.origin) {
          expect(call.url.href).toBe(`${allocated.runtimeUrl}/health`);
          expect(call.method).toBe('GET');
          expect(call.headers.has('Authorization')).toBe(false);
          expect(call.headers.has('Cookie')).toBe(false);
        } else {
          expect(call.url.origin).toBe(base.origin);
          expect(call.url.pathname.startsWith('/api/v1/')).toBe(true);
        }
      }
      expect(state.calls.filter(call => call.url.origin === runtime.origin)).toHaveLength(1);
    });
  });

  test('rejects a copied real target before transport or ledger writes', async () => {
    await withAllocatedTarget(async allocated => {
      const { state, ledger, runner } = fixture(undefined, allocated);
      const results = await runner.runServiceAcceptance({ ...allocated });
      expect(results.map(result => result.status)).toEqual(['blocked', 'blocked']);
      expect(results[0]?.code).toBe('SERVICE_TARGET_INVALID');
      expect(state.calls).toHaveLength(0);
      expect(ledger).toHaveLength(0);
    });
  });

  test.each(['baseUrl', 'runtimeUrl', 'projectRef'])('rejects mutated allocated %s before transport', async key => {
    await withAllocatedTarget(async allocated => {
      if (key === 'baseUrl') allocated.baseUrl = 'https://auth.xai.xigu.team/api';
      else if (key === 'runtimeUrl') allocated.runtimeUrl = 'https://other.xai.xigu.team/auth/v1';
      else allocated.projectRef = TEST_IDENTITY_OWNER_REF;
      const { state, ledger, runner } = fixture(undefined, allocated);
      const results = await runner.runServiceAcceptance(allocated);
      expect(results.map(result => result.status)).toEqual(['blocked', 'blocked']);
      expect(state.calls).toHaveLength(0);
      expect(ledger).toHaveLength(0);
    });
  });

  test('synthetic refs cannot bypass allocation for remote same-origin targets', async () => {
    const { state, runner } = fixture();
    const results = await runner.runServiceAcceptance({
      ...target, baseUrl: 'https://fixture.invalid/api', runtimeUrl: 'https://fixture.invalid/auth/v1',
    });
    expect(results.map(result => result.status)).toEqual(['blocked', 'blocked']);
    expect(state.calls).toHaveLength(0);
  });

  test('owner health redirects are rejected even when Location is the authorized app origin', async () => {
    await withAllocatedTarget(async allocated => {
      const { state, runner } = fixture(call => call.url.href === `${allocated.runtimeUrl}/health`
        ? new Response(null, { status: 302, headers: { Location: `${allocated.baseUrl}/v1/health` } })
        : undefined, allocated);
      const results = await runner.runServiceAcceptance(allocated);
      expect(results[0]?.code).toBe('SERVICE_DESTINATION_REJECTED');
      expect(results[1]?.status).toBe('blocked');
      expect(writes(state)).toHaveLength(0);
      expect(state.calls.filter(call => call.url.href === `${allocated.runtimeUrl}/health`)).toHaveLength(1);
    });
  });

});

describe('real service acceptance isolated unit transport (not live evidence)', () => {
  test('runs real SDK methods through constrained transport and verifies cleanup', async () => {
    const { state, runner } = fixture();
    state.rows.push(row('foreign'));
    const results = await runner.runServiceAcceptance(target);
    expect(results.map(result => [result.phase, result.status])).toEqual([['backend', 'passed'], ['sdk', 'passed']]);
    expect(results[0]?.checks).toBe(5);
    expect(results[1]?.checks).toBeGreaterThan(5);
    expect(writes(state).map(call => call.method)).toEqual(['POST', 'PUT', 'DELETE']);
    expect(writes(state, 'POST')[0]?.body).toEqual({
      url: expect.stringMatching(/^https:\/\/supauth-contract\.invalid\/[0-9a-f-]+$/), enabled: false, events: [],
    });
    expect(writes(state, 'PUT')[0]?.body).toEqual({ url: expect.stringMatching(/\/updated$/), enabled: false });
    expect(state.rows.map(item => item.id)).toEqual(['foreign']);
    for (const call of state.calls) {
      expect(call.url.origin).toBe('https://localhost:8443');
      expect(call.init.redirect).toBe('error');
      expect(call.init.credentials).toBe('omit');
      expect(call.init.cache).toBe('no-store');
      expect(call.init.signal).toBeInstanceOf(AbortSignal);
      expect(call.headers.has('Cookie')).toBe(false);
      expect(call.url.pathname.startsWith('/project/')).toBe(true);
      if (call.url.pathname === '/project/auth/v1/health') expect(call.headers.has('Authorization')).toBe(false);
    }
  });

  for (const invalid of [
    { baseUrl: 'https://fixture.invalid/other', runtimeUrl: 'https://external.invalid/' },
    { baseUrl: 'https://user:secret@fixture.invalid/api' },
    { baseUrl: 'http://external.invalid/' },
    { baseUrl: 'https://auth.ai.xigu.team' },
    { projectRef: 'existing-project' },
    { adminToken: '' },
    { userToken: target.adminToken },
  ]) {
    test(`blocks invalid target keys ${Object.keys(invalid).join(',')}`, async () => {
      const { state, runner } = fixture();
      const results = await runner.runServiceAcceptance({ ...target, ...invalid });
      expect(results.map(result => result.status)).toEqual(['blocked', 'blocked']);
      expect(state.calls).toHaveLength(0);
      expect(JSON.stringify(results)).not.toContain('secret');
    });
  }

  for (const payload of [
    { id: 'p', name: 'fixture' },
    { id: 'p', name: 'fixture', ref: 'wrong' },
    { id: 'p', name: 'fixture', ref: target.projectRef, project_ref: 'wrong' },
  ]) {
    test(`does not trust health config instead of upstream project ${JSON.stringify(payload)}`, async () => {
      const { state, runner } = fixture(call => call.url.pathname.endsWith('/v1/project') ? Response.json(payload) : undefined);
      const results = await runner.runServiceAcceptance(target);
      expect(results[0]?.code).toBe('BACKEND_PROJECT_MISMATCH');
      expect(results[1]?.status).toBe('blocked');
      expect(writes(state)).toHaveLength(0);
    });
  }

  for (const payload of [{}, { version: 'v2' }, { name: 'not-gotrue', version: 'v2', description: 'bad' }]) {
    test(`requires real GoTrue health fields ${JSON.stringify(payload)}`, async () => {
      const { state, runner } = fixture(call => call.url.pathname.includes('/auth/v1/') ? Response.json(payload) : undefined);
      const results = await runner.runServiceAcceptance(target);
      expect(results[0]?.status).toBe('failed');
      expect(writes(state)).toHaveLength(0);
    });
  }

  for (const status of [200, 401, 500]) {
    test(`requires non-admin403, not status ${status}`, async () => {
      const { state, runner } = fixture(call => call.headers.get('Authorization') === `Bearer ${target.userToken}`
        ? Response.json({ items: [], total: 0 }, { status }) : undefined);
      expect((await runner.runServiceAcceptance(target))[0]?.status).toBe('failed');
      expect(writes(state)).toHaveLength(0);
    });
  }

  test('rejects malformed errors and MFA-only denial as evidence for non-admin', async () => {
    for (const error of [{ arbitrary: 'denied' }, { success: false, error: { code: 'admin_mfa_required', message: 'mfa' } }]) {
      const { state, runner } = fixture(call => call.headers.get('Authorization') === `Bearer ${target.userToken}`
        ? Response.json(error, { status: 403 }) : undefined);
      expect((await runner.runServiceAcceptance(target))[0]?.status).toBe('failed');
      expect(writes(state)).toHaveLength(0);
    }
  });

  test('rejects redirects without sending requests to Location', async () => {
    const { state, runner } = fixture(() => new Response(null, { status: 302, headers: { Location: 'https://other.invalid/' } }));
    expect((await runner.runServiceAcceptance(target))[0]?.code).toBe('SERVICE_DESTINATION_REJECTED');
    expect(state.calls).toHaveLength(1);
  });

  test('bounds an unresponsive transport and never logs its secret error', async () => {
    const runner = createServiceAcceptanceRunner(async () => new Promise<Response>(() => {}), 5);
    expect((await runner.runServiceAcceptance(target))[0]?.code).toBe('SERVICE_TRANSPORT_FAILED');
    const failure = createServiceAcceptanceRunner(async () => { throw new Error(target.adminToken); });
    expect(JSON.stringify(await failure.runServiceAcceptance(target))).not.toContain(target.adminToken);
  });

  test('captures target identity and tokens before awaiting transport', async () => {
    const mutable = { ...target };
    const { runner } = fixture(call => {
      if (call.url.pathname.endsWith('/v1/health')) {
        mutable.projectRef = 'changed';
        mutable.adminToken = 'changed';
        mutable.baseUrl = 'https://other.invalid';
      }
      return undefined;
    });
    expect((await runner.runServiceAcceptance(mutable)).map(result => result.status)).toEqual(['passed', 'passed']);
  });

  test('follows bounded complete pagination with the same guarded SDK transport', async () => {
    const { state, runner } = fixture((call, state) => {
      if (call.method === 'GET' && call.url.pathname.endsWith('/v1/webhooks')
        && call.headers.get('Authorization') === `Bearer ${target.adminToken}`) {
        const page = Number(call.url.searchParams.get('page') ?? '1');
        return Response.json({ items: state.rows.slice(page - 1, page), total: state.rows.length, page, limit: 1 });
      }
      return undefined;
    });
    state.rows.push(row('foreign-a'), row('foreign-b'));
    expect((await runner.runServiceAcceptance(target)).map(result => result.status)).toEqual(['passed', 'passed']);
    expect(state.calls.some(call => call.url.searchParams.get('page') === '3')).toBe(true);
    expect(state.rows.map(item => item.id)).toEqual(['foreign-a', 'foreign-b']);
  });

  for (const mode of ['repeated-page', 'changed-total', 'changed-limit']) {
    test(`rejects ${mode} before writing`, async () => {
      const { state, runner } = fixture(call => {
        if (!call.url.pathname.endsWith('/v1/webhooks')
          || call.headers.get('Authorization') !== `Bearer ${target.adminToken}`) return undefined;
        const page = Number(call.url.searchParams.get('page') ?? '1');
        return Response.json({
          items: [row(page === 1 || mode === 'repeated-page' ? 'first' : 'second')],
          total: page > 1 && mode === 'changed-total' ? 3 : 2,
          page, limit: page > 1 && mode === 'changed-limit' ? 2 : 1,
        });
      });
      expect((await runner.runServiceAcceptance(target))[1]?.code).toBe('WEBHOOK_MUTATION_BLOCKED');
      expect(writes(state)).toHaveLength(0);
    });
  }

  for (const payload of [
    { items: [row('a')], total: 2 },
    { items: [row('a'), row('a')], total: 2 },
    { items: [], total: -1 },
    { items: [], total: 1.5 },
    { items: [], total: 2000 },
  ]) {
    test(`blocks unsafe baseline ${JSON.stringify(payload)}`, async () => {
      const { state, runner } = fixture(call => call.url.pathname.endsWith('/v1/webhooks')
        && call.headers.get('Authorization') === `Bearer ${target.adminToken}` ? Response.json(payload) : undefined);
      expect((await runner.runServiceAcceptance(target))[1]?.code).toBe('WEBHOOK_MUTATION_BLOCKED');
      expect(writes(state)).toHaveLength(0);
    });
  }

  for (const mode of ['timeout-after-create', 'invalid-reply', 'denied-after-create', 'wrong-ack-id']) {
    test(`reconciles and cleans ${mode} without replay or claiming PASS`, async () => {
      const { state, runner } = fixture((call, state) => {
        if (call.method !== 'POST') return undefined;
        const url = record(call.body)['url'];
        if (typeof url !== 'string') throw new Error('fixture url required');
        state.rows.push(row('committed', url));
        if (mode === 'timeout-after-create') throw new DOMException('fixture timeout', 'TimeoutError');
        if (mode === 'denied-after-create') return Response.json({ error: 'post-write audit denied' }, { status: 403 });
        if (mode === 'wrong-ack-id') return Response.json(row('foreign', url));
        return Response.json({ unexpected: target.adminToken });
      });
      state.rows.push(row('foreign'));
      const results = await runner.runServiceAcceptance(target);
      expect(results[1]?.code).toBe('WEBHOOK_CREATE_UNKNOWN');
      expect(writes(state, 'POST')).toHaveLength(1);
      expect(writes(state, 'PUT')).toHaveLength(0);
      expect(writes(state, 'DELETE')).toHaveLength(1);
      expect(state.rows.map(item => item.id)).toEqual(['foreign']);
      expect(JSON.stringify(results)).not.toContain(target.adminToken);
    });
  }

  test('does not claim late-create absence is proven when an unknown create has no current match', async () => {
    const { state, runner, ledger } = fixture(call => {
      if (call.method === 'POST') throw new TypeError('fixture connection lost');
      return undefined;
    });
    expect((await runner.runServiceAcceptance(target))[1]?.code).toBe('WEBHOOK_CREATE_UNKNOWN');
    expect(writes(state, 'POST')).toHaveLength(1);
    expect(writes(state, 'DELETE')).toHaveLength(0);
    expect(ledger.at(-1)).toMatchObject({
      phase: 'cleanup-unresolved', id: null,
      primaryCode: 'WEBHOOK_CREATE_UNKNOWN', cleanupCode: 'WEBHOOK_CREATE_UNKNOWN',
    });
  });

  test('an unconfirmed acknowledgement ID cannot prevent exact-marker reconciliation', async () => {
    const { state, runner } = fixture((call, state) => {
      if (call.method !== 'POST') return undefined;
      const url = record(call.body)['url'];
      if (typeof url !== 'string') throw new Error('fixture url required');
      state.rows.push(row('committed', url));
      return Response.json(row('wrong-ack-id', url));
    });
    expect((await runner.runServiceAcceptance(target))[1]?.code).toBe('WEBHOOK_READBACK_FAILED');
    expect(writes(state, 'DELETE')[0]?.url.pathname).toBe('/project/api/v1/webhooks/committed');
    expect(state.rows).toHaveLength(0);
  });

  test('ambiguous create marker and incomplete cleanup inventory preserve recovery evidence', async () => {
    for (const mode of ['duplicate-marker', 'partial-inventory']) {
      const { state, runner, ledger } = fixture((call, state) => {
        if (call.method === 'POST') {
          const url = record(call.body)['url'];
          if (typeof url !== 'string') throw new Error('fixture url required');
          state.rows.push(row('committed', url));
          if (mode === 'duplicate-marker') state.rows.push(row('duplicate', url));
          throw new TypeError('fixture lost response');
        }
        if (mode === 'partial-inventory' && state.rows.length && call.url.pathname.endsWith('/v1/webhooks')) {
          return Response.json({ items: [], total: 1 });
        }
        return undefined;
      });
      expect((await runner.runServiceAcceptance(target))[1]?.code).toBe('WEBHOOK_CLEANUP_FAILED');
      expect(writes(state, 'DELETE')).toHaveLength(0);
      expect(ledger.at(-1)?.primaryCode).toBe('WEBHOOK_CREATE_UNKNOWN');
      expect(ledger.at(-1)?.phase).toBe('cleanup-failed');
    }
  });

  test('failed update still cleans the original owned object and fails the SDK phase', async () => {
    const { state, runner } = fixture(call => call.method === 'PUT'
      ? Response.json({ success: false, error: { code: 'failed', message: 'fixture failure' } }, { status: 503 })
      : undefined);
    expect((await runner.runServiceAcceptance(target))[1]?.status).toBe('failed');
    expect(state.rows).toHaveLength(0);
    expect(writes(state, 'PUT')).toHaveLength(1);
  });

  test('failed ownership confirmation never permits callback or unrelated deletion', async () => {
    const { state, runner } = fixture(call => call.method === 'GET' && call.url.pathname.endsWith('/owned-1')
      ? Response.json(row('owned-1', 'https://foreign.invalid/changed')) : undefined);
    let callbackCalled = false;
    await expect(runner.runOwnedWebhook(target, async () => { callbackCalled = true; }))
      .rejects.toThrow('WEBHOOK_CLEANUP_FAILED');
    expect(callbackCalled).toBe(false);
    expect(writes(state, 'DELETE')).toHaveLength(0);
  });

  test('browser-style enabled change is owned and cleaned without requiring it disabled', async () => {
    const { state, runner } = fixture();
    const value = await runner.runOwnedWebhook(target, async ({ id, marker, sdk }) => {
      const item = state.rows.find(row => row.id === id);
      if (!item) throw new Error('missing fixture');
      item.enabled = true;
      expect((await sdk.getWebhook(id)).enabled).toBe(true);
      expect(item.url).toBe(marker);
      return 'browser-value';
    });
    expect(value).toBe('browser-value');
    expect(state.rows).toHaveLength(0);
  });

  test('callback failure still cleans, and raw callback error never escapes', async () => {
    const { state, runner } = fixture();
    await expect(runner.runOwnedWebhook(target, async () => { throw new Error(target.adminToken); }))
      .rejects.toThrow('WEBHOOK_CALLBACK_FAILED');
    expect(state.rows).toHaveLength(0);
    expect(serviceAcceptanceCode(new Error(target.adminToken))).toBe('SERVICE_TRANSPORT_FAILED');
  });

  test('SDK update to another object, encoded path escape or foreign URL never reaches fetch', async () => {
    for (const mode of ['other-id', 'escape', 'foreign-url', 'enable']) {
      const { state, runner } = fixture();
      state.rows.push(row('foreign'));
      await expect(runner.runOwnedWebhook(target, async ({ id, updatedUrl, sdk }) => {
        await sdk.updateWebhook(mode === 'other-id' ? 'foreign' : mode === 'escape' ? '../project' : id,
          { url: mode === 'foreign-url' ? 'https://other.invalid/hook' : updatedUrl, enabled: mode === 'enable' });
      })).rejects.toThrow('SERVICE_DESTINATION_REJECTED');
      expect(writes(state, 'PUT')).toHaveLength(0);
      expect(state.rows.map(item => item.id)).toEqual(['foreign']);
    }
  });

  test('cleanup refuses a changed marker or enabled event subscription', async () => {
    for (const change of ['url', 'events']) {
      const { state, runner } = fixture();
      await expect(runner.runOwnedWebhook(target, async ({ id }) => {
        const item = state.rows.find(row => row.id === id);
        if (!item) throw new Error('missing fixture');
        if (change === 'url') item.url = 'https://foreign.invalid/replaced';
        else item.events = ['user.created'];
      })).rejects.toThrow('WEBHOOK_CLEANUP_FAILED');
      expect(writes(state, 'DELETE')).toHaveLength(0);
    }
  });

  test('cleanup failure overrides a successful callback and is not swallowed', async () => {
    const { state, runner, ledger } = fixture(call => call.method === 'DELETE'
      ? Response.json({ secret: target.adminToken }, { status: 500 }) : undefined);
    await expect(runner.runOwnedWebhook(target, async () => 'success')).rejects.toThrow('WEBHOOK_CLEANUP_FAILED');
    expect(writes(state, 'DELETE')).toHaveLength(1);
    expect(state.rows).toHaveLength(1);
    expect(ledger.at(-1)).toMatchObject({ id: 'owned-1', phase: 'cleanup-failed', primaryCode: null });
    expect(JSON.stringify(ledger)).not.toContain(target.adminToken);
    expect(JSON.stringify(ledger)).not.toContain(target.userToken);
  });

  test('intent must persist before POST and failed sink prevents mutation', async () => {
    const { state, fetch } = fixture();
    const runner = createServiceAcceptanceRunner(fetch, 100, async () => { throw new Error('disk failed'); });
    expect((await runner.runServiceAcceptance(target))[1]?.code).toBe('WEBHOOK_LEDGER_FAILED');
    expect(writes(state)).toHaveLength(0);
  });

  test('a ledger update failure does not skip cleanup or produce PASS', async () => {
    const { state, fetch } = fixture();
    const entries: FixtureLedger[] = [];
    const runner = createServiceAcceptanceRunner(fetch, 100, async initial => {
      entries.push({ ...initial });
      return { write: async () => { throw new Error('disk failure'); } };
    });
    expect((await runner.runServiceAcceptance(target))[1]?.code).toBe('WEBHOOK_CLEANUP_FAILED');
    expect(entries[0]?.phase).toBe('intent');
    expect(writes(state, 'POST')).toHaveLength(1);
    expect(writes(state, 'DELETE')).toHaveLength(1);
    expect(state.rows).toHaveLength(0);
  });

  test('ledger preserves separate primary and cleanup failures with recovery ownership', async () => {
    const { runner, ledger } = fixture(call => call.method === 'DELETE'
      ? new Response(null, { status: 500 }) : undefined);
    await expect(runner.runOwnedWebhook(target, async () => { throw new Error(target.adminToken); }))
      .rejects.toThrow('WEBHOOK_CLEANUP_FAILED');
    expect(ledger.at(-1)).toMatchObject({
      phase: 'cleanup-failed', primaryCode: 'WEBHOOK_CALLBACK_FAILED',
      cleanupCode: 'WEBHOOK_CLEANUP_FAILED', projectRef: target.projectRef,
      baseUrl: target.baseUrl, id: 'owned-1',
    });
    expect(ledger[0]).toMatchObject({ phase: 'intent', id: null });
    expect(ledger.at(-1)?.marker).toBe(ledger[0]?.marker);
  });

  test('callback SDK cannot read a different object', async () => {
    const { state, runner } = fixture();
    await expect(runner.runOwnedWebhook(target, async ({ sdk }) => { await sdk.getWebhook('foreign'); }))
      .rejects.toThrow('SERVICE_DESTINATION_REJECTED');
    expect(state.calls.some(call => call.url.pathname.endsWith('/foreign'))).toBe(false);
    expect(state.rows).toHaveLength(0);
  });

  test('production ledger writes private durable recovery evidence before POST', async () => {
    const directory = await mkdtemp(join(tmpdir(), 'supauth-services-ledger-'));
    const fixtures = join(directory, 'artifacts', 'real-contract-acceptance', 'fixtures');
    try {
      const { fetch } = fixture(async call => {
        if (call.method === 'POST') {
          const names = await readdir(fixtures);
          const name = names[0];
          if (!name) throw new Error('intent missing');
          const value: unknown = JSON.parse(await readFile(join(fixtures, name), 'utf8'));
          expect(record(value)['phase']).toBe('intent');
          expect(record(value)['id']).toBe(null);
        }
        if (call.method === 'DELETE') return new Response(null, { status: 500 });
        return undefined;
      });
      const runner = createServiceAcceptanceRunner(fetch, 500, createFileFixtureLedgerSink(directory));
      await expect(runner.runOwnedWebhook(target, async () => { throw new Error(target.adminToken); }))
        .rejects.toThrow('WEBHOOK_CLEANUP_FAILED');
      const names = await readdir(fixtures);
      expect(names).toHaveLength(1);
      const name = names[0];
      if (!name) throw new Error('ledger missing');
      expect(name).toMatch(/^[0-9a-f-]{36}\.json$/);
      expect((await stat(fixtures)).mode & 0o777).toBe(0o700);
      expect((await stat(join(fixtures, name))).mode & 0o777).toBe(0o600);
      const raw = await readFile(join(fixtures, name), 'utf8');
      const value: unknown = JSON.parse(raw);
      expect(record(value)).toMatchObject({
        phase: 'cleanup-failed', id: 'owned-1', primaryCode: 'WEBHOOK_CALLBACK_FAILED',
        cleanupCode: 'WEBHOOK_CLEANUP_FAILED',
      });
      expect(raw).not.toContain(target.adminToken);
      expect(raw).not.toContain(target.userToken);
    } finally {
      await rm(directory, { recursive: true, force: true });
    }
  });

  test('production ledger refuses symlink directories before any mutation', async () => {
    const directory = await mkdtemp(join(tmpdir(), 'supauth-services-ledger-'));
    const outside = await mkdtemp(join(tmpdir(), 'supauth-services-outside-'));
    try {
      await symlink(outside, join(directory, 'artifacts'));
      const { state, fetch } = fixture();
      const runner = createServiceAcceptanceRunner(fetch, 100, createFileFixtureLedgerSink(directory));
      expect((await runner.runServiceAcceptance(target))[1]?.code).toBe('WEBHOOK_LEDGER_FAILED');
      expect(writes(state)).toHaveLength(0);
      expect(await readdir(outside)).toHaveLength(0);
    } finally {
      await rm(directory, { recursive: true, force: true });
      await rm(outside, { recursive: true, force: true });
    }
  });

  test('delete timeout after commit still fails the SDK contract without retry', async () => {
    const { state, runner } = fixture((call, state) => {
      if (call.method !== 'DELETE') return undefined;
      state.rows = [];
      throw new TypeError('fixture connection closed');
    });
    expect((await runner.runServiceAcceptance(target))[1]?.code).toBe('WEBHOOK_CLEANUP_FAILED');
    expect(writes(state, 'DELETE')).toHaveLength(1);
    expect(state.rows).toHaveLength(0);
  });

  test('a non-empty delete acknowledgement cannot count as a valid void result', async () => {
    const { state, runner } = fixture((call, state) => {
      if (call.method !== 'DELETE') return undefined;
      state.rows = [];
      return Response.json({ bogus: 'ack' });
    });
    expect((await runner.runServiceAcceptance(target))[1]?.status).toBe('failed');
    expect(writes(state, 'DELETE')).toHaveLength(1);
  });
});
