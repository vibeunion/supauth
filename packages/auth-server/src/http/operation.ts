import { decodeSchema, type TSchema } from '../../../shared/src/schema.js';
import { mapObservedError } from '../middleware/index.js';
import { ApiContractError } from '../utils/api-contract.js';
import {
  SERVER_CONTRACT_METADATA,
  type ServerContractContext,
  type ServerContractMetadataCarrier,
  type ServerContractVerifier,
} from '../utils/server-contract.js';

export interface HttpInvocation {
  request: Request;
  params?: Record<string, unknown>;
  query?: Record<string, unknown>;
  body?: unknown;
  headers?: Record<string, unknown>;
  context?: unknown;
}

type SegmentParameter<Segment extends string> =
  Segment extends `:${infer Name}` ? Name : Segment extends '*' ? '*' : never;

type PathParameters<Path extends string> =
  string extends Path ? string
    : Path extends `${infer Segment}/${infer Rest}`
      ? SegmentParameter<Segment> | PathParameters<Rest>
      : SegmentParameter<Path>;

export interface HttpOperationContext<Path extends string = string> {
  request: Request;
  body: unknown;
  params: { [Key in PathParameters<Path>]: string };
  query: Record<string, string | undefined>;
  headers: Record<string, string | undefined>;
  set: {
    status?: number | string;
    headers: Record<string, string | number>;
  };
  context?: unknown;
}

export type HttpOperationExecutor<Path extends string, Result = unknown> =
  (context: HttpOperationContext<Path>) => Result | Promise<Result>;

export interface HttpOperationOptions extends Partial<ServerContractMetadataCarrier> {
  body?: TSchema;
  parse?: 'none';
  detail?: Record<string, unknown>;
  beforeParse?: (request: Request) => Response | null | undefined | Promise<Response | null | undefined>;
  beforeHandle?: ServerContractVerifier;
  afterHandle?: (context: ServerContractContext & {
    responseValue: unknown;
    set: HttpOperationContext['set'];
  }) => unknown | Promise<unknown>;
  onError?: (error: unknown) => Response | undefined | Promise<Response | undefined>;
}

export interface HttpOperation<Path extends string = string, Result = unknown> {
  readonly method: string;
  readonly path: Path;
  readonly options: HttpOperationOptions;
  readonly execute: HttpOperationExecutor<Path, Result>;
  invoke(input: HttpInvocation, executor?: HttpOperationExecutor<Path, Result>): Promise<Response>;
}

function invalidInput(): ApiContractError {
  return new ApiContractError(400, 'invalid_request_body', 'Request does not match the declared contract');
}

function operationParams<Path extends string>(
  path: Path,
  input: Record<string, unknown> = {},
): HttpOperationContext<Path>['params'] {
  const entries: [string, string][] = [];
  for (const segment of path.split('/')) {
    const name = segment.startsWith(':') ? segment.slice(1) : segment === '*' ? '*' : undefined;
    if (name === undefined) continue;
    const value = Object.hasOwn(input, name) ? input[name] : undefined;
    if (typeof value !== 'string' || (name !== '*' && !value.length)) throw invalidInput();
    entries.push([name, value]);
  }
  // 每个路径参数都已逐项验证；只暴露路径声明的字符串字段。
  return Object.fromEntries(entries) as HttpOperationContext<Path>['params'];
}

function stringFields(input: Record<string, unknown>): Record<string, string | undefined> {
  const entries: [string, string | undefined][] = [];
  for (const [name, value] of Object.entries(input)) {
    if (value !== undefined && typeof value !== 'string') throw invalidInput();
    entries.push([name, value]);
  }
  return Object.fromEntries(entries);
}

async function invocationBody(input: HttpInvocation, options: HttpOperationOptions): Promise<unknown> {
  if (Object.hasOwn(input, 'body') && input.body !== undefined) return input.body;
  const { request } = input;
  if (options.parse === 'none' || request.method === 'GET' || request.method === 'HEAD'
    || request.body === null) return undefined;
  try {
    // 原件留给协议校验和签名 handler；禁止通用解析消耗原始字节。
    const copy = request.clone();
    const mediaType = request.headers.get('content-type')?.split(';')[0]?.trim().toLowerCase();
    if (mediaType === 'application/json' || mediaType?.endsWith('+json')) {
      const text = await copy.text();
      return text.length ? JSON.parse(text) : undefined;
    }
    if (mediaType === 'multipart/form-data' || mediaType === 'application/x-www-form-urlencoded') {
      const form = await copy.formData();
      return Object.fromEntries([...new Set(form.keys())].map(name => {
        const values = form.getAll(name);
        return [name, values.length === 1 ? values[0] : values];
      }));
    }
    if (!mediaType || mediaType.startsWith('text/')) return await copy.text();
    return await copy.arrayBuffer();
  } catch {
    throw new ApiContractError(400, 'invalid_request', 'Invalid request');
  }
}

function responseStatus(status: number | string | undefined): number {
  if (status === undefined) return 200;
  const code = typeof status === 'number' || /^\d{3}$/.test(status)
    ? Number(status)
    : HTTP_STATUS_CODES[status];
  if (code === undefined || !Number.isInteger(code) || code < 200 || code > 599) {
    throw new ApiContractError(502, 'invalid_upstream_response', 'Invalid response status');
  }
  return code;
}

// Keep named status support without loading Node's `http` builtin in tenant code.
const HTTP_STATUS_CODES: Record<string, number | undefined> = {
  Continue: 100,
  'Switching Protocols': 101,
  Processing: 102,
  'Early Hints': 103,
  OK: 200,
  Created: 201,
  Accepted: 202,
  'Non-Authoritative Information': 203,
  'No Content': 204,
  'Reset Content': 205,
  'Partial Content': 206,
  'Multi-Status': 207,
  'Already Reported': 208,
  'IM Used': 226,
  'Multiple Choices': 300,
  'Moved Permanently': 301,
  Found: 302,
  'See Other': 303,
  'Not Modified': 304,
  'Use Proxy': 305,
  'Temporary Redirect': 307,
  'Permanent Redirect': 308,
  'Bad Request': 400,
  Unauthorized: 401,
  'Payment Required': 402,
  Forbidden: 403,
  'Not Found': 404,
  'Method Not Allowed': 405,
  'Not Acceptable': 406,
  'Proxy Authentication Required': 407,
  'Request Timeout': 408,
  Conflict: 409,
  Gone: 410,
  'Length Required': 411,
  'Precondition Failed': 412,
  'Payload Too Large': 413,
  'URI Too Long': 414,
  'Unsupported Media Type': 415,
  'Range Not Satisfiable': 416,
  'Expectation Failed': 417,
  "I'm a Teapot": 418,
  'Misdirected Request': 421,
  'Unprocessable Entity': 422,
  Locked: 423,
  'Failed Dependency': 424,
  'Too Early': 425,
  'Upgrade Required': 426,
  'Precondition Required': 428,
  'Too Many Requests': 429,
  'Request Header Fields Too Large': 431,
  'Unavailable For Legal Reasons': 451,
  'Internal Server Error': 500,
  'Not Implemented': 501,
  'Bad Gateway': 502,
  'Service Unavailable': 503,
  'Gateway Timeout': 504,
  'HTTP Version Not Supported': 505,
  'Variant Also Negotiates': 506,
  'Insufficient Storage': 507,
  'Loop Detected': 508,
  'Bandwidth Limit Exceeded': 509,
  'Not Extended': 510,
  'Network Authentication Required': 511,
};

function responseHeaders(set: HttpOperationContext['set']): Headers {
  return new Headers(Object.entries(set.headers).map(([name, value]): [string, string] => [name, String(value)]));
}

function operationResponse(value: unknown, set: HttpOperationContext['set']): Response {
  const headers = responseHeaders(set);
  if (value instanceof Response) {
    if ([...headers].length === 0) return value;
    const merged = new Headers(value.headers);
    for (const [name, content] of headers) {
      if (name === 'set-cookie') merged.append(name, content);
      else if (!merged.has(name)) merged.set(name, content);
    }
    return new Response(value.body, {
      status: value.status, statusText: value.statusText, headers: merged,
    });
  }
  const status = responseStatus(set.status);
  if (status === 204 || status === 205 || status === 304) {
    if (value !== undefined && value !== null && value !== '') {
      throw new ApiContractError(502, 'invalid_upstream_response', 'Empty response status has a body');
    }
    return new Response(null, { status, headers });
  }
  if (value === undefined || value === null) return new Response(null, { status, headers });
  if (ArrayBuffer.isView(value)) {
    const bytes = new Uint8Array(value.byteLength);
    bytes.set(new Uint8Array(value.buffer, value.byteOffset, value.byteLength));
    return new Response(bytes, { status, headers });
  }
  if (typeof value === 'string' || value instanceof Blob || value instanceof ArrayBuffer
    || value instanceof FormData || value instanceof URLSearchParams
    || value instanceof ReadableStream) {
    return new Response(value, { status, headers });
  }
  return Response.json(value, { status, headers });
}

function headResponse(request: Request, response: Response): Response {
  return request.method === 'HEAD'
    ? new Response(null, { status: response.status, statusText: response.statusText, headers: response.headers })
    : response;
}

export function defineHttpOperation<const Path extends string, Result>(
  method: string,
  path: Path,
  handler: HttpOperationExecutor<Path, Result>,
  options: HttpOperationOptions = {},
): HttpOperation<Path, Result> {
  return {
    method: method.toUpperCase(),
    path,
    options,
    execute: handler,
    async invoke(input, executor = handler) {
      try {
        // 协议认证先于解析；拒绝响应不进入业务 handler 或成功 receipt 校验。
        const rejected = await options.beforeParse?.(input.request);
        if (rejected instanceof Response) return headResponse(input.request, rejected);
        const context: HttpOperationContext<Path> = {
          request: input.request,
          params: operationParams(path, input.params),
          query: stringFields(input.query ?? Object.fromEntries(new URL(input.request.url).searchParams)),
          headers: stringFields(input.headers ?? Object.fromEntries(input.request.headers)),
          body: await invocationBody(input, options),
          set: { headers: {} },
          ...(input.context === undefined ? {} : { context: input.context }),
        };
        if (options.body) {
          try {
            decodeSchema(options.body, context.body);
          } catch {
            throw new ApiContractError(422, 'validation_error', 'Request validation failed');
          }
        }
        // metadata 保存最终有效钩子；account receipt 只能在业务 handler 后检查。
        const metadata = options[SERVER_CONTRACT_METADATA];
        const before = metadata ? metadata.beforeRequest : options.beforeHandle;
        const after = metadata ? metadata.afterResponse : options.afterHandle;
        const early = await before?.(context);
        const value = early === undefined ? await executor(context) : early;
        await after?.({ ...context, responseValue: value });
        const response = operationResponse(value, context.set);
        return headResponse(input.request, response);
      } catch (error) {
        const recovered = await options.onError?.(error);
        if (recovered !== undefined) return headResponse(input.request, recovered);
        const failure = mapObservedError(input.request, error);
        return headResponse(input.request, Response.json(failure.body, { status: failure.status }));
      }
    },
  };
}

export function defineHttpOperations<
  const Prefix extends string,
  const Operations extends Record<string, { readonly method: string; readonly path: string }>,
>(config: { prefix: Prefix }, operations: Operations): { readonly prefix: Prefix; readonly operations: Operations } {
  return { prefix: config.prefix, operations };
}
