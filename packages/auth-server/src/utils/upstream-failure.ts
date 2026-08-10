export interface PublicUpstreamFailure {
  ok: false;
  status: number;
  code: string;
  message: string;
}

export interface UpstreamBadRequestContext {
  code: string;
  message: string;
}

const INVALID_CREDENTIAL_CODES = new Set([
  'invalid_credentials',
  'invalid_login_credentials',
]);

const INVALID_CREDENTIAL_MESSAGES = new Set([
  'invalid credentials',
  'invalid login credentials',
]);

function isRecord(input: unknown): input is Record<string, unknown> {
  return typeof input === 'object' && input !== null && !Array.isArray(input);
}

function normalizedPayloadStrings(payload: unknown) {
  if (!isRecord(payload)) return [];
  return ['code', 'error_code', 'message', 'msg', 'error_description', 'error']
    .flatMap((field) => typeof payload[field] === 'string' ? [payload[field].trim().toLowerCase()] : []);
}

export function isInvalidCredentialsResponse(status: number, payload: unknown) {
  if (status !== 400) return false;
  const strings = normalizedPayloadStrings(payload);
  return strings.some((entry) => INVALID_CREDENTIAL_CODES.has(entry) || INVALID_CREDENTIAL_MESSAGES.has(entry));
}

export function isWeakPasswordResponse(status: number, payload: unknown) {
  if (status !== 400 && status !== 422) return false;
  if (!isRecord(payload)) return false;
  const codes = [payload.code, payload.error_code]
    .filter((entry): entry is string => typeof entry === 'string')
    .map((entry) => entry.trim().toLowerCase());
  return codes.includes('weak_password') || isRecord(payload.weak_password);
}

export function upstreamResponseFailure(
  status: number,
  badRequest: UpstreamBadRequestContext,
  payload?: unknown,
): PublicUpstreamFailure {
  if (status === 400) return { ok: false, status, ...badRequest };
  if (status === 401) {
    return { ok: false, status, code: 'invalid_token', message: 'Authentication credentials are invalid or expired.' };
  }
  if (isUserBannedResponse(status, payload)) {
    return { ok: false, status, code: 'user_banned', message: 'This account has been disabled.' };
  }
  if (status === 403) {
    return { ok: false, status, code: 'upstream_forbidden', message: 'Authentication runtime refused this operation.' };
  }
  if (status === 404) {
    return { ok: false, status, code: 'upstream_not_found', message: 'Authentication resource was not found.' };
  }
  if (status === 429) {
    return { ok: false, status, code: 'upstream_rate_limited', message: 'Authentication runtime rate limit exceeded.' };
  }
  if (status >= 400 && status < 500) {
    return { ok: false, status, code: 'upstream_request_rejected', message: 'Authentication runtime rejected the request.' };
  }
  return {
    ok: false,
    status: 502,
    code: 'runtime_unavailable',
    message: 'Authentication runtime is unavailable.',
  };
}

function isUserBannedResponse(status: number, payload: unknown) {
  return status === 403
    && isRecord(payload)
    && (payload.code === 'user_banned' || payload.error_code === 'user_banned');
}

function isTimeoutError(error: unknown) {
  if (!isRecord(error)) return false;
  return error.name === 'TimeoutError' || error.name === 'AbortError';
}

export function upstreamNetworkFailure(error: unknown): PublicUpstreamFailure {
  if (isTimeoutError(error)) {
    return {
      ok: false,
      status: 504,
      code: 'runtime_timeout',
      message: 'Authentication runtime timed out.',
    };
  }
  return {
    ok: false,
    status: 502,
    code: 'runtime_unavailable',
    message: 'Authentication runtime is unavailable.',
  };
}

export function preferredUpstreamNetworkFailure(
  previous: PublicUpstreamFailure | null,
  error: unknown,
): PublicUpstreamFailure {
  const current = upstreamNetworkFailure(error);
  return previous?.code === 'runtime_timeout' && current.code !== 'runtime_timeout'
    ? previous
    : current;
}
