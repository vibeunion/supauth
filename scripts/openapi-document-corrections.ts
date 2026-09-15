import { isUnknownArray, parseJson } from "./tooling-values.js";
import { createHash } from 'node:crypto';
import { Type, decodeSchema } from '../packages/shared/src/schema.js';
import { findOpenApiBreakingChanges, type OpenApiDocument } from './openapi-additive-contract.js';
import { createOpenApiValidationSession } from './openapi-validation.js';

const digestSchema = Type.String({ pattern: '^[a-f0-9]{64}$' });
const fingerprintSchema = Type.Object({
  present: Type.Boolean(),
  digest: Type.Union([digestSchema, Type.Null()]),
}, { additionalProperties: false });
const ledgerSchema = Type.Object({
  version: Type.Literal(1),
  legacySha256: digestSchema,
  reviewedSha256: digestSchema,
  runtimeCommit: Type.String({ pattern: '^[a-f0-9]{40}$' }),
  corrections: Type.Array(Type.Object({
    pointer: Type.String({ minLength: 1 }),
    kind: Type.Union([
      Type.Literal('request-body-documentation'),
      Type.Literal('parameter-documentation'),
      Type.Literal('response-documentation'),
      Type.Literal('schema-definition'),
    ]),
    before: fingerprintSchema,
    after: fingerprintSchema,
    reason: Type.String({ minLength: 20 }),
    evidence: Type.Array(Type.String({ minLength: 1 }), { minItems: 2 }),
  }, { additionalProperties: false })),
}, { additionalProperties: false });

type RecordValue = Record<string, unknown>;
type Node = { present: boolean; value?: unknown };
const methods = new Set(['get', 'put', 'post', 'delete', 'patch', 'options', 'head', 'trace']);

function record(value: unknown): value is RecordValue {
  return value !== null && typeof value === 'object' && !isUnknownArray(value);
}

export function sha256(value: string): string {
  return createHash('sha256').update(value).digest('hex');
}

function canonical(value: unknown): string {
  if (isUnknownArray(value)) return `[${value.map(canonical).join(',')}]`;
  if (record(value)) {
    return `{${Object.keys(value).sort().map(key => `${JSON.stringify(key)}:${canonical(value[key])}`).join(',')}}`;
  }
  const result = JSON.stringify(value);
  if (result === undefined) throw new Error('Unsupported document correction value');
  return result;
}

export function nodeFingerprint(node: Node) {
  return { present: node.present, digest: node.present ? sha256(canonical(node.value)) : null };
}

function segments(pointer: string): string[] {
  if (!pointer.startsWith('/') || /~(?![01])/u.test(pointer)) throw new Error('Invalid correction pointer');
  return pointer.slice(1).split('/').map(part => part.replace(/~1/g, '/').replace(/~0/g, '~'));
}

export function documentNode(document: unknown, pointer: string): Node {
  let value = document;
  for (const key of segments(pointer)) {
    if (!record(value) && !isUnknownArray(value)) return { present: false };
    if (!Object.hasOwn(value, key)) return { present: false };
    if (isUnknownArray(value)) {
      if (!/^(0|[1-9]\d*)$/.test(key)) throw new Error('Invalid correction array index');
      value = value[Number(key)];
    } else value = value[key];
  }
  return { present: true, value };
}

function scope(pointer: string): string | undefined {
  const parts = segments(pointer);
  if (parts.length === 3 && parts[0] === 'components' && parts[1] === 'schemas' && parts[2]) {
    return 'schema-definition';
  }
  if (parts[0] !== 'paths' || !parts[1]?.startsWith('/') || !methods.has(parts[2] ?? '')) return;
  const tail = parts.slice(3);
  if (tail[0] === 'requestBody' && (
    tail.length === 1 || (tail.length === 2 && tail[1] === 'required')
    || (tail.length === 4 && tail[1] === 'content' && tail[3] === 'schema')
  )) return 'request-body-documentation';
  if (tail[0] === 'parameters' && /^(0|[1-9]\d*)$/.test(tail[1] ?? '') && (
    tail.length === 2 || (tail.length === 3 && ['required', 'schema'].includes(tail[2] ?? ''))
  )) return 'parameter-documentation';
  if (tail[0] === 'responses' && /^(?:[1-5]\d\d|default)$/.test(tail[1] ?? '') && (
    tail.length === 2 || (tail.length === 3 && ['content', 'description'].includes(tail[2] ?? ''))
    || (tail.length === 5 && tail[2] === 'content' && tail[4] === 'schema')
  )) return 'response-documentation';
}

function writeNode(document: RecordValue, reviewed: unknown, pointer: string, node: Node): void {
  const parts = segments(pointer);
  let parent: RecordValue | unknown[] = document;
  let walked = '';
  for (const key of parts.slice(0, -1)) {
    walked += `/${key.replace(/~/g, '~0').replace(/\//g, '~1')}`;
    let child: unknown = isUnknownArray(parent) ? parent[Number(key)] : parent[key];
    if (!Object.hasOwn(parent, key)) {
      if (isUnknownArray(parent) && (!/^(0|[1-9]\d*)$/.test(key) || Number(key) !== parent.length)) {
        throw new Error('Corrections cannot create gaps in intermediate parameter arrays');
      }
      const template = documentNode(reviewed, walked);
      if (!template.present || (!record(template.value) && !isUnknownArray(template.value))) {
        throw new Error('Missing document correction parent');
      }
      child = isUnknownArray(template.value) ? [] : {};
      Object.defineProperty(parent, key, { value: child, enumerable: true, writable: true, configurable: true });
    }
    if (!record(child) && !isUnknownArray(child)) throw new Error('Invalid document correction parent');
    parent = child;
  }
  const key = parts.at(-1);
  if (key === undefined) throw new Error('Empty correction pointer');
  if (isUnknownArray(parent)) {
    const index = Number(key);
    if (!node.present || !Number.isSafeInteger(index) || index < 0 || index > parent.length) {
      throw new Error('Corrections cannot remove or create gaps in parameter arrays');
    }
    parent[index] = node.value;
  } else if (node.present) {
    Object.defineProperty(parent, key, { value: node.value, enumerable: true, writable: true, configurable: true });
  } else delete parent[key];
}

export function parseOpenApiDocument(source: string): OpenApiDocument {
  const value: unknown = parseJson(source);
  if (!record(value) || typeof value["openapi"] !== 'string' || !record(value["paths"])
    || (value['components'] !== undefined && !record(value['components']))) {
    throw new Error('Invalid reviewed OpenAPI document');
  }
  return value;
}

/** 只修正经过逐项审查的旧文档节点，不把当前导出的变化当作自动批准。 */
export async function inspectReviewedOpenApi(
  legacySource: string,
  reviewedSource: string,
  ledgerSource: string,
  current: OpenApiDocument,
) {
  const ledger = decodeSchema(ledgerSchema, (parseJson(ledgerSource)));
  if (ledger.legacySha256 !== sha256(legacySource) || ledger.reviewedSha256 !== sha256(reviewedSource)) {
    throw new Error('Document correction baseline digest mismatch');
  }
  const legacy = parseOpenApiDocument(legacySource);
  const reviewed = parseOpenApiDocument(reviewedSource);
  const validate = createOpenApiValidationSession();
  // 固定旧文档含缺 description 的空响应；只允许经指纹记录修正后再通过完整标准校验。
  await validate(reviewed);
  await validate(current);
  const corrected = parseOpenApiDocument(legacySource);
  const pointers: string[] = [];
  for (const correction of ledger.corrections) {
    if (scope(correction.pointer) !== correction.kind) throw new Error('Correction exceeds its permitted scope');
    if (pointers.some(pointer => pointer === correction.pointer
      || pointer.startsWith(`${correction.pointer}/`) || correction.pointer.startsWith(`${pointer}/`))) {
      throw new Error('Duplicate or overlapping document corrections');
    }
    pointers.push(correction.pointer);
    const before = documentNode(legacy, correction.pointer);
    const after = documentNode(reviewed, correction.pointer);
    if (canonical(nodeFingerprint(before)) !== canonical(correction.before)
      || canonical(nodeFingerprint(after)) !== canonical(correction.after)) {
      throw new Error('Stale document correction fingerprint');
    }
    if (canonical(nodeFingerprint(before)) === canonical(nodeFingerprint(after))) {
      throw new Error('Unused document correction');
    }
    const testEvidence = (item: string) => item.startsWith('tests/')
      || /\/(?:__tests__|tests|__fixtures__|fixtures)\//u.test(item)
      || /\.(?:test|spec)\.[^/]+$/u.test(item);
    if (!correction.evidence.some(testEvidence)
      || !correction.evidence.some(item => item.startsWith('packages/') && !testEvidence(item))) {
      throw new Error('Document corrections require runtime source and test evidence');
    }
    writeNode(corrected, reviewed, correction.pointer, after);
  }
  await validate(corrected);
  const rawChanges = findOpenApiBreakingChanges(legacy, current);
  const residualChanges = findOpenApiBreakingChanges(corrected, current);
  const reviewedChanges = findOpenApiBreakingChanges(reviewed, current);
  return { rawChanges, residualChanges, reviewedChanges, corrections: pointers.length };
}
