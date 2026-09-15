import { describe, expect, test } from 'bun:test';
import { decodeSchema, JsonObjectSchema, type JsonObject, type JsonValue } from '../packages/shared/src/schema.js';
import { applyCorsPlan, type CorsTransport } from '../scripts/real-contract-cors-host.js';
import { planRealContractCors } from '../scripts/real-contract-cors.js';

function fixture() {
  const header = {
    handler: 'headers',
    response: { set: { 'Access-Control-Allow-Origin': ['{http.request.header.Origin}'] } },
  };
  const routes = ['/auth/v1*', '/.well-known/oauth-authorization-server/auth/v1*'].map(path => ({
    match: [{ host: ['auth.xai.xigu.team'], path: [path] }],
    handle: [{ handler: 'subroute', routes: [
      { match: [{ method: ['OPTIONS'], header: { Origin: ['https://old.example'] } }],
        handle: [header, { handler: 'static_response', status_code: 204 }], terminal: true },
      { match: [{ header: { Origin: ['https://old.example'] } }], handle: [header] },
    ] }],
  }));
  return decodeSchema(JsonObjectSchema, { apps: { http: { servers: { supacloud: { routes } } } } });
}
function setPatch(config: JsonObject, path: string, value: string[]) {
  const segments = path.slice('/config/'.length).split('/');
  const last = segments.pop();
  if (last !== 'Origin') throw new Error('Invalid fixture patch');
  let current: JsonValue = config;
  for (const segment of segments) {
    const next: JsonValue | undefined = Array.isArray(current)
      ? current[Number(segment)] : decodeSchema(JsonObjectSchema, current)[segment];
    if (next === undefined) throw new Error('Missing fixture node');
    current = next;
  }
  decodeSchema(JsonObjectSchema, current)[last] = value;
}
describe('CORS host CAS orchestration, offline transport', () => {
  test('uses every fresh ETag, reads every patch back and supports exact undo', async () => {
    const config = fixture();
    const baseline = structuredClone(config);
    const plan = planRealContractCors(config);
    let revision = 0;
    const transport: CorsTransport = {
      read: async () => ({ config: structuredClone(config), etag: `"${revision}"` }),
      async patch(path, value, etag) {
        expect(etag).toBe(`"${revision}"`);
        setPatch(config, path, value);
        revision += 1;
      },
    };
    expect(await applyCorsPlan(plan, transport)).toBe(4);
    expect(await applyCorsPlan(plan, transport, true)).toBe(4);
    expect(config).toEqual(baseline);
  });
  test('an unknown PATCH outcome stops without a retry', async () => {
    const config = fixture();
    let writes = 0;
    await expect(applyCorsPlan(planRealContractCors(config), {
      read: async () => ({ config, etag: '"revision"' }),
      async patch() { writes += 1; throw new Error('CORS_PATCH_OUTCOME_UNVERIFIED'); },
    })).rejects.toThrow('CORS_PATCH_OUTCOME_UNVERIFIED');
    expect(writes).toBe(1);
  });
  test('a successful response without the actual update cannot pass', async () => {
    const config = fixture();
    await expect(applyCorsPlan(planRealContractCors(config), {
      read: async () => ({ config, etag: '"revision"' }), patch: async () => {},
    })).rejects.toThrow('CORS_PATCH_READBACK_FAILED');
  });
});
