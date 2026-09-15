import { isIP } from 'node:net';
import { Type, decodeSchema, type Static } from '../packages/shared/src/schema.js';
import {
  allocationProofDetails, allocationTargetMatches, loadAllocationProof,
  type AllocationProof,
} from './real-contract-allocation.js';

type TargetKey =
  | 'REAL_ACCEPTANCE_BASE_URL'
  | 'REAL_ACCEPTANCE_RUNTIME_URL'
  | 'REAL_ACCEPTANCE_PROJECT_REF'
  | 'REAL_ACCEPTANCE_ADMIN_TOKEN'
  | 'REAL_ACCEPTANCE_USER_TOKEN'
  | 'REAL_ACCEPTANCE_ENVIRONMENT'
  | 'REAL_ACCEPTANCE_CONFIRM_PROJECT';

export interface AcceptanceTarget {
  baseUrl: string;
  runtimeUrl: string;
  projectRef: string;
  adminToken: string;
  userToken: string;
}

const targetAllocations = new WeakMap<AcceptanceTarget, AllocationProof>();

const EnvironmentValueSchema = Type.String({
  minLength: 1, pattern: '^[^\\s\\u0000-\\u001f\\u007f]+$',
});
const ProjectRefSchema = Type.String({ pattern: '^supauth_contract_[0-9a-f]{32}$' });
const PhaseSchema = Type.Union([
  Type.Literal('postgres'), Type.Literal('backend'), Type.Literal('sdk'), Type.Literal('browser'),
]);
const PhaseResultSchema = Type.Object({
  phase: PhaseSchema,
  status: Type.Union([Type.Literal('passed'), Type.Literal('failed'), Type.Literal('blocked')]),
  checks: Type.Integer({ minimum: 0, maximum: Number.MAX_SAFE_INTEGER }),
  code: Type.String({ minLength: 1 }),
}, { additionalProperties: false });
const PhaseResultsSchema = Type.Array(PhaseResultSchema, { minItems: 4, maxItems: 4 });

export type AcceptancePhase = Static<typeof PhaseSchema>;
export type PhaseResult = Static<typeof PhaseResultSchema>;

function invalidTarget(key: TargetKey): Error {
  return new Error(`REAL_ACCEPTANCE_INVALID_CONFIG:${key}`);
}

function environmentValue(env: Record<string, string | undefined>, key: TargetKey): string {
  try {
    const descriptor = Object.getOwnPropertyDescriptor(env, key);
    if (!descriptor || !Object.hasOwn(descriptor, 'value')) throw invalidTarget(key);
    const value: unknown = descriptor.value;
    return decodeSchema(EnvironmentValueSchema, value);
  } catch {
    // 不读取访问器，也不保留原始异常的 message/cause 或环境值。
    throw invalidTarget(key);
  }
}

function targetUrl(value: string, key: TargetKey): URL {
  try {
    // 拒绝 URL 解析器会修复的歧义输入；验收目标不需要编码或隐式 scheme。
    if (/[\u0000-\u0020\u007f\\%?#]/.test(value)) throw invalidTarget(key);
    const authority = /^https?:\/\/([^/?#]+)/i.exec(value)?.[1];
    if (!authority || authority.includes('@')) throw invalidTarget(key);
    const url = new URL(value);
    if (url.protocol !== 'https:' && url.protocol !== 'http:') throw invalidTarget(key);
    if (url.username || url.password || url.search || url.hash) throw invalidTarget(key);

    const hostname = url.hostname.toLowerCase();
    const productionHost = hostname.replace(/\.+$/, '');
    if (productionHost === 'auth.ai.xigu.team' || productionHost.endsWith('.auth.ai.xigu.team')) {
      throw invalidTarget(key);
    }
    const suppliedHost = authority.startsWith('[')
      ? authority.slice(0, authority.indexOf(']') + 1)
      : authority.split(':')[0];
    // 十进制整数、八进制、十六进制或缩写 IPv4 不作为可审计的目标表达式。
    if (isIP(hostname) === 4 && suppliedHost !== hostname) throw invalidTarget(key);
    if (url.protocol === 'http:' && !loopbackTarget(url)) throw invalidTarget(key);
    return url;
  } catch {
    throw invalidTarget(key);
  }
}

function loopbackTarget(url: URL): boolean {
  return url.hostname === 'localhost' || url.hostname === '[::1]'
    || (isIP(url.hostname) === 4 && url.hostname.startsWith('127.'));
}

function parseTarget(
  env: Record<string, string | undefined>, allocation: AllocationProof | undefined,
): AcceptanceTarget {
  const environment = environmentValue(env, 'REAL_ACCEPTANCE_ENVIRONMENT');
  if (environment !== 'isolated-test') throw invalidTarget('REAL_ACCEPTANCE_ENVIRONMENT');
  const projectRef = environmentValue(env, 'REAL_ACCEPTANCE_PROJECT_REF');
  if (allocation === undefined) {
    try {
      decodeSchema(ProjectRefSchema, projectRef);
    } catch {
      throw invalidTarget('REAL_ACCEPTANCE_PROJECT_REF');
    }
  }
  if (environmentValue(env, 'REAL_ACCEPTANCE_CONFIRM_PROJECT') !== projectRef) {
    throw invalidTarget('REAL_ACCEPTANCE_CONFIRM_PROJECT');
  }
  const base = targetUrl(environmentValue(env, 'REAL_ACCEPTANCE_BASE_URL'), 'REAL_ACCEPTANCE_BASE_URL');
  const runtime = targetUrl(
    environmentValue(env, 'REAL_ACCEPTANCE_RUNTIME_URL'), 'REAL_ACCEPTANCE_RUNTIME_URL',
  );
  const baseUrl = base.href.replace(/\/+$/, '');
  const runtimeUrl = runtime.href.replace(/\/+$/, '');
  if (allocation === undefined) {
    if (base.origin !== runtime.origin) throw new Error('REAL_ACCEPTANCE_TARGET_ORIGIN_MISMATCH');
    if (!loopbackTarget(base) || !loopbackTarget(runtime)) {
      throw new Error('REAL_ACCEPTANCE_ALLOCATION_REQUIRED');
    }
  } else if (!allocationTargetMatches(allocation, { projectRef, baseUrl, runtimeUrl })) {
    throw new Error('REAL_ACCEPTANCE_ALLOCATION_MISMATCH');
  }
  const adminToken = environmentValue(env, 'REAL_ACCEPTANCE_ADMIN_TOKEN');
  const userToken = environmentValue(env, 'REAL_ACCEPTANCE_USER_TOKEN');
  const target = { baseUrl, runtimeUrl, projectRef, adminToken, userToken };
  if (allocation !== undefined) targetAllocations.set(target, allocation);
  return target;
}

export function parseAcceptanceTarget(env: Record<string, string | undefined>): AcceptanceTarget {
  let allocation: AllocationProof | undefined;
  try {
    allocation = loadAllocationProof(env);
  } catch {
    throw new Error('REAL_ACCEPTANCE_ALLOCATION_INVALID');
  }
  return parseTarget(env, allocation);
}

/** 真实目标授权只保存在本进程中；复制字段或自行拼装对象不能复制 journal 授权。 */
export function validateAcceptanceTarget(target: AcceptanceTarget): AcceptanceTarget {
  function ownValue(key: keyof AcceptanceTarget, envKey: TargetKey): string {
    try {
      const descriptor = Object.getOwnPropertyDescriptor(target, key);
      if (!descriptor || !Object.hasOwn(descriptor, 'value')) throw invalidTarget(envKey);
      const value: unknown = descriptor.value;
      return decodeSchema(EnvironmentValueSchema, value);
    } catch {
      throw invalidTarget(envKey);
    }
  }
  const projectRef = ownValue('projectRef', 'REAL_ACCEPTANCE_PROJECT_REF');
  return parseTarget({
    REAL_ACCEPTANCE_ENVIRONMENT: 'isolated-test',
    REAL_ACCEPTANCE_PROJECT_REF: projectRef,
    REAL_ACCEPTANCE_CONFIRM_PROJECT: projectRef,
    REAL_ACCEPTANCE_BASE_URL: ownValue('baseUrl', 'REAL_ACCEPTANCE_BASE_URL'),
    REAL_ACCEPTANCE_RUNTIME_URL: ownValue('runtimeUrl', 'REAL_ACCEPTANCE_RUNTIME_URL'),
    REAL_ACCEPTANCE_ADMIN_TOKEN: ownValue('adminToken', 'REAL_ACCEPTANCE_ADMIN_TOKEN'),
    REAL_ACCEPTANCE_USER_TOKEN: ownValue('userToken', 'REAL_ACCEPTANCE_USER_TOKEN'),
  }, targetAllocations.get(target));
}

export function acceptanceAllocationDetails(target: AcceptanceTarget) {
  const validated = validateAcceptanceTarget(target);
  return allocationProofDetails(targetAllocations.get(validated));
}

export function decodePhaseResult(value: unknown): PhaseResult {
  try {
    return decodeSchema(PhaseResultSchema, value);
  } catch {
    throw new Error('REAL_ACCEPTANCE_INVALID_PHASE_RESULT');
  }
}

export function acceptancePassed(results: readonly PhaseResult[]): boolean {
  try {
    const decoded = decodeSchema(PhaseResultsSchema, results);
    const phases = new Set<AcceptancePhase>();
    for (const result of decoded) {
      if (result.status !== 'passed' || result.checks <= 0 || phases.has(result.phase)) return false;
      phases.add(result.phase);
    }
    return phases.size === 4;
  } catch {
    return false;
  }
}
