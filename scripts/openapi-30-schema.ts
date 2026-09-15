import { isUnknownArray } from "./tooling-values.js";
type JsonValue = null | boolean | number | string | JsonValue[] | JsonRecord;
type JsonRecord = { [key: string]: JsonValue };

export class OpenApi30ConversionError extends Error {
  readonly code = 'OPENAPI_30_SCHEMA_UNSUPPORTED';

  constructor(readonly pointer: string, reason: string) {
    super(`Unsupported OpenAPI 3.0 schema at ${pointer || '/'}: ${reason}`);
    this.name = 'OpenApi30ConversionError';
  }
}

const ALL_STRING_KEYS = '^[\\s\\S]*$';
const TYPES = new Set(['array', 'boolean', 'integer', 'number', 'object', 'string']);
const ANNOTATIONS = new Set([
  'title', 'description', 'default', 'example', 'deprecated', 'readOnly', 'writeOnly',
  'externalDocs', 'xml', 'discriminator',
]);
const BOOLEAN_KEYS = new Set(['nullable', 'deprecated', 'readOnly', 'writeOnly', 'uniqueItems', 'exclusiveMinimum', 'exclusiveMaximum']);
const STRING_KEYS = new Set(['title', 'description', 'format', 'pattern']);
const COUNT_KEYS = new Set(['minLength', 'maxLength', 'minItems', 'maxItems', 'minProperties', 'maxProperties']);
const NUMBER_KEYS = new Set(['minimum', 'maximum', 'multipleOf']);
const COMPOSITIONS = ['allOf', 'anyOf', 'oneOf'] as const;
const ALLOWED_KEYS = new Set([
  ...ANNOTATIONS, ...BOOLEAN_KEYS, ...STRING_KEYS, ...COUNT_KEYS, ...NUMBER_KEYS,
  ...COMPOSITIONS, 'type', 'enum', 'required', 'not', 'properties', 'items',
  'additionalProperties', 'const', 'patternProperties',
]);
const INPUT_BINDINGS = new Set(['body', 'params', 'query', 'headers', 'cookie']);

function record(value: unknown): value is JsonRecord {
  return value !== null && typeof value === 'object' && !isUnknownArray(value);
}

function location(parent: string, key: string | number): string {
  return `${parent}/${String(key).replace(/~/g, '~0').replace(/\//g, '~1')}`;
}

function unsupported(pointer: string, reason: string): never {
  throw new OpenApi30ConversionError(pointer, reason);
}

// 只接收导出的 JSON 快照；不通过 JSON.stringify 静默丢弃非法 Schema 字段。
function cloneJson(value: unknown, pointer: string, ancestors = new Set<object>()): JsonValue {
  if (value === null || typeof value === 'string' || typeof value === 'boolean') return value;
  if (typeof value === 'number' && Number.isFinite(value)) return value;
  if (!value || typeof value !== 'object') unsupported(pointer, 'expected a JSON value');
  if (ancestors.has(value)) unsupported(pointer, 'cyclic value');
  const array = isUnknownArray(value);
  const prototype: unknown = Object.getPrototypeOf(value);
  if (prototype !== (array ? Array.prototype : Object.prototype) && !(prototype === null && !array)) {
    unsupported(pointer, 'expected a plain JSON container');
  }
  ancestors.add(value);
  try {
    const entries: [string, JsonValue][] = [];
    for (const key of Reflect.ownKeys(value)) {
      if (array && key === 'length') continue;
      if (typeof key !== 'string') unsupported(pointer, 'symbol key');
      const descriptor = Object.getOwnPropertyDescriptor(value, key);
      if (!descriptor?.enumerable || !Object.hasOwn(descriptor, 'value')) unsupported(pointer, 'expected an enumerable data property');
      const child: unknown = descriptor.value;
      entries.push([key, cloneJson(child, location(pointer, key), ancestors)]);
    }
    if (!array) return Object.fromEntries(entries);
    if (entries.length !== value.length || entries.some(([key], index) => key !== String(index))) {
      unsupported(pointer, 'expected a dense undecorated array');
    }
    return entries.map(([, entry]) => entry);
  } finally {
    ancestors.delete(value);
  }
}

function equivalent(left: JsonValue, right: JsonValue): boolean {
  if (left === right) return true;
  if (isUnknownArray(left) && isUnknownArray(right)) {
    return left.length === right.length && left.every((entry, index) => {
      const candidate = right[index];
      return candidate !== undefined && equivalent(entry, candidate);
    });
  }
  if (!record(left) || !record(right)) return false;
  const keys = Object.keys(left);
  return keys.length === Object.keys(right).length && keys.every(key => {
    const source = left[key];
    const target = right[key];
    return Object.hasOwn(right, key) && source !== undefined && target !== undefined && equivalent(source, target);
  });
}

function referenceTarget(document: JsonRecord, reference: JsonValue, pointer: string): void {
  if (typeof reference !== 'string' || !reference.startsWith('#/')) unsupported(pointer, 'expected a canonical local reference');
  let target: JsonValue = document;
  for (const segment of reference.slice(2).split('/')) {
    if (/~(?![01])/u.test(segment)) unsupported(pointer, 'invalid reference escape');
    const key = segment.replace(/~1/g, '/').replace(/~0/g, '~');
    if ((!record(target) && !isUnknownArray(target)) || !Object.hasOwn(target, key)) unsupported(pointer, 'unresolved reference');
    if (isUnknownArray(target) && !/^(?:0|[1-9]\d*)$/.test(key)) unsupported(pointer, 'invalid reference array index');
    const child: JsonValue | undefined = isUnknownArray(target) ? target[Number(key)] : target[key];
    if (child === undefined) unsupported(pointer, 'unresolved reference');
    target = child;
  }
  if (!record(target)) unsupported(pointer, 'reference target is not a schema object');
}

function convertNull(schema: JsonRecord, pointer: string): void {
  for (const key of Object.keys(schema)) {
    if (!ANNOTATIONS.has(key) && !key.startsWith('x-') && !['type', 'enum', 'nullable'].includes(key)) {
      unsupported(location(pointer, key), 'null schema has unsupported sibling constraints');
    }
  }
  if (schema["enum"] !== undefined && (!isUnknownArray(schema["enum"]) || schema["enum"].length !== 1 || schema["enum"][0] !== null)) {
    unsupported(location(pointer, 'enum'), 'null schema has a conflicting enum');
  }
  if (schema["nullable"] !== undefined && schema["nullable"] !== true) unsupported(pointer, 'null schema has conflicting nullability');
  if (schema["default"] !== undefined && schema["default"] !== null) unsupported(pointer, 'null schema has a non-null default');
  schema["type"] = 'string';
  schema["nullable"] = true;
  schema["enum"] = [null];
}

function convertSchema(value: JsonValue, pointer: string, document: JsonRecord): void {
  if (!record(value)) unsupported(pointer, 'expected a Schema Object');
  if (value["$ref"] !== undefined) {
    if (Object.keys(value).length !== 1) unsupported(pointer, 'reference siblings would be ignored by OpenAPI 3.0');
    referenceTarget(document, value["$ref"], location(pointer, '$ref'));
    return;
  }
  for (const key of Object.keys(value)) {
    if (!ALLOWED_KEYS.has(key) && !key.startsWith('x-')) unsupported(location(pointer, key), 'unsupported schema keyword');
  }
  // 空 required 不施加约束，但 OAS 3.0 不接受空数组；仅在 Schema 上省略。
  if (isUnknownArray(value["required"]) && value["required"].length === 0) delete value["required"];
  if (Object.hasOwn(value, 'const')) {
    const literal = value["const"];
    if (literal === undefined) unsupported(pointer, 'invalid literal');
    if (value["enum"] !== undefined && (!isUnknownArray(value["enum"]) || !value["enum"].some(entry => equivalent(entry, literal)))) {
      unsupported(pointer, 'const conflicts with enum');
    }
    value["enum"] = [literal];
    delete value["const"];
    if (literal === null) {
      if (value["type"] !== undefined && value["type"] !== 'null') unsupported(pointer, 'null literal has an unsupported explicit type');
      value["type"] = 'null';
    }
  }
  if (value["type"] === 'null') convertNull(value, pointer);
  if (value["type"] !== undefined && (typeof value["type"] !== 'string' || !TYPES.has(value["type"]))) {
    unsupported(location(pointer, 'type'), 'unsupported schema type');
  }
  for (const key of BOOLEAN_KEYS) {
    if (value[key] !== undefined && typeof value[key] !== 'boolean') unsupported(location(pointer, key), 'expected a boolean');
  }
  for (const key of STRING_KEYS) {
    if (value[key] !== undefined && typeof value[key] !== 'string') unsupported(location(pointer, key), 'expected a string');
  }
  for (const key of COUNT_KEYS) {
    const count = value[key];
    if (count !== undefined && (typeof count !== 'number' || !Number.isInteger(count) || count < 0)) {
      unsupported(location(pointer, key), 'expected a non-negative integer');
    }
  }
  for (const key of NUMBER_KEYS) {
    const number = value[key];
    if (number !== undefined && (typeof number !== 'number' || (key === 'multipleOf' && number <= 0))) {
      unsupported(location(pointer, key), 'invalid numeric constraint');
    }
  }
  if (value["enum"] !== undefined && (!isUnknownArray(value["enum"]) || value["enum"].length === 0)) unsupported(pointer, 'invalid enum');
  if (value["required"] !== undefined && (!isUnknownArray(value["required"]) || value["required"].length === 0
    || value["required"].some(key => typeof key !== 'string') || new Set(value["required"]).size !== value["required"].length)) {
    unsupported(pointer, 'invalid required list');
  }
  if (value["patternProperties"] !== undefined) {
    const patterns = value["patternProperties"];
    if (value["type"] !== 'object' || !record(patterns) || Object.keys(patterns).length !== 1 || !Object.hasOwn(patterns, ALL_STRING_KEYS)) {
      unsupported(location(pointer, 'patternProperties'), 'only the explicit all-string-keys pattern is portable');
    }
    if (value["properties"] !== undefined && (!record(value["properties"]) || Object.keys(value["properties"]).length !== 0)) {
      unsupported(pointer, 'patternProperties with named properties requires unsupported intersections');
    }
    if (value["additionalProperties"] !== undefined && value["additionalProperties"] !== true) {
      unsupported(pointer, 'patternProperties with another additionalProperties constraint is unsupported');
    }
    const dictionaryValue = patterns[ALL_STRING_KEYS];
    if (dictionaryValue === undefined) unsupported(pointer, 'missing dictionary value schema');
    value["additionalProperties"] = dictionaryValue;
    delete value["patternProperties"];
  }
  if (value["type"] === 'array' && value["items"] === undefined) unsupported(pointer, 'array schema requires items');
  for (const key of ['items', 'not'] as const) {
    const child = value[key];
    if (child !== undefined) convertSchema(child, location(pointer, key), document);
  }
  if (value["additionalProperties"] !== undefined && typeof value["additionalProperties"] !== 'boolean') {
    convertSchema(value["additionalProperties"], location(pointer, 'additionalProperties'), document);
  }
  if (value["properties"] !== undefined) {
    if (!record(value["properties"])) unsupported(pointer, 'properties must be a schema map');
    for (const [key, child] of Object.entries(value["properties"])) {
      convertSchema(child, location(location(pointer, 'properties'), key), document);
    }
  }
  for (const key of COMPOSITIONS) {
    const branches = value[key];
    if (branches === undefined) continue;
    if (!isUnknownArray(branches) || branches.length === 0) unsupported(location(pointer, key), 'expected non-empty schema alternatives');
    branches.forEach((branch, index) => convertSchema(branch, location(location(pointer, key), index), document));
  }
}

function convertBindings(value: JsonValue, pointer: string, document: JsonRecord): void {
  if (!record(value)) unsupported(pointer, 'bindings must be an object');
  for (const [key, schema] of Object.entries(value)) {
    const childPath = location(pointer, key);
    if (key === 'response') {
      if (record(schema) && Object.keys(schema).length > 0
        && Object.keys(schema).every(status => /^(?:[1-5]\d\d|[1-5]xx|default)$/i.test(status))) {
        for (const [status, child] of Object.entries(schema)) convertSchema(child, location(childPath, status), document);
      } else convertSchema(schema, childPath, document);
    } else if (INPUT_BINDINGS.has(key)) convertSchema(schema, childPath, document);
    else unsupported(childPath, 'unsupported schema binding');
  }
}

type Context = 'document' | 'components' | 'pathItem' | 'operation' | 'parameter'
  | 'response' | 'requestBody' | 'media' | 'encoding' | 'callback' | 'inventory';
const METHODS = new Set(['get', 'put', 'post', 'delete', 'options', 'head', 'patch', 'trace']);

function walkMap(value: JsonValue, pointer: string, document: JsonRecord, context: Context, extensions = false): void {
  if (!record(value)) unsupported(pointer, 'expected an OpenAPI object map');
  for (const [name, child] of Object.entries(value)) {
    if (extensions && name.startsWith('x-')) continue;
    walk(child, location(pointer, name), document, context);
  }
}

function walk(value: JsonValue, pointer: string, document: JsonRecord, context: Context): void {
  if (!record(value)) return;
  // 组件名、header 名和 media type 都是映射键，不能按名称误判为 schema 字段。
  if (context === 'callback') {
    walkMap(value, pointer, document, 'pathItem', true);
    return;
  }
  for (const [key, child] of Object.entries(value)) {
    const childPath = location(pointer, key);
    if (key === 'x-supauth-input-schema') convertSchema(child, childPath, document);
    else if (key === 'x-supauth-bindings') convertBindings(child, childPath, document);
    else if (context === 'document') {
      if (key === 'paths') walkMap(child, childPath, document, 'pathItem', true);
      else if (key === 'components') walk(child, childPath, document, 'components');
    } else if (context === 'components') {
      if (key === 'schemas') {
        if (!record(child)) unsupported(childPath, 'components schemas must be an object');
        for (const [name, schema] of Object.entries(child)) convertSchema(schema, location(childPath, name), document);
      } else if (key === 'parameters' || key === 'headers') walkMap(child, childPath, document, 'parameter');
      else if (key === 'responses') walkMap(child, childPath, document, 'response');
      else if (key === 'requestBodies') walkMap(child, childPath, document, 'requestBody');
      else if (key === 'callbacks') walkMap(child, childPath, document, 'callback');
    } else if (context === 'pathItem' || context === 'operation') {
      if (key === 'parameters') {
        if (!isUnknownArray(child)) unsupported(childPath, 'parameters must be an array');
        child.forEach((parameter, index) => walk(parameter, location(childPath, index), document, 'parameter'));
      } else if (context === 'pathItem' && METHODS.has(key)) walk(child, childPath, document, 'operation');
      else if (context === 'operation') {
        if (key === 'requestBody') walk(child, childPath, document, 'requestBody');
        else if (key === 'responses') walkMap(child, childPath, document, 'response', true);
        else if (key === 'callbacks') walkMap(child, childPath, document, 'callback');
      }
    } else if (context === 'parameter' || context === 'response' || context === 'requestBody') {
      if (key === 'schema' && context === 'parameter') convertSchema(child, childPath, document);
      else if (key === 'content') walkMap(child, childPath, document, 'media');
      else if (key === 'headers' && context === 'response') walkMap(child, childPath, document, 'parameter');
    } else if (context === 'media') {
      if (key === 'schema') convertSchema(child, childPath, document);
      else if (key === 'encoding') walkMap(child, childPath, document, 'encoding');
    } else if (context === 'encoding' && key === 'headers') {
      walkMap(child, childPath, document, 'parameter');
    } else if (context === 'inventory' && key === 'operation') {
      walk(child, childPath, document, 'operation');
    }
  }
}

/** 引用规整后再转换 JSON 副本，不改变 TypeBox 运行时对象或 API 方言版本。 */
export function convertOpenApi30Schemas(document: unknown, inventory: unknown = []) {
  const spec = cloneJson(document, '');
  const routes = cloneJson(inventory, '/inventory');
  if (!record(spec) || spec["openapi"] !== '3.0.3' || !record(spec["paths"]) || !isUnknownArray(routes)) {
    unsupported('', 'expected an OpenAPI 3.0.3 document and route inventory');
  }
  walk(spec, '', spec, 'document');
  routes.forEach((route, index) => walk(route, location('/inventory', index), spec, 'inventory'));
  return { spec, inventory: routes };
}
