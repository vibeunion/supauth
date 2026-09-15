import { describe, expect, test } from 'bun:test';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  acceptanceAllocationDetails, acceptancePassed, decodePhaseResult, parseAcceptanceTarget,
  validateAcceptanceTarget,
  type AcceptancePhase, type PhaseResult,
} from '../scripts/real-contract-acceptance-contract.js';
import {
  createAllocationJournal, TEST_IDENTITY_OWNER_REF,
} from '../scripts/real-contract-allocation.js';

const projectRef = 'supauth_contract_1234567812344abc8def1234567890ab';
const adminToken = 'synthetic-admin-secret-sentinel';
const userToken = 'synthetic-user-secret-sentinel';

function environment(overrides: Record<string, string | undefined> = {}): Record<string, string | undefined> {
  return {
    REAL_ACCEPTANCE_BASE_URL: 'https://localhost:8443/admin/',
    REAL_ACCEPTANCE_RUNTIME_URL: 'https://localhost:8443/runtime/',
    REAL_ACCEPTANCE_PROJECT_REF: projectRef,
    REAL_ACCEPTANCE_ADMIN_TOKEN: adminToken,
    REAL_ACCEPTANCE_USER_TOKEN: userToken,
    REAL_ACCEPTANCE_ENVIRONMENT: 'isolated-test',
    REAL_ACCEPTANCE_CONFIRM_PROJECT: projectRef,
    ...overrides,
  };
}

function rejection(env: Record<string, string | undefined>): Error {
  try {
    parseAcceptanceTarget(env);
  } catch (error) {
    if (!(error instanceof Error)) throw new Error('Expected a fixed validation error');
    expect(error.message).toMatch(/^REAL_ACCEPTANCE_[A-Z_]+(?::REAL_ACCEPTANCE_[A-Z_]+)?$/);
    expect(error.message).not.toContain(adminToken);
    expect(error.message).not.toContain(userToken);
    expect(error.message).not.toContain(projectRef);
    expect(Object.hasOwn(error, 'cause')).toBe(false);
    return error;
  }
  throw new Error('Unsafe acceptance target was admitted');
}

async function withAllocation(
  callback: (env: Record<string, string | undefined>, directory: string) => void | Promise<void>,
): Promise<void> {
  const root = await mkdtemp(join(tmpdir(), 'supauth-core-allocation-'));
  const runId = '12345678-1234-4abc-8def-1234567890ab';
  const projectOrigin = `https://contract-${runId}.xai.xigu.team`;
  const ref = 'abcdefghijklmnopqrst';
  const name = `supauth-contract-${runId}`;
  try {
    const journal = await createAllocationJournal(root, {
      runId, name, projectOrigin, authorityRef: TEST_IDENTITY_OWNER_REF,
      managementOrigin: 'http://127.0.0.1:29190',
      authorityOrigin: 'https://auth.xai.xigu.team',
      beforeInventory: {
        complete: true, projects: [{ ref: TEST_IDENTITY_OWNER_REF, name: 'existing identity owner' }],
      },
    });
    const project = {
      id: 'offline-project-id', created_at: '2026-09-09T00:00:00Z',
      ref, name, api: { url: projectOrigin }, status: 'ACTIVE_HEALTHY',
    };
    await journal.createOnce(async () => project);
    await journal.bind({
      projectReadback: project, authorityOrigin: 'https://auth.xai.xigu.team',
      authorityDescriptor: {
        project_ref: ref, mode: 'shared', authority_project_ref: TEST_IDENTITY_OWNER_REF,
        owner_project_ref: TEST_IDENTITY_OWNER_REF, local_gotrue_enabled: false,
        public_auth_route: 'owner_proxy', user_management: 'owner_only',
        configuration_management: 'owner_only',
      },
    });
    const directory = join(root, runId);
    await callback(environment({
      REAL_ACCEPTANCE_BASE_URL: `${projectOrigin}/api`,
      REAL_ACCEPTANCE_RUNTIME_URL: 'https://auth.xai.xigu.team/auth/v1',
      REAL_ACCEPTANCE_PROJECT_REF: ref,
      REAL_ACCEPTANCE_CONFIRM_PROJECT: ref,
      REAL_ACCEPTANCE_ALLOCATION_JOURNAL: directory,
    }), directory);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
}

describe('real acceptance explicit isolated target', () => {
  test('requires explicit configuration instead of loading ambient defaults', () => {
    expect(rejection({}).message).toBe('REAL_ACCEPTANCE_INVALID_CONFIG:REAL_ACCEPTANCE_ENVIRONMENT');
  });

  test('returns only the validated target with canonical URL origins and unchanged credentials', () => {
    expect(parseAcceptanceTarget(environment())).toEqual({
      baseUrl: 'https://localhost:8443/admin',
      runtimeUrl: 'https://localhost:8443/runtime',
      projectRef, adminToken, userToken,
    });
  });

  for (const key of Object.keys(environment())) {
    test.each([undefined, '', ' ', '\n'])(`rejects missing or blank ${key}: %j`, (value) => {
      expect(rejection(environment({ [key]: value })).message)
        .toBe(`REAL_ACCEPTANCE_INVALID_CONFIG:${key}`);
    });
  }

  test.each(['production', 'test', 'staging', 'isolated-test ', 'ISOLATED-TEST'])(
    'rejects an unconfirmed environment: %s', (value) => {
      expect(rejection(environment({ REAL_ACCEPTANCE_ENVIRONMENT: value })).message)
        .toBe('REAL_ACCEPTANCE_INVALID_CONFIG:REAL_ACCEPTANCE_ENVIRONMENT');
    },
  );

  test.each([
    'existing-project',
    'supauth_contract_12345678-1234-4abc-8def-1234567890ab',
    'supauth_contract_1234567812344ABC8DEF1234567890AB',
    'supauth_contract_1234567812344abc8def1234567890ag',
    'supauth_contract_1234567812344abc8def1234567890a',
    'supauth_contract_1234567812344abc8def1234567890abc',
    `${projectRef}\n`,
  ])('rejects a project outside the dedicated run format: %s', (value) => {
    expect(rejection(environment({
      REAL_ACCEPTANCE_PROJECT_REF: value, REAL_ACCEPTANCE_CONFIRM_PROJECT: value,
    })).message).toBe('REAL_ACCEPTANCE_INVALID_CONFIG:REAL_ACCEPTANCE_PROJECT_REF');
  });

  test('rejects mixed run projects even when both have the dedicated format', () => {
    const other = 'supauth_contract_8765432112344abc8def1234567890ab';
    expect(rejection(environment({ REAL_ACCEPTANCE_CONFIRM_PROJECT: other })).message)
      .toBe('REAL_ACCEPTANCE_INVALID_CONFIG:REAL_ACCEPTANCE_CONFIRM_PROJECT');
  });

  test.each([
    'https://auth.ai.xigu.team',
    'https://AUTH.AI.XIGU.TEAM:443/path',
    'https://auth.ai.xigu.team.',
    'https://auth.ai.xigu.team..',
    'https://child.auth.ai.xigu.team',
    'https://%61uth.ai.xigu.team',
    'https://auth%2eai.xigu.team',
    'https://auth.ai.xigu.team\u3002',
  ])('rejects production hostname forms: %s', (url) => {
    for (const key of ['REAL_ACCEPTANCE_BASE_URL', 'REAL_ACCEPTANCE_RUNTIME_URL']) {
      expect(rejection(environment({ [key]: url })).message)
        .toBe(`REAL_ACCEPTANCE_INVALID_CONFIG:${key}`);
    }
  });

  test.each([
    'http://isolated.example.test',
    'http://192.168.1.2',
    'http://0.0.0.0',
    'http://localhost.example.test',
    'http://[::]',
    'http://[2001:db8::1]',
    'http://[::ffff:127.0.0.1]',
    'http://127.1',
    'http://2130706433',
    'http://0177.0.0.1',
    'http://0x7f000001',
    'http://127.0.0.1.example.test',
  ])('rejects non-loopback or ambiguous HTTP targets: %s', (url) => {
    expect(rejection(environment({ REAL_ACCEPTANCE_BASE_URL: url })).message)
      .toBe('REAL_ACCEPTANCE_INVALID_CONFIG:REAL_ACCEPTANCE_BASE_URL');
  });

  test.each([
    'http://localhost:8080', 'http://127.0.0.1:8080', 'http://127.23.45.67:8080',
    'http://[::1]:8080', 'http://[0:0:0:0:0:0:0:1]:8080',
    'https://[::1]:8443',
  ])('admits local HTTPS or loopback HTTP and canonicalizes IPv6: %s', (url) => {
    const target = parseAcceptanceTarget(environment({
      REAL_ACCEPTANCE_BASE_URL: `${url}/admin/`,
      REAL_ACCEPTANCE_RUNTIME_URL: `${url}/runtime/`,
    }));
    expect(new URL(target.baseUrl).origin).toBe(new URL(url).origin);
    expect(new URL(target.runtimeUrl).origin).toBe(new URL(url).origin);
  });

  test.each([
    'https://name:secret@isolated.example.test',
    'https://@isolated.example.test',
    'https://isolated.example.test@other.example.test',
    '//isolated.example.test',
    '/relative',
    'https:isolated.example.test',
    'https:////isolated.example.test',
    'ftp://isolated.example.test',
    'file:///isolated.example.test',
    'javascript:alert(1)',
    'https://isolated.example.test?redirect=https://other.example.test',
    'https://isolated.example.test?',
    'https://isolated.example.test#other.example.test',
    'https://isolated.example.test#',
    'https://isolated.example.test/%2f%2fother.example.test',
    'https://isolated.example.test/%3fredirect=other',
    'https://isolated.example.test\\@other.example.test',
    'https://isolated.example.test/\nother',
    ' https://isolated.example.test',
    'https://isolated.example.test/\u0000',
    'https://[::1%25lo0]',
    'https://isolated.example.test:65536',
  ])('rejects credentials, encoded, relative, and redirected-origin expressions: %s', (url) => {
    expect(rejection(environment({ REAL_ACCEPTANCE_BASE_URL: url })).message)
      .toBe('REAL_ACCEPTANCE_INVALID_CONFIG:REAL_ACCEPTANCE_BASE_URL');
  });

  test.each([
    'https://other.example.test/runtime',
    'https://isolated.example.test.evil.test/runtime',
    'https://isolated.example.test:8443/runtime',
    'https://isolated.example.test./runtime',
  ])('requires exact base/runtime origin, not prefix or host similarity: %s', (runtime) => {
    expect(rejection(environment({ REAL_ACCEPTANCE_RUNTIME_URL: runtime })).message)
      .toBe('REAL_ACCEPTANCE_TARGET_ORIGIN_MISMATCH');
  });

  test('rejects different schemes even on the same loopback hostname', () => {
    expect(rejection(environment({
      REAL_ACCEPTANCE_BASE_URL: 'http://localhost',
      REAL_ACCEPTANCE_RUNTIME_URL: 'https://localhost',
    })).message).toBe('REAL_ACCEPTANCE_TARGET_ORIGIN_MISMATCH');
  });

  test('canonical default ports and hostname case represent the same origin', () => {
    const target = parseAcceptanceTarget(environment({
      REAL_ACCEPTANCE_BASE_URL: 'https://LOCALHOST:443/admin/',
      REAL_ACCEPTANCE_RUNTIME_URL: 'https://localhost/runtime',
    }));
    expect(target.baseUrl).toBe('https://localhost/admin');
    expect(new URL(target.baseUrl).origin).toBe(new URL(target.runtimeUrl).origin);
  });

  test.each([
    'https://isolated.example.test', 'https://fixture.invalid',
    'https://[2001:db8::1]:8443', 'https://auth.xai.xigu.team',
  ])('synthetic project names cannot authorize a remote origin: %s', (origin) => {
    expect(rejection(environment({
      REAL_ACCEPTANCE_BASE_URL: `${origin}/admin`,
      REAL_ACCEPTANCE_RUNTIME_URL: `${origin}/runtime`,
    })).message).toBe('REAL_ACCEPTANCE_ALLOCATION_REQUIRED');
  });

  test('URL failures redact embedded secrets and do not retain parser cause', () => {
    const url = `https://${adminToken}:${userToken}@isolated.example.test/${projectRef}`;
    const error = rejection(environment({ REAL_ACCEPTANCE_BASE_URL: url }));
    expect(error.message).toBe('REAL_ACCEPTANCE_INVALID_CONFIG:REAL_ACCEPTANCE_BASE_URL');
    expect(error.stack).not.toContain(adminToken);
    expect(error.stack).not.toContain(userToken);
    expect(error.stack).not.toContain(projectRef);
    expect(JSON.stringify(error)).toBe('{}');
  });

  for (const key of ['REAL_ACCEPTANCE_ADMIN_TOKEN', 'REAL_ACCEPTANCE_USER_TOKEN']) {
    test.each(['\u0000', '\u001f', '\u007f'])(`rejects token control characters in ${key}`, (control) => {
      expect(rejection(environment({ [key]: `${adminToken}${control}` })).message)
        .toBe(`REAL_ACCEPTANCE_INVALID_CONFIG:${key}`);
    });
  }

  test('environment accessors are rejected without invoking their secret-bearing failure', () => {
    const env = environment();
    let invoked = false;
    Object.defineProperty(env, 'REAL_ACCEPTANCE_ADMIN_TOKEN', {
      enumerable: true,
      get() {
        invoked = true;
        throw new Error(adminToken);
      },
    });
    expect(rejection(env).message).toBe('REAL_ACCEPTANCE_INVALID_CONFIG:REAL_ACCEPTANCE_ADMIN_TOKEN');
    expect(invoked).toBe(false);
  });

  test('inherited configuration cannot act as implicit defaults', () => {
    const env: Record<string, string | undefined> = {};
    Object.setPrototypeOf(env, environment());
    expect(rejection(env).message).toBe('REAL_ACCEPTANCE_INVALID_CONFIG:REAL_ACCEPTANCE_ENVIRONMENT');
  });
});

describe('journal-bound allocated acceptance targets (offline evidence only)', () => {
  test('admits exact allocated project and shared authority origins from the private journal', async () => {
    await withAllocation(env => {
      const target = parseAcceptanceTarget(env);
      expect(target.projectRef).toBe('abcdefghijklmnopqrst');
      expect(target.runtimeUrl).toBe('https://auth.xai.xigu.team/auth/v1');
      expect(new URL(target.baseUrl).origin).not.toBe(new URL(target.runtimeUrl).origin);
      const validated = validateAcceptanceTarget(target);
      expect(validated).toEqual(target);
      expect(acceptanceAllocationDetails(validated)).toEqual({
        runId: '12345678-1234-4abc-8def-1234567890ab',
        projectRef: target.projectRef,
        projectOrigin: new URL(target.baseUrl).origin,
        authorityRef: TEST_IDENTITY_OWNER_REF,
        authorityOrigin: 'https://auth.xai.xigu.team',
      });
      expect(acceptanceAllocationDetails(parseAcceptanceTarget(environment()))).toBeUndefined();
    });
  });

  test('canonical trailing slashes preserve exact allocation binding', async () => {
    await withAllocation(env => {
      const target = parseAcceptanceTarget({
        ...env,
        REAL_ACCEPTANCE_BASE_URL: `${env['REAL_ACCEPTANCE_BASE_URL']}/`,
        REAL_ACCEPTANCE_RUNTIME_URL: `${env['REAL_ACCEPTANCE_RUNTIME_URL']}/`,
      });
      expect(validateAcceptanceTarget(target)).toEqual(target);
    });
  });

  test.each([
    { REAL_ACCEPTANCE_BASE_URL: 'https://auth.xai.xigu.team/api' },
    { REAL_ACCEPTANCE_BASE_URL: 'https://contract-87654321-1234-4abc-8def-1234567890ab.xai.xigu.team/api' },
    { REAL_ACCEPTANCE_BASE_URL: 'https://contract-12345678-1234-4abc-8def-1234567890ab.xai.xigu.team/other' },
    { REAL_ACCEPTANCE_RUNTIME_URL: 'https://other.xai.xigu.team/auth/v1' },
    { REAL_ACCEPTANCE_RUNTIME_URL: 'https://auth.xai.xigu.team/api' },
    { REAL_ACCEPTANCE_RUNTIME_URL: 'https://auth.xai.xigu.team:8443/auth/v1' },
    {
      REAL_ACCEPTANCE_PROJECT_REF: TEST_IDENTITY_OWNER_REF,
      REAL_ACCEPTANCE_CONFIRM_PROJECT: TEST_IDENTITY_OWNER_REF,
    },
    {
      REAL_ACCEPTANCE_PROJECT_REF: projectRef,
      REAL_ACCEPTANCE_CONFIRM_PROJECT: projectRef,
      REAL_ACCEPTANCE_BASE_URL: 'http://localhost:8080/api',
      REAL_ACCEPTANCE_RUNTIME_URL: 'http://localhost:8080/auth/v1',
    },
  ])('rejects field substitution instead of treating the journal as a blanket permit: %j', async overrides => {
    await withAllocation(env => {
      expect(rejection({ ...env, ...overrides }).message).toBe('REAL_ACCEPTANCE_ALLOCATION_MISMATCH');
    });
  });

  test('real refs cannot be authorized by environment claims without a journal', () => {
    expect(rejection(environment({
      REAL_ACCEPTANCE_PROJECT_REF: 'abcdefghijklmnopqrst',
      REAL_ACCEPTANCE_CONFIRM_PROJECT: 'abcdefghijklmnopqrst',
      REAL_ACCEPTANCE_AUTHORITY_REF: TEST_IDENTITY_OWNER_REF,
      REAL_ACCEPTANCE_RUN_AUTHORIZED: 'true',
    })).message).toBe('REAL_ACCEPTANCE_INVALID_CONFIG:REAL_ACCEPTANCE_PROJECT_REF');
  });

  test('a copied target cannot copy its allocation capability', async () => {
    await withAllocation(env => {
      const target = parseAcceptanceTarget(env);
      expect(() => validateAcceptanceTarget({ ...target })).toThrow(
        'REAL_ACCEPTANCE_INVALID_CONFIG:REAL_ACCEPTANCE_PROJECT_REF',
      );
    });
  });

  test('target mutations must still match the journal on consumer entry', async () => {
    await withAllocation(env => {
      const target = parseAcceptanceTarget(env);
      target.runtimeUrl = 'https://other.xai.xigu.team/auth/v1';
      expect(() => validateAcceptanceTarget(target)).toThrow('REAL_ACCEPTANCE_ALLOCATION_MISMATCH');
    });
  });

  test('does not invoke secret-bearing target accessors', () => {
    const target = parseAcceptanceTarget(environment());
    let invoked = false;
    Object.defineProperty(target, 'baseUrl', {
      get() { invoked = true; throw new Error(adminToken); },
    });
    expect(() => validateAcceptanceTarget(target)).toThrow(
      'REAL_ACCEPTANCE_INVALID_CONFIG:REAL_ACCEPTANCE_BASE_URL',
    );
    expect(invoked).toBe(false);
  });

  test('invalid journal paths never fall back to otherwise valid local synthetic configuration', () => {
    expect(rejection(environment({
      REAL_ACCEPTANCE_ALLOCATION_JOURNAL: `relative-${adminToken}`,
    })).message).toBe('REAL_ACCEPTANCE_ALLOCATION_INVALID');
  });

  test('a malformed persisted receipt cannot authorize a target and its contents are redacted', async () => {
    await withAllocation(async (env, directory) => {
      await writeFile(join(directory, 'receipt.json'), JSON.stringify({ secret: adminToken }), { mode: 0o600 });
      expect(rejection(env).message).toBe('REAL_ACCEPTANCE_ALLOCATION_INVALID');
    });
  });

  test('journal path accessors are rejected without invocation', () => {
    const env = environment();
    let invoked = false;
    Object.defineProperty(env, 'REAL_ACCEPTANCE_ALLOCATION_JOURNAL', {
      get() { invoked = true; throw new Error(adminToken); },
    });
    expect(rejection(env).message).toBe('REAL_ACCEPTANCE_ALLOCATION_INVALID');
    expect(invoked).toBe(false);
  });
});

const phases: readonly AcceptancePhase[] = ['postgres', 'backend', 'sdk', 'browser'];
function completed(): PhaseResult[] {
  return phases.map((phase) => ({ phase, status: 'passed', checks: 1, code: 'CHECKS_PASSED' }));
}

describe('real acceptance evidence completeness', () => {
  test('requires all four unique passing phases, independent of ordering', () => {
    expect(acceptancePassed(completed())).toBe(true);
    expect(acceptancePassed(completed().reverse())).toBe(true);
  });

  test.each([0, 1, 2, 3])('rejects missing phases with only %s results', (length) => {
    expect(acceptancePassed(completed().slice(0, length))).toBe(false);
  });

  test.each([...phases])('rejects duplicated or substituted %s phase evidence', (phase) => {
    const duplicate = decodePhaseResult({ phase, status: 'passed', checks: 1, code: 'CHECKS_PASSED' });
    expect(acceptancePassed([...completed(), duplicate])).toBe(false);
    expect(acceptancePassed(Array.from({ length: 4 }, () => duplicate))).toBe(false);
    const missing = completed().filter((result) => result.phase !== phase);
    const [replacement] = missing;
    if (replacement === undefined) throw new Error('Missing test phase fixture');
    expect(acceptancePassed([...missing, replacement])).toBe(false);
  });

  test.each(['failed', 'blocked'])('nonpassing %s phase cannot count as acceptance', (status) => {
    const result = decodePhaseResult({ phase: 'browser', status, checks: 0, code: 'NOT_EXECUTED' });
    expect(acceptancePassed([...completed().slice(0, 3), result])).toBe(false);
  });

  test.each([0, -1, 0.5, NaN, Infinity, Number.MAX_SAFE_INTEGER + 1])(
    'nonpositive or invalid check count cannot pass: %s', (checks) => {
      expect(acceptancePassed(completed().map((result) => ({ ...result, checks })))).toBe(false);
    },
  );

  test.each([
    null, [], {}, { phase: 'mock', status: 'passed', checks: 1, code: 'OK' },
    { phase: 'postgres', status: 'skipped', checks: 1, code: 'OK' },
    { phase: 'postgres', status: 'passed', checks: '1', code: 'OK' },
    { phase: 'postgres', status: 'passed', checks: -1, code: 'OK' },
    { phase: 'postgres', status: 'passed', checks: 1.5, code: 'OK' },
    { phase: 'postgres', status: 'passed', checks: Infinity, code: 'OK' },
    { phase: 'postgres', status: 'passed', checks: 1, code: '' },
    { phase: 'postgres', status: 'passed', checks: 1, code: 'OK', secret: adminToken },
  ].map((value) => ({ value })))('phase decoding rejects invalid external data without input disclosure: %j', ({ value }) => {
    expect(() => decodePhaseResult(value)).toThrow('REAL_ACCEPTANCE_INVALID_PHASE_RESULT');
  });

  test('permits zero-check blocked evidence without treating it as completed work', () => {
    expect(decodePhaseResult({ phase: 'postgres', status: 'blocked', checks: 0, code: 'NO_DATABASE' }))
      .toEqual({ phase: 'postgres', status: 'blocked', checks: 0, code: 'NO_DATABASE' });
  });

  test('does not count sparse arrays as complete evidence', () => {
    const results = completed();
    delete results[0];
    expect(acceptancePassed(results)).toBe(false);
  });
});
