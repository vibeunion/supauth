import { randomUUID } from 'node:crypto';
import { chmod, lstat, mkdir, open, rename, unlink } from 'node:fs/promises';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  decodeSchema, sdkEndpoints, Type,
  type SdkEndpointResult,
} from '../packages/shared/src/index.js';
import { commonServerErrorResponse } from '../packages/shared/src/server-contracts.js';
import {
  SupaOAuthAPIError, SupaOAuthClient, type SupaOAuthFetch,
} from '../packages/sdks/typescript/src/index.js';
import {
  validateAcceptanceTarget, type AcceptanceTarget, type PhaseResult,
} from './real-contract-acceptance-contract.js';

type ServiceCode =
  | 'SERVICE_TARGET_INVALID' | 'SERVICE_DESTINATION_REJECTED'
  | 'SERVICE_TRANSPORT_FAILED' | 'SERVICE_RESPONSE_INVALID'
  | 'BACKEND_PROJECT_MISMATCH' | 'BACKEND_RUNTIME_INVALID'
  | 'BACKEND_ANONYMOUS_BOUNDARY_FAILED' | 'BACKEND_USER_BOUNDARY_FAILED'
  | 'BACKEND_PREFLIGHT_FAILED' | 'SDK_PREFLIGHT_BLOCKED'
  | 'WEBHOOK_LIST_INCOMPLETE' | 'WEBHOOK_MUTATION_BLOCKED'
  | 'WEBHOOK_CREATE_UNKNOWN' | 'WEBHOOK_READBACK_FAILED'
  | 'WEBHOOK_OWNERSHIP_LOST' | 'WEBHOOK_CALLBACK_FAILED'
  | 'WEBHOOK_CLEANUP_FAILED' | 'WEBHOOK_LEDGER_FAILED' | 'WEBHOOK_DELETE_UNKNOWN';

export class ServiceAcceptanceError extends Error {
  constructor(readonly code: ServiceCode) {
    super(code);
    this.name = 'ServiceAcceptanceError';
  }
}

export function serviceAcceptanceCode(error: unknown): string {
  return error instanceof ServiceAcceptanceError ? error.code : 'SERVICE_TRANSPORT_FAILED';
}

export interface OwnedWebhook {
  id: string;
  /** 本次运行的精确初始 URL，而不是可匹配其他资源的通用前缀。 */
  marker: string;
  updatedUrl: string;
  sdk: Pick<SupaOAuthClient, 'getWebhook' | 'updateWebhook'>;
}

type Webhook = SdkEndpointResult<'getWebhook'>;
type WebhookList = SdkEndpointResult<'listWebhooks'>;
type RunPermission = { marker: string; updatedUrl: string; id: string | null; createSent: boolean };
const MAX_ROWS = 1_000;
const MAX_PAGES = 20;
const MAX_BODY_BYTES = 2_000_000;

// GoTrue HealthCheckResponse: internal/api/api.go (上游字段，不复用 BFF health)。
const GoTrueHealthSchema = Type.Object({
  name: Type.Literal('GoTrue'),
  version: Type.String({ minLength: 1 }),
  description: Type.String({ minLength: 1 }),
});

export interface FixtureLedger {
  version: 1;
  runId: string;
  projectRef: string;
  baseUrl: string;
  marker: string;
  updatedUrl: string;
  id: string | null;
  phase: 'intent' | 'create-acknowledged' | 'created' | 'cleanup-started'
    | 'cleanup-complete' | 'cleanup-unresolved' | 'cleanup-failed';
  primaryCode: ServiceCode | null;
  cleanupCode: ServiceCode | null;
}

export type FixtureLedgerSink = (intent: Readonly<FixtureLedger>) => Promise<{
  write(record: Readonly<FixtureLedger>): Promise<void>;
}>;

export const createFileFixtureLedgerSink = (root: string): FixtureLedgerSink => async intent => {
  if (!/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/.test(intent.runId)) {
    fail('WEBHOOK_LEDGER_FAILED');
  }
  let directory = root;
  for (const segment of ['artifacts', 'real-contract-acceptance', 'fixtures']) {
    directory = join(directory, segment);
    try {
      await mkdir(directory, { mode: 0o700 });
    } catch (error) {
      if (!(error instanceof Error) || !('code' in error) || error.code !== 'EEXIST') throw error;
    }
    const info = await lstat(directory);
    if (!info.isDirectory() || info.isSymbolicLink()) fail('WEBHOOK_LEDGER_FAILED');
  }
  await chmod(directory, 0o700);
  const path = join(directory, `${intent.runId}.json`);
  const initial = await open(path, 'wx', 0o600);
  try {
    await initial.writeFile(`${JSON.stringify(intent)}\n`);
    await initial.sync();
  } finally {
    await initial.close();
  }
  const syncDirectory = async () => {
    const handle = await open(directory, 'r');
    try { await handle.sync(); } finally { await handle.close(); }
  };
  await syncDirectory();
  return {
    async write(record) {
      if (record.runId !== intent.runId || record.marker !== intent.marker) fail('WEBHOOK_LEDGER_FAILED');
      const temporary = join(directory, `${intent.runId}.${randomUUID()}.tmp`);
      const handle = await open(temporary, 'wx', 0o600);
      try {
        await handle.writeFile(`${JSON.stringify(record)}\n`);
        await handle.sync();
      } finally {
        await handle.close();
      }
      try {
        await rename(temporary, path);
        await syncDirectory();
      } catch (error) {
        await unlink(temporary).catch(() => {});
        throw error;
      }
    },
  };
};

const fileLedger = createFileFixtureLedgerSink(fileURLToPath(new URL('..', import.meta.url)));

function fail(code: ServiceCode): never {
  throw new ServiceAcceptanceError(code);
}

function pathWithin(url: URL, base: URL): string {
  const prefix = base.pathname.replace(/\/+$/, '');
  if (url.origin !== base.origin || url.username || url.password || url.hash
    || !url.pathname.startsWith(`${prefix}/`) || /%|\\/.test(url.pathname)) {
    fail('SERVICE_DESTINATION_REJECTED');
  }
  return url.pathname.slice(prefix.length);
}

async function boundedBody(response: Response): Promise<Uint8Array<ArrayBuffer>> {
  const reader = response.body?.getReader();
  if (!reader) return new Uint8Array();
  const chunks: Uint8Array[] = [];
  let length = 0;
  try {
    while (true) {
      const chunk = await reader.read();
      if (chunk.done) break;
      length += chunk.value.byteLength;
      if (length > MAX_BODY_BYTES) fail('SERVICE_RESPONSE_INVALID');
      chunks.push(chunk.value);
    }
  } finally {
    await reader.cancel();
    reader.releaseLock();
  }
  const body = new Uint8Array(length);
  let offset = 0;
  for (const chunk of chunks) {
    body.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return body;
}

function requestAllowed(path: string, url: URL, method: string, role: 'admin' | 'user' | 'anonymous',
  permission: RunPermission | null, init: RequestInit): void {
  const list = path === '/v1/webhooks';
  if (method === 'GET') {
    if (url.search && (!list || [...url.searchParams.keys()].some(key => !['page', 'limit'].includes(key))
      || [...url.searchParams.values()].some(value => !/^[1-9][0-9]*$/.test(value)))) {
      fail('SERVICE_DESTINATION_REJECTED');
    }
    if (list || (role === 'admin' && (path === '/v1/health' || path === '/v1/project'
      || /^\/v1\/webhooks\/[A-Za-z0-9_-]+$/.test(path)))) return;
    fail('SERVICE_DESTINATION_REJECTED');
  }
  if (role !== 'admin' || !permission || url.search) fail('SERVICE_DESTINATION_REJECTED');
  if (method === 'DELETE' && permission.id && path === `/v1/webhooks/${permission.id}`) return;
  if (typeof init.body !== 'string') fail('SERVICE_DESTINATION_REJECTED');
  let payload: unknown;
  try { payload = JSON.parse(init.body); } catch { fail('SERVICE_DESTINATION_REJECTED'); }
  if (method === 'POST' && list && !permission.createSent) {
    const decoded = decodeSchema(sdkEndpoints.createWebhook.input, { body: payload });
    if (decoded.body.url !== permission.marker || decoded.body.enabled !== false
      || decoded.body.events.length !== 0
      || Object.keys(decoded.body).some(key => !['url', 'events', 'enabled'].includes(key))) {
      fail('SERVICE_DESTINATION_REJECTED');
    }
    permission.createSent = true;
    return;
  }
  if (method === 'PUT' && permission.id && path === `/v1/webhooks/${permission.id}`) {
    const decoded = decodeSchema(sdkEndpoints.updateWebhook.input, {
      params: { webhookId: permission.id }, body: payload,
    });
    if (decoded.body.enabled === true || (decoded.body.events && decoded.body.events.length !== 0)
      || (decoded.body.url !== undefined && ![permission.marker, permission.updatedUrl].includes(decoded.body.url))
      || Object.keys(decoded.body).some(key => !['url', 'events', 'enabled'].includes(key))) {
      fail('SERVICE_DESTINATION_REJECTED');
    }
    return;
  }
  fail('SERVICE_DESTINATION_REJECTED');
}

function checkedWebhook(value: Webhook, id: string, urls: readonly string[], disabled = false): Webhook {
  if (value.id !== id || !urls.includes(value.url) || value.events.length !== 0
    || (disabled && value.enabled !== false)) fail('WEBHOOK_READBACK_FAILED');
  return value;
}

/** 注入只用于局部安全测试；正式入口在文件末尾固定使用真实 fetch。 */
export function createServiceAcceptanceRunner(
  fetchImpl: SupaOAuthFetch, timeoutMs = 8_000, ledgerSink: FixtureLedgerSink = fileLedger,
) {
  function prepare(target: AcceptanceTarget) {
    try {
      const validated = validateAcceptanceTarget(target);
      const { projectRef, adminToken, userToken } = validated;
      const base = new URL(validated.baseUrl);
      const runtime = new URL(validated.runtimeUrl);
      if (adminToken === userToken || !Number.isSafeInteger(timeoutMs) || timeoutMs <= 0) {
        fail('SERVICE_TARGET_INVALID');
      }
      let permission: RunPermission | null = null;
      const transport = (role: 'admin' | 'user' | 'anonymous' | 'runtime'): SupaOAuthFetch => async (input, init = {}) => {
        try {
          if (input instanceof Request) fail('SERVICE_DESTINATION_REJECTED');
          const url = new URL(input);
          const path = pathWithin(url, role === 'runtime' ? runtime : base);
          const method = (init.method ?? 'GET').toUpperCase();
          if (role === 'runtime') {
            const expected = runtime.pathname.endsWith('/auth/v1') ? '/health' : '/auth/v1/health';
            if (method !== 'GET' || path !== expected || url.search) fail('SERVICE_DESTINATION_REJECTED');
          } else requestAllowed(path, url, method, role, permission, init);
          const headers = new Headers(init.headers);
          const token = role === 'admin' ? adminToken : role === 'user' ? userToken : null;
          if (token) headers.set('Authorization', `Bearer ${token}`);
          else headers.delete('Authorization');
          headers.delete('Cookie');
          const controller = new AbortController();
          let timer: ReturnType<typeof setTimeout> | undefined;
          // 超时覆盖响应体读取；注入 transport 不响应 abort 时也不能无限等待。
          const deadline = new Promise<never>((_resolve, reject) => {
            timer = setTimeout(() => {
              controller.abort();
              reject(new ServiceAcceptanceError('SERVICE_TRANSPORT_FAILED'));
            }, timeoutMs);
          });
          try {
            return await Promise.race([deadline, (async () => {
              const response = await fetchImpl(url, {
                ...init, headers, method, redirect: 'error', credentials: 'omit',
                cache: 'no-store', signal: controller.signal,
              });
              if (response.redirected || (response.status >= 300 && response.status < 400)) {
                await response.body?.cancel();
                fail('SERVICE_DESTINATION_REJECTED');
              }
              if (response.url) {
                const returned = new URL(response.url);
                if (returned.href !== url.href) fail('SERVICE_DESTINATION_REJECTED');
              }
              const bytes = await boundedBody(response);
              if (response.ok && ((method === 'DELETE'
                && (![200, 204, 205].includes(response.status) || bytes.byteLength !== 0))
                || (method !== 'POST' && method !== 'DELETE' && response.status !== 200))) {
                fail('SERVICE_RESPONSE_INVALID');
              }
              return new Response([204, 205, 304].includes(response.status) ? null : bytes, {
                status: response.status, headers: response.headers,
              });
            })()]);
          } finally {
            if (timer !== undefined) clearTimeout(timer);
          }
        } catch (error) {
          if (error instanceof ServiceAcceptanceError) throw error;
          fail('SERVICE_TRANSPORT_FAILED');
        }
      };
      const admin = new SupaOAuthClient({ baseUrl: base.href.replace(/\/+$/, ''), fetch: transport('admin') });
      const anonymous = new SupaOAuthClient({ baseUrl: base.href.replace(/\/+$/, ''), fetch: transport('anonymous') });
      const user = new SupaOAuthClient({ baseUrl: base.href.replace(/\/+$/, ''), fetch: transport('user') });
      return {
        admin, anonymous, user, projectRef, baseUrl: base.href.replace(/\/+$/, ''),
        runtimeHealth: async () => {
          const suffix = runtime.pathname.endsWith('/auth/v1') ? '/health' : '/auth/v1/health';
          const response = await transport('runtime')(`${runtime.href.replace(/\/+$/, '')}${suffix}`);
          if (response.status !== 200) fail('BACKEND_RUNTIME_INVALID');
          const value: unknown = await response.json();
          decodeSchema(GoTrueHealthSchema, value);
        },
        authorize: (value: RunPermission | null) => { permission = value; },
      };
    } catch {
      fail('SERVICE_TARGET_INVALID');
    }
  }

  type Session = ReturnType<typeof prepare>;

  async function denial(client: SupaOAuthClient, expected: 401 | 403): Promise<void> {
    const code = expected === 401 ? 'BACKEND_ANONYMOUS_BOUNDARY_FAILED' : 'BACKEND_USER_BOUNDARY_FAILED';
    try {
      await client.listWebhooks();
    } catch (error) {
      if (!(error instanceof SupaOAuthAPIError) || error.status !== expected) fail(code);
      let value: unknown;
      try { value = JSON.parse(error.body); } catch { value = error.body; }
      const decoded = decodeSchema(commonServerErrorResponse.schema, value);
      if (expected === 403 && (typeof decoded !== 'object'
        || decoded.error.code !== 'admin_access_forbidden')) fail(code);
      if (expected === 401 && decoded === 'Too Many Requests') fail(code);
      return;
    }
    fail(code);
  }

  async function preflight(session: Session, checked: () => void) {
    const health = await session.admin.health();
    if (health.project_ref !== session.projectRef || health.status !== 'ok') fail('BACKEND_PROJECT_MISMATCH');
    checked();
    const project = await session.admin.getProject();
    if (project.ref !== session.projectRef
      || (project.project_ref !== undefined && project.project_ref !== session.projectRef)) {
      fail('BACKEND_PROJECT_MISMATCH');
    }
    checked();
    await session.runtimeHealth();
    checked();
    await denial(session.anonymous, 401);
    checked();
    await denial(session.user, 403);
    checked();
  }

  async function completeList(client: SupaOAuthClient): Promise<Webhook[]> {
    let page: WebhookList = await client.listWebhooks();
    const total = page.total;
    const limit = page.limit;
    const rows: Webhook[] = [];
    const ids = new Set<string>();
    for (let number = 1; number <= MAX_PAGES; number++) {
      if (!Number.isSafeInteger(total) || total < 0 || total > MAX_ROWS || page.total !== total
        || (page.page !== undefined && page.page !== number)
        || (number > 1 && page.limit !== limit)) fail('WEBHOOK_LIST_INCOMPLETE');
      for (const row of page.items) {
        if (!/^[A-Za-z0-9_-]+$/.test(row.id) || ids.has(row.id)) fail('WEBHOOK_LIST_INCOMPLETE');
        ids.add(row.id);
        rows.push(row);
      }
      if (rows.length === total) return rows;
      if (rows.length > total || page.page !== number || page.limit === undefined
        || !Number.isSafeInteger(page.limit) || page.limit <= 0 || page.items.length !== page.limit) {
        fail('WEBHOOK_LIST_INCOMPLETE');
      }
      if (number === MAX_PAGES) fail('WEBHOOK_LIST_INCOMPLETE');
      page = await client.requestDecoded(
        `/v1/webhooks?page=${number + 1}&limit=${page.limit}`,
        value => decodeSchema(sdkEndpoints.listWebhooks.result, value),
      );
    }
    fail('WEBHOOK_LIST_INCOMPLETE');
  }

  async function owned<T>(session: Session, callback: (value: OwnedWebhook) => Promise<T>,
    checked: () => void): Promise<T> {
    const runId = randomUUID();
    const marker = `https://supauth-contract.invalid/${runId}`;
    const updatedUrl = `${marker}/updated`;
    let baseline: Webhook[];
    try { baseline = await completeList(session.admin); } catch { fail('WEBHOOK_MUTATION_BLOCKED'); }
    if (baseline.some(row => row.url === marker || row.url === updatedUrl)) fail('WEBHOOK_MUTATION_BLOCKED');
    checked();
    const baselineIds = new Set(baseline.map(row => row.id));
    const permission: RunPermission = { marker, updatedUrl, id: null, createSent: false };
    let ledger: FixtureLedger = {
      version: 1, runId, projectRef: session.projectRef, baseUrl: session.baseUrl,
      marker, updatedUrl, id: null, phase: 'intent', primaryCode: null, cleanupCode: null,
    };
    let writer: Awaited<ReturnType<FixtureLedgerSink>>;
    try { writer = await ledgerSink({ ...ledger }); } catch { fail('WEBHOOK_LEDGER_FAILED'); }
    const persist = async (update: Partial<FixtureLedger>) => {
      ledger = { ...ledger, ...update };
      try { await writer.write({ ...ledger }); } catch { fail('WEBHOOK_LEDGER_FAILED'); }
    };
    session.authorize(permission);
    let primary: ServiceAcceptanceError | null = null;
    let cleanup: ServiceAcceptanceError | null = null;
    let unresolvedCreate = false;
    let result: { value: T } | null = null;
    try {
      let created: Webhook;
      try {
        created = await session.admin.createWebhook({ url: marker, events: [], enabled: false });
        if (baselineIds.has(created.id) || !/^[A-Za-z0-9_-]+$/.test(created.id)) fail('WEBHOOK_CREATE_UNKNOWN');
        checkedWebhook(created, created.id, [marker], true);
      } catch {
        fail('WEBHOOK_CREATE_UNKNOWN');
      }
      checked();
      await persist({ phase: 'create-acknowledged' });
      try {
        checkedWebhook(await session.admin.getWebhook(created.id), created.id, [marker], true);
      } catch {
        fail('WEBHOOK_READBACK_FAILED');
      }
      permission.id = created.id;
      checked();
      await persist({ phase: 'created', id: created.id });
      result = { value: await callback({
        id: created.id, marker, updatedUrl,
        sdk: {
          getWebhook: id => {
            if (id !== created.id) fail('SERVICE_DESTINATION_REJECTED');
            return session.admin.getWebhook(id);
          },
          updateWebhook: (id, data) => {
            if (id !== created.id) fail('SERVICE_DESTINATION_REJECTED');
            return session.admin.updateWebhook(id, data);
          },
        },
      }) };
    } catch (error) {
      primary = error instanceof ServiceAcceptanceError ? error : new ServiceAcceptanceError('WEBHOOK_CALLBACK_FAILED');
    } finally {
      try {
        await persist({ phase: 'cleanup-started', primaryCode: primary?.code ?? null });
      } catch {
        cleanup = new ServiceAcceptanceError('WEBHOOK_LEDGER_FAILED');
      }
      try {
        if (permission.createSent) {
          // 创建回执未知时也先按完整列表精确找回；绝不重放 POST。
          const rows = await completeList(session.admin);
          const matches = rows.filter(row => row.url === marker || row.url === updatedUrl);
          if (matches.length > 1) fail('WEBHOOK_OWNERSHIP_LOST');
          const candidate = matches[0];
          if (candidate) {
            if (baselineIds.has(candidate.id) || (permission.id !== null && candidate.id !== permission.id)) {
              fail('WEBHOOK_OWNERSHIP_LOST');
            }
            permission.id = candidate.id;
            try { await persist({ id: candidate.id }); } catch {
              cleanup = new ServiceAcceptanceError('WEBHOOK_LEDGER_FAILED');
            }
            const current = await session.admin.getWebhook(candidate.id);
            checkedWebhook(current, candidate.id, [marker, updatedUrl]);
            checked();
            let deletionFailed = false;
            try {
              await session.admin.deleteWebhook(candidate.id);
              checked();
            } catch {
              deletionFailed = true;
            }
            const after = await completeList(session.admin);
            if (after.some(row => row.id === candidate.id || row.url === marker || row.url === updatedUrl)) {
              fail('WEBHOOK_CLEANUP_FAILED');
            }
            checked();
            // 即使删除已收敛，未知/无效回执仍不能计作 SDK 契约通过。
            if (deletionFailed) fail('WEBHOOK_DELETE_UNKNOWN');
          } else if (permission.id && rows.some(row => row.id === permission.id)) {
            fail('WEBHOOK_OWNERSHIP_LOST');
          } else if (primary === null) {
            fail('WEBHOOK_OWNERSHIP_LOST');
          } else if (permission.id === null) {
            unresolvedCreate = true;
          }
        }
      } catch (error) {
        cleanup = error instanceof ServiceAcceptanceError ? error : new ServiceAcceptanceError('WEBHOOK_CLEANUP_FAILED');
      } finally {
        session.authorize(null);
      }
      try {
        await persist({
          phase: cleanup ? 'cleanup-failed' : unresolvedCreate ? 'cleanup-unresolved' : 'cleanup-complete',
          primaryCode: primary?.code ?? null,
          cleanupCode: cleanup?.code ?? (unresolvedCreate ? 'WEBHOOK_CREATE_UNKNOWN' : null),
        });
      } catch {
        cleanup = new ServiceAcceptanceError('WEBHOOK_LEDGER_FAILED');
      }
    }
    if (cleanup) fail('WEBHOOK_CLEANUP_FAILED');
    if (primary) throw primary;
    if (!result) fail('WEBHOOK_CALLBACK_FAILED');
    return result.value;
  }

  async function runOwnedWebhook<T>(target: AcceptanceTarget, callback: (value: OwnedWebhook) => Promise<T>): Promise<T> {
    try {
      const session = prepare(target);
      await preflight(session, () => {});
      return await owned(session, callback, () => {});
    } catch (error) {
      if (error instanceof ServiceAcceptanceError) throw error;
      fail('BACKEND_PREFLIGHT_FAILED');
    }
  }

  async function runServiceAcceptance(target: AcceptanceTarget): Promise<PhaseResult[]> {
    let checks = 0;
    let session: Session;
    try {
      session = prepare(target);
      await preflight(session, () => { checks++; });
    } catch (error) {
      return [
        { phase: 'backend', status: error instanceof ServiceAcceptanceError && error.code === 'SERVICE_TARGET_INVALID'
          ? 'blocked' : 'failed', checks, code: serviceAcceptanceCode(error) },
        { phase: 'sdk', status: 'blocked', checks: 0, code: 'SDK_PREFLIGHT_BLOCKED' },
      ];
    }
    const backend: PhaseResult = { phase: 'backend', status: 'passed', checks, code: 'BACKEND_CONTRACT_PASSED' };
    checks = 0;
    try {
      await owned(session, async ({ id, updatedUrl, sdk }) => {
        checkedWebhook(await sdk.updateWebhook(id, { url: updatedUrl, enabled: false }), id, [updatedUrl], true);
        checks++;
        checkedWebhook(await sdk.getWebhook(id), id, [updatedUrl], true);
        checks++;
      }, () => { checks++; });
      return [backend, { phase: 'sdk', status: 'passed', checks, code: 'SDK_CONTRACT_PASSED' }];
    } catch (error) {
      return [backend, { phase: 'sdk', status: error instanceof ServiceAcceptanceError
        && error.code === 'WEBHOOK_MUTATION_BLOCKED' ? 'blocked' : 'failed',
      checks, code: serviceAcceptanceCode(error) }];
    }
  }

  return { runServiceAcceptance, runOwnedWebhook };
}

const live = createServiceAcceptanceRunner((input, init) => globalThis.fetch(input, init));
export const runServiceAcceptance = live.runServiceAcceptance;
export const runOwnedWebhook = live.runOwnedWebhook;
