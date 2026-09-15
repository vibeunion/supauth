import {
  Type, decodeSchema, JsonObjectSchema, type JsonObject, type JsonValue, type Static,
} from '../packages/shared/src/schema.js';

export const REAL_CONTRACT_CORS_SCOPE = {
  runId: '7a91e5ac-961d-4537-9f79-901c50f214db',
  ownerRef: 'lhevaxecbonjjdbardgi',
  host: 'auth.xai.xigu.team',
  origin: 'https://contract-7a91e5ac-961d-4537-9f79-901c50f214db.xai.xigu.team',
  routesPath: '/config/apps/http/servers/supacloud/routes',
} as const;

const AUTH_PATH = '/auth/v1*';
const DISCOVERY_PATH = '/.well-known/oauth-authorization-server/auth/v1*';
const OriginArraySchema = Type.Array(Type.String({ minLength: 1 }), { minItems: 1 });
const PatchSchema = Type.Object({
  path: Type.String(),
  original: OriginArraySchema,
  next: OriginArraySchema,
}, { additionalProperties: false });
const PlanSchema = Type.Object({
  version: Type.Literal(1),
  runId: Type.Literal(REAL_CONTRACT_CORS_SCOPE.runId),
  ownerRef: Type.Literal(REAL_CONTRACT_CORS_SCOPE.ownerRef),
  origin: Type.Literal(REAL_CONTRACT_CORS_SCOPE.origin),
  scopePath: Type.Literal('/config/'),
  baseline: JsonObjectSchema,
  patches: Type.Array(PatchSchema),
}, { additionalProperties: false });

export type RealContractCorsPatch = Static<typeof PatchSchema>;
export type RealContractCorsPlan = Static<typeof PlanSchema>;
export interface RealContractCorsReadback {
  appliedPaths: string[];
  pendingPaths: string[];
  complete: boolean;
  restored: boolean;
}
type CorsErrorCode = 'CORS_INVALID_JSON' | 'CORS_SCOPE_REJECTED'
  | 'CORS_STRUCTURE_REJECTED' | 'CORS_TARGETS_MISSING'
  | 'CORS_PLAN_REJECTED' | 'CORS_READBACK_CONFLICT';
export class RealContractCorsError extends Error {
  constructor(readonly code: CorsErrorCode) {
    super(code);
    this.name = 'RealContractCorsError';
  }
}
function fail(code: CorsErrorCode): never { throw new RealContractCorsError(code); }
function object(value: JsonValue | undefined): JsonObject {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) {
    return fail('CORS_STRUCTURE_REJECTED');
  }
  return value;
}
function array(value: JsonValue | undefined): JsonValue[] {
  if (!Array.isArray(value)) return fail('CORS_STRUCTURE_REJECTED');
  return value;
}
function keysAre(value: JsonObject, allowed: readonly string[]): boolean {
  return Object.keys(value).every((key) => allowed.includes(key));
}
function same(left: JsonValue | undefined, right: JsonValue | undefined): boolean {
  if (left === right) return true;
  if (Array.isArray(left) && Array.isArray(right)) {
    return left.length === right.length && left.every((entry, i) => same(entry, right[i]));
  }
  if (left === null || right === null || typeof left !== 'object' || typeof right !== 'object'
    || Array.isArray(left) || Array.isArray(right)) return false;
  const keys = Object.keys(left);
  return keys.length === Object.keys(right).length
    && keys.every((key) => Object.hasOwn(right, key) && same(left[key], right[key]));
}
function config(value: unknown): JsonObject {
  try { return structuredClone(decodeSchema(JsonObjectSchema, value)); }
  catch { return fail('CORS_INVALID_JSON'); }
}
function routesFrom(root: JsonObject): JsonValue[] {
  const servers = object(object(object(root['apps'])['http'])['servers']);
  return array(object(servers['supacloud'])['routes']);
}
function isAllowedPath(value: JsonValue | undefined): value is string {
  return value === AUTH_PATH || value === DISCOVERY_PATH;
}
function validateHeaderRegexp(value: JsonValue): void {
  const headers = object(value);
  if (Object.keys(headers).length === 0) fail('CORS_STRUCTURE_REJECTED');
  for (const [name, raw] of Object.entries(headers)) {
    if (!/^[!#$%&'*+.^_`|~0-9A-Za-z-]+$/.test(name)) fail('CORS_STRUCTURE_REJECTED');
    const regexp = object(raw);
    if (!keysAre(regexp, ['name', 'pattern']) || typeof regexp['pattern'] !== 'string'
      || (regexp['name'] !== undefined && typeof regexp['name'] !== 'string')) {
      fail('CORS_STRUCTURE_REJECTED');
    }
  }
}
function isCorsHeader(value: JsonValue | undefined): boolean {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) return false;
  if (value['handler'] !== 'headers') return false;
  const response = value['response'];
  if (response === null || typeof response !== 'object' || Array.isArray(response)) return false;
  const set = response['set'];
  return set !== null && typeof set === 'object' && !Array.isArray(set)
    && Object.keys(set).some((key) => key.toLowerCase() === 'access-control-allow-origin');
}
// 只检查顶层 handle 的直接 subroute，不递归搜索任意 Origin 或 custom-ui 子树。
function corsHandles(route: JsonObject): number[] {
  return array(route['handle']).flatMap((value, index) => {
    const handler = object(value);
    if (handler['handler'] !== 'subroute') return [];
    const branches = array(handler['routes']);
    return branches.some((branch) => array(object(branch)['handle']).some(isCorsHeader))
      ? [index] : [];
  });
}
function selectedPath(route: JsonObject): string | undefined {
  const matchers = array(route['match']).map(object);
  const mentionsHost = matchers.some((match) =>
    Array.isArray(match['host']) && match['host'].includes(REAL_CONTRACT_CORS_SCOPE.host));
  if (!mentionsHost) return undefined;
  const mentionsPath = matchers.some((match) =>
    Array.isArray(match['path']) && match['path'].some(isAllowedPath));
  // 明确不在本轮范围的 frontend、admin DELETE、ACME 等不参与规划。
  if (!mentionsPath) {
    const ambiguous = matchers.some((match) => !Array.isArray(match['path'])
      || match['path'].some((path) => path === '*' || path === '/*' || path === '/auth/*'
        || path === '/auth*' || path === '/.well-known/*' || path === '/.well-known/**'));
    if (ambiguous && corsHandles(route).length > 0) fail('CORS_SCOPE_REJECTED');
    return undefined;
  }
  // 无 CORS 的限流/安全路由只读；其 mixed-host matcher 不能变成修改入口。
  if (corsHandles(route).length === 0) return undefined;
  const firstPath = array(matchers[0]?.['path'])[0];
  if (!isAllowedPath(firstPath)) return fail('CORS_SCOPE_REJECTED');
  for (const match of matchers) {
    if (!keysAre(match, ['host', 'path', 'header_regexp'])
      || !same(match['host'], [REAL_CONTRACT_CORS_SCOPE.host])
      || !same(match['path'], [firstPath])) fail('CORS_SCOPE_REJECTED');
    // 附加 header_regexp 只能收窄此 matcher；不读取其语义或输出可能敏感的 pattern。
    if (match['header_regexp'] !== undefined) validateHeaderRegexp(match['header_regexp']);
  }
  return firstPath;
}
function originPatch(branch: JsonObject, path: string, preflight: boolean): RealContractCorsPatch {
  const handles = array(branch['handle']);
  const header = object(handles[0]);
  if (!isCorsHeader(header)
    || !same(object(object(header['response'])['set'])['Access-Control-Allow-Origin'],
      ['{http.request.header.Origin}'])) fail('CORS_STRUCTURE_REJECTED');
  if (preflight) {
    const response = object(handles[1]);
    if (handles.length !== 2 || response['handler'] !== 'static_response'
      || response['status_code'] !== 204 || branch['terminal'] !== true) {
      fail('CORS_STRUCTURE_REJECTED');
    }
  } else if (handles.length !== 1 || (branch['terminal'] !== undefined && branch['terminal'] !== false)) {
    fail('CORS_STRUCTURE_REJECTED');
  }
  const exact: RealContractCorsPatch[] = [];
  for (const [index, raw] of array(branch['match']).entries()) {
    const match = object(raw);
    if (!keysAre(match, ['method', 'header', 'header_regexp'])
      || (preflight ? !same(match['method'], ['OPTIONS']) : match['method'] !== undefined)) {
      fail('CORS_STRUCTURE_REJECTED');
    }
    if (match['header'] !== undefined) {
      const headerMatch = object(match['header']);
      if (!same(Object.keys(headerMatch), ['Origin']) || match['header_regexp'] !== undefined) {
        fail('CORS_STRUCTURE_REJECTED');
      }
      let original: string[];
      try { original = decodeSchema(OriginArraySchema, headerMatch['Origin']); }
      catch { return fail('CORS_STRUCTURE_REJECTED'); }
      const next = original.includes(REAL_CONTRACT_CORS_SCOPE.origin)
        ? [...original] : [...original, REAL_CONTRACT_CORS_SCOPE.origin];
      exact.push({ path: `${path}/match/${index}/header/Origin`, original: [...original], next });
    } else if (match['header_regexp'] !== undefined) {
      const regex = object(match['header_regexp']);
      if (!same(Object.keys(regex), ['Origin'])) fail('CORS_STRUCTURE_REJECTED');
      validateHeaderRegexp(regex);
    }
    // 既有空 matcher / OPTIONS fallback 原样保留，不创建、更不视为新增授权证据。
  }
  const patch = exact[0];
  if (exact.length !== 1 || patch === undefined) return fail('CORS_STRUCTURE_REJECTED');
  return patch;
}

/** 纯规划器；输入必须是 main 读取的完整 /config JSON，不执行任何 I/O。 */
export function planRealContractCors(input: unknown): RealContractCorsPlan {
  const baseline = config(input);
  const patches: RealContractCorsPatch[] = [];
  const paths = new Set<string>();
  for (const [index, raw] of routesFrom(baseline).entries()) {
    const route = object(raw);
    if (route['match'] === undefined) continue;
    const path = selectedPath(route);
    if (path === undefined) continue;
    const indices = corsHandles(route);
    if (!same(indices, [0])) fail('CORS_STRUCTURE_REJECTED');
    const branches = array(object(array(route['handle'])[0])['routes']);
    if (branches.length !== 2) fail('CORS_STRUCTURE_REJECTED');
    const base = `${REAL_CONTRACT_CORS_SCOPE.routesPath}/${index}/handle/0/routes`;
    const preflight = originPatch(object(branches[0]), `${base}/0`, true);
    const actual = originPatch(object(branches[1]), `${base}/1`, false);
    if (!same(preflight.original, actual.original)) fail('CORS_STRUCTURE_REJECTED');
    paths.add(path);
    for (const patch of [preflight, actual]) {
      if (!same(patch.original, patch.next)) patches.push(patch);
    }
  }
  if (!paths.has(AUTH_PATH) || !paths.has(DISCOVERY_PATH)) fail('CORS_TARGETS_MISSING');
  return {
    version: 1,
    runId: REAL_CONTRACT_CORS_SCOPE.runId,
    ownerRef: REAL_CONTRACT_CORS_SCOPE.ownerRef,
    origin: REAL_CONTRACT_CORS_SCOPE.origin,
    scopePath: '/config/',
    baseline,
    patches,
  };
}
function trustedPlan(input: unknown): RealContractCorsPlan {
  try {
    const decoded = decodeSchema(PlanSchema, input);
    const regenerated = planRealContractCors(decoded.baseline);
    if (!same(decoded, regenerated)) return fail('CORS_PLAN_REJECTED');
    return regenerated;
  } catch { return fail('CORS_PLAN_REJECTED'); }
}
function location(root: JsonObject, path: string): { parent: JsonObject; key: string } {
  if (!path.startsWith(`${REAL_CONTRACT_CORS_SCOPE.routesPath}/`)) fail('CORS_PLAN_REJECTED');
  const parts = path.slice('/config/'.length).split('/');
  const key = parts.pop();
  if (key !== 'Origin') return fail('CORS_PLAN_REJECTED');
  let node: JsonValue = root;
  for (const part of parts) {
    const child: JsonValue | undefined = Array.isArray(node) ? node[Number(part)] : object(node)[part];
    if (child === undefined) return fail('CORS_READBACK_CONFLICT');
    node = child;
  }
  return { parent: object(node), key };
}
function inspect(plan: RealContractCorsPlan, input: unknown): RealContractCorsReadback {
  const current = config(input);
  const appliedPaths: string[] = [];
  const pendingPaths: string[] = [];
  try {
    for (const patch of plan.patches) {
      const { parent, key } = location(current, patch.path);
      if (same(parent[key], patch.next)) appliedPaths.push(patch.path);
      else if (same(parent[key], patch.original)) pendingPaths.push(patch.path);
      else return fail('CORS_READBACK_CONFLICT');
      parent[key] = [...patch.original];
    }
    if (!same(current, plan.baseline)) return fail('CORS_READBACK_CONFLICT');
  } catch { return fail('CORS_READBACK_CONFLICT'); }
  return {
    appliedPaths, pendingPaths,
    complete: pendingPaths.length === 0,
    restored: appliedPaths.length === 0,
  };
}

/** 只接受原快照或本轮精确增量的任意已应用子集；其它漂移一律停止。 */
export function inspectRealContractCorsReadback(
  planInput: unknown, current: unknown,
): RealContractCorsReadback {
  return inspect(trustedPlan(planInput), current);
}

/** 撤销仅返回已确认应用的数组，逆序 PATCH；调用者仍须新 GET ETag + If-Match。 */
export function planRealContractCorsUndo(
  planInput: unknown, current: unknown,
): RealContractCorsPatch[] {
  const plan = trustedPlan(planInput);
  const applied = new Set(inspect(plan, current).appliedPaths);
  return plan.patches.filter((patch) => applied.has(patch.path)).reverse().map((patch) => ({
    path: patch.path, original: [...patch.next], next: [...patch.original],
  }));
}
