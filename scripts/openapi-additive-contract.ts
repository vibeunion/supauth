import { requireRecord } from "./tooling-values.js";
import { isUnknownArray } from "./tooling-values.js";
export type OpenApiObject = Record<string, unknown>;

export interface OpenApiDocument extends OpenApiObject {
  openapi?: string;
  paths?: OpenApiObject;
  components?: OpenApiObject;
}

const HTTP_METHODS = new Set(['get', 'put', 'post', 'delete', 'patch', 'options', 'head', 'trace']);
const IGNORED_CONTRACT_KEYS = new Set([
  'description',
  'summary',
  'title',
  'example',
  'examples',
  'externalDocs',
  'deprecated',
  'tags',
]);
const EXACT_ARRAY_KEYS = new Set(['enum', 'required', 'type']);
const EXACT_COMPOSITION_KEYS = new Set(['allOf', 'anyOf', 'oneOf']);
const RESTRICTIVE_SCHEMA_KEYS = new Set([
  '$ref',
  'allOf',
  'anyOf',
  'oneOf',
  'additionalProperties',
  'const',
  'enum',
  'exclusiveMaximum',
  'exclusiveMinimum',
  'format',
  'maxItems',
  'maxLength',
  'maxProperties',
  'maximum',
  'minItems',
  'minLength',
  'minProperties',
  'minimum',
  'multipleOf',
  'not',
  'nullable',
  'pattern',
  'required',
  'type',
  'uniqueItems',
]);

interface ComparisonState {
  changes: string[];
  baselineDocument: OpenApiDocument;
  currentDocument: OpenApiDocument;
}

interface ComparisonLocation {
  location: string;
  state: ComparisonState;
}

type NodeKind = 'contract' | 'contract-map' | 'schema' | 'schema-map' | 'schema-list' | 'schema-value' | 'value';
interface NodeLocation extends ComparisonLocation {
  kind: NodeKind;
}

const SCHEMA_MAP_KEYS = new Set(['properties', 'patternProperties', '$defs', 'definitions', 'dependentSchemas']);
const SCHEMA_NODE_KEYS = new Set([
  'items', 'additionalItems', 'additionalProperties', 'unevaluatedItems', 'unevaluatedProperties',
  'contains', 'not', 'propertyNames', 'if', 'then', 'else', 'contentSchema',
]);
const CONTRACT_MAP_KEYS = new Set([
  'content', 'responses', 'headers', 'parameters', 'requestBodies', 'callbacks',
  'links', 'examples', 'encoding', 'securitySchemes',
]);

export function findOpenApiBreakingChanges(
  baseline: OpenApiDocument,
  current: OpenApiDocument,
): string[] {
  const state: ComparisonState = { changes: [], baselineDocument: baseline, currentDocument: current };
  compareOpenApiVersion(baseline, current, state);
  if (baseline["security"] !== undefined || current["security"] !== undefined) {
    compareExactValue(baseline["security"], current["security"], 'security', state);
  }
  compareComponents(baseline.components, current.components, state);
  comparePaths(baseline.paths, current.paths, state);
  return state.changes;
}

function compareOpenApiVersion(
  baseline: OpenApiDocument,
  current: OpenApiDocument,
  state: ComparisonState,
) {
  if (baseline.openapi !== current.openapi) {
    state.changes.push(`OpenAPI version changed from ${baseline.openapi || 'missing'} to ${current.openapi || 'missing'}`);
  }
}

function compareComponents(
  baselineComponents: unknown,
  currentComponents: unknown,
  state: ComparisonState,
) {
  if (baselineComponents === undefined) return;
  compareContractNode(baselineComponents, currentComponents, 'components', state);
}

function comparePaths(baselinePaths: unknown, currentPaths: unknown, state: ComparisonState) {
  const baseline = objectValue(baselinePaths);
  const current = objectValue(currentPaths);
  if (!baseline || !current) {
    state.changes.push('OpenAPI paths object is missing');
    return;
  }
  for (const [path, baselinePathItem] of Object.entries(baseline)) {
    const currentPathItem = current[path];
    if (!currentPathItem) {
      state.changes.push(`Path removed: ${path}`);
      continue;
    }
    comparePathItem(path, baselinePathItem, currentPathItem, state);
  }
}

function comparePathItem(path: string, baselinePathItem: unknown, currentPathItem: unknown, state: ComparisonState) {
  const baseline = objectValue(resolveContractReference(baselinePathItem, state.baselineDocument, 'pathItem', path, state));
  const current = objectValue(resolveContractReference(currentPathItem, state.currentDocument, 'pathItem', path, state));
  if (!baseline || !current) {
    state.changes.push(`Path contract is invalid: ${path}`);
    return;
  }
  for (const method of Object.keys(baseline).filter((key) => HTTP_METHODS.has(key))) {
    if (!current[method]) {
      state.changes.push(`Operation removed: ${method.toUpperCase()} ${path}`);
      continue;
    }
    compareOperation(method, baseline, current, { location: path, state });
  }
}

function compareOperation(
  method: string,
  baselinePath: OpenApiObject,
  currentPath: OpenApiObject,
  context: ComparisonLocation,
) {
  const location = `${method.toUpperCase()} ${context.location}`;
  const baseline = objectValue(baselinePath[method]);
  const current = objectValue(currentPath[method]);
  if (!baseline || !current) return;
  compareOperationId(location, baseline["operationId"], current["operationId"], context.state);
  compareParameters(location,
    combinedParameters(baselinePath, baseline, context.state.baselineDocument, location, context.state),
    combinedParameters(currentPath, current, context.state.currentDocument, location, context.state),
    context.state);
  compareRequestBody(location, baseline["requestBody"], current["requestBody"], context.state);
  compareOperationContract(location, baseline, current, context.state);
}

function compareOperationId(
  location: string,
  baselineOperationId: unknown,
  currentOperationId: unknown,
  state: ComparisonState,
) {
  if (baselineOperationId !== currentOperationId) {
    state.changes.push(`${location} operationId changed from ${String(baselineOperationId)} to ${String(currentOperationId)}`);
  }
}

function combinedParameters(
  pathItem: OpenApiObject, operation: OpenApiObject, document: OpenApiDocument,
  location: string, state: ComparisonState,
): unknown[] {
  const parameters = [...arrayValue(pathItem["parameters"]), ...arrayValue(operation["parameters"])]
    .map(parameter => resolveContractReference(parameter, document, 'parameter', `${location} parameter`, state));
  // Operation 按 in/name 覆盖 Path Item；被覆盖的定义不再参与该操作的比较。
  return [...new Map(parameters.map(parameter => [parameterIdentity(parameter), parameter])).values()];
}

// 只解析需要判断 required 的 OpenAPI 容器引用；Schema 内的 $ref 保持原样比较。
function resolveContractReference(
  value: unknown, document: OpenApiDocument, kind: 'pathItem' | 'parameter' | 'requestBody',
  location: string, state: ComparisonState,
): unknown {
  let candidate = value;
  const visited = new Set<string>();
  while (true) {
    const node = objectValue(candidate);
    if (!node || !Object.hasOwn(node, '$ref')) {
      if (visited.size && (!node || !validReferenceTarget(node, kind))) {
        state.changes.push(`${location} has an invalid ${kind} reference target`);
        return undefined;
      }
      return candidate;
    }
    const ref = node["$ref"];
    if (typeof ref !== 'string' || visited.has(ref)) {
      state.changes.push(`${location} has an invalid or cyclic ${kind} reference`);
      return undefined;
    }
    visited.add(ref);
    if (Object.keys(node).some(key => !['$ref', 'summary', 'description'].includes(key))) {
      state.changes.push(`${location} has unsupported ${kind} reference siblings`);
    }
    let pointer: string;
    try { pointer = decodeURIComponent(ref); } catch {
      state.changes.push(`${location} has an invalid ${kind} reference pointer`);
      return undefined;
    }
    if (!pointer.startsWith('#/') || /~(?![01])/u.test(pointer)) {
      state.changes.push(`${location} has an unresolved or non-local ${kind} reference`);
      return undefined;
    }
    candidate = document;
    for (const token of pointer.slice(2).split('/')) {
      const key = token.replace(/~1/g, '/').replace(/~0/g, '~');
      const parent = objectValue(candidate);
      if (parent && Object.hasOwn(parent, key)) candidate = parent[key];
      else if (isUnknownArray(candidate) && /^(0|[1-9]\d*)$/.test(key)
        && Number.isSafeInteger(Number(key)) && Object.hasOwn(candidate, key)) candidate = candidate[Number(key)];
      else {
        state.changes.push(`${location} has an unresolved ${kind} reference`);
        return undefined;
      }
    }
  }
}

function validReferenceTarget(node: OpenApiObject, kind: 'pathItem' | 'parameter' | 'requestBody'): boolean {
  if (kind === 'pathItem') return true;
  if (node["required"] !== undefined && typeof node["required"] !== 'boolean') return false;
  if (kind === 'requestBody') return objectValue(node["content"]) !== null;
  return typeof node["name"] === 'string' && ['query', 'header', 'path', 'cookie'].includes(String(node["in"]))
    && (node["in"] !== 'path' || node["required"] === true)
    && (objectValue(node["schema"]) !== null || objectValue(node["content"]) !== null);
}

function compareParameters(
  location: string,
  baselineParameters: unknown[],
  currentParameters: unknown[],
  state: ComparisonState,
) {
  const currentByIdentity = new Map(currentParameters.map((parameter) => [parameterIdentity(parameter), parameter]));
  const baselineIdentities = new Set(baselineParameters.map(parameterIdentity));
  for (const baselineParameter of baselineParameters) {
    compareParameter(location, baselineParameter, currentByIdentity.get(parameterIdentity(baselineParameter)), state);
  }
  for (const currentParameter of currentParameters) {
    if (!baselineIdentities.has(parameterIdentity(currentParameter)) && objectValue(currentParameter)?.["required"] === true) {
      state.changes.push(`${location} added required parameter ${parameterIdentity(currentParameter)}`);
    }
  }
}

function compareParameter(
  location: string,
  baselineParameter: unknown,
  currentParameter: unknown,
  state: ComparisonState,
) {
  const identity = parameterIdentity(baselineParameter);
  if (!currentParameter) {
    state.changes.push(`${location} removed parameter ${identity}`);
    return;
  }
  const baseline = objectValue(baselineParameter) || {};
  const current = objectValue(currentParameter) || {};
  if (baseline["required"] !== true && current["required"] === true) {
    state.changes.push(`${location} made parameter ${identity} required`);
  }
  compareContractNode(withoutKey(baseline, 'required'), withoutKey(current, 'required'), `${location} parameter ${identity}`, state);
}

function parameterIdentity(parameter: unknown): string {
  const record = objectValue(parameter);
  if (!record) return JSON.stringify(parameter);
  if (typeof record["$ref"] === 'string') return `$ref:${record["$ref"]}`;
  return `${String(record["in"] || 'unknown')}:${String(record["name"] || 'unknown')}`;
}

function compareRequestBody(
  location: string,
  baselineRequestBody: unknown,
  currentRequestBody: unknown,
  state: ComparisonState,
) {
  baselineRequestBody = resolveContractReference(
    baselineRequestBody, state.baselineDocument, 'requestBody', `${location} requestBody`, state,
  );
  currentRequestBody = resolveContractReference(
    currentRequestBody, state.currentDocument, 'requestBody', `${location} requestBody`, state,
  );
  if (baselineRequestBody === undefined) {
    if (objectValue(currentRequestBody)?.["required"] === true) state.changes.push(`${location} added a required request body`);
    return;
  }
  if (currentRequestBody === undefined) {
    state.changes.push(`${location} removed its request body`);
    return;
  }
  const baseline = objectValue(baselineRequestBody) || {};
  const current = objectValue(currentRequestBody) || {};
  if (baseline["required"] !== true && current["required"] === true) state.changes.push(`${location} made its request body required`);
  compareContractNode(withoutKey(baseline, 'required'), withoutKey(current, 'required'), `${location} requestBody`, state);
}

function compareOperationContract(
  location: string,
  baseline: OpenApiObject,
  current: OpenApiObject,
  state: ComparisonState,
) {
  for (const key of ['responses', 'callbacks']) {
    if (baseline[key] !== undefined) compareContractNode(baseline[key], current[key], `${location} ${key}`, state, 'contract-map');
  }
  if (baseline["security"] !== undefined || current["security"] !== undefined) {
    compareExactValue(baseline["security"], current["security"], `${location} security`, state);
  }
}

function compareContractNode(
  baseline: unknown,
  current: unknown,
  location: string,
  state: ComparisonState,
  kind: NodeKind = 'contract',
) {
  if (kind === 'value' && (isUnknownArray(baseline) || objectValue(baseline))) {
    compareExactValue(baseline, current, location, state);
    return;
  }
  if (isUnknownArray(baseline)) {
    compareArrayNode('', baseline, current, { location, state, kind });
    return;
  }
  const baselineObject = objectValue(baseline);
  if (baselineObject) {
    if (kind === 'schema' && equivalentFiniteSchema(baselineObject, current)) return;
    compareObjectNode(baselineObject, current, location, state, kind);
    return;
  }
  if (!Object.is(baseline, current)) state.changes.push(`${location} changed from ${JSON.stringify(baseline)} to ${JSON.stringify(current)}`);
}

function compareObjectNode(
  baseline: OpenApiObject, currentValue: unknown, location: string, state: ComparisonState, kind: NodeKind,
) {
  const current = objectValue(currentValue);
  if (!current) {
    state.changes.push(`${location} was removed or is no longer an object`);
    return;
  }
  for (const [key, baselineChild] of Object.entries(baseline)) {
    if ((kind === 'contract' || kind === 'schema') && ignoredContractKey(key)) continue;
    if (!(key in current)) {
      state.changes.push(`${location}.${key} was removed`);
      continue;
    }
    compareChildNode(key, baselineChild, current[key], {
      location: `${location}.${key}`, state, kind: childKind(kind, key),
    });
  }
  if (kind === 'schema') reportNewRestrictions(baseline, current, location, state);
}

function childKind(parent: NodeKind, key: string): NodeKind {
  if (parent === 'schema-map' || parent === 'schema-list') return 'schema';
  if (parent === 'contract-map') return 'contract';
  if (parent === 'value' || parent === 'schema-value') return 'value';
  if (parent === 'schema') {
    if (SCHEMA_MAP_KEYS.has(key)) return 'schema-map';
    if (EXACT_COMPOSITION_KEYS.has(key) || key === 'prefixItems') return 'schema-list';
    if (SCHEMA_NODE_KEYS.has(key)) return 'schema';
    if (EXACT_ARRAY_KEYS.has(key)) return 'schema-value';
    return 'value';
  }
  if (key === 'schema') return 'schema';
  if (key === 'schemas') return 'schema-map';
  return CONTRACT_MAP_KEYS.has(key) ? 'contract-map' : 'contract';
}

// 只证明有限、纯 literal 的接受值集合相同；任何额外约束或未知分支均保持原比较。
function equivalentFiniteSchema(baseline: OpenApiObject, candidate: unknown): boolean {
  const current = objectValue(candidate);
  if (!current) return false;
  const before = finiteSchemaValues(baseline);
  const after = finiteSchemaValues(current);
  return before !== null && after !== null && canonicalValue(before) === canonicalValue(after);
}

function finiteSchemaValues(schema: OpenApiObject): string[] | null {
  const keys = Object.keys(schema).filter(key => !ignoredContractKey(key));
  let values: unknown[];
  if (keys.every(key => key === 'enum' || key === 'type') && isUnknownArray(schema["enum"]) && schema["enum"].length) {
    values = schema["enum"];
    if (!values.every(value => primitiveValue(value) && literalTypeMatches(value, schema["type"]))) return null;
  } else if (keys.length === 1 && keys[0] === 'anyOf' && isUnknownArray(schema["anyOf"]) && schema["anyOf"].length) {
    values = [];
    for (const branch of schema["anyOf"]) {
      const literal = objectValue(branch);
      if (!literal) return null;
      const hasConst = Object.hasOwn(literal, 'const');
      const hasEnum = Object.hasOwn(literal, 'enum');
      const enumValues = isUnknownArray(literal["enum"]) ? literal["enum"] : undefined;
      if (hasConst === hasEnum
        || Object.keys(literal).some(key => !ignoredContractKey(key)
          && key !== 'type' && key !== (hasConst ? 'const' : 'enum'))
        || (hasEnum && enumValues?.length !== 1)) return null;
      const value = hasConst ? literal["const"] : enumValues?.[0];
      if (!primitiveValue(value) || !literalTypeMatches(value, literal["type"])) return null;
      values.push(value);
    }
  } else {
    return null;
  }
  return [...new Set(values.map(canonicalValue))].sort();
}

function primitiveValue(value: unknown): boolean {
  return value === null || typeof value === 'string' || typeof value === 'boolean'
    || (typeof value === 'number' && Number.isFinite(value));
}

function literalTypeMatches(value: unknown, type: unknown): boolean {
  if (type === undefined) return true;
  if (type === 'null') return value === null;
  if (type === 'integer') return typeof value === 'number' && Number.isInteger(value);
  return (type === 'string' || type === 'boolean' || type === 'number') && typeof value === type;
}

function compareChildNode(
  key: string,
  baseline: unknown,
  current: unknown,
  context: NodeLocation,
) {
  if (isUnknownArray(baseline)) {
    compareArrayNode(key, baseline, current, context);
    return;
  }
  compareContractNode(baseline, current, context.location, context.state, context.kind);
}

function compareArrayNode(key: string, baseline: unknown[], currentValue: unknown, context: NodeLocation) {
  if (context.kind === 'value') {
    compareExactValue(baseline, currentValue, context.location, context.state);
    return;
  }
  if (!isUnknownArray(currentValue)) {
    context.state.changes.push(`${context.location} was removed or is no longer an array`);
    return;
  }
  if (context.kind === 'schema-value' && EXACT_ARRAY_KEYS.has(key)) {
    compareExactSet(baseline, currentValue, context.location, context.state);
    return;
  }
  if (context.kind === 'schema-list' && EXACT_COMPOSITION_KEYS.has(key) && baseline.length !== currentValue.length) {
    context.state.changes.push(`${context.location} changed schema alternative count`);
    return;
  }
  if (currentValue.length < baseline.length) context.state.changes.push(`${context.location} removed array entries`);
  baseline.forEach((baselineEntry, index) => {
    compareContractNode(
      baselineEntry, currentValue[index], `${context.location}[${index}]`, context.state,
      context.kind === 'schema-list' ? 'schema' : context.kind === 'contract-map' ? 'contract' : context.kind,
    );
  });
}

function compareExactSet(
  baseline: unknown[],
  current: unknown[],
  location: string,
  state: ComparisonState,
) {
  const baselineValues = baseline.map(canonicalValue).sort();
  const currentValues = current.map(canonicalValue).sort();
  if (JSON.stringify(baselineValues) !== JSON.stringify(currentValues)) {
    state.changes.push(`${location} changed from ${JSON.stringify(baseline)} to ${JSON.stringify(current)}`);
  }
}

function compareExactValue(
  baseline: unknown,
  current: unknown,
  location: string,
  state: ComparisonState,
) {
  if (canonicalValue(baseline) !== canonicalValue(current)) state.changes.push(`${location} changed incompatibly`);
}

function reportNewRestrictions(
  baseline: OpenApiObject,
  current: OpenApiObject,
  location: string,
  state: ComparisonState,
) {
  for (const key of RESTRICTIVE_SCHEMA_KEYS) {
    if (!(key in baseline) && newRestriction(key, current[key])) {
      state.changes.push(`${location}.${key} added a new restriction`);
    }
  }
}

function newRestriction(key: string, candidate: unknown): boolean {
  if (key === 'additionalProperties') return candidate !== undefined && candidate !== true;
  if (key === 'nullable') return candidate !== undefined && candidate !== false;
  if (key === 'required' || key === 'enum') return isUnknownArray(candidate) && candidate.length > 0;
  return candidate !== undefined;
}

function ignoredContractKey(key: string): boolean {
  return IGNORED_CONTRACT_KEYS.has(key) || key.startsWith('x-');
}

function withoutKey(record: OpenApiObject, excludedKey: string): OpenApiObject {
  return Object.fromEntries(Object.entries(record).filter(([key]) => key !== excludedKey));
}

function objectValue(candidate: unknown): OpenApiObject | null {
  return candidate !== null && typeof candidate === 'object' && !isUnknownArray(candidate)
    ? requireRecord(candidate)
    : null;
}

function arrayValue(candidate: unknown): unknown[] {
  return isUnknownArray(candidate) ? candidate : [];
}

function canonicalValue(candidate: unknown): string {
  if (isUnknownArray(candidate)) return JSON.stringify(candidate.map(canonicalValue));
  const record = objectValue(candidate);
  if (!record) return JSON.stringify(candidate) ?? String(candidate);
  return JSON.stringify(Object.keys(record).sort().map((key) => [key, canonicalValue(record[key])]));
}
