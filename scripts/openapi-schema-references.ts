import { isUnknownArray, parseJson } from "./tooling-values.js";
type JsonRecord = Record<string, unknown>;

function record(value: unknown): value is JsonRecord {
  return value !== null && typeof value === 'object' && !isUnknownArray(value);
}

function stable(value: unknown): string {
  if (isUnknownArray(value)) return `[${value.map(stable).join(',')}]`;
  if (record(value)) return `{${Object.keys(value).sort().map(key => `${JSON.stringify(key)}:${stable(value[key])}`).join(',')}}`;
  return JSON.stringify(value) ?? 'null';
}

const maps = ['properties', 'patternProperties', '$defs', 'definitions', 'dependentSchemas', 'dependencies'] as const;
const singles = ['items', 'additionalItems', 'additionalProperties', 'contains', 'not', 'if', 'then', 'else', 'propertyNames', 'unevaluatedProperties', 'unevaluatedItems'] as const;
const lists = ['allOf', 'anyOf', 'oneOf', 'prefixItems'] as const;

function visitSchema(value: unknown, visitor: (schema: JsonRecord) => void): void {
  if (!record(value)) return;
  visitor(value);
  for (const key of maps) if (record(value[key])) {
    for (const child of Object.values(value[key])) visitSchema(child, visitor);
  }
  for (const key of singles) {
    const child = value[key];
    if (isUnknownArray(child)) child.forEach(item => visitSchema(item, visitor));
    else visitSchema(child, visitor);
  }
  for (const key of lists) if (isUnknownArray(value[key])) {
    value[key].forEach(child => visitSchema(child, visitor));
  }
}

function visitSchemas(value: unknown, visitor: (schema: JsonRecord) => void): void {
  if (isUnknownArray(value)) {
    value.forEach(item => visitSchemas(item, visitor));
    return;
  }
  if (!record(value)) return;
  for (const [key, child] of Object.entries(value)) {
    if (key === 'schema' || key === 'x-supauth-input-schema') visitSchema(child, visitor);
    else if (key === 'x-supauth-bindings' && record(child)) {
      for (const [binding, schema] of Object.entries(child)) {
        if (binding === 'response' && record(schema)
          && Object.keys(schema).every(status => /^(?:[1-5]\d\d|[1-5]xx|default)$/i.test(status))) {
          for (const response of Object.values(schema)) visitSchema(response, visitor);
        } else visitSchema(schema, visitor);
      }
    } else if (key === 'schemas' && record(child)) {
      for (const schema of Object.values(child)) visitSchema(schema, visitor);
    } else if (!['example', 'examples', 'default', 'enum', 'const'].includes(key)) {
      visitSchemas(child, visitor);
    }
  }
}

function pointer(document: JsonRecord, reference: string): unknown {
  if (!reference.startsWith('#/')) throw new Error('OpenAPI reference is not local');
  let value: unknown = document;
  for (const segment of reference.slice(2).split('/')) {
    const key = segment.replace(/~1/g, '/').replace(/~0/g, '~');
    if (isUnknownArray(value)) {
      if (!/^(0|[1-9]\d*)$/.test(key) || !Object.hasOwn(value, key)) throw new Error('Unresolved OpenAPI reference');
      value = value[Number(key)];
    } else {
      if (!record(value) || !Object.hasOwn(value, key)) throw new Error('Unresolved OpenAPI reference');
      value = value[key];
    }
  }
  return value;
}

/** 将运行时 TypeBox 的递归标识转换为跨端生成器可解析的文档内引用。 */
export function canonicalizeOpenApiReferences(document: unknown, inventory: unknown) {
  // 克隆序列化快照，绝不改动仍用于运行时校验的 TypeBox 对象。
  const spec: unknown = parseJson(JSON.stringify(document));
  const routes: unknown = parseJson(JSON.stringify(inventory));
  if (!record(spec) || !isUnknownArray(routes)) throw new Error('Invalid OpenAPI export');
  const definitions = new Map<string, JsonRecord>();
  const roots = [spec, routes];
  for (const root of roots) visitSchemas(root, schema => {
    if (schema["$id"] === undefined) return;
    if (typeof schema["$id"] !== 'string' || !/^[A-Za-z_][A-Za-z0-9_.-]*$/.test(schema["$id"])) {
      throw new Error('Unsupported OpenAPI schema identifier');
    }
    const previous = definitions.get(schema["$id"]);
    if (previous && stable(previous) !== stable(schema)) throw new Error('Conflicting OpenAPI schema identifier');
    definitions.set(schema["$id"], schema);
  });
  const components = record(spec["components"]) ? spec["components"] : {};
  const schemas = record(components["schemas"]) ? components["schemas"] : {};
  spec["components"] = components;
  components["schemas"] = schemas;
  for (const [id, definition] of definitions) {
    const previous = schemas[id];
    if (previous && stable(previous) !== stable(definition)) throw new Error('Conflicting OpenAPI component');
    schemas[id] = definition;
  }
  for (const root of roots) visitSchemas(root, schema => {
    delete schema["$id"];
    if (schema["$ref"] === undefined) return;
    if (typeof schema["$ref"] !== 'string') throw new Error('Invalid OpenAPI schema reference');
    const reference = definitions.has(schema["$ref"]) ? `#/components/schemas/${schema["$ref"]}` : schema["$ref"];
    schema["$ref"] = reference;
    const target = pointer(spec, reference);
    if (!record(target)) throw new Error('Invalid OpenAPI schema reference target');
  });
  return { spec, inventory: routes };
}
