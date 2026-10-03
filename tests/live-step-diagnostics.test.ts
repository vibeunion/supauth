import { describe, expect, it } from 'bun:test';
import {
  safeLiveError,
  withLiveStep,
  type LiveStepEvent,
} from './integration/supabase-compat/live-step-diagnostics.js';

function recorder() {
  const events: LiveStepEvent[] = [];
  let time = 100;
  return {
    events,
    options: { emit: (event: LiveStepEvent) => { events.push(event); }, now: () => time },
    advance: (milliseconds: number) => { time += milliseconds; },
  };
}

describe('live step diagnostics', () => {
  it('calls once and preserves the response while recording stage order and duration', async () => {
    const { events, options, advance } = recorder();
    const result = { data: { access_token: 'private-token' }, error: null };
    let calls = 0;
    const returned = await withLiveStep('sign-in', async () => {
      calls += 1;
      advance(12);
      return result;
    }, options);
    expect(returned).toBe(result);
    expect(calls).toBe(1);
    expect(events).toEqual([
      { stage: 'sign-in', event: 'start', elapsedMs: 0, ok: null, error: null },
      { stage: 'sign-in', event: 'finish', elapsedMs: 12, ok: true, error: null },
    ]);
    expect(JSON.stringify(events)).not.toContain('private-token');
  });

  it('reports safe details for returned errors without throwing or changing the result', async () => {
    const { events, options } = recorder();
    const result = {
      error: {
        name: 'AuthApiError', status: 429, code: 'over_request_rate_limit',
        message: 'private-message', stack: 'private-stack', factorId: 'private-factor',
      },
      data: { secret: 'private-totp' },
    };
    expect(await withLiveStep('enroll', async () => result, options)).toBe(result);
    expect(events[1]).toEqual({
      stage: 'enroll', event: 'finish', elapsedMs: 0, ok: false,
      error: { name: 'AuthApiError', status: 429, code: 'over_request_rate_limit' },
    });
    expect(JSON.stringify(events)).not.toContain('private-');
  });

  it('rethrows the identical exception without retries and rejects secret-bearing names and codes', async () => {
    const { events, options, advance } = recorder();
    const original = Object.assign(new Error('private-message'), {
      name: 'AuthApiError-private-name', code: 'invalid_credentials-private-code',
      status: 'private-status', credentials: 'private-credentials',
    });
    let calls = 0;
    let caught: unknown;
    try {
      await withLiveStep('verify', async () => {
        calls += 1;
        advance(7);
        throw original;
      }, options);
    } catch (error: unknown) {
      caught = error;
    }
    expect(caught).toBe(original);
    expect(calls).toBe(1);
    expect(events[1]).toEqual({
      stage: 'verify', event: 'error', elapsedMs: 7, ok: false,
      error: { name: 'UnknownError', status: null, code: 'unknown' },
    });
    expect(JSON.stringify(events)).not.toContain('private-');
  });

  it('records start before an unresolved operation and finish only after resolution', async () => {
    const { events, options } = recorder();
    const deferred = Promise.withResolvers<string>();
    const pending = withLiveStep('challenge', () => deferred.promise, options);
    expect(events.map(event => event.event)).toEqual(['start']);
    deferred.resolve('private-result');
    expect(await pending).toBe('private-result');
    expect(events.map(event => event.event)).toEqual(['start', 'finish']);
    expect(JSON.stringify(events)).not.toContain('private-result');
  });

  it('restricts error fields to enumerated strings and integer HTTP statuses', () => {
    for (const status of ['401', NaN, Infinity, 99, 600, 401.5]) {
      expect(safeLiveError({ name: 'Error', code: 'bad_jwt', status })).toEqual({
        name: 'Error', code: 'bad_jwt', status: null,
      });
    }
    expect(safeLiveError({ name: 'AuthApiError', code: 'invalid_credentials', status: 400 })).toEqual({
      name: 'AuthApiError', code: 'invalid_credentials', status: 400,
    });
    for (const value of [null, undefined, 'private-error', { get name() { throw new Error('private-getter'); } }]) {
      expect(safeLiveError(value)).toEqual({ name: 'UnknownError', status: null, code: 'unknown' });
    }
  });

  it('does not let diagnostic failures alter returned values or thrown errors', async () => {
    const options = { emit: () => { throw new Error('sink failed'); } };
    const result = { error: null };
    expect(await withLiveStep('refresh', async () => result, options)).toBe(result);
    const original = new Error('original');
    let caught: unknown;
    try {
      await withLiveStep('refresh', async () => { throw original; }, options);
    } catch (error: unknown) {
      caught = error;
    }
    expect(caught).toBe(original);
  });
});
