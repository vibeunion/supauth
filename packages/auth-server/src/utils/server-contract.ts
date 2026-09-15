import type { TSchema } from '../../../shared/src/schema.js';
import { Type, TypeGuard, decodeSchema } from '../../../shared/src/schema.js';
import {
  type ServerResponseContract,
  type ServerRouteContract,
  decodeServerInput,
} from '../../../shared/src/server-contracts.js';
import { ApiContractError, isRecord } from './api-contract.js';

export interface ServerContractContext {
  body?: unknown;
  params?: unknown;
  query?: unknown;
  headers?: unknown;
  cookie?: unknown;
  request: Request;
  set: { status?: number | string | undefined };
}

interface ContractOptions {
  contract: ServerRouteContract;
  detail?: Record<string, unknown>;
  beforeValidate?: (context: ServerContractContext) => unknown | Promise<unknown>;
}

function inputFailure(): ApiContractError {
  return new ApiContractError(400, 'invalid_request_body', 'Request does not match the declared contract');
}

function outputFailure(): ApiContractError {
  return new ApiContractError(502, 'invalid_upstream_response', 'Response does not match the declared contract');
}

function mediaType(response: Response): string {
  return (response.headers.get('content-type') || 'text/plain').split(';')[0]?.trim().toLowerCase() || 'text/plain';
}

export function jsonWireValue(value: unknown): unknown {
  if (value === undefined) return value;
  // 只验证序列化后的公开值，不修改原对象、日期或已有 HTTP envelope。
  return JSON.parse(JSON.stringify(value));
}

function assertResponseContract(branch: ServerResponseContract): void {
  if (branch.alternatives) {
    if (!branch.alternatives.length || branch.kind !== 'protocol' || branch.schema) {
      throw new Error('Response alternatives require an explicit protocol branch');
    }
    for (const alternative of branch.alternatives) assertResponseContract(alternative);
    return;
  }
  if ((branch.kind === 'validated' || branch.kind === 'html' || branch.kind === 'protocol')
    && !branch.schema) {
    throw new Error('A concrete response schema is required');
  }
  if (branch.kind === 'binary' && !branch.contentTypes?.length) {
    throw new Error('Binary responses require explicit content types');
  }
}

export async function validateServerResponse(
  contract: ServerRouteContract,
  value: unknown,
  status = 200,
): Promise<void> {
  const actualStatus = value instanceof Response ? value.status : status;
  const responseContract = contract.responses[actualStatus];
  if (!responseContract) throw outputFailure();
  try {
    await validateResponseBranch(responseContract, value);
  } catch {
    // 不传播校验器路径、原始输入、密码或上游报文。
    throw outputFailure();
  }
}

async function validateResponseBranch(contract: ServerResponseContract, value: unknown): Promise<void> {
  if (contract.alternatives) {
    for (const alternative of contract.alternatives) {
      try {
        await validateResponseBranch(alternative, value);
        return;
      } catch {
        // 同状态的 JSON/空体兼容分支独立验证，不修改原始响应。
      }
    }
    throw outputFailure();
  }
  if (value instanceof Response) {
    if (contract.contentTypes && !contract.contentTypes.includes(mediaType(value))) throw outputFailure();
    if (contract.headers) decodeSchema(contract.headers, Object.fromEntries(value.headers));
  }
  if (contract.kind === 'empty') {
    if (value instanceof Response) {
      if ((await value.clone().arrayBuffer()).byteLength !== 0) throw outputFailure();
    } else if (value !== undefined && value !== null) throw outputFailure();
    return;
  }
  if (contract.kind === 'redirect') {
    if (!(value instanceof Response) || value.status < 300 || value.status >= 400
      || !value.headers.get('location')) throw outputFailure();
    if (contract.schema) decodeSchema(contract.schema, value.headers.get('location'));
    return;
  }
  if (contract.kind === 'binary') {
    if (!(value instanceof Response) || !contract.contentTypes?.length || value.body === null) throw outputFailure();
    return;
  }
  if (!contract.schema) throw outputFailure();
  if (value instanceof Response) {
    // Response.json() 返回值也必须经过同一个领域 schema，不能绕过输出校验。
    const wireValue: unknown = mediaType(value) === 'application/json' || mediaType(value).endsWith('+json')
      ? await value.clone().json()
      : await value.clone().text();
    decodeSchema(contract.schema, wireValue);
  } else {
    decodeSchema(contract.schema, jsonWireValue(value));
  }
}

function schemaBranches(schema: TSchema, keyword: string): TSchema[] {
  const value: unknown = schema[keyword];
  if (value === undefined) return [];
  if (!Array.isArray(value)) throw new Error('Schema branches must be an array');
  const candidates: unknown[] = value;
  const branches: TSchema[] = [];
  for (const candidate of candidates) {
    if (!TypeGuard.IsSchema(candidate)) throw new Error('Schema branch must be a TypeBox schema');
    branches.push(candidate);
  }
  return branches;
}

function schemaRequiredFields(schema: TSchema): string[] {
  const value: unknown = schema["required"];
  if (value === undefined) return [];
  if (!Array.isArray(value)) throw new Error('Schema required fields must be an array');
  const candidates: unknown[] = value;
  const fields: string[] = [];
  for (const candidate of candidates) {
    if (typeof candidate !== 'string') throw new Error('Schema required field must be a string');
    fields.push(candidate);
  }
  return fields;
}

function schemaFields(schema: TSchema): Record<string, TSchema> {
  const result = new Map<string, TSchema>();
  // TypeBox 的扩展关键字使用开放索引；先接 unknown，再校验每个子 schema。
  const properties: unknown = schema["properties"];
  if (properties !== undefined) {
    if (!isRecord(properties)) throw new Error('Schema properties must be a record');
    for (const [key, field] of Object.entries(properties)) {
      if (!TypeGuard.IsSchema(field)) throw new Error('Schema property must be a TypeBox schema');
      result.set(key, field);
    }
  }
  for (const keyword of ['anyOf', 'oneOf', 'allOf'] as const) {
    const branches = schemaBranches(schema, keyword);
    if (!branches.length) continue;
    const fields = branches.map(schemaFields);
    for (const key of new Set(fields.flatMap(branch => Object.keys(branch)))) {
      const variants = fields.flatMap(branch => {
        if (!Object.hasOwn(branch, key)) return [];
        const variant = branch[key];
        return variant ? [variant] : [];
      });
      const first = variants[0];
      if (!first) throw new Error('Schema field has no variant');
      const projected = variants.length === 1 ? first
        : keyword === 'allOf' ? Type.Intersect(variants) : Type.Union(variants);
      const existing = result.get(key);
      result.set(key, existing ? Type.Intersect([existing, projected]) : projected);
    }
  }
  return Object.fromEntries(result);
}

function requiresField(schema: TSchema, key: string): boolean {
  if (schemaRequiredFields(schema).includes(key)) return true;
  const all = schemaBranches(schema, 'allOf');
  if (all.some(branch => requiresField(branch, key))) return true;
  return ['anyOf', 'oneOf'].some(keyword => {
    const branches = schemaBranches(schema, keyword);
    return branches.length > 0 && branches.every(branch => requiresField(branch, key));
  });
}

function numericQuery(input: unknown, schema: TSchema | undefined): unknown {
  if (!input || typeof input !== 'object' || !schema) return input;
  const record: Record<string, unknown> = { ...input };
  for (const [name, field] of Object.entries(schemaFields(schema))) {
    const fieldType: unknown = field["type"];
    if ((fieldType === 'number' || fieldType === 'integer') && typeof record[name] === 'string') {
      record[name] = Number(record[name]);
    }
  }
  return record;
}

function inputDocumentation(input: TSchema) {
  const properties = schemaFields(input);
  const body = properties["body"];
  const parameters = Object.entries({ params: 'path', query: 'query', headers: 'header' } as const).flatMap(([key, location]) => {
    const schema = properties[key];
    return Object.entries(schema ? schemaFields(schema) : {}).map(([name, field]) => ({
      name,
      in: location,
      required: location === 'path' || (schema ? requiresField(input, key) && requiresField(schema, name) : false),
      schema: field,
    }));
  });
  return {
    'x-supauth-input-schema': input,
    ...(body ? { requestBody: {
      required: requiresField(input, 'body'),
      content: { 'application/json': { schema: body } },
    } } : {}),
    ...(parameters.length ? { parameters } : {}),
  };
}

export function serverContract<const O extends ContractOptions>(source: string, options: O) {
  const { contract, beforeValidate, detail, ...routeOptions } = options;
  if (!source || !Object.keys(contract.responses).length) throw new Error('A complete route contract is required');
  if ((contract.request === 'raw-signed' || contract.request === 'protocol') && !beforeValidate) {
    throw new Error('Protocol requests require an explicit verifier');
  }
  for (const branch of Object.values(contract.responses)) assertResponseContract(branch);
  const success = contract.responses[200] || contract.responses[201] || contract.responses[204]
    || Object.values(contract.responses)[0];
  if (!success) throw new Error('A response contract is required');
  const contentEntries = (schema: TSchema, contentTypes: readonly string[] = ['application/json']) => (
    contentTypes.map((type): [string, { schema: TSchema }] => [type, { schema }])
  );
  const responses = Object.fromEntries(Object.entries(contract.responses).map(([status, branch]) => [
    status,
    {
      description: branch.kind,
      ...(branch.alternatives ? {
        'x-supauth-response-alternatives': branch.alternatives.map(item => item.kind),
        content: Object.fromEntries(branch.alternatives.flatMap(item => item.schema
          ? contentEntries(item.schema, item.contentTypes)
          : [])),
      } : {}),
      ...(branch.schema ? {
        content: Object.fromEntries(contentEntries(branch.schema, branch.contentTypes)),
      } : {}),
    },
  ]));
  return {
    ...routeOptions,
    detail: {
      ...detail,
      ...inputDocumentation(contract.input),
      responses,
      ...(contract.hidden ? { hide: true } : {}),
      'x-supauth-contract': {
        request: contract.request,
        response: success.kind,
        source,
        ...(contract.retired ? { retired: true } : {}),
      },
    },
    beforeHandle: async (context: ServerContractContext) => {
      const earlyResponse = await beforeValidate?.(context);
      if (earlyResponse !== undefined) return earlyResponse;
      // raw-signed 的原始字节与认证顺序由对应 ceremony 的专用校验器负责。
      if (contract.request === 'raw-signed' || contract.request === 'protocol') return;
      const properties = schemaFields(contract.input);
      const headerNames = properties["headers"] ? Object.keys(schemaFields(properties["headers"])) : [];
      const headers = headerNames.length && !requiresField(contract.input, 'headers')
        && !headerNames.some(name => context.request.headers.has(name))
        ? undefined : Object.fromEntries(context.request.headers);
      const input = Object.fromEntries(Object.keys(properties).map((key): [string, unknown] => {
        if (key === 'query') return [key, numericQuery(context.query, properties["query"])];
        if (key === 'headers') return [key, headers];
        if (key === 'params' || key === 'body' || key === 'cookie') return [key, context[key]];
        throw new Error('Unsupported request contract field');
      }).filter(([, value]) => value !== undefined));
      try {
        decodeServerInput(contract, input);
      } catch {
        throw inputFailure();
      }
    },
    afterHandle: async (context: {
      responseValue: unknown;
      set: { status?: number | string | undefined };
    }) => {
      await validateServerResponse(contract, context.responseValue, Number(context.set.status || 200));
    },
  };
}
