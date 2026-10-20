const ERROR_NAMES = new Set([
  'Error', 'TypeError', 'AbortError', 'TimeoutError', 'AuthError', 'AuthApiError',
  'AuthRetryableFetchError', 'AuthUnknownError', 'AuthSessionMissingError',
  'AuthInvalidTokenResponseError',
]);
const ERROR_CODES = new Set([
  'unexpected_failure', 'request_timeout', 'over_request_rate_limit',
  'over_email_send_rate_limit', 'invalid_credentials', 'email_not_confirmed',
  'user_not_found', 'user_banned', 'session_not_found', 'session_expired',
  'refresh_token_not_found', 'refresh_token_already_used', 'bad_jwt',
  'mfa_factor_not_found', 'mfa_challenge_expired', 'mfa_verification_failed',
  'mfa_verification_rejected', 'mfa_ip_address_mismatch', 'insufficient_aal',
]);
const STAGES = new Set([
  'version', 'sign-in', 'enroll', 'challenge', 'verify', 'assurance',
  'delete-factor', 'refresh', 'unenroll', 'cleanup', 'sign-out',
]);

type LiveStage =
  | 'version' | 'sign-in' | 'enroll' | 'challenge' | 'verify' | 'assurance'
  | 'delete-factor' | 'refresh' | 'unenroll' | 'cleanup' | 'sign-out';

export interface SafeLiveError {
  name: string;
  status: number | null;
  code: string;
}

export interface LiveStepEvent {
  stage: string;
  event: 'start' | 'finish' | 'error';
  elapsedMs: number;
  ok: boolean | null;
  error: SafeLiveError | null;
}

interface DiagnosticOptions {
  emit?: (event: LiveStepEvent) => void;
  now?: () => number;
}

export function safeLiveError(error: unknown): SafeLiveError {
  const fallback = { name: 'UnknownError', status: null, code: 'unknown' };
  if (typeof error !== 'object' || error === null) return fallback;
  try {
    const name: unknown = 'name' in error ? error.name : undefined;
    const status: unknown = 'status' in error ? error.status : undefined;
    const code: unknown = 'code' in error ? error.code : undefined;
    return {
      name: typeof name === 'string' && ERROR_NAMES.has(name) ? name : 'UnknownError',
      status: typeof status === 'number' && Number.isInteger(status) && status >= 100 && status <= 599
        ? status : null,
      code: typeof code === 'string' && ERROR_CODES.has(code) ? code : 'unknown',
    };
  } catch {
    return fallback;
  }
}

export async function withLiveStep<T>(
  stage: LiveStage,
  operation: () => Promise<T>,
  options: DiagnosticOptions = {},
): Promise<T> {
  const now = options.now ?? (() => performance.now());
  const emit = options.emit ?? ((event: LiveStepEvent) => console.log(`[live-step] ${JSON.stringify(event)}`));
  const started = now();
  const report = (event: LiveStepEvent['event'], ok: boolean | null, error: SafeLiveError | null) => {
    try {
      emit({
        stage: STAGES.has(stage) ? stage : 'unknown',
        event,
        elapsedMs: Math.max(0, Math.round(now() - started)),
        ok,
        error,
      });
    } catch {
      // 诊断输出失败不得改变请求结果或遮蔽原始异常。
    }
  };
  report('start', null, null);
  let result: T;
  try {
    result = await operation();
  } catch (error: unknown) {
    report('error', false, safeLiveError(error));
    throw error;
  }
  let error: unknown = null;
  try {
    if (typeof result === 'object' && result !== null && 'error' in result) error = result.error;
  } catch {
    // 不让第三方返回对象的属性访问异常改变原返回值。
  }
  const failed = error !== null && error !== undefined;
  report('finish', !failed, failed ? safeLiveError(error) : null);
  return result;
}
