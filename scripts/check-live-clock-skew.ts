const MAX_CLOCK_SKEW_MS = 5_000;
const DEFAULT_TIMEOUT_MS = 5_000;

type FetchLike = (input: string | URL | Request, init?: RequestInit) => Promise<Response>;

export interface LiveClockCheckOptions {
  runtimeUrl: string;
  fetchImpl?: FetchLike;
  now?: () => number;
  timeoutMs?: number;
}

export async function checkLiveClockSkew(options: LiveClockCheckOptions): Promise<number> {
  const now = options.now ?? Date.now;
  const requestStartedAt = now();
  const response = await fetchGotrueHealth(options, gotrueHealthUrl(options.runtimeUrl));
  const requestFinishedAt = now();
  return validatedClockSkew(response, requestStartedAt, requestFinishedAt);
}

function validatedClockSkew(response: Response, requestStartedAt: number, requestFinishedAt: number): number {
  if (!response.ok) throw new Error(`GoTrue health returned HTTP ${response.status}`);
  const serverTime = response.headers.get('date');
  if (!serverTime) throw new Error('GoTrue health response is missing the Date header');
  const serverTimeMs = Date.parse(serverTime);
  if (!Number.isFinite(serverTimeMs)) throw new Error('GoTrue health response has an invalid Date header');

  const requestMidpointMs = (requestStartedAt + requestFinishedAt) / 2;
  const clockSkewMs = serverTimeMs - requestMidpointMs;
  if (Math.abs(clockSkewMs) > MAX_CLOCK_SKEW_MS) {
    throw new Error(`GoTrue clock skew ${formatClockSkew(clockSkewMs)} exceeds 5.000s`);
  }
  return clockSkewMs;
}

async function fetchGotrueHealth(options: LiveClockCheckOptions, healthUrl: URL): Promise<Response> {
  const timeoutMs = options.timeoutMs ?? DEFAULT_TIMEOUT_MS;
  const timeoutSignal = AbortSignal.timeout(timeoutMs);
  try {
    return await (options.fetchImpl ?? fetch)(healthUrl, { cache: 'no-store', signal: timeoutSignal });
  } catch (error) {
    if (timeoutSignal.aborted) throw new Error(`GoTrue health request timed out after ${timeoutMs}ms`, { cause: error });
    throw new Error(`GoTrue health request failed: ${errorMessage(error)}`, { cause: error });
  }
}

function gotrueHealthUrl(runtimeUrl: string): URL {
  let parsedRuntimeUrl: URL;
  try {
    parsedRuntimeUrl = new URL(runtimeUrl);
  } catch (error) {
    throw new Error('OAUTH_RUNTIME_URL must be a valid URL', { cause: error });
  }
  if (!['http:', 'https:'].includes(parsedRuntimeUrl.protocol)) {
    throw new Error('OAUTH_RUNTIME_URL must use http or https');
  }
  const healthUrl = new URL('/auth/v1/health', parsedRuntimeUrl);
  healthUrl.searchParams.set('clock_check', crypto.randomUUID());
  return healthUrl;
}

function formatClockSkew(clockSkewMs: number): string {
  const sign = clockSkewMs >= 0 ? '+' : '-';
  return `${sign}${(Math.abs(clockSkewMs) / 1_000).toFixed(3)}s`;
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

async function main(): Promise<void> {
  const runtimeUrl = process.env.OAUTH_RUNTIME_URL?.trim();
  if (!runtimeUrl) throw new Error('OAUTH_RUNTIME_URL is required for the live clock check');
  const clockSkewMs = await checkLiveClockSkew({ runtimeUrl });
  console.log(`GoTrue clock skew: ${formatClockSkew(clockSkewMs)}`);
}

if (import.meta.main) {
  try {
    await main();
  } catch (error) {
    console.error(errorMessage(error));
    process.exit(1);
  }
}
