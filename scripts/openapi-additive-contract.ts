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
  'pattern',
  'required',
  'type',
  'uniqueItems',
]);

interface ComparisonState {
  changes: string[];
}

interface ComparisonLocation {
  location: string;
  state: ComparisonState;
}

export function findOpenApiBreakingChanges(
  baseline: OpenApiDocument,
  current: OpenApiDocument,
): string[] {
  const state: ComparisonState = { changes: [] };
  compareOpenApiVersion(baseline, current, state);
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
  const baseline = objectValue(baselinePathItem);
  const current = objectValue(currentPathItem);
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
  compareOperationId(location, baseline.operationId, current.operationId, context.state);
  compareParameters(location, combinedParameters(baselinePath, baseline), combinedParameters(currentPath, current), context.state);
  compareRequestBody(location, baseline.requestBody, current.requestBody, context.state);
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

function combinedParameters(pathItem: OpenApiObject, operation: OpenApiObject): unknown[] {
  return [...arrayValue(pathItem.parameters), ...arrayValue(operation.parameters)];
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
    if (!baselineIdentities.has(parameterIdentity(currentParameter)) && objectValue(currentParameter)?.required === true) {
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
  if (baseline.required !== true && current.required === true) {
    state.changes.push(`${location} made parameter ${identity} required`);
  }
  compareContractNode(withoutKey(baseline, 'required'), withoutKey(current, 'required'), `${location} parameter ${identity}`, state);
}

function parameterIdentity(parameter: unknown): string {
  const record = objectValue(parameter);
  if (!record) return JSON.stringify(parameter);
  if (typeof record.$ref === 'string') return `$ref:${record.$ref}`;
  return `${String(record.in || 'unknown')}:${String(record.name || 'unknown')}`;
}

function compareRequestBody(
  location: string,
  baselineRequestBody: unknown,
  currentRequestBody: unknown,
  state: ComparisonState,
) {
  if (baselineRequestBody === undefined) {
    if (objectValue(currentRequestBody)?.required === true) state.changes.push(`${location} added a required request body`);
    return;
  }
  if (currentRequestBody === undefined) {
    state.changes.push(`${location} removed its request body`);
    return;
  }
  const baseline = objectValue(baselineRequestBody) || {};
  const current = objectValue(currentRequestBody) || {};
  if (baseline.required !== true && current.required === true) state.changes.push(`${location} made its request body required`);
  compareContractNode(withoutKey(baseline, 'required'), withoutKey(current, 'required'), `${location} requestBody`, state);
}

function compareOperationContract(
  location: string,
  baseline: OpenApiObject,
  current: OpenApiObject,
  state: ComparisonState,
) {
  for (const key of ['responses', 'callbacks']) {
    if (baseline[key] !== undefined) compareContractNode(baseline[key], current[key], `${location} ${key}`, state);
  }
  if (baseline.security !== undefined || current.security !== undefined) {
    compareExactValue(baseline.security, current.security, `${location} security`, state);
  }
}

function compareContractNode(
  baseline: unknown,
  current: unknown,
  location: string,
  state: ComparisonState,
) {
  if (Array.isArray(baseline)) {
    compareArrayNode('', baseline, current, { location, state });
    return;
  }
  const baselineObject = objectValue(baseline);
  if (baselineObject) {
    compareObjectNode(baselineObject, current, location, state);
    return;
  }
  if (!Object.is(baseline, current)) state.changes.push(`${location} changed from ${JSON.stringify(baseline)} to ${JSON.stringify(current)}`);
}

function compareObjectNode(baseline: OpenApiObject, currentValue: unknown, location: string, state: ComparisonState) {
  const current = objectValue(currentValue);
  if (!current) {
    state.changes.push(`${location} was removed or is no longer an object`);
    return;
  }
  for (const [key, baselineChild] of Object.entries(baseline)) {
    if (ignoredContractKey(key)) continue;
    if (!(key in current)) {
      state.changes.push(`${location}.${key} was removed`);
      continue;
    }
    compareChildNode(key, baselineChild, current[key], { location: `${location}.${key}`, state });
  }
  reportNewRestrictions(baseline, current, location, state);
}

function compareChildNode(
  key: string,
  baseline: unknown,
  current: unknown,
  context: ComparisonLocation,
) {
  if (Array.isArray(baseline)) {
    compareArrayNode(key, baseline, current, context);
    return;
  }
  compareContractNode(baseline, current, context.location, context.state);
}

function compareArrayNode(key: string, baseline: unknown[], currentValue: unknown, context: ComparisonLocation) {
  if (!Array.isArray(currentValue)) {
    context.state.changes.push(`${context.location} was removed or is no longer an array`);
    return;
  }
  if (EXACT_ARRAY_KEYS.has(key)) {
    compareExactSet(baseline, currentValue, context.location, context.state);
    return;
  }
  if (EXACT_COMPOSITION_KEYS.has(key) && baseline.length !== currentValue.length) {
    context.state.changes.push(`${context.location} changed schema alternative count`);
    return;
  }
  if (currentValue.length < baseline.length) context.state.changes.push(`${context.location} removed array entries`);
  baseline.forEach((baselineEntry, index) => {
    compareContractNode(baselineEntry, currentValue[index], `${context.location}[${index}]`, context.state);
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
  if (key === 'additionalProperties') return candidate === false;
  if (key === 'required' || key === 'enum') return Array.isArray(candidate) && candidate.length > 0;
  return candidate !== undefined;
}

function ignoredContractKey(key: string): boolean {
  return IGNORED_CONTRACT_KEYS.has(key) || key.startsWith('x-');
}

function withoutKey(record: OpenApiObject, excludedKey: string): OpenApiObject {
  return Object.fromEntries(Object.entries(record).filter(([key]) => key !== excludedKey));
}

function objectValue(candidate: unknown): OpenApiObject | null {
  return candidate !== null && typeof candidate === 'object' && !Array.isArray(candidate)
    ? candidate as OpenApiObject
    : null;
}

function arrayValue(candidate: unknown): unknown[] {
  return Array.isArray(candidate) ? candidate : [];
}

function canonicalValue(candidate: unknown): string {
  if (Array.isArray(candidate)) return JSON.stringify(candidate.map(canonicalValue));
  const record = objectValue(candidate);
  if (!record) return JSON.stringify(candidate) ?? String(candidate);
  return JSON.stringify(Object.keys(record).sort().map((key) => [key, canonicalValue(record[key])]));
}
