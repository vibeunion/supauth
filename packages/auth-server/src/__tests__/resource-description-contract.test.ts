import { beforeEach, describe, expect, mock, test } from 'bun:test';
import { Elysia } from 'elysia';
import { ApiContractError } from '../utils/api-contract.js';

const initial = {
  id: 'resource-one', name: 'Documents', indicator: 'https://api.example.test',
  description: 'Existing description', createdAt: '2026-09-08T00:00:00Z', updatedAt: '2026-09-08T00:00:00Z',
};
let stored: Record<string, unknown> = { ...initial };
const writes: Array<{ kind: 'insert' | 'update'; value: Record<string, unknown> }> = [];
const audits: unknown[] = [];
let transactions = 0;

interface Mutation {
  values(input: Record<string, unknown>): Mutation;
  set(input: Record<string, unknown>): Mutation;
  where(condition: unknown): Mutation;
  returning(): Promise<Array<Record<string, unknown>>>;
}
function mutation(kind: 'insert' | 'update'): Mutation {
  let value: Record<string, unknown> = {};
  const chain: Mutation = {
    values(input) { value = input; writes.push({ kind, value }); return chain; },
    set(input) { value = input; writes.push({ kind, value }); return chain; },
    where() { return chain; },
    async returning() {
      stored = { ...stored, ...value };
      return [{ ...stored }];
    },
  };
  return chain;
}
const transaction = { insert: () => mutation('insert') };
mock.module('../db/index.js', () => ({
  getDb: () => ({
    async transaction<T>(callback: (value: typeof transaction) => Promise<T>): Promise<T> {
      transactions++;
      return callback(transaction);
    },
    update: () => mutation('update'),
  }),
}));
mock.module('../repositories/audit.js', () => ({
  logAudit: async (value: unknown) => { audits.push(value); },
}));
// 运行真实路由与仓储，仅在数据库边界捕获 values/set，不重写描述默认逻辑。
const { resourceRoutes } = await import('../routes/resources.js');
const app = new Elysia().onError(({ error, set }) => {
  if (error instanceof ApiContractError) {
    set.status = error.status;
    return { code: error.code };
  }
  set.status = 500;
  return { code: 'unexpected_error' };
}).use(resourceRoutes);

beforeEach(() => {
  stored = { ...initial };
  writes.length = 0;
  audits.length = 0;
  transactions = 0;
});

function request(method: 'POST' | 'PUT', body?: unknown) {
  return app.handle(new Request(`http://localhost/v1/resources${method === 'PUT' ? '/resource-one' : ''}`, {
    method,
    ...(body === undefined ? {} : { headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) }),
  }));
}

describe('resource description uses the shared nullable text contract through storage', () => {
  test.each(['Document API', '', null].map(description => ({ description })))(
    'create preserves the original text-or-null storage default: $description', async ({ description }) => {
      const response = await request('POST', { name: initial.name, indicator: initial.indicator, description });
      expect(response.status).toBe(200);
      expect(await response.json()).toMatchObject({ description: description || null, scopes: [] });
      expect(writes).toEqual([{
        kind: 'insert', value: { name: initial.name, indicator: initial.indicator, description: description || null },
      }]);
      expect(transactions).toBe(1);
      expect(audits).toHaveLength(1);
    },
  );

  test.each(['Updated description', '', null].map(description => ({ description })))(
    'update stores text/empty/null without changing clear semantics: $description', async ({ description }) => {
      const response = await request('PUT', { description });
      expect(response.status).toBe(200);
      expect(await response.json()).toMatchObject({ description });
      expect(stored["description"]).toBe(description);
      expect(writes).toHaveLength(1);
      expect(writes[0]?.kind).toBe('update');
      expect(writes[0]?.value).toEqual({ description, updatedAt: expect.any(Date) });
      expect(audits).toHaveLength(1);
    },
  );

  test('omitted create description defaults null, while empty/absent update bodies preserve existing text', async () => {
    const created = await request('POST', { name: initial.name, indicator: initial.indicator });
    expect(created.status).toBe(200);
    expect(stored["description"]).toBeNull();
    for (const body of [{}, undefined]) {
      stored = { ...initial };
      const updated = await request('PUT', body);
      expect(updated.status).toBe(200);
      expect(stored["description"]).toBe(initial.description);
      expect(writes.at(-1)?.value).toEqual({ updatedAt: expect.any(Date) });
    }
  });

  for (const method of ['POST', 'PUT'] as const) {
    test.each([42, false, {}, []].map(description => ({ description })))(
      `${method} rejects non-text descriptions before transactions, writes or audits: $description`,
      async ({ description }) => {
        const response = await request(method, {
          ...(method === 'POST' ? { name: initial.name, indicator: initial.indicator } : {}), description,
        });
        expect(response.status).toBe(400);
        expect(await response.json()).toEqual({ code: 'invalid_request_body' });
        expect(transactions).toBe(0);
        expect(writes).toHaveLength(0);
        expect(audits).toHaveLength(0);
        expect(stored).toEqual(initial);
      },
    );
  }
});
