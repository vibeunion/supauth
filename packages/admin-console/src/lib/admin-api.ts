import { getAdminAccessToken } from "./auth-token";

const API_BASE = import.meta.env.VITE_AUTH_SERVER_URL || "/api";

type AdminFetch = (
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

interface AdminRequestBoundaryOptions {
  signal?: AbortSignal | null;
  timeoutMs?: number;
}

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
    && (error as { name?: unknown }).name === "AbortError";
}

function createAdminRequestBoundary(
  options: AdminRequestBoundaryOptions,
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
  options: AdminRequestBoundaryOptions = {},
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
  return typeof candidate === "object" && candidate !== null
    ? (candidate as Record<string, unknown>)
    : null;
}

async function readResponseBody(response: Response): Promise<unknown> {
  const text = await response.text();
  if (!text) return undefined;
  try {
    return JSON.parse(text) as unknown;
  } catch {
    return text;
  }
}

async function createAdminApiError(response: Response): Promise<AdminApiError> {
  const responseBody = await readResponseBody(response);
  const responseRecord = asRecord(responseBody);
  const nestedErrorRecord = asRecord(responseRecord?.error);
  const retryExhausted =
    response.headers.get("X-Svadmin-Auth-Retry") === "exhausted";
  const code = retryExhausted
    ? "auth_retry_exhausted"
    : [
        responseRecord?.code,
        responseRecord?.error_code,
        nestedErrorRecord?.code,
        nestedErrorRecord?.error_code,
      ].find((candidate): candidate is string => typeof candidate === "string");
  const responseMessage =
    [
      responseRecord?.message,
      nestedErrorRecord?.message,
      responseRecord?.error_description,
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
): Promise<Response> {
  const headers = new Headers(options.headers);
  if (!headers.has("Content-Type"))
    headers.set("Content-Type", "application/json");

  const fetcher = refreshAwareFetch ?? globalThis.fetch.bind(globalThis);
  if (!refreshAwareFetch) {
    const token = await getAdminAccessToken();
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
  options: RequestInit = {},
): Promise<unknown> {
  return runBoundedAdminRequest(async (signal) => {
    const response = await authenticatedAdminResponse(path, {
      ...options,
      signal,
    });
    if (response.status === 204) return null;
    const responseBody = await readResponseBody(response);
    return responseBody ?? null;
  }, { signal: options.signal });
}

export async function adminApiBlob(
  path: string,
  options: RequestInit = {},
): Promise<Blob> {
  return runBoundedAdminRequest(async (signal) => {
    const response = await authenticatedAdminResponse(path, {
      ...options,
      signal,
    });
    return response.blob();
  }, { signal: options.signal });
}
