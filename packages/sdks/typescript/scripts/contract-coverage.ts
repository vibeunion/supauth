import { readFileSync } from 'node:fs';
import { sdkEndpoints } from '@supauth/shared';
import { decodeCoverageDocument } from './coverage-contract.js';

const baselinePath = process.argv[2];
if (!baselinePath) throw new Error('Pass the independently exported baseline OpenAPI JSON path.');
const rawBaseline: unknown = JSON.parse(readFileSync(baselinePath, 'utf8'));
const baseline = decodeCoverageDocument(rawBaseline);
const normalize = (path: string) => path.replace(/\/$/, '').replace(/:[A-Za-z0-9_]+|\{[^}]+\}/g, ':parameter');
const key = (method: string, path: string) => `${method.toUpperCase()} ${normalize(path)}`;
const httpMethods = new Set(['get', 'post', 'put', 'patch', 'delete', 'head', 'options', 'trace']);
const baselineOperations = new Map<string, string>();
for (const [path, operations] of Object.entries(baseline.paths)) {
  for (const method of Object.keys(operations)) {
    if (httpMethods.has(method)) baselineOperations.set(key(method, path), `${method.toUpperCase()} ${path}`);
  }
}
const sdkOperations = new Map(Object.values(sdkEndpoints).map(endpoint => [key(endpoint.method, endpoint.path), endpoint]));
const missing = [...baselineOperations].filter(([operation]) => !sdkOperations.has(operation)).map(([, label]) => label).sort();
const extra = [...sdkOperations].filter(([operation]) => !baselineOperations.has(operation)).map(([, endpoint]) => `${endpoint.method} ${endpoint.path}`).sort();
const counts = Object.values(sdkEndpoints).reduce((total, endpoint) => {
  total[endpoint.responseKind] += 1;
  return total;
}, { json: 0, void: 0, blob: 0 });
console.log(JSON.stringify({
  baselineOperations: baselineOperations.size, sdkMethods: Object.keys(sdkEndpoints).length,
  sdkOperations: sdkOperations.size, baselineCovered: baselineOperations.size - missing.length,
  responseKinds: counts, notInSdk: missing, notInBaseline: extra,
}, null, 2));
