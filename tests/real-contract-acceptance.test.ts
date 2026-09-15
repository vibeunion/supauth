import { describe, expect, test } from 'bun:test';
import { mkdirSync, mkdtempSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { runAcceptance, sourceFingerprint, type AcceptanceRunners } from '../scripts/real-contract-acceptance.js';
import { acceptancePassed, type PhaseResult } from '../scripts/real-contract-acceptance-contract.js';
import { assertStaticCheckoutDoesNotLoadEnv, releaseStaticEnvironment } from '../scripts/release-static-environment.js';

function passed(phase: PhaseResult['phase']): PhaseResult {
  return { phase, status: 'passed', checks: 1, code: 'TEST_DOUBLE' };
}

const environment = {
  REAL_ACCEPTANCE_ENVIRONMENT: 'isolated-test',
  REAL_ACCEPTANCE_PROJECT_REF: 'supauth_contract_1234567890abcdef1234567890abcdef',
  REAL_ACCEPTANCE_CONFIRM_PROJECT: 'supauth_contract_1234567890abcdef1234567890abcdef',
  REAL_ACCEPTANCE_BASE_URL: 'http://127.0.0.1:5191/api',
  REAL_ACCEPTANCE_RUNTIME_URL: 'http://127.0.0.1:5191',
  REAL_ACCEPTANCE_ADMIN_TOKEN: 'test-admin',
  REAL_ACCEPTANCE_USER_TOKEN: 'test-user',
};

function runners(): AcceptanceRunners {
  return {
    postgres: async () => passed('postgres'),
    services: async () => [passed('backend'), passed('sdk')],
    browser: async () => passed('browser'),
  };
}

describe('real acceptance orchestration safety (unit doubles, not live evidence)', () => {
  test('source identity supports pre-existing tracked deletions and ignores nested dotenv', () => {
    const root = mkdtempSync(join(tmpdir(), 'supauth-source-identity-'));
    try {
      expect(Bun.spawnSync(['git', 'init', '-q', root]).exitCode).toBe(0);
      writeFileSync(join(root, 'deleted.ts'), 'export const value = 1;');
      expect(Bun.spawnSync(['git', '-C', root, 'add', 'deleted.ts']).exitCode).toBe(0);
      const initial = sourceFingerprint(root);
      rmSync(join(root, 'deleted.ts'));
      const deleted = sourceFingerprint(root);
      expect(deleted).not.toBe(initial);
      mkdirSync(join(root, 'nested'));
      writeFileSync(join(root, 'nested', '.env.test'), 'SECRET=private');
      expect(sourceFingerprint(root)).toBe(deleted);
      writeFileSync(join(root, 'target.ts'), 'export const value = 1;');
      symlinkSync('target.ts', join(root, 'linked.ts'));
      const linked = sourceFingerprint(root);
      writeFileSync(join(root, 'target.ts'), 'export const value = 2;');
      expect(sourceFingerprint(root)).not.toBe(linked);
      mkdirSync(join(root, 'artifacts'));
      writeFileSync(join(root, 'artifacts', 'payload.ts'), 'export const value = 1;');
      symlinkSync('artifacts/payload.ts', join(root, 'uncovered.ts'));
      expect(() => sourceFingerprint(root)).toThrow('SOURCE_SYMLINK_OUTSIDE_CHECKED_SCOPE');
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  test('missing target still records PostgreSQL but never calls services or browser', async () => {
    const operations = runners();
    operations.services = async () => { throw new Error('must not run'); };
    let browserCalled = false;
    operations.browser = async () => { browserCalled = true; return passed('browser'); };
    const results = await runAcceptance({}, operations);
    expect(results.map(result => result.status)).toEqual(['passed', 'blocked', 'blocked', 'blocked']);
    expect(browserCalled).toBe(false);
    expect(acceptancePassed(results)).toBe(false);
  });

  test('does not promote a missing or duplicated service phase into browser authorization', async () => {
    for (const services of [[], [passed('sdk')], [passed('backend'), passed('backend')]]) {
      const operations = runners();
      operations.services = async () => services;
      operations.browser = async () => { throw new Error('must not run'); };
      const result = await runAcceptance(environment, operations);
      expect(result.at(-1)?.code).toBe('SERVICE_ACCEPTANCE_REQUIRED');
      expect(acceptancePassed(result)).toBe(false);
    }
  });

  test('exceptions are fixed codes and never leak exception messages', async () => {
    const operations = runners();
    operations.postgres = async () => { throw new Error('secret-db-url'); };
    operations.services = async () => { throw new Error('secret-token'); };
    const result = await runAcceptance(environment, operations);
    expect(JSON.stringify(result)).not.toContain('secret-');
    expect(acceptancePassed(result)).toBe(false);
  });

  test('all four runners are required for a passing representative contract gate', async () => {
    expect(acceptancePassed(await runAcceptance(environment, runners()))).toBe(true);
    const operations = runners();
    operations.browser = async () => ({ ...passed('browser'), status: 'blocked', checks: 0 });
    expect(acceptancePassed(await runAcceptance(environment, operations))).toBe(false);
  });
});

describe('release static environment', () => {
  test('refuses nested auto-loaded dotenv files before any nested package command', () => {
    const root = mkdtempSync(join(tmpdir(), 'supauth-release-static-'));
    try {
      const nested = join(root, 'packages', 'example');
      mkdirSync(nested, { recursive: true });
      writeFileSync(join(nested, '.env.example'), 'RUN_SUPACLOUD_LIVE_MUTATION=1');
      expect(() => assertStaticCheckoutDoesNotLoadEnv(root)).not.toThrow();
      writeFileSync(join(nested, '.env.test'), 'REQUIRE_SUPABASE_AUTH_COMPAT=1');
      expect(() => assertStaticCheckoutDoesNotLoadEnv(root)).toThrow('RELEASE_STATIC_DOTENV_CHECKOUT_FORBIDDEN');
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  test('does not let workspace directory links hide a dotenv source', () => {
    const root = mkdtempSync(join(tmpdir(), 'supauth-release-links-'));
    const external = mkdtempSync(join(tmpdir(), 'supauth-external-env-'));
    try {
      mkdirSync(join(root, 'packages'));
      symlinkSync(external, join(root, 'packages', 'external'));
      expect(() => assertStaticCheckoutDoesNotLoadEnv(root)).toThrow('RELEASE_STATIC_SYMLINK_OUTSIDE_CHECKOUT');
      rmSync(join(root, 'packages', 'external'));
      mkdirSync(join(root, 'internal'));
      symlinkSync('../internal', join(root, 'packages', 'internal'));
      expect(() => assertStaticCheckoutDoesNotLoadEnv(root)).not.toThrow();
      writeFileSync(join(root, 'internal', '.env'), 'RUN_SUPACLOUD_LIVE_MUTATION=1');
      expect(() => assertStaticCheckoutDoesNotLoadEnv(root)).toThrow('RELEASE_STATIC_DOTENV_CHECKOUT_FORBIDDEN');
    } finally {
      rmSync(root, { recursive: true, force: true });
      rmSync(external, { recursive: true, force: true });
    }
  });

  test('uses an allowlist, including against strict-only activation and prefixed overrides', () => {
    expect(releaseStaticEnvironment({
      PATH: '/bin',
      HOME: '/home/test',
      RUN_SUPACLOUD_LIVE_MUTATION: '1',
      REQUIRE_SUPABASE_AUTH_COMPAT: '1',
      EDGEFN_SUPAUTH_DATABASE_URL: 'secret',
      DATABASE_URL: 'secret',
      SUPACLOUD_MASTER_TOKEN: 'secret',
      NODE_OPTIONS: '--require=unsafe',
      BUN_OPTIONS: 'unsafe',
      REAL_ACCEPTANCE_ADMIN_TOKEN: 'secret',
    })).toEqual({ PATH: '/bin', HOME: '/home/test' });
  });
});
