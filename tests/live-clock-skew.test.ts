import { describe, expect, it } from 'bun:test';
import { readFileSync } from 'node:fs';
import { checkLiveClockSkew, type LiveClockCheckOptions } from '../scripts/check-live-clock-skew.js';

const BASE_TIME_MS = 1_700_000_000_000;

describe('live clock skew prerequisite', () => {
  it('uses the request midpoint and accepts the exact five-second boundary', async () => {
    const clockSkewMs = await checkLiveClockSkew(clockOptions({
      serverTimeMs: BASE_TIME_MS + 6_000,
      localTimes: [BASE_TIME_MS, BASE_TIME_MS + 2_000],
    }));

    expect(clockSkewMs).toBe(5_000);
  });

  it('fails when absolute skew exceeds five seconds', async () => {
    await expect(checkLiveClockSkew(clockOptions({
      serverTimeMs: BASE_TIME_MS - 6_000,
      localTimes: [BASE_TIME_MS, BASE_TIME_MS],
    }))).rejects.toThrow('GoTrue clock skew -6.000s exceeds 5.000s');
  });

  it('fails on non-2xx, missing Date, and invalid Date responses', async () => {
    await expect(checkLiveClockSkew(clockOptions({ status: 503 }))).rejects.toThrow('HTTP 503');
    await expect(checkLiveClockSkew(clockOptions({ includeDate: false }))).rejects.toThrow('missing the Date header');
    await expect(checkLiveClockSkew(clockOptions({ dateHeader: 'not-a-date' }))).rejects.toThrow('invalid Date header');
  });

  it('stops after exactly three timeouts and preserves the original timeout cause', async () => {
    const signals: AbortSignal[] = [];
    const result = await checkLiveClockSkew({
      runtimeUrl: 'https://auth.example.test',
      fetchImpl: async (_input, init) => {
        const signal = init?.signal;
        if (!signal) throw new Error('Expected a timeout signal');
        signals.push(signal);
        return await waitForTimeout(signal);
      },
      timeoutMs: 5,
      retryDelayMs: 0,
    }).catch((error: unknown) => error);

    expect(signals).toHaveLength(3);
    expect(result).toBeInstanceOf(Error);
    if (!(result instanceof Error)) throw new Error('Expected a timeout error');
    expect(result.message).toContain('timed out after 5ms');
    expect(result.message).toContain('3 attempts');
    expect(result.cause).toBe(signals[2]?.reason);
  });

  it('recovers on the third attempt with independent signals, nonces, and timing', async () => {
    const signals: AbortSignal[] = [];
    const nonces: string[] = [];
    const localTimes = [
      BASE_TIME_MS - 40_000, BASE_TIME_MS - 35_000,
      BASE_TIME_MS - 20_000, BASE_TIME_MS - 15_000,
      BASE_TIME_MS, BASE_TIME_MS + 2_000,
    ];
    let clockReads = 0;
    const skew = await checkLiveClockSkew({
      runtimeUrl: 'https://auth.example.test',
      timeoutMs: 5,
      retryDelayMs: 0,
      now: () => {
        clockReads++;
        const time = localTimes.shift();
        if (time === undefined) throw new Error('Unexpected clock read');
        return time;
      },
      fetchImpl: async (input, init) => {
        const signal = init?.signal;
        if (!signal) throw new Error('Expected a timeout signal');
        signals.push(signal);
        const url = new URL(input instanceof Request ? input.url : input.toString());
        const nonce = url.searchParams.get('clock_check');
        if (!nonce) throw new Error('Expected a cache nonce');
        nonces.push(nonce);
        expect(init?.cache).toBe('no-store');
        if (signals.length < 3) return await waitForTimeout(signal);
        expect(signal.aborted).toBe(false);
        return new Response(null, { headers: { date: new Date(BASE_TIME_MS + 6_000).toUTCString() } });
      },
    });

    expect(skew).toBe(5_000);
    expect(clockReads).toBe(6);
    expect(localTimes).toHaveLength(0);
    expect(new Set(signals).size).toBe(3);
    expect(new Set(nonces).size).toBe(3);
  });

  for (const { name, fixture, message } of [
    { name: 'HTTP', fixture: { status: 503 }, message: 'HTTP 503' },
    { name: 'missing Date', fixture: { includeDate: false }, message: 'missing the Date header' },
    { name: 'invalid Date', fixture: { dateHeader: 'not-a-date' }, message: 'invalid Date header' },
    { name: 'skew', fixture: { serverTimeMs: BASE_TIME_MS + 6_000 }, message: 'exceeds 5.000s' },
  ]) {
    it(`does not retry ${name} errors, even after a timeout`, async () => {
      for (const initialTimeout of [false, true]) {
        const options = clockOptions(fixture);
        const responseFetch = options.fetchImpl;
        if (!responseFetch) throw new Error('Expected a fixture fetch');
        let attempts = 0;
        await expect(checkLiveClockSkew({
          ...options,
          timeoutMs: 5,
          retryDelayMs: 0,
          fetchImpl: async (input, init) => {
            attempts++;
            if (initialTimeout && attempts === 1) {
              const signal = init?.signal;
              if (!signal) throw new Error('Expected a timeout signal');
              return await waitForTimeout(signal);
            }
            return await responseFetch(input, init);
          },
        })).rejects.toThrow(message);
        expect(attempts).toBe(initialTimeout ? 2 : 1);
      }
    });
  }

  it('does not retry other network failures', async () => {
    const originalError = new TypeError('Connection refused');
    let attempts = 0;
    const result = await checkLiveClockSkew({
      runtimeUrl: 'https://auth.example.test',
      retryDelayMs: 0,
      fetchImpl: async () => {
        attempts++;
        throw originalError;
      },
    }).catch((error: unknown) => error);
    expect(attempts).toBe(1);
    expect(result).toBeInstanceOf(Error);
    if (!(result instanceof Error)) throw new Error('Expected a network error');
    expect(result.cause).toBe(originalError);
  });

  it('bypasses caches for every GoTrue health request', async () => {
    const requests: Array<{ init?: RequestInit; url: URL }> = [];
    const fetchImpl: NonNullable<LiveClockCheckOptions['fetchImpl']> = async (input, init) => {
      requests.push({ ...(init === undefined ? {} : { init }), url: new URL(input instanceof Request ? input.url : input.toString()) });
      return new Response(null, { headers: { date: new Date(BASE_TIME_MS).toUTCString() } });
    };
    const options = { fetchImpl, now: () => BASE_TIME_MS, runtimeUrl: 'https://auth.example.test' };

    await checkLiveClockSkew(options);
    await checkLiveClockSkew(options);

    expect(requests).toHaveLength(2);
    for (const request of requests) {
      expect(request.url.origin).toBe('https://auth.example.test');
      expect(request.url.pathname).toBe('/auth/v1/health');
      expect(request.url.searchParams.get('clock_check')).toBeTruthy();
      expect(request.init?.cache).toBe('no-store');
      expect(request.init?.signal).toBeInstanceOf(AbortSignal);
    }
    const [first, second] = requests;
    if (!first || !second) throw new Error('Expected two uncached clock requests');
    expect(first.url.search).not.toBe(second.url.search);
  });

  it('runs before both strict live compatibility suites', () => {
    for (const workflowPath of ['.github/workflows/ci.yml', '.github/workflows/live-compat.yml']) {
      const workflow = readFileSync(workflowPath, 'utf8');
      const prerequisite = workflow.indexOf('bun --use-system-ca run scripts/check-live-clock-skew.ts');
      const strictSuite = workflow.indexOf('bun run test:supabase-auth-compat');
      expect(prerequisite).toBeGreaterThan(-1);
      expect(prerequisite).toBeLessThan(strictSuite);
      expect(workflow).toContain('OAUTH_RUNTIME_URL: ${{ secrets.LIVE_SUPABASE_AUTH_URL || secrets.LIVE_OAUTH_RUNTIME_URL }}');
      const sessionPreparation = workflow.indexOf('bun --use-system-ca run scripts/prepare-supabase-auth-compat-session.ts');
      if (sessionPreparation > -1) expect(prerequisite).toBeLessThan(sessionPreparation);
    }
    const packageManifest = readFileSync('package.json', 'utf8');
    expect(packageManifest).toContain('bun --use-system-ca test tests/integration/supabase-compat/oauth21.test.ts');
  });

  it('isolates self-hosted checkout from the runner SSH config', () => {
    const ciWorkflow = readFileSync('.github/workflows/ci.yml', 'utf8');
    const liveWorkflow = readFileSync('.github/workflows/live-compat.yml', 'utf8');
    const compatJob = ciWorkflow.slice(
      ciWorkflow.indexOf('  supabase-auth-compat:'),
      ciWorkflow.indexOf('  package-auth-ui:'),
    );
    const liveJob = liveWorkflow.slice(liveWorkflow.indexOf('  live-compat:'));
    const sshCommand = 'ssh -F /dev/null -o BatchMode=yes -o StrictHostKeyChecking=yes -o UserKnownHostsFile=/Users/zhd/.ssh/known_hosts';

    expect(`${ciWorkflow}\n${liveWorkflow}`.split(`GIT_SSH_COMMAND: ${sshCommand}`)).toHaveLength(3);
    for (const job of [compatJob, liveJob]) {
      expect(job.split(`GIT_SSH_COMMAND: ${sshCommand}`)).toHaveLength(2);
      expect(job).not.toMatch(/ProxyCommand|ProxyJump|7897|StrictHostKeyChecking=no/);
      expect(job).not.toContain('core.sshCommand');
      expect(job).not.toContain('ssh-key:');
      expect(job.indexOf('ssh-keyscan github.com')).toBeLessThan(job.indexOf('- uses: actions/checkout@v6'));
      expect(job.indexOf('insteadOf "https://github.com/"')).toBeLessThan(job.indexOf('- uses: actions/checkout@v6'));
    }
    expect(ciWorkflow.slice(0, ciWorkflow.indexOf('  supabase-auth-compat:'))).not.toContain('GIT_SSH_COMMAND');
    expect(ciWorkflow.slice(ciWorkflow.indexOf('  package-auth-ui:'))).not.toContain('GIT_SSH_COMMAND');
  });
});

interface ClockFixture {
  serverTimeMs?: number;
  localTimes?: [number, number];
  status?: number;
  includeDate?: boolean;
  dateHeader?: string;
}

function waitForTimeout(signal: AbortSignal): Promise<Response> {
  return new Promise((_resolve, reject) => {
    if (signal.aborted) {
      reject(signal.reason);
      return;
    }
    signal.addEventListener('abort', () => reject(signal.reason), { once: true });
  });
}

function clockOptions(fixture: ClockFixture): LiveClockCheckOptions {
  const localTimes = [...(fixture.localTimes ?? [BASE_TIME_MS, BASE_TIME_MS])];
  const headers = new Headers();
  if (fixture.includeDate !== false) {
    headers.set('date', fixture.dateHeader ?? new Date(fixture.serverTimeMs ?? BASE_TIME_MS).toUTCString());
  }
  return {
    runtimeUrl: 'https://auth.example.test',
    fetchImpl: async () => new Response(null, { status: fixture.status ?? 200, headers }),
    now: () => localTimes.shift() ?? BASE_TIME_MS,
  };
}
