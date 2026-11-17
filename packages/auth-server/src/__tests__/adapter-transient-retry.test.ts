import { describe, it, expect, beforeEach, afterEach } from 'bun:test';
import { strictFetch } from './helpers/strict-fetch.js';
import { SupaCloudAdapter, SupaCloudApiError } from '../supacloud/adapter.js';
import { loadConfig } from '../config/index.js';

// 生产事故（vibeunion/supauth#144）：上游瞬时 5xx / 连接中断会直接放大成前端认证 500。
// 这里约束适配器：只对幂等且无请求体的请求做有限重试，并把 Retry-After 透传给下游。

function stubFetch(handler: (input: string | URL | Request, init?: RequestInit) => Promise<Response>) {
  const original = globalThis.fetch;
  globalThis.fetch = strictFetch(handler);
  return () => { globalThis.fetch = original; };
}

describe('SupaCloudAdapter transient upstream retry', () => {
  let restore: (() => void) | undefined;

  beforeEach(() => {
    process.env["SUPACLOUD_API_URL"] = 'http://test-api:9090';
    process.env["SUPACLOUD_MASTER_TOKEN"] = 'test-token';
    process.env["SUPABASE_SERVICE_ROLE_KEY"] = 'test-storage-token';
    process.env["PROJECT_REF"] = 'test-ref';
    parseEnvFallbacks();
    loadConfig();
  });

  afterEach(() => {
    restore?.();
    restore = undefined;
  });

  it('retries a GET once after a transient 503', async () => {
    const calls: string[] = [];
    restore = stubFetch((input) => {
      calls.push(String(input));
      if (calls.length === 1) {
        return Promise.resolve(Response.json({ error: 'warming up' }, {
          status: 503,
          headers: { 'retry-after': '0' },
        }));
      }
      return Promise.resolve(Response.json({ id: 'test-ref' }));
    });

    const adapter = new SupaCloudAdapter();
    await expect(adapter.getProject()).resolves.toEqual({ id: 'test-ref' });
    expect(calls).toHaveLength(2);
  });

  it('retries a GET once after a network interruption', async () => {
    const calls: string[] = [];
    restore = stubFetch((input) => {
      calls.push(String(input));
      if (calls.length === 1) return Promise.reject(new TypeError('fetch failed'));
      return Promise.resolve(Response.json({ ok: true }));
    });

    const adapter = new SupaCloudAdapter();
    await expect(adapter.getProject()).resolves.toEqual({ ok: true });
    expect(calls).toHaveLength(2);
  });

  it('does not retry a POST even when the upstream answers 503', async () => {
    const calls: string[] = [];
    restore = stubFetch((input) => {
      calls.push(String(input));
      return Promise.resolve(Response.json({ error: 'unavailable' }, { status: 503 }));
    });

    const adapter = new SupaCloudAdapter();
    await expect(adapter.runDatabaseMigration('m1', 'select 1')).rejects.toBeInstanceOf(SupaCloudApiError);
    expect(calls).toHaveLength(1);
  });

  it('does not retry a deterministic 500 but keeps the upstream status', async () => {
    const calls: string[] = [];
    restore = stubFetch((input) => {
      calls.push(String(input));
      return Promise.resolve(Response.json({ error: 'boom' }, { status: 500 }));
    });

    const adapter = new SupaCloudAdapter();
    await expect(adapter.getProject()).rejects.toMatchObject({ status: 500 });
    expect(calls).toHaveLength(1);
  });

  it('rethrows the original transport failure after the retry budget', async () => {
    let calls = 0;
    const failure = new TypeError('connect ECONNREFUSED');
    restore = stubFetch(() => {
      calls += 1;
      return Promise.reject(failure);
    });

    const adapter = new SupaCloudAdapter();
    await expect(adapter.getProject()).rejects.toBe(failure);
    expect(calls).toBe(2);
  });

  it('keeps the upstream Retry-After hint for downstream 503 responses', async () => {
    restore = stubFetch(() => Promise.resolve(Response.json({ error: 'unavailable' }, {
      status: 503,
      headers: { 'retry-after': '7' },
    })));

    const adapter = new SupaCloudAdapter();
    await expect(adapter.runDatabaseMigration('m1', 'select 1'))
      .rejects.toMatchObject({ status: 503, retryAfterSeconds: 7 });
  });
});

/** 与 adapter-contract 测试保持相同的清理口径，避免宿主机环境污染。 */
function parseEnvFallbacks() {
  process.env["OAUTH_RUNTIME_URL"] = 'http://runtime.test';
  process.env["DATABASE_URL"] = 'postgres://test';
  for (const name of [
    'SUPACLOUD_RUNTIME_URL_TEMPLATE',
    'SUPACLOUD_STORAGE_URL_TEMPLATE',
    'SUPACLOUD_STORAGE_URL',
    'SUPABASE_URL',
  ]) {
    delete process.env[name];
  }
}