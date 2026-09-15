import { getAdminAccessToken, getCurrentAdminAccessToken } from "./auth-token";
import { isUnknownRecord } from "./unknown-value.js";
import {
  Type,
  JsonValueSchema,
  decodeSchema,
  type Static,
  type TSchema,
  type SdkEndpoint,
} from "@supauth/shared";

const AdminApiBaseSchema = Type.String();

export function resolveAdminApiBase(value: unknown): string {
  if (value === undefined) return "/api";
  return decodeSchema(AdminApiBaseSchema, value) || "/api";
}

const API_BASE = resolveAdminApiBase(import.meta.env["VITE_AUTH_SERVER_URL"]);

export type AdminFetch = (
  input: RequestInfo | URL,
  init?: RequestInit,
) => Promise<Response>;

let refreshAwareFetch: AdminFetch | null = null;

export const ADMIN_REQUEST_TIMEOUT_MS = 8_000;

export class AdminApiError extends Error {
  constructor(
    message: string,
    public readonly statusCode: number,
    public readonly code?: string,
    public readonly body?: unknown,
  ) {
    super(message);
    this.name = "AdminApiError";
  }
}

export interface AdminRequestOptions {
  signal?: AbortSignal | null;
  timeoutMs?: number;
  authenticationRetry?: "never";
}

type AdminRawRequestOptions = RequestInit & Pick<AdminRequestOptions, "timeoutMs">;

type AdminRequestInterruptionCode = "request_timeout" | "request_aborted";

interface AdminRequestBoundary {
  signal: AbortSignal;
  interrupted: Promise<never>;
  dispose(): void;
}

function interruptedAdminRequest(code: AdminRequestInterruptionCode) {
  const message = code === "request_timeout"
    ? "Admin API request timed out"
    : "Admin API request was cancelled";
  return new AdminApiError(message, 0, code);
}

function isAbortError(error: unknown): boolean {
  return typeof error === "object"
    && error !== null
    && "name" in error
    && error.name === "AbortError";
}

function createAdminRequestBoundary(
  options: AdminRequestOptions,
): AdminRequestBoundary {
  const controller = new AbortController();
  let rejectInterruption = (_error: AdminApiError) => {};
  const interrupted = new Promise<never>((_, reject) => {
    rejectInterruption = reject;
  });
  const interrupt = (code: AdminRequestInterruptionCode) => {
    rejectInterruption(interruptedAdminRequest(code));
    controller.abort();
  };
  const callerAbort = () => interrupt("request_aborted");
  options.signal?.addEventListener("abort", callerAbort, { once: true });
  const timeoutId = setTimeout(
    () => interrupt("request_timeout"),
    options.timeoutMs ?? ADMIN_REQUEST_TIMEOUT_MS,
  );
  return {
    signal: controller.signal,
    interrupted,
    dispose() {
      clearTimeout(timeoutId);
      options.signal?.removeEventListener("abort", callerAbort);
    },
  };
}

export async function runBoundedAdminRequest<T>(
  operation: (signal: AbortSignal) => Promise<T>,
  options: AdminRequestOptions = {},
): Promise<T> {
  if (options.signal?.aborted)
    throw interruptedAdminRequest("request_aborted");

  const boundary = createAdminRequestBoundary(options);

  try {
    return await Promise.race([
      Promise.resolve().then(() => operation(boundary.signal)),
      boundary.interrupted,
    ]);
  } catch (error) {
    if (!isAbortError(error) || error instanceof AdminApiError) throw error;
    throw interruptedAdminRequest("request_aborted");
  } finally {
    boundary.dispose();
  }
}

export function setAdminAuthenticatedFetch(fetcher: AdminFetch | null): void {
  refreshAwareFetch = fetcher;
}

function asRecord(candidate: unknown): Record<string, unknown> | null {
  return isUnknownRecord(candidate) ? candidate : null;
}

async function readResponseBody(response: Response): Promise<unknown> {
  const text = await response.text();
  if (!text) return undefined;
  try {
    const value: unknown = JSON.parse(text);
    return value;
  } catch {
    return text;
  }
}

async function createAdminApiError(response: Response): Promise<AdminApiError> {
  const responseBody = await readResponseBody(response);
  const responseRecord = asRecord(responseBody);
  const nestedErrorRecord = asRecord(responseRecord?.["error"]);
  const retryExhausted =
    response.headers.get("X-Svadmin-Auth-Retry") === "exhausted";
  const code = retryExhausted
    ? "auth_retry_exhausted"
    : [
        responseRecord?.["code"],
        responseRecord?.["error_code"],
        nestedErrorRecord?.["code"],
        nestedErrorRecord?.["error_code"],
      ].find((candidate): candidate is string => typeof candidate === "string");
  const responseMessage =
    [
      responseRecord?.["message"],
      nestedErrorRecord?.["message"],
      responseRecord?.["error_description"],
      responseBody,
    ].find((candidate): candidate is string => typeof candidate === "string") ||
    response.statusText ||
    `Admin API ${response.status}`;
  const statusLabel =
    response.status === 403
      ? "Forbidden"
      : response.status === 404
        ? "Not Found"
        : response.status === 501
          ? "Capability Unavailable"
          : response.status === 503
            ? "Service Unavailable"
            : "";
  const message = statusLabel
    ? `[${response.status} ${statusLabel}] ${responseMessage}`
    : responseMessage;
  return new AdminApiError(message, response.status, code, responseBody);
}

async function authenticatedAdminResponse(
  path: string,
  options: RequestInit = {},
  authenticationRetry?: AdminRequestOptions["authenticationRetry"],
): Promise<Response> {
  const headers = new Headers(options.headers);
  if (!headers.has("Content-Type"))
    headers.set("Content-Type", "application/json");

  // 写后 401 可能来自审计，不能让认证客户端在内部重放写请求。
  const singleAttempt = authenticationRetry === "never";
  const fetcher = singleAttempt
    ? globalThis.fetch.bind(globalThis)
    : refreshAwareFetch ?? globalThis.fetch.bind(globalThis);
  if (singleAttempt || !refreshAwareFetch) {
    const token = await (singleAttempt ? getCurrentAdminAccessToken() : getAdminAccessToken());
    if (singleAttempt) {
      if (options.signal?.aborted) throw interruptedAdminRequest("request_aborted");
      if (!token) {
        throw new AdminApiError("Admin API request requires an active session", 401, "session_not_found");
      }
    }
    if (token) headers.set("Authorization", `Bearer ${token}`);
  }
  const response = await fetcher(`${API_BASE}${path}`, {
    ...options,
    headers,
    credentials: "include",
  });
  if (!response.ok) throw await createAdminApiError(response);
  return response;
}

export async function adminApiRequest(
  path: string,
  options: AdminRawRequestOptions = {},
): Promise<unknown> {
  const { timeoutMs, ...requestOptions } = options;
  return runBoundedAdminRequest(async (signal) => {
    const response = await authenticatedAdminResponse(path, {
      ...requestOptions,
      signal,
    });
    if (response.status === 204) return null;
    const responseBody = await readResponseBody(response);
    return responseBody ?? null;
  }, requestBoundaryOptions(options.signal, timeoutMs));
}

export async function adminApiBlob(
  path: string,
  options: AdminRawRequestOptions = {},
): Promise<Blob> {
  const { timeoutMs, ...requestOptions } = options;
  return runBoundedAdminRequest(async (signal) => {
    const response = await authenticatedAdminResponse(path, {
      ...requestOptions,
      signal,
    });
    return response.blob();
  }, requestBoundaryOptions(options.signal, timeoutMs));
}

function requestBoundaryOptions(
  signal: AbortSignal | null | undefined,
  timeoutMs: number | undefined,
): AdminRequestOptions {
  return {
    ...(signal === undefined ? {} : { signal }),
    ...(timeoutMs === undefined ? {} : { timeoutMs }),
  };
}

const EndpointEnvelopeSchema = Type.Object({
  params: Type.Optional(Type.Record(Type.String(), Type.String())),
  query: Type.Optional(Type.Record(Type.String(), Type.Union([Type.String(), Type.Number(), Type.Boolean()]))),
  body: Type.Optional(JsonValueSchema),
  headers: Type.Optional(Type.Record(Type.String(), Type.String())),
  upload: Type.Optional(Type.Object({ size: Type.Number(), type: Type.String() })),
}, { additionalProperties: false });

function invalidEndpointInput(): AdminApiError {
  return new AdminApiError("Admin API request does not match its contract", 400, "invalid_request");
}

function endpointRequest<I extends TSchema, R extends TSchema>(
  contract: SdkEndpoint<I, R>,
  input: unknown,
  binaryBody?: Blob,
): { path: string; options: RequestInit } {
  try {
    const validated = decodeSchema(EndpointEnvelopeSchema, decodeSchema(contract.input, input));
    if (validated.upload) {
      if (!(binaryBody instanceof Blob) || binaryBody.size !== validated.upload.size
        || validated.headers?.["Content-Type"] !== validated.upload.type || validated.body !== undefined) {
        throw invalidEndpointInput();
      }
    } else if (binaryBody !== undefined) {
      throw invalidEndpointInput();
    }
    const path = contract.path.replace(/([:*])([A-Za-z][A-Za-z0-9_]*)/g, (_match, kind: string, name: string) => {
      const value = validated.params?.[name];
      if (!value) throw invalidEndpointInput();
      const segments = kind === "*" ? value.split("/") : [value];
      if (segments.some((segment) => !segment || segment === "." || segment === "..")) throw invalidEndpointInput();
      return segments.map((segment) => encodeURIComponent(segment)).join("/");
    });
    const query = new URLSearchParams();
    for (const [key, value] of Object.entries(validated.query ?? {})) {
      const text = String(value).trim();
      if (text !== "") query.set(key, text);
    }
    return {
      path: `${path}${query.size ? `?${query}` : ""}`,
      options: {
        method: contract.method,
        ...(validated.headers === undefined ? {} : { headers: validated.headers }),
        ...(binaryBody !== undefined ? { body: binaryBody }
          : validated.body === undefined ? {} : { body: JSON.stringify(validated.body) }),
      },
    };
  } catch {
    throw invalidEndpointInput();
  }
}

export function adminEndpointRequest<I extends TSchema, R extends TSchema>(
  contract: SdkEndpoint<I, R> & { responseKind: "json" },
  input: NoInfer<Static<I>>,
  options?: AdminRequestOptions,
): Promise<Static<R>>;
export function adminEndpointRequest<I extends TSchema, R extends TSchema>(
  contract: SdkEndpoint<I, R> & { responseKind: "void" },
  input: NoInfer<Static<I>>,
  options?: AdminRequestOptions,
): Promise<null>;
export function adminEndpointRequest<I extends TSchema, R extends TSchema>(
  contract: SdkEndpoint<I, R> & { responseKind: "blob" },
  input: NoInfer<Static<I>>,
  options?: AdminRequestOptions,
): Promise<Blob>;
export function adminEndpointRequest<I extends TSchema, R extends TSchema>(
  contract: SdkEndpoint<I, R>,
  input: Static<I>,
  options: AdminRequestOptions = {},
): Promise<Static<R> | Blob | null> {
  return executeAdminEndpoint(contract, input, options);
}

export function adminUploadRequest<I extends TSchema, R extends TSchema>(
  contract: SdkEndpoint<I, R> & { responseKind: "json" },
  input: Omit<NoInfer<Static<I>>, "upload">,
  body: Blob,
  options: AdminRequestOptions = {},
): Promise<Static<R>> {
  return runBoundedAdminRequest(async (signal) => {
    if (!(body instanceof Blob)) throw invalidEndpointInput();
    let headers: Static<typeof EndpointEnvelopeSchema>["headers"];
    try {
      headers = decodeSchema(EndpointEnvelopeSchema, input).headers;
    } catch {
      throw invalidEndpointInput();
    }
    const request = endpointRequest(contract, {
      ...input,
      upload: { size: body.size, type: headers?.["Content-Type"] },
    }, body);
    const response = await authenticatedAdminResponse(
      request.path, { ...request.options, signal }, options.authenticationRetry,
    );
    return decodeEndpointResponse(contract.result, response);
  }, options);
}

async function decodeEndpointResponse<R extends TSchema>(schema: R, response: Response): Promise<Static<R>> {
  const value = await readResponseBody(response);
  try {
    return decodeSchema(schema, value);
  } catch {
    // 不保留原始响应或字段路径，避免契约错误泄漏一次性凭据。
    throw new AdminApiError("Admin API response does not match its contract", 502, "invalid_upstream_response");
  }
}

function executeAdminEndpoint<I extends TSchema, R extends TSchema>(
  contract: SdkEndpoint<I, R>,
  input: Static<I>,
  options: AdminRequestOptions,
): Promise<Static<R> | Blob | null> {
  return runBoundedAdminRequest(async (signal) => {
    const request = endpointRequest(contract, input);
    const response = await authenticatedAdminResponse(
      request.path, { ...request.options, signal }, options.authenticationRetry,
    );
    if (contract.responseKind === "blob") return response.blob();
    if (contract.responseKind === "void") {
      await response.body?.cancel();
      return null;
    }
    return decodeEndpointResponse(contract.result, response);
  }, options);
}
