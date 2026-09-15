#!/usr/bin/env bun
import { constants } from 'node:fs';
import { lstat, mkdir, open } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { parseEnv } from 'node:util';
import { Type, decodeSchema, type TSchema, type Static } from '../packages/shared/src/schema.js';
import {
  AllocationRunIdSchema, PlatformProjectRefSchema, TEST_IDENTITY_OWNER_REF,
  createAllocationJournal, openAllocationJournal, type AllocationInventory,
} from './real-contract-allocation.js';

const MANAGEMENT = 'http://127.0.0.1:29190';
const AUTHORITY = 'https://auth.xai.xigu.team';
const ROOT = resolve('artifacts/real-contract-deployment');
const ProjectSchema = Type.Object({
  id: Type.String({ minLength: 1 }), ref: PlatformProjectRefSchema,
  name: Type.String({ minLength: 1 }), created_at: Type.String({ minLength: 1 }),
  status: Type.String({ minLength: 1 }),
});
const ProjectDetailSchema = Type.Object({
  ...ProjectSchema.properties, api: Type.Object({ url: Type.String({ minLength: 1 }) }),
});
const OAuthStatusSchema = Type.Object({
  project_ref: Type.Literal(TEST_IDENTITY_OWNER_REF), enabled: Type.Literal(true),
  issuer: Type.Literal(`${AUTHORITY}/auth/v1`),
  authorization_path: Type.Literal('/authorize.html'),
  signing_alg: Type.Literal('ES256'), oidc_id_token_ready: Type.Literal(true),
});
const DescriptorSchema = Type.Object({
  project_ref: PlatformProjectRefSchema, mode: Type.String(),
  authority_project_ref: Type.Literal(TEST_IDENTITY_OWNER_REF),
  local_gotrue_enabled: Type.Boolean(),
});
const SSH = [
  'ssh', '-o', 'BatchMode=yes', '-o', 'StrictHostKeyChecking=yes',
  '-o', 'UpdateHostKeys=no', '-o', 'ConnectTimeout=5',
  '-o', 'ControlMaster=no', '-o', 'ControlPath=none',
  '-o', 'ForwardAgent=no', '-o', 'ClearAllForwardings=yes', 'root@192.168.200.112',
];
const TUNNEL_COMMAND = [
  'ssh', '-o', 'BatchMode=yes', '-o', 'StrictHostKeyChecking=yes',
  '-o', 'UpdateHostKeys=no', '-o', 'ConnectTimeout=5',
  '-o', 'ControlMaster=no', '-o', 'ControlPath=none',
  '-o', 'ForwardAgent=no', '-o', 'ExitOnForwardFailure=yes',
  '-N', '-L', '127.0.0.1:29190:127.0.0.1:9090', 'root@192.168.200.112',
].join(' ');

export function validTestTunnelProcess(command: string, uid: string): boolean {
  return command.trim() === TUNNEL_COMMAND
    && process.getuid !== undefined && uid.trim() === String(process.getuid());
}

class DeploymentError extends Error {
  constructor(readonly code: string, readonly status?: number) { super(code); }
}

async function remoteRead(command: 'hostname' | 'hostname -I' | 'cat /etc/supabase/management-api.env') {
  const child = Bun.spawn([...SSH, command], { stdout: 'pipe', stderr: 'pipe' });
  const output = await new Response(child.stdout).text();
  if (await child.exited !== 0) throw new DeploymentError('TEST_HOST_READ_FAILED');
  return output;
}

async function processOutput(args: string[]): Promise<string> {
  const child = Bun.spawn(args, { stdout: 'pipe', stderr: 'pipe' });
  const output = await new Response(child.stdout).text();
  if (await child.exited !== 0) throw new DeploymentError('TEST_TUNNEL_UNAVAILABLE');
  return output;
}

async function testTunnelIdentity(): Promise<string> {
  const output = await processOutput(['lsof', '-nP', '-iTCP:29190', '-sTCP:LISTEN', '-Fp']);
  const pids = output.trim().split('\n').filter(line => line.startsWith('p'));
  const pidLine = pids[0];
  if (pids.length !== 1 || !pidLine || !/^p[1-9][0-9]*$/.test(pidLine)) {
    throw new DeploymentError('TEST_TUNNEL_IDENTITY_MISMATCH');
  }
  const pid = pidLine.slice(1);
  const command = await processOutput(['ps', '-p', pid, '-o', 'command=']);
  const uid = await processOutput(['ps', '-p', pid, '-o', 'uid=']);
  if (!validTestTunnelProcess(command, uid)) throw new DeploymentError('TEST_TUNNEL_IDENTITY_MISMATCH');
  return pid;
}

export function validManagementPath(path: string, method: 'GET' | 'POST'): boolean {
  if (/^\/v1\/projects(?:\/[a-z]{20}(?:\/[a-z0-9_/-]+)?)?$/.test(path)) return true;
  return method === 'GET'
    && /^\/v1\/projects\/[a-z]{20}\/tasks\?summary=true&limit=100$/.test(path);
}

export async function managementTransport() {
  const tunnelPid = await testTunnelIdentity();
  if ((await remoteRead('hostname')).trim() !== 'i.pigsty'
    || !(await remoteRead('hostname -I')).trim().split(/\s+/).includes('192.168.200.112')) {
    throw new DeploymentError('TEST_HOST_IDENTITY_MISMATCH');
  }
  const values = parseEnv(await remoteRead('cat /etc/supabase/management-api.env'));
  const token = decodeSchema(Type.String({ minLength: 32 }), values['MASTER_TOKEN']);
  return async (path: string, init: {
    method?: 'GET' | 'POST'; body?: unknown;
  } = {}): Promise<{ status: number; body: unknown }> => {
    if (!validManagementPath(path, init.method ?? 'GET')) {
      throw new DeploymentError('TEST_API_DESTINATION_REJECTED');
    }
    if (await testTunnelIdentity() !== tunnelPid) throw new DeploymentError('TEST_TUNNEL_IDENTITY_MISMATCH');
    const response = await fetch(`${MANAGEMENT}${path}`, {
      method: init.method ?? 'GET', redirect: 'error', credentials: 'omit',
      headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
      ...(init.body === undefined ? {} : { body: JSON.stringify(init.body) }),
      signal: AbortSignal.timeout(60_000),
    });
    const value: unknown = await response.json();
    return { status: response.status, body: value };
  };
}

export async function managementClient() {
  const transport = await managementTransport();
  return async <S extends TSchema>(path: string, schema: S, init: {
    method?: 'GET' | 'POST'; body?: unknown;
  } = {}): Promise<Static<S>> => {
    const response = await transport(path, init);
    if (response.status < 200 || response.status >= 300) {
      throw new DeploymentError('TEST_API_REQUEST_FAILED', response.status);
    }
    return decodeSchema(schema, response.body);
  };
}

export async function writeDeploymentEvidence(directory: string, filename: string, value: unknown): Promise<void> {
  if (!/^[a-z0-9-]+\.json$/.test(filename)) throw new DeploymentError('EVIDENCE_NAME_REJECTED');
  const info = await lstat(directory);
  if (!info.isDirectory() || info.isSymbolicLink() || (info.mode & 0o777) !== 0o700) {
    throw new DeploymentError('EVIDENCE_DIRECTORY_REJECTED');
  }
  const file = await open(join(directory, filename),
    constants.O_WRONLY | constants.O_CREAT | constants.O_EXCL | constants.O_NOFOLLOW, 0o600);
  try {
    await file.writeFile(`${JSON.stringify(value, null, 2)}\n`);
    await file.sync();
  } finally { await file.close(); }
  const parent = await open(directory, constants.O_RDONLY | constants.O_NOFOLLOW);
  try { await parent.sync(); } finally { await parent.close(); }
}

async function inventory(request: Awaited<ReturnType<typeof managementClient>>): Promise<AllocationInventory> {
  const projects = await request('/v1/projects', Type.Array(ProjectSchema));
  return { complete: true, projects: projects.map(project => ({ ref: project.ref, name: project.name })) };
}

async function preflight(request: Awaited<ReturnType<typeof managementClient>>) {
  const owner = await request(`/v1/projects/${TEST_IDENTITY_OWNER_REF}/auth/runtime`, DescriptorSchema);
  if (owner.mode !== 'owner' || !owner.local_gotrue_enabled
    || owner.project_ref !== TEST_IDENTITY_OWNER_REF) {
    throw new DeploymentError('TEST_AUTHORITY_MISMATCH');
  }
  const oauth = await request(`/v1/projects/${TEST_IDENTITY_OWNER_REF}/auth/oauth-server`, OAuthStatusSchema);
  return { authorityRef: owner.project_ref, issuer: oauth.issuer, oauthEnabled: oauth.enabled };
}

async function allocate(runId: string): Promise<void> {
  const request = await managementClient();
  const authority = await preflight(request);
  const beforeInventory = await inventory(request);
  await mkdir(ROOT, { mode: 0o700, recursive: true });
  const journal = await createAllocationJournal(ROOT, {
    runId, name: `supauth-contract-${runId}`, managementOrigin: MANAGEMENT,
    projectOrigin: `https://contract-${runId}.xai.xigu.team`,
    authorityRef: TEST_IDENTITY_OWNER_REF, authorityOrigin: AUTHORITY, beforeInventory,
  });
  const receipt = await journal.createOnce(body => request('/v1/projects', ProjectDetailSchema, {
    method: 'POST', body,
  }));
  await writeDeploymentEvidence(join(ROOT, runId), 'authority-preflight.json', authority);
  console.log(JSON.stringify({ stage: 'allocated', projectRef: receipt.ref, runId }));
  await bind(runId);
}

async function bind(runId: string): Promise<void> {
  const request = await managementClient();
  await preflight(request);
  const journal = await openAllocationJournal(ROOT, runId);
  const projects = await inventory(request);
  const matches = projects.projects.filter(project => project.name === `supauth-contract-${runId}`);
  const project = matches[0];
  if (matches.length !== 1 || !project) throw new DeploymentError('PROJECT_ALLOCATION_AMBIGUOUS');
  // 创建接口仅确认分配；必须等待实际项目就绪并核对独立读取的身份描述。
  const deadline = Date.now() + 120_000;
  while (true) {
    const detail = await request(`/v1/projects/${project.ref}`, ProjectDetailSchema);
    if (detail.status === 'ACTIVE_HEALTHY') {
      const descriptor = await request(`/v1/projects/${project.ref}/auth/runtime`, DescriptorSchema);
      const bound = await journal.bind({
        projectReadback: detail, authorityDescriptor: descriptor, authorityOrigin: AUTHORITY,
      });
      console.log(JSON.stringify({ stage: 'bound', projectRef: bound.project.ref, runId }));
      return;
    }
    if (Date.now() >= deadline || /FAIL|ERROR|REMOVED|INACTIVE/.test(detail.status)) {
      throw new DeploymentError('PROJECT_PROVISIONING_NOT_READY');
    }
    await Bun.sleep(2000);
  }
}

if (import.meta.main) {
  try {
    const mode = Bun.argv[2];
    const runId = decodeSchema(AllocationRunIdSchema, Bun.argv[3]);
    if (mode === 'allocate') await allocate(runId);
    else if (mode === 'bind') await bind(runId);
    else throw new DeploymentError('DEPLOYMENT_MODE_INVALID');
  } catch (error) {
    // 不输出远端正文、环境变量、SQL 或第三方异常中的凭据。
    console.error(JSON.stringify({
      code: error instanceof DeploymentError ? error.code : 'DEPLOYMENT_EXECUTION_FAILED',
      ...(error instanceof DeploymentError && error.status !== undefined ? { status: error.status } : {}),
    }));
    process.exitCode = 1;
  }
}
