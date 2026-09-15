import { requireRecord } from "./tooling-values.js";
import { isUnknownArray, requireDefined } from "./tooling-values.js";
export interface RouteContractInventory {
  method: string;
  path: string;
  hidden: boolean;
  contract?: unknown;
  /** 真实 route detail；x-supauth-bindings 保留原始运行时绑定，导出层负责规整引用。 */
  operation?: unknown;
}

export function decodeRouteContractInventory(value: unknown): RouteContractInventory[] {
  if (!isUnknownArray(value)) throw new Error('Route inventory is not an array');
  return value.map(candidate => {
    const route = requireRecord(candidate, 'Route inventory entry');
    const method = route['method'];
    const path = route['path'];
    const hidden = route['hidden'];
    if (typeof method !== 'string' || typeof path !== 'string' || typeof hidden !== 'boolean') {
      throw new Error('Invalid route inventory entry');
    }
    return {
      method, path, hidden,
      ...(route['contract'] === undefined ? {} : { contract: route['contract'] }),
      ...(route['operation'] === undefined ? {} : { operation: route['operation'] }),
    };
  });
}

export interface ContractCoverageIssue {
  operation: string;
  code: 'missing_contract' | 'invalid_contract' | 'missing_response_schema' | 'missing_request_schema' | 'missing_operation' | 'unsupported_method';
}

export interface ContractCoverage {
  total: number;
  covered: number;
  hidden: number;
  issues: ContractCoverageIssue[];
}

const HTTP_METHODS = new Set(['get', 'post', 'put', 'patch', 'delete', 'head', 'options', 'trace']);
const INPUT_BINDINGS = ['body', 'params', 'query', 'headers', 'cookie'] as const;
const REQUEST_KINDS = new Set(['validated', 'none', 'raw-signed', 'protocol']);
const RESPONSE_KINDS = new Set(['validated', 'empty', 'binary', 'html', 'redirect', 'protocol']);

function record(value: unknown): Record<string, unknown> | undefined {
  return value !== null && typeof value === 'object' && !isUnknownArray(value)
    ? requireRecord(value)
    : undefined;
}

export function normalizeContractPath(path: string): string {
  return path.replace(/:([^/]+)/g, '{$1}').replace(/\/+$/, '') || '/';
}

function operationKey(method: string, path: string): string {
  return `${method.toUpperCase()} ${normalizeContractPath(path)}`;
}

function referenceSchema(reference: string, document: Record<string, unknown>): unknown {
  if (!reference.startsWith('#/')) return undefined;
  let current: unknown = document;
  for (const part of reference.slice(2).split('/')) {
    const value = record(current);
    const key = part.replace(/~1/g, '/').replace(/~0/g, '~');
    if (!value || !Object.hasOwn(value, key)) return undefined;
    current = value[key];
  }
  return current;
}

interface SchemaEvidence {
  valid: boolean;
  domain: boolean;
  anchored: boolean;
}

const INVALID_SCHEMA: SchemaEvidence = { valid: false, domain: false, anchored: false };

function inspectSchema(
  value: unknown,
  document: Record<string, unknown>,
  active: Map<object, number>,
  depth: number,
): SchemaEvidence {
  const schema = record(value);
  if (!schema) return INVALID_SCHEMA;
  const ancestorDepth = active.get(schema);
  if (ancestorDepth !== undefined) {
    // 只有穿过对象字段/数组元素的递归才有效；递归边本身不能充当具体叶子。
    return { valid: depth > ancestorDepth, domain: false, anchored: false };
  }
  active.set(schema, depth);
  try {
    const evidence: SchemaEvidence[] = [];
    const visit = (child: unknown, childDepth = depth) => inspectSchema(child, document, active, childDepth);
    if (Object.hasOwn(schema, '$ref')) {
      evidence.push(typeof schema["$ref"] === 'string'
        ? visit(referenceSchema(schema["$ref"], document))
        : INVALID_SCHEMA);
    }
    if (Object.hasOwn(schema, 'const') || (isUnknownArray(schema["enum"]) && schema["enum"].length > 0)) {
      evidence.push({ valid: true, domain: true, anchored: true });
    }
    for (const key of ['anyOf', 'oneOf', 'allOf']) {
      if (!Object.hasOwn(schema, key)) continue;
      const variants = schema[key];
      if (!isUnknownArray(variants) || variants.length === 0) return INVALID_SCHEMA;
      const branches = variants.map(item => visit(item));
      evidence.push({
        valid: branches.every(branch => branch.valid),
        domain: key === 'allOf' ? branches.some(branch => branch.domain) : branches.every(branch => branch.domain),
        anchored: branches.some(branch => branch.anchored),
      });
    }
    // $ref/allOf 也能提供基础类型；所有已声明 Schema 关键字必须独立检查。
    const constraint = (branches: SchemaEvidence[]) => evidence.push({
      valid: branches.every(branch => branch.valid), domain: false, anchored: false,
    });
    const schemaMap = (key: string, childDepth: number): SchemaEvidence[] => {
      if (!Object.hasOwn(schema, key)) return [];
      const children = record(schema[key]);
      if (!children) return [INVALID_SCHEMA];
      return Object.values(children).map(child => visit(child, childDepth));
    };
    const fields = schemaMap('properties', depth + 1);
    const dictionaries = schemaMap('patternProperties', depth + 1);
    if (Object.hasOwn(schema, 'additionalProperties')) {
      if (record(schema["additionalProperties"])) dictionaries.push(visit(schema["additionalProperties"], depth + 1));
      else if (typeof schema["additionalProperties"] !== 'boolean') dictionaries.push(INVALID_SCHEMA);
    }
    const objectBranches = [...fields, ...dictionaries];
    if (['properties', 'patternProperties', 'additionalProperties'].some(key => Object.hasOwn(schema, key))) {
      constraint(objectBranches);
    }

    const arrayBranches: SchemaEvidence[] = [];
    if (Object.hasOwn(schema, 'items') && schema["items"] !== false) {
      const items = isUnknownArray(schema["items"]) ? schema["items"] : [schema["items"]];
      arrayBranches.push(...(items.length ? items.map(item => visit(item, depth + 1)) : [INVALID_SCHEMA]));
    }
    if (Object.hasOwn(schema, 'prefixItems')) {
      arrayBranches.push(...(isUnknownArray(schema["prefixItems"]) && schema["prefixItems"].length
        ? schema["prefixItems"].map(item => visit(item, depth + 1)) : [INVALID_SCHEMA]));
    }
    if (Object.hasOwn(schema, 'additionalItems')) {
      if (record(schema["additionalItems"])) arrayBranches.push(visit(schema["additionalItems"], depth + 1));
      else if (typeof schema["additionalItems"] !== 'boolean') arrayBranches.push(INVALID_SCHEMA);
    }
    if (['items', 'prefixItems', 'additionalItems'].some(key => Object.hasOwn(schema, key))) {
      constraint(arrayBranches);
    }
    for (const key of ['$defs', 'definitions', 'dependentSchemas']) {
      if (Object.hasOwn(schema, key)) constraint(schemaMap(key, depth));
    }
    for (const key of ['contains', 'not', 'if', 'then', 'else', 'propertyNames', 'unevaluatedProperties', 'unevaluatedItems']) {
      if (!Object.hasOwn(schema, key)) continue;
      if (schema[key] === false) continue;
      constraint([visit(schema[key], key === 'contains' || key.startsWith('unevaluated') ? depth + 1 : depth)]);
    }
    if (Object.hasOwn(schema, 'dependencies')) {
      const dependencies = record(schema["dependencies"]);
      constraint(dependencies ? Object.values(dependencies).map(child =>
        isUnknownArray(child) && child.every(key => typeof key === 'string')
          ? { valid: true, domain: false, anchored: false } : visit(child)) : [INVALID_SCHEMA]);
    }

    if (schema["type"] === 'array') {
      evidence.push({
        valid: arrayBranches.length > 0 && arrayBranches.every(branch => branch.valid),
        domain: arrayBranches.length > 0 && arrayBranches.every(branch => branch.domain),
        anchored: arrayBranches.some(branch => branch.anchored),
      });
    } else if (schema["type"] === 'object') {
      const closedEmpty = objectBranches.length === 0 && schema["additionalProperties"] === false
        && (schema["required"] === undefined || (isUnknownArray(schema["required"]) && schema["required"].length === 0));
      evidence.push({
        valid: closedEmpty || (objectBranches.length > 0 && objectBranches.every(branch => branch.valid)),
        // 有类型的 metadata 可嵌套，但根级任意键字典不是领域对象。
        domain: closedEmpty || fields.length > 0,
        anchored: closedEmpty || objectBranches.some(branch => branch.anchored),
      });
    } else if (['string', 'number', 'integer', 'boolean', 'null'].includes(String(schema["type"]))) {
      evidence.push({ valid: true, domain: true, anchored: true });
    } else if (schema["type"] !== undefined) {
      return INVALID_SCHEMA;
    }
    return {
      valid: evidence.length > 0 && evidence.every(item => item.valid),
      domain: evidence.some(item => item.domain),
      anchored: evidence.some(item => item.anchored),
    };
  } finally {
    active.delete(schema);
  }
}

// 声明质量检查，不替代实际 HTTP/领域解码；裸 TypeBox $id/$ref 由导出层规整。
export function isConcreteSchema(value: unknown, document: Record<string, unknown> = {}): boolean {
  const evidence = inspectSchema(value, document, new Map(), 0);
  return evidence.valid && evidence.domain && evidence.anchored;
}

function resolveObject(value: unknown, document: Record<string, unknown>): Record<string, unknown> | undefined {
  const visited = new Set<string>();
  let resolved = record(value);
  while (resolved && Object.hasOwn(resolved, '$ref')) {
    const reference = resolved["$ref"];
    if (typeof reference !== 'string' || visited.has(reference)) return undefined;
    visited.add(reference);
    resolved = record(referenceSchema(reference, document));
  }
  return resolved;
}

function concreteContent(value: unknown, document: Record<string, unknown>): boolean {
  const content = record(resolveObject(value, document)?.["content"]);
  return !!content && Object.keys(content).length > 0
    && Object.values(content).every(media => isConcreteSchema(record(media)?.["schema"], document));
}

/** 保留真实声明和绑定，不凭空构造成功状态、媒体类型或 Schema 引用。 */
export function createRouteContractInventory(route: {
  method: string;
  path: string;
  hooks?: unknown;
}): RouteContractInventory {
  const hooks = record(route.hooks);
  const detail = record(hooks?.["detail"]);
  const bindings = Object.fromEntries([...INPUT_BINDINGS, 'response'].flatMap(key =>
    hooks?.[key] === undefined ? [] : [[key, hooks[key]]]));
  return {
    method: route.method,
    path: route.path,
    hidden: detail?.["hide"] === true,
    ...(detail?.['x-supauth-contract'] === undefined ? {} : { contract: detail['x-supauth-contract'] }),
    operation: {
      ...detail,
      ...(Object.keys(bindings).length ? { 'x-supauth-bindings': bindings } : {}),
    },
  };
}

function mergeParameters(inherited: unknown, own: unknown, document: Record<string, unknown>): unknown {
  if (inherited === undefined) return own;
  if (own === undefined) return inherited;
  if (!isUnknownArray(inherited) || !isUnknownArray(own)) return null;
  const keys = new Set(own.map(value => {
    const parameter = resolveObject(value, document);
    return parameter ? `${parameter["in"]}:${parameter["name"]}` : undefined;
  }));
  return [...inherited.filter(value => {
    const parameter = resolveObject(value, document);
    return !parameter || !keys.has(`${parameter["in"]}:${parameter["name"]}`);
  }), ...own];
}

function hasValidRequest(
  operations: Record<string, unknown>[],
  path: string,
  document: Record<string, unknown>,
): boolean {
  let declarations = 0;
  let valid = true;
  const pathParameters = new Set<string>();
  for (const operation of operations) {
    if (Object.hasOwn(operation, 'requestBody')) {
      declarations++;
      valid = concreteContent(operation["requestBody"], document) && valid;
    }
    if (Object.hasOwn(operation, 'parameters')) {
      const parameters = operation["parameters"];
      if (!isUnknownArray(parameters)) valid = false;
      else for (const value of parameters) {
        declarations++;
        const parameter = resolveObject(value, document);
        valid = !!parameter && typeof parameter["name"] === 'string'
          && ['path', 'query', 'header', 'cookie'].includes(String(parameter["in"]))
          && (Object.hasOwn(parameter, 'schema')
            ? isConcreteSchema(parameter["schema"], document)
            : concreteContent(parameter, document)) && valid;
        if (parameter?.["in"] === 'path' && typeof parameter["name"] === 'string') pathParameters.add(parameter["name"]);
      }
    }
    const bindings = record(operation['x-supauth-bindings']);
    for (const key of INPUT_BINDINGS) {
      if (!bindings || !Object.hasOwn(bindings, key)) continue;
      declarations++;
      valid = isConcreteSchema(bindings[key], document) && valid;
      if (key === 'params') {
        const properties = record(resolveObject(bindings[key], document)?.["properties"]);
        for (const name of Object.keys(properties ?? {})) pathParameters.add(name);
      }
    }
  }
  const requiredPaths = [...normalizeContractPath(path).matchAll(/\{([^}]+)\}/g)].map(match => requireDefined(match[1]));
  return declarations > 0 && valid && requiredPaths.every(name => pathParameters.has(name));
}

function hasValidResponse(operations: Record<string, unknown>[], document: Record<string, unknown>): boolean {
  let declarations = 0;
  let valid = true;
  for (const operation of operations) {
    if (Object.hasOwn(operation, 'responses')) {
      declarations++;
      const successes = Object.entries(record(operation["responses"]) ?? {}).filter(([status]) => /^[23](?:\d\d|XX)$/i.test(status));
      valid = successes.length > 0 && successes.every(([status, response]) => {
        // 无体状态按 HTTP 协议核算；不能借此放过 200 空声明或虚构的 204 body。
        if (['204', '205', '304'].includes(status)) {
          const resolved = resolveObject(response, document);
          const content = record(resolved?.["content"]);
          return !!resolved && (resolved["content"] === undefined
            || (!!content && Object.keys(content).length === 0));
        }
        return concreteContent(response, document);
      }) && valid;
    }
    const bindings = record(operation['x-supauth-bindings']);
    if (bindings && Object.hasOwn(bindings, 'response')) {
      declarations++;
      const response = record(bindings["response"]);
      const statuses = response && Object.keys(response).every(status => /^\d{3}$/.test(status));
      const successes = Object.entries(response ?? {}).filter(([status]) => /^[23]\d\d$/.test(status));
      valid = (statuses
        ? successes.length > 0 && successes.every(([, schema]) => isConcreteSchema(schema, document))
        : isConcreteSchema(bindings["response"], document)) && valid;
    }
  }
  return declarations > 0 && valid;
}

export function inspectContractCoverage(
  specification: unknown,
  inventory?: readonly RouteContractInventory[],
): ContractCoverage {
  const document = record(specification);
  const paths = record(document?.["paths"]);
  if (!document || !paths || Object.keys(paths).length === 0) {
    throw new Error('OpenAPI document has no operations');
  }
  const operations = new Map<string, Record<string, unknown>>();
  for (const [path, item] of Object.entries(paths)) {
    const pathItem = resolveObject(item, document);
    for (const [method, operation] of Object.entries(pathItem ?? {})) {
      if (!HTTP_METHODS.has(method)) continue;
      const value = record(operation);
      if (value) {
        const parameters = mergeParameters(pathItem?.["parameters"], value["parameters"], document);
        operations.set(operationKey(method, path), {
          ...value,
          ...(parameters === undefined ? {} : { parameters }),
        });
      }
    }
  }
  if (operations.size === 0) throw new Error('OpenAPI document has no operations');
  const routes = new Map<string, RouteContractInventory>();
  // ALL 先展开，再由具体方法覆盖；未知方法留在分母并报错，不静默丢弃。
  for (const route of inventory ?? []) {
    if (route.method.toLowerCase() !== 'all') continue;
    for (const method of HTTP_METHODS) routes.set(operationKey(method, route.path), { ...route, method });
  }
  for (const route of inventory ?? []) {
    if (route.method.toLowerCase() === 'all') continue;
    routes.set(operationKey(route.method, route.path), route);
  }
  for (const key of operations.keys()) {
    if (!routes.has(key)) {
      const separator = key.indexOf(' ');
      routes.set(key, { method: key.slice(0, separator), path: key.slice(separator + 1), hidden: false });
    }
  }
  const issues: ContractCoverageIssue[] = [];
  let covered = 0;
  let hidden = 0;
  for (const [key, route] of routes) {
    if (route.hidden) hidden++;
    const operation = operations.get(key);
    const runtimeOperation = record(route.operation);
    const evidence = [operation, runtimeOperation].filter((value): value is Record<string, unknown> => value !== undefined);
    const marker = record(route.contract ?? runtimeOperation?.['x-supauth-contract'] ?? operation?.['x-supauth-contract']);
    const start = issues.length;
    if (!HTTP_METHODS.has(route.method.toLowerCase())) issues.push({ operation: key, code: 'unsupported_method' });
    if (!marker) {
      issues.push({ operation: key, code: 'missing_contract' });
    } else if (
      !REQUEST_KINDS.has(String(marker["request"])) ||
      !RESPONSE_KINDS.has(String(marker["response"])) ||
      typeof marker["source"] !== 'string' || !marker["source"].trim()
    ) {
      issues.push({ operation: key, code: 'invalid_contract' });
    } else {
      if (!operation && !route.hidden) issues.push({ operation: key, code: 'missing_operation' });
      if (!operation && !runtimeOperation && route.hidden && (marker["request"] === 'validated' || marker["response"] === 'validated')) {
        issues.push({ operation: key, code: 'missing_operation' });
      }
      if (marker["response"] === 'validated' && !hasValidResponse(evidence, document)) {
        issues.push({ operation: key, code: 'missing_response_schema' });
      }
      if (marker["request"] === 'validated' && !hasValidRequest(evidence, route.path, document)) {
        issues.push({ operation: key, code: 'missing_request_schema' });
      }
    }
    if (issues.length === start) covered++;
  }
  return { total: routes.size, covered, hidden, issues };
}
