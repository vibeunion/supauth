import { getAdminAccessToken } from "./auth-token";

const API_BASE = import.meta.env.VITE_AUTH_SERVER_URL || "/api";

type AdminFetch = (
  input: RequestInfo | URL,
  init?: RequestInit,
) => Promise<Response>;

let refreshAwareFetch: AdminFetch | null = null;

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
  const response = await authenticatedAdminResponse(path, options);
  if (response.status === 204) return null;
  const responseBody = await readResponseBody(response);
  return responseBody ?? null;
}

export async function adminApiBlob(
  path: string,
  options: RequestInit = {},
): Promise<Blob> {
  const response = await authenticatedAdminResponse(path, options);
  return response.blob();
}
