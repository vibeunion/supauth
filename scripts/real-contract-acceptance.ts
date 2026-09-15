#!/usr/bin/env bun
import { createHash } from 'node:crypto';
import { lstatSync, mkdirSync, readdirSync, readFileSync, readlinkSync, realpathSync, writeFileSync } from 'node:fs';
import { isAbsolute, join, relative } from 'node:path';
import {
  acceptancePassed,
  parseAcceptanceTarget,
  type AcceptanceTarget,
  type PhaseResult,
} from './real-contract-acceptance-contract.js';
import { runPostgresAcceptance } from './real-contract-postgres.js';
import { runServiceAcceptance } from './real-contract-services.js';
import { runBrowserAcceptance } from './real-contract-browser.js';

type Environment = Record<string, string | undefined>;

export interface AcceptanceRunners {
  postgres(): Promise<PhaseResult>;
  services(target: AcceptanceTarget): Promise<PhaseResult[]>;
  browser(target: AcceptanceTarget, env: Environment): Promise<PhaseResult>;
}

function blocked(phase: PhaseResult['phase'], code: string): PhaseResult {
  return { phase, status: 'blocked', checks: 0, code };
}

export async function runAcceptance(
  env: Environment,
  runners: AcceptanceRunners,
): Promise<PhaseResult[]> {
  const results: PhaseResult[] = [];
  try {
    results.push(await runners.postgres());
  } catch {
    results.push({ phase: 'postgres', status: 'failed', checks: 0, code: 'POSTGRES_RUNNER_FAILED' });
  }

  let target: AcceptanceTarget;
  try {
    target = parseAcceptanceTarget(env);
  } catch {
    return [
      ...results,
      blocked('backend', 'ISOLATED_TARGET_REQUIRED'),
      blocked('sdk', 'ISOLATED_TARGET_REQUIRED'),
      blocked('browser', 'ISOLATED_TARGET_REQUIRED'),
    ];
  }

  let services: PhaseResult[];
  try {
    services = await runners.services(target);
  } catch {
    services = [
      { phase: 'backend', status: 'failed', checks: 0, code: 'SERVICE_RUNNER_FAILED' },
      { phase: 'sdk', status: 'failed', checks: 0, code: 'SERVICE_RUNNER_FAILED' },
    ];
  }
  results.push(...services);
  const servicesReady = services.length === 2
    && ['backend', 'sdk'].every(phase => services.filter(result => result.phase === phase
      && result.status === 'passed' && Number.isSafeInteger(result.checks) && result.checks > 0).length === 1);
  if (!servicesReady) {
    results.push(blocked('browser', 'SERVICE_ACCEPTANCE_REQUIRED'));
    return results;
  }
  try {
    results.push(await runners.browser(target, env));
  } catch {
    results.push({ phase: 'browser', status: 'failed', checks: 0, code: 'BROWSER_RUNNER_FAILED' });
  }
  return results;
}

export function sourceFingerprint(root = process.cwd()): string {
  const listed = Bun.spawnSync(['git', 'ls-files', '-co', '--exclude-standard', '-z'], {
    cwd: root, stdout: 'pipe', stderr: 'pipe',
  });
  if (listed.exitCode !== 0) throw new Error('SOURCE_IDENTITY_UNAVAILABLE');
  const paths = new Set(new TextDecoder().decode(listed.stdout).split('\0').filter(path => path
    && !/^(?:\.agents\/|output\/|artifacts\/)/.test(path) && !/(?:^|\/)\.env(?:$|\.)/.test(path)));
  const targetCovered = (path: string): boolean => {
    const absolute = join(root, path);
    if (!lstatSync(absolute).isDirectory()) return paths.has(path);
    return readdirSync(absolute, { withFileTypes: true }).every(entry => targetCovered(join(path, entry.name)));
  };
  const hash = createHash('sha256');
  for (const path of [...paths].sort()) {
    const absolute = join(root, path);
    hash.update(path).update('\0');
    const stat = (() => {
      try {
        return lstatSync(absolute);
      } catch (error) {
        if (error instanceof Error && 'code' in error && error.code === 'ENOENT') return null;
        throw error;
      }
    })();
    if (stat === null) {
      hash.update('deleted\0');
      continue;
    }
    if (stat.isSymbolicLink()) {
      const target = relative(realpathSync(root), realpathSync(absolute));
      if (isAbsolute(target) || target === '..' || target.startsWith('../')
        || !targetCovered(target)) {
        throw new Error('SOURCE_SYMLINK_OUTSIDE_CHECKED_SCOPE');
      }
      // 内部链接的目标必须同时位于枚举源码中，目标内容由同一轮普通文件哈希覆盖。
      hash.update('symlink\0').update(readlinkSync(absolute)).update('\0').update(target).update('\0');
    }
    else if (stat.isFile()) hash.update('file\0').update(readFileSync(absolute)).update('\0');
    else hash.update('directory\0');
  }
  return hash.digest('hex');
}

async function main(): Promise<void> {
  const runId = crypto.randomUUID();
  const directory = join('artifacts', 'real-contract-acceptance', runId);
  mkdirSync(directory, { recursive: true, mode: 0o700 });
  const startedAt = new Date().toISOString();
  const sourceBefore = sourceFingerprint();
  const phases = await runAcceptance(process.env, {
    postgres: runPostgresAcceptance,
    services: runServiceAcceptance,
    browser: runBrowserAcceptance,
  });
  let sourceUnchanged = false;
  try {
    sourceUnchanged = sourceBefore === sourceFingerprint();
  } catch {
    // 验收后的源码读取失败仍须保留已执行结果，不能丢失清理失败等证据。
  }
  const passed = sourceUnchanged && acceptancePassed(phases);
  const report = {
    runId,
    startedAt,
    finishedAt: new Date().toISOString(),
    sourceSha256: sourceBefore,
    sourceUnchanged,
    status: passed ? 'passed' : phases.some(phase => phase.status === 'failed') ? 'failed' : 'partial',
    phases,
    scope: 'Real PostgreSQL, backend authorization, SDK webhook lifecycle and browser acceptance. Not proof of every runtime behavior.',
  };
  const reportPath = join(directory, 'report.json');
  writeFileSync(reportPath, `${JSON.stringify(report, null, 2)}\n`, { mode: 0o600 });
  console.log(JSON.stringify({ status: report.status, phases, reportPath }));
  process.exitCode = passed ? 0 : 1;
}

if (import.meta.main) {
  main().catch(() => {
    console.error('REAL_ACCEPTANCE_RUNNER_FAILED');
    process.exitCode = 1;
  });
}
