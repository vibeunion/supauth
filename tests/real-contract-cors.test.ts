import { describe, expect, test } from 'bun:test';
import { decodeSchema, JsonObjectSchema, type JsonObject, type JsonValue } from '../packages/shared/src/schema.js';
import {
  inspectRealContractCorsReadback, planRealContractCors, planRealContractCorsUndo,
  REAL_CONTRACT_CORS_SCOPE, type RealContractCorsPatch,
} from '../scripts/real-contract-cors.js';

const AUTH = '/auth/v1*';
const DISCOVERY = '/.well-known/oauth-authorization-server/auth/v1*';
const ORIGINS = ['https://existing.xai.xigu.team', 'https://another.xai.xigu.team'];
const HOST = REAL_CONTRACT_CORS_SCOPE.host;
const ORIGIN = REAL_CONTRACT_CORS_SCOPE.origin;
function record(value: JsonValue | undefined): JsonObject {
  return decodeSchema(JsonObjectSchema, value);
}
function list(value: JsonValue | undefined): JsonValue[] {
  if (!Array.isArray(value)) throw new Error('Invalid fixture array');
  return value;
}
function header(): JsonObject {
  return {
    handler: 'headers',
    response: { set: {
      'Access-Control-Allow-Origin': ['{http.request.header.Origin}'],
      'Access-Control-Allow-Credentials': ['true'],
      'Access-Control-Allow-Methods': ['GET, POST, OPTIONS'],
      'Access-Control-Allow-Headers': ['authorization,content-type,x-client-info'],
      Vary: ['Origin'],
    } },
  };
}
function route(path = AUTH, duplicate = false): JsonObject {
  const match = { host: [HOST], path: [path] };
  return {
    '@id': `fixture-${path}`,
    match: duplicate ? [structuredClone(match), match] : [match],
    terminal: true,
    handle: [
      { handler: 'subroute', routes: [
        {
          match: [{ header: { Origin: [...ORIGINS] }, method: ['OPTIONS'] }, { method: ['OPTIONS'] }],
          handle: [header(), { handler: 'static_response', status_code: 204 }],
          terminal: true,
        },
        { match: [{ header: { Origin: [...ORIGINS] } }, {}], handle: [header()] },
      ] },
      { handler: 'rewrite', strip_path_prefix: '/auth/v1' },
      { handler: 'reverse_proxy', upstreams: [{ dial: '127.0.0.1:9999' }] },
    ],
  };
}
function fixture(selected = [route(AUTH, true), route(DISCOVERY), route()]): JsonObject {
  return {
    admin: { listen: 'localhost:2019' },
    apps: { http: { servers: {
      supacloud: { listen: [':443'], routes: selected },
      other: { routes: [route()] },
    } } },
    logging: { logs: { default: { level: 'INFO' } } },
  };
}
function routes(root: JsonObject): JsonValue[] {
  return list(record(record(record(record(root['apps'])['http'])['servers'])['supacloud'])['routes']);
}
function branches(target: JsonObject): JsonValue[] {
  return list(record(list(target['handle'])[0])['routes']);
}
function matcher(target: JsonObject, branchIndex = 0, matchIndex = 0): JsonObject {
  return record(list(record(branches(target)[branchIndex])['match'])[matchIndex]);
}
function apply(input: JsonObject, patches: readonly RealContractCorsPatch[]): JsonObject {
  const result = structuredClone(input);
  for (const patch of patches) {
    let node: JsonValue = result;
    const segments = patch.path.slice('/config/'.length).split('/');
    const last = segments.pop();
    if (last !== 'Origin') throw new Error('Invalid fixture patch');
    for (const segment of segments) {
      const child: JsonValue | undefined = Array.isArray(node) ? node[Number(segment)] : record(node)[segment];
      if (child === undefined) throw new Error('Missing fixture child');
      node = child;
    }
    record(node)[last] = [...patch.next];
  }
  return result;
}
function rejected(target: JsonObject): void {
  expect(() => planRealContractCors(fixture([target, route(DISCOVERY)]))).toThrow();
}

describe('real contract CORS pure plan', () => {
  test('live shape: duplicate top matcher, six exact arrays, no mutation or unrelated changes', () => {
    const input = fixture();
    const before = structuredClone(input);
    const plan = planRealContractCors(input);
    expect(plan.patches).toHaveLength(6);
    expect(plan.scopePath).toBe('/config/');
    expect(plan.runId).toBe(REAL_CONTRACT_CORS_SCOPE.runId);
    for (const [index, patch] of plan.patches.entries()) {
      expect(patch.path).toBe(`${REAL_CONTRACT_CORS_SCOPE.routesPath}/${Math.floor(index / 2)}/handle/0/routes/${index % 2}/match/0/header/Origin`);
      expect(patch.original).toEqual(ORIGINS);
      expect(patch.next).toEqual([...ORIGINS, ORIGIN]);
    }
    expect(input).toEqual(before);
    expect(inspectRealContractCorsReadback(plan, input)).toEqual({
      appliedPaths: [], pendingPaths: plan.patches.map((patch) => patch.path), complete: false, restored: true,
    });
    const current = apply(input, plan.patches);
    expect(inspectRealContractCorsReadback(plan, current).complete).toBe(true);
    expect(apply(current, planRealContractCorsUndo(plan, current))).toEqual(input);
    expect(input).toEqual(before);
    expect(planRealContractCors(current).patches).toEqual([]);
  });

  test('derive positions from scope, not 29/33/66, and leave safety/custom-ui/ACME routes alone', () => {
    const foreign = route();
    foreign['match'] = [{ host: ['elsewhere.xai.xigu.team'], path: [AUTH] }];
    const rateLimit: JsonObject = {
      match: [{ host: [HOST, 'other.xai.xigu.team'], path: [AUTH, '/rest/v1*'] }],
      handle: [{ handler: 'rate_limit', rate_limits: { untouched: {} } }],
    };
    const deletion = route('/auth/v1/admin/users/*');
    deletion['match'] = [{ host: [HOST, 'other.xai.xigu.team'], path: ['/auth/v1/admin/users/*'], method: ['DELETE'] }];
    const unrelated = [rateLimit, route('/authorize.html'), route('/logout'), deletion,
      route('/.well-known/acme-challenge*'), foreign];
    const input = fixture([...unrelated, route(DISCOVERY), route(AUTH, true)]);
    const plan = planRealContractCors(input);
    expect(plan.patches).toHaveLength(4);
    expect(plan.patches.every((patch) => /\/routes\/(6|7)\/handle\/0\//.test(patch.path))).toBe(true);
    const changed = apply(input, plan.patches);
    expect(routes(changed).slice(0, unrelated.length)).toEqual(unrelated);
    expect(record(record(record(changed['apps'])['http'])['servers'])['other'])
      .toEqual(record(record(record(input['apps'])['http'])['servers'])['other']);
  });

  test('preserve every fallback, response header, method, handler, regex and unknown field', () => {
    const auth = route();
    auth['extra_metadata'] = { nested: ['retained'], enabled: false };
    for (const [index, branch] of branches(auth).entries()) {
      list(record(branch)['match']).push({
        ...(index === 0 ? { method: ['OPTIONS'] } : {}),
        header_regexp: { Origin: { name: 'cors_origin', pattern: '^https://old\\.example$' } },
      });
    }
    const input = fixture([auth, route(DISCOVERY)]);
    const plan = planRealContractCors(input);
    const current = apply(input, plan.patches);
    expect(apply(current, planRealContractCorsUndo(plan, current))).toEqual(input);
    for (const [index, branch] of branches(record(routes(current)[0])).entries()) {
      expect(record(branch)['handle']).toEqual(record(branches(auth)[index])['handle']);
      expect(list(record(branch)['match']).slice(1)).toEqual(list(record(branches(auth)[index])['match']).slice(1));
    }
  });

  test('existing new origin is an idempotent no-op and is never removed by undo', () => {
    const original = fixture();
    const current = apply(original, planRealContractCors(original).patches);
    const plan = planRealContractCors(current);
    expect(plan.patches).toEqual([]);
    expect(planRealContractCorsUndo(plan, current)).toEqual([]);
    expect(inspectRealContractCorsReadback(plan, current)).toEqual({
      appliedPaths: [], pendingPaths: [], complete: true, restored: true,
    });
  });

  test('top header_regexp narrows duplicate matchers and remains opaque and unchanged', () => {
    const auth = route(AUTH, true);
    const matches = list(auth['match']);
    record(matches[0])['header_regexp'] = { 'X-Fixture': { name: 'fixture', pattern: '^synthetic-one$' } };
    record(matches[1])['header_regexp'] = { 'X-Fixture': { pattern: '^synthetic-two$' } };
    const input = fixture([auth, route(DISCOVERY), route()]);
    const plan = planRealContractCors(input);
    expect(plan.patches).toHaveLength(6);
    const current = apply(input, plan.patches);
    expect(record(routes(current)[0])['match']).toEqual(auth['match']);
    expect(inspectRealContractCorsReadback(plan, current).complete).toBe(true);
    expect(apply(current, planRealContractCorsUndo(plan, current))).toEqual(input);
    record(list(record(routes(current)[0])['match'])[0])['header_regexp'] = {
      'X-Fixture': { name: 'fixture', pattern: '^drift$' },
    };
    expect(() => inspectRealContractCorsReadback(plan, current)).toThrow('CORS_READBACK_CONFLICT');
    expect(() => planRealContractCorsUndo(plan, current)).toThrow('CORS_READBACK_CONFLICT');
  });

  test.each([
    ['null', null],
    ['array', []],
    ['string', 'synthetic'],
    ['empty map', {}],
    ['invalid header name', { 'X Invalid': { pattern: 'synthetic' } }],
    ['empty header name', { '': { pattern: 'synthetic' } }],
    ['newline header name', { 'X-Fixture\n': { pattern: 'synthetic' } }],
    ['null entry', { 'X-Fixture': null }],
    ['array entry', { 'X-Fixture': [] }],
    ['missing pattern', { 'X-Fixture': { name: 'fixture' } }],
    ['non-string pattern', { 'X-Fixture': { pattern: 42 } }],
    ['non-string name', { 'X-Fixture': { name: false, pattern: 'synthetic' } }],
    ['unknown field', { 'X-Fixture': { pattern: 'synthetic', other: true } }],
  ] satisfies [string, JsonValue][])('reject invalid top header_regexp: %s', (_name, regexp) => {
    const target = route(AUTH, true);
    record(list(target['match'])[1])['header_regexp'] = regexp;
    rejected(target);
  });

  test('valid top header_regexp cannot excuse mixed hosts or broadened path in any matcher', () => {
    for (const widened of [
      { host: [HOST, 'other.example'], path: [AUTH] },
      { host: [HOST], path: [AUTH, '/custom-ui*'] },
      { host: ['other.example'], path: [AUTH] },
    ]) {
      const target = route(AUTH, true);
      list(target['match'])[1] = {
        ...widened, header_regexp: { 'X-Fixture': { pattern: '^synthetic$' } },
      };
      rejected(target);
    }
  });

  test('partial apply and reverse ordered undo are guarded and do not mutate the caller', () => {
    const input = fixture();
    const plan = planRealContractCors(input);
    const applied = plan.patches.slice(0, 3);
    const current = apply(input, applied);
    const before = structuredClone(current);
    expect(inspectRealContractCorsReadback(plan, current).appliedPaths).toHaveLength(3);
    const undo = planRealContractCorsUndo(plan, current);
    expect(undo.map((patch) => patch.path)).toEqual(applied.map((patch) => patch.path).reverse());
    expect(apply(current, undo)).toEqual(input);
    expect(current).toEqual(before);
  });

  test('baseline and returned arrays do not alias the input', () => {
    const input = fixture();
    const before = structuredClone(input);
    const plan = planRealContractCors(input);
    routes(plan.baseline).pop();
    plan.patches[0]?.next.push('https://unapproved.example');
    expect(input).toEqual(before);
    expect(() => inspectRealContractCorsReadback(plan, input)).toThrow('CORS_PLAN_REJECTED');
  });

  test.each([
    ['mixed hosts', [{ host: [HOST, 'other.example'], path: [AUTH] }]],
    ['foreign OR branch', [{ host: [HOST], path: [AUTH] }, { host: ['other.example'], path: [AUTH] }]],
    ['unbounded OR branch', [{ host: [HOST], path: [AUTH] }, {}]],
    ['mixed paths', [{ host: [HOST], path: [AUTH, '/custom-ui*'] }]],
    ['different allowed path in OR', [{ host: [HOST], path: [AUTH] }, { host: [HOST], path: [DISCOVERY] }]],
    ['additional method', [{ host: [HOST], path: [AUTH], method: ['POST'] }]],
    ['additional header', [{ host: [HOST], path: [AUTH], header: { Origin: ORIGINS } }]],
    ['missing path', [{ host: [HOST] }]],
    ['broad auth path', [{ host: [HOST], path: ['/auth/*'] }]],
    ['broad discovery path', [{ host: [HOST], path: ['/.well-known/**'] }]],
  ] satisfies [string, JsonValue[]][])('reject scope: %s', (_name, match) => {
    const target = route();
    target['match'] = match;
    rejected(target);
  });

  test('reject missing auth/discovery groups, foreign-only input and unscoped routes array', () => {
    expect(() => planRealContractCors(fixture([route()]))).toThrow('CORS_TARGETS_MISSING');
    expect(() => planRealContractCors(fixture([route(DISCOVERY)]))).toThrow('CORS_TARGETS_MISSING');
    const foreign = route();
    foreign['match'] = [{ host: ['other.example'], path: [AUTH] }];
    expect(() => planRealContractCors(fixture([foreign]))).toThrow('CORS_TARGETS_MISSING');
    expect(() => planRealContractCors(routes(fixture()))).toThrow('CORS_INVALID_JSON');
  });

  test.each([
    ['missing exact array', (target: JsonObject) => { delete matcher(target)['header']; }],
    ['non-array Origin', (target: JsonObject) => { matcher(target)['header'] = { Origin: ORIGIN }; }],
    ['empty Origin', (target: JsonObject) => { matcher(target)['header'] = { Origin: [] }; }],
    ['non-string Origin', (target: JsonObject) => { matcher(target)['header'] = { Origin: [42] }; }],
    ['different preflight and actual', (target: JsonObject) => { matcher(target)['header'] = { Origin: ['https://different.example'] }; }],
    ['ambiguous exact matcher', (target: JsonObject) => { list(record(branches(target)[0])['match']).push(structuredClone(matcher(target))); }],
    ['wrong preflight method', (target: JsonObject) => { matcher(target)['method'] = ['POST']; }],
    ['write handler', (target: JsonObject) => { list(record(branches(target)[1])['handle']).push({ handler: 'reverse_proxy' }); }],
    ['wrong static status', (target: JsonObject) => { record(list(record(branches(target)[0])['handle'])[1])['status_code'] = 200; }],
    ['extra child path', (target: JsonObject) => { matcher(target)['path'] = ['/custom-ui*']; }],
    ['extra child header', (target: JsonObject) => { record(matcher(target)['header'])['Authorization'] = ['*']; }],
    ['nonreflective ACAO', (target: JsonObject) => {
      record(record(record(list(record(branches(target)[0])['handle'])[0])['response'])['set'])['Access-Control-Allow-Origin'] = ['*'];
    }],
    ['third branch', (target: JsonObject) => { branches(target).push({ match: [{}], handle: [header()] }); }],
    ['second CORS subroute', (target: JsonObject) => { list(target['handle']).push(structuredClone(record(list(target['handle'])[0]))); }],
    ['nested CORS not direct', (target: JsonObject) => {
      const previous = list(target['handle'])[0];
      if (previous === undefined) throw new Error('fixture');
      target['handle'] = [{ handler: 'subroute', routes: [{ handle: [previous] }] }];
    }],
  ] satisfies [string, (target: JsonObject) => void][])('reject structure: %s', (_name, change) => {
    const target = route();
    change(target);
    rejected(target);
  });

  test('regex-only CORS is not converted into new exact matchers', () => {
    const target = route();
    for (let index = 0; index < 2; index += 1) {
      const match = matcher(target, index);
      delete match['header'];
      match['header_regexp'] = { Origin: { pattern: '^https://existing\\.example$' } };
    }
    rejected(target);
  });

  test('invalid JSON, accessors, prototype instances, hidden fields and cycles fail closed', () => {
    let invoked = false;
    const getter = Object.defineProperty({}, 'apps', {
      enumerable: true, get() { invoked = true; return {}; },
    });
    const cyclic: { self?: unknown } = {};
    cyclic.self = cyclic;
    for (const value of [undefined, null, [], new Date(), { field: undefined }, { field: NaN },
      getter, cyclic, Object.defineProperty(fixture(), 'hidden', { value: true })]) {
      expect(() => planRealContractCors(value)).toThrow('CORS_INVALID_JSON');
    }
    expect(invoked).toBe(false);
  });

  test.each([
    ['route reorder', (root: JsonObject) => { routes(root).reverse(); }],
    ['host change', (root: JsonObject) => { record(routes(root)[0])['match'] = [{ host: ['other.example'], path: [AUTH] }]; }],
    ['path change', (root: JsonObject) => { record(routes(root)[0])['match'] = [{ host: [HOST], path: ['/custom-ui*'] }]; }],
    ['fallback change', (root: JsonObject) => { matcher(record(routes(root)[0]), 1, 1)['method'] = ['POST']; }],
    ['unrelated config drift', (root: JsonObject) => { root['logging'] = {}; }],
    ['new unrelated origin', (root: JsonObject) => { list(record(matcher(record(routes(root)[0]))['header'])['Origin']).push('https://third.example'); }],
    ['route deleted', (root: JsonObject) => { routes(root).shift(); }],
  ] satisfies [string, (root: JsonObject) => void][])('reject readback and undo: %s', (_name, change) => {
    const input = fixture();
    const plan = planRealContractCors(input);
    const current = apply(input, plan.patches);
    change(current);
    expect(() => inspectRealContractCorsReadback(plan, current)).toThrow('CORS_READBACK_CONFLICT');
    expect(() => planRealContractCorsUndo(plan, current)).toThrow('CORS_READBACK_CONFLICT');
  });

  test('reject forged patch path, body, run binding, omitted patch and accessor in persisted plan', () => {
    const input = fixture();
    const plan = planRealContractCors(input);
    const first = plan.patches[0];
    if (first === undefined) throw new Error('fixture');
    for (const changed of [
      { ...plan, patches: [{ ...first, path: '/config/apps/http/servers/other/routes/0/match/0/host' }] },
      { ...plan, patches: [{ ...first, next: ['https://unapproved.example'] }] },
      { ...plan, patches: [{ ...first, original: ['https://unapproved.example'] }] },
      { ...plan, runId: 'another-run' },
      { ...plan, patches: plan.patches.slice(1) },
      Object.defineProperty({ ...plan }, 'baseline', { enumerable: true, get() { throw new Error('never'); } }),
    ]) {
      expect(() => inspectRealContractCorsReadback(changed, input)).toThrow('CORS_PLAN_REJECTED');
      expect(() => planRealContractCorsUndo(changed, input)).toThrow('CORS_PLAN_REJECTED');
    }
  });

  test('JSON object key order may change on GET without concealing array order drift', () => {
    const input = fixture();
    const plan = planRealContractCors(input);
    const current = apply(input, plan.patches);
    const reordered = Object.fromEntries(Object.entries(current).reverse());
    expect(inspectRealContractCorsReadback(plan, reordered).complete).toBe(true);
    list(record(matcher(record(routes(current)[0]))['header'])['Origin']).reverse();
    expect(() => planRealContractCorsUndo(plan, current)).toThrow('CORS_READBACK_CONFLICT');
  });
});
