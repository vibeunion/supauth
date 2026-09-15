import { randomBytes } from 'node:crypto';
import { constants } from 'node:fs';
import { lstat, mkdir, open } from 'node:fs/promises';
import { isAbsolute, join } from 'node:path';
import { Type, decodeSchema, type Static, type TSchema } from '../packages/shared/src/schema.js';
import {
  allocationProofDetails, TEST_IDENTITY_OWNER_REF, type AllocationProof,
} from './real-contract-allocation.js';
import {
  BrowserIdentityReceiptSchema, browserMfaUser, browserTotpCode,
} from './real-contract-browser.js';

const MANAGEMENT_ORIGIN = 'http://127.0.0.1:29190';
const AUTHORITY_ORIGIN = 'https://auth.xai.xigu.team';
const OWNER_PATH = `/v1/projects/${TEST_IDENTITY_OWNER_REF}/auth`;
const Uuid = Type.String({ pattern: '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$' });
const Text = Type.String({ minLength: 1, maxLength: 4096, pattern: '^[^\\s\\u0000-\\u001f\\u007f]+$' });
const Timestamp = Type.String({ minLength: 1, maxLength: 64 });
const UserSchema = Type.Object({
  id: Uuid, email: Text, created_at: Timestamp,
  email_confirmed_at: Type.Optional(Type.Union([Timestamp, Type.Null()])),
  factors: Type.Optional(Type.Array(Type.Object({
    id: Uuid, factor_type: Type.String(), status: Type.String(),
    friendly_name: Type.Optional(Type.String()),
  }))),
});
const UsersSchema = Type.Object({
  users: Type.Array(Type.Object({ id: Uuid, email: Type.Optional(Type.String()) })),
  total: Type.Integer({ minimum: 0, maximum: 1000 }),
  page: Type.Literal(1), per_page: Type.Literal(100),
});
const ClientId = Type.String({ minLength: 1, maxLength: 160, pattern: '^[A-Za-z0-9_-]+$' });
const ClientSchema = Type.Object({
  client_id: ClientId, client_name: Type.String(),
  client_type: Type.Literal('public'), token_endpoint_auth_method: Type.Literal('none'),
  redirect_uris: Type.Array(Text, { minItems: 1, maxItems: 1 }),
  grant_types: Type.Array(Type.String(), { minItems: 1, maxItems: 2 }),
});
const ClientListSchema = Type.Object({
  clients: Type.Array(Type.Object({ client_id: ClientId, client_name: Type.Optional(Type.String()) }), { maxItems: 100 }),
});
const SessionSchema = Type.Object({
  access_token: Text, refresh_token: Text,
  user: UserSchema,
});
const EnrollmentSchema = Type.Object({
  id: Uuid, type: Type.Literal('totp'),
  totp: Type.Object({ secret: Type.String({ pattern: '^[A-Z2-7]{32}$' }) }),
});
const ChallengeSchema = Type.Object({
  id: Uuid, type: Type.Literal('totp'), expires_at: Type.Integer({ minimum: 1 }),
});
const OwnerSchema = Type.Object({
  project_ref: Type.Literal(TEST_IDENTITY_OWNER_REF), mode: Type.Literal('owner'),
  authority_project_ref: Type.Literal(TEST_IDENTITY_OWNER_REF),
  owner_project_ref: Type.Literal(TEST_IDENTITY_OWNER_REF),
  local_gotrue_enabled: Type.Literal(true),
});
const OAuthReadySchema = Type.Object({
  project_ref: Type.Literal(TEST_IDENTITY_OWNER_REF), enabled: Type.Literal(true),
  issuer: Type.Literal(`${AUTHORITY_ORIGIN}/auth/v1`),
});

type User = Static<typeof UserSchema>;
type Client = Static<typeof ClientSchema>;
type Session = Static<typeof SessionSchema>;
type Receipt = Static<typeof BrowserIdentityReceiptSchema>;
type Role = 'admin' | 'user';
type Code = 'IDENTITY_CONFIG_INVALID' | 'IDENTITY_JOURNAL_FAILED' | 'IDENTITY_BASELINE_CONFLICT'
  | 'IDENTITY_INVENTORY_INCOMPLETE' | 'IDENTITY_TRANSPORT_FAILED' | 'IDENTITY_RESPONSE_INVALID'
  | 'IDENTITY_OWNERSHIP_MISMATCH' | 'IDENTITY_ALREADY_STARTED' | 'IDENTITY_WRITE_UNKNOWN'
  | 'IDENTITY_CLEANUP_UNRESOLVED';

export class IdentityFixtureError extends Error {
  constructor(readonly code: Code) { super(code); this.name = 'IdentityFixtureError'; }
}
function fail(code: Code): never { throw new IdentityFixtureError(code); }
function checked<S extends TSchema>(schema: S, value: unknown): Static<S> {
  try { return decodeSchema(schema, value); } catch { return fail('IDENTITY_RESPONSE_INVALID'); }
}
export interface IdentityFixtureOptions {
  allocationProof: AllocationProof;
  root: string;
  fetchImpl: (url: URL, init: RequestInit) => Promise<Response>;
  managementToken: string;
  publicKey: string;
  /** 仅用于读取完整的 owner OAuth inventory；不得使用新 app 的 key。 */
  ownerServiceRoleKey: string;
  timeoutMs?: number;
}
export interface PreparedRunIdentities {
  receipt: Receipt;
  receiptPath: string;
  admin: { userId: string; email: string; password: string; accessToken: string; refreshToken: string };
  user: { userId: string; email: string; password: string; accessToken: string; refreshToken: string };
  mfa: { userId: string; factorId: string; secret: string };
  clientId: string;
}
export interface IdentityCleanupResult {
  status: 'complete' | 'unresolved';
  code: 'IDENTITY_CLEANUP_COMPLETE' | 'IDENTITY_CLEANUP_UNRESOLVED';
}
type OwnedUser = { creation: User; readback: User | null; session: Session | null };

async function privateDirectory(path: string): Promise<void> {
  const info = await lstat(path);
  if (!info.isDirectory() || info.isSymbolicLink() || (info.mode & 0o7777) !== 0o700
    || info.uid !== process.getuid?.()) fail('IDENTITY_JOURNAL_FAILED');
}
async function writePrivate(directory: string, name: string, value: unknown): Promise<void> {
  try {
    await privateDirectory(directory);
    const file = await open(join(directory, name),
      constants.O_WRONLY | constants.O_CREAT | constants.O_EXCL | constants.O_NOFOLLOW, 0o600);
    try {
      await file.writeFile(`${JSON.stringify(value)}\n`);
      await file.sync();
    } finally { await file.close(); }
    const parent = await open(directory, constants.O_RDONLY | constants.O_NOFOLLOW);
    try { await parent.sync(); } finally { await parent.close(); }
  } catch { fail('IDENTITY_JOURNAL_FAILED'); }
}
function userReceipt(user: User) {
  return { id: user.id, email: user.email, createdAt: user.created_at };
}
function clientReceipt(client: Client) {
  const redirectUri = client.redirect_uris[0];
  if (!redirectUri) fail('IDENTITY_RESPONSE_INVALID');
  return { id: client.client_id, name: client.client_name, redirectUri };
}

/** 没有默认 fetch 或环境加载；调用方负责提供本轮已验证 allocation 和受保护凭据。 */
export async function createRunIdentityFixture(options: IdentityFixtureOptions) {
  const allocation = allocationProofDetails(options.allocationProof);
  const timeoutMs = options.timeoutMs ?? 8000;
  if (!allocation || allocation.authorityRef !== TEST_IDENTITY_OWNER_REF
    || allocation.authorityOrigin !== AUTHORITY_ORIGIN || !isAbsolute(options.root)
    || !Number.isSafeInteger(timeoutMs) || timeoutMs <= 0 || timeoutMs > 30_000) fail('IDENTITY_CONFIG_INVALID');
  let managementToken: string;
  let publicKey: string;
  let ownerKey: string;
  try {
    managementToken = decodeSchema(Text, options.managementToken);
    publicKey = decodeSchema(Text, options.publicKey);
    ownerKey = decodeSchema(Text, options.ownerServiceRoleKey);
    if (publicKey === ownerKey) fail('IDENTITY_CONFIG_INVALID');
  } catch { return fail('IDENTITY_CONFIG_INVALID'); }
  const fetchImpl = options.fetchImpl;
  const name = `supauth-contract-${allocation.runId}`;
  const emails = { admin: `admin-${allocation.runId}@xai.xigu.team`, user: `user-${allocation.runId}@xai.xigu.team` };
  const redirectUri = `${allocation.projectOrigin}/admin`;
  const recordedAt = new Date(Math.floor(Date.now() / 1000) * 1000).toISOString();
  const intent = {
    version: 1, runId: allocation.runId, projectRef: allocation.projectRef,
    authorityRef: allocation.authorityRef, authorityOrigin: allocation.authorityOrigin,
    adminEmail: emails.admin, userEmail: emails.user, clientName: name, redirectUri, recordedAt,
  };
  const directory = join(options.root, `identities-${allocation.runId}`);
  try {
    await privateDirectory(options.root);
    await mkdir(directory, { mode: 0o700 });
    await writePrivate(directory, 'intent.json', intent);
  } catch { return fail('IDENTITY_JOURNAL_FAILED'); }
  let sequence = 0;
  let started = false;
  let cleaning = false;
  let cleaned = false;
  let busy = false;
  let unknownWrite = false;
  const owned: { admin: OwnedUser | null; user: OwnedUser | null; client: Client | null; factorId: string | null } = {
    admin: null, user: null, client: null, factorId: null,
  };
  const log = (step: string, data: unknown = null) => writePrivate(directory,
    `${String(++sequence).padStart(3, '0')}-${step}.json`, { step, data });

  async function request(
    area: 'management' | 'runtime' | 'inventory', path: string, method = 'GET',
    body?: unknown, bearer?: string,
  ): Promise<{ response: Response; value: unknown }> {
    const url = new URL(area === 'management' ? `${MANAGEMENT_ORIGIN}${OWNER_PATH}${path}`
      : `${AUTHORITY_ORIGIN}/auth/v1${path}`);
    if (area === 'inventory' && (method !== 'GET' || url.pathname !== '/auth/v1/admin/oauth/clients')) {
      fail('IDENTITY_CONFIG_INVALID');
    }
    const headers = new Headers({ accept: 'application/json' });
    if (area === 'management') {
      headers.set('authorization', `Bearer ${managementToken}`);
      headers.set('x-project-ref', TEST_IDENTITY_OWNER_REF);
    } else {
      headers.set('apikey', area === 'inventory' ? ownerKey : publicKey);
      if (area === 'inventory') headers.set('authorization', `Bearer ${ownerKey}`);
      else if (bearer) headers.set('authorization', `Bearer ${bearer}`);
    }
    if (body !== undefined) headers.set('content-type', 'application/json');
    const controller = new AbortController();
    let timer: ReturnType<typeof setTimeout> | undefined;
    const deadline = new Promise<never>((_resolve, reject) => {
      timer = setTimeout(() => {
        controller.abort();
        reject(new IdentityFixtureError('IDENTITY_TRANSPORT_FAILED'));
      }, timeoutMs);
    });
    try {
      return await Promise.race([deadline, (async () => {
        const response = await fetchImpl(url, {
          method, headers, redirect: 'error', credentials: 'omit', cache: 'no-store',
          signal: controller.signal, ...(body === undefined ? {} : { body: JSON.stringify(body) }),
        });
        if (response.redirected || (response.status >= 300 && response.status < 400)
          || (response.url && response.url !== url.href)) fail('IDENTITY_RESPONSE_INVALID');
        const reader = response.body?.getReader();
        let text = '';
        let length = 0;
        if (reader) {
          const decoder = new TextDecoder('utf-8', { fatal: true });
          try {
            while (true) {
              const part = await reader.read();
              if (part.done) break;
              length += part.value.byteLength;
              if (length > 1_000_000) fail('IDENTITY_RESPONSE_INVALID');
              text += decoder.decode(part.value, { stream: true });
            }
            text += decoder.decode();
          } finally { await reader.cancel(); reader.releaseLock(); }
        }
        if (!response.ok && response.status !== 404) fail('IDENTITY_TRANSPORT_FAILED');
        const value: unknown = text ? JSON.parse(text) : null;
        return { response, value };
      })()]);
    } catch (error) {
      if (error instanceof IdentityFixtureError) throw error;
      return fail('IDENTITY_TRANSPORT_FAILED');
    } finally { if (timer !== undefined) clearTimeout(timer); }
  }
  async function mutation(
    step: string, area: 'management' | 'runtime', path: string, method: string,
    body?: unknown, bearer?: string,
  ): Promise<unknown> {
    await log(`${step}-started`);
    try {
      const result = await request(area, path, method, body, bearer);
      if (!result.response.ok) fail('IDENTITY_RESPONSE_INVALID');
      return result.value;
    } catch {
      unknownWrite = true;
      await log(`${step}-unknown`);
      return fail('IDENTITY_WRITE_UNKNOWN');
    }
  }
  function sameUser(value: unknown, expected: User): User {
    const user = checked(UserSchema, value);
    if (user.id !== expected.id || user.email !== expected.email || user.created_at !== expected.created_at) {
      fail('IDENTITY_OWNERSHIP_MISMATCH');
    }
    return user;
  }
  function ownedClient(value: unknown): Client {
    const client = checked(ClientSchema, value);
    if (client.client_name !== name || client.redirect_uris[0] !== redirectUri
      || new Set(client.grant_types).size !== client.grant_types.length
      || !client.grant_types.includes('authorization_code')
      || client.grant_types.some(grant => !['authorization_code', 'refresh_token'].includes(grant))) {
      fail('IDENTITY_OWNERSHIP_MISMATCH');
    }
    return client;
  }
  async function baseline(): Promise<void> {
    checked(OwnerSchema, (await request('management', '/runtime')).value);
    checked(OAuthReadySchema, (await request('management', '/oauth-server')).value);
    for (const email of [emails.admin, emails.user]) {
      const query = new URLSearchParams({ search: email, page: '1', per_page: '100' });
      const result = checked(UsersSchema, (await request('management', `/users?${query}`)).value);
      if (result.total !== 0 || result.users.length !== 0) fail('IDENTITY_BASELINE_CONFLICT');
    }
    const seen = new Set<string>();
    let total: number | undefined;
    for (let page = 1; page <= 10; page++) {
      const result = await request('inventory', `/admin/oauth/clients?page=${page}&per_page=100`);
      const count = result.response.headers.get('x-total-count');
      if (count === null || !/^(?:0|[1-9][0-9]*)$/.test(count)) fail('IDENTITY_INVENTORY_INCOMPLETE');
      const expected = Number(count);
      if (expected > 1000 || (total !== undefined && total !== expected)) fail('IDENTITY_INVENTORY_INCOMPLETE');
      total = expected;
      const list = checked(ClientListSchema, result.value).clients;
      if (list.length !== Math.min(100, total - seen.size)) fail('IDENTITY_INVENTORY_INCOMPLETE');
      for (const client of list) {
        if (client.client_name === name) fail('IDENTITY_BASELINE_CONFLICT');
        if (seen.has(client.client_id)) fail('IDENTITY_INVENTORY_INCOMPLETE');
        seen.add(client.client_id);
      }
      if (seen.size === total) {
        await log('baseline-zero', {
          matchingAdminUserIds: [], matchingUserIds: [], matchingClientIds: [], oauthInventoryCount: total,
        });
        return;
      }
    }
    fail('IDENTITY_INVENTORY_INCOMPLETE');
  }
  async function createUser(role: Role, password: string): Promise<OwnedUser> {
    const value = await mutation(`create-${role}`, 'management', '/users', 'POST', {
      email: emails[role], password, email_confirm: true,
    });
    let user: User;
    try {
      user = checked(UserSchema, value);
      if (user.email !== emails[role] || !Number.isFinite(Date.parse(user.created_at))
        || Date.parse(user.created_at) < Date.parse(recordedAt)) fail('IDENTITY_OWNERSHIP_MISMATCH');
    } catch { unknownWrite = true; return fail('IDENTITY_WRITE_UNKNOWN'); }
    const entry: OwnedUser = { creation: user, readback: null, session: null };
    owned[role] = entry;
    await log(`create-${role}-receipt`, userReceipt(user));
    const read = sameUser((await request('management', `/users/${user.id}`)).value, user);
    if (!read.email_confirmed_at || !Number.isFinite(Date.parse(read.email_confirmed_at))) {
      fail('IDENTITY_RESPONSE_INVALID');
    }
    entry.readback = read;
    await log(`create-${role}-readback`, userReceipt(read));
    return entry;
  }
  async function login(entry: OwnedUser, password: string, role: Role): Promise<Session> {
    const result = await mutation(`login-${role}`, 'runtime', '/token?grant_type=password', 'POST', {
      email: entry.creation.email, password,
    });
    const session = checked(SessionSchema, result);
    sameUser(session.user, entry.creation);
    entry.session = session;
    sameUser((await request('runtime', '/user', 'GET', undefined, session.access_token)).value, entry.creation);
    await log(`login-${role}-confirmed`, { userId: entry.creation.id });
    return session;
  }
  async function prepare(): Promise<PreparedRunIdentities> {
    if (started || cleaning || cleaned) fail('IDENTITY_ALREADY_STARTED');
    started = true;
    busy = true;
    try {
      await baseline();
      const adminPassword = randomBytes(36).toString('base64url');
      const userPassword = randomBytes(36).toString('base64url');
      const admin = await createUser('admin', adminPassword);
      const user = await createUser('user', userPassword);
      const clientValue = await mutation('create-client', 'management', '/oauth-clients', 'POST', {
        client_name: name, client_type: 'public', token_endpoint_auth_method: 'none',
        redirect_uris: [redirectUri], grant_types: ['authorization_code', 'refresh_token'],
      });
      let client: Client;
      try { client = ownedClient(clientValue); } catch { unknownWrite = true; return fail('IDENTITY_WRITE_UNKNOWN'); }
      owned.client = client;
      await log('create-client-receipt', clientReceipt(client));
      const clientReadback = ownedClient((await request('management', `/oauth-clients/${client.client_id}`)).value);
      if (clientReadback.client_id !== client.client_id) fail('IDENTITY_OWNERSHIP_MISMATCH');
      await log('create-client-readback', clientReceipt(clientReadback));
      const adminSession = await login(admin, adminPassword, 'admin');
      const userSession = await login(user, userPassword, 'user');
      const beforeFactor = sameUser((await request('runtime', '/user', 'GET', undefined,
        adminSession.access_token)).value, admin.creation);
      if ((beforeFactor.factors ?? []).length !== 0) fail('IDENTITY_BASELINE_CONFLICT');
      await log('factor-baseline-zero', { userId: admin.creation.id, matchingFactorIds: [] });
      const enrollmentValue = await mutation('enroll-factor', 'runtime', '/factors', 'POST', {
        factor_type: 'totp', friendly_name: name, issuer: 'SupaAuth acceptance',
      }, adminSession.access_token);
      let enrollment: Static<typeof EnrollmentSchema>;
      try { enrollment = checked(EnrollmentSchema, enrollmentValue); }
      catch { unknownWrite = true; return fail('IDENTITY_WRITE_UNKNOWN'); }
      owned.factorId = enrollment.id;
      const factor = { id: enrollment.id, userId: admin.creation.id, factorType: 'totp' };
      await log('enroll-factor-receipt', factor);
      const enrolledUser = sameUser((await request('runtime', '/user', 'GET', undefined,
        adminSession.access_token)).value, admin.creation);
      const enrolled = enrolledUser.factors?.[0];
      if (enrolledUser.factors?.length !== 1 || !enrolled || enrolled.id !== enrollment.id
        || enrolled.factor_type !== 'totp' || enrolled.status !== 'unverified'
        || enrolled.friendly_name !== name) fail('IDENTITY_OWNERSHIP_MISMATCH');
      await log('enroll-factor-readback', factor);
      const factorBase = `/factors/${enrollment.id}`;
      const challenge = checked(ChallengeSchema, await mutation('challenge-factor', 'runtime',
        `${factorBase}/challenge`, 'POST', { factorId: enrollment.id }, adminSession.access_token));
      if (challenge.expires_at * 1000 <= Date.now()) fail('IDENTITY_RESPONSE_INVALID');
      const verification = checked(SessionSchema, await mutation('verify-factor', 'runtime',
        `${factorBase}/verify`, 'POST', {
          challenge_id: challenge.id, code: await browserTotpCode(enrollment.totp.secret),
        }, adminSession.access_token));
      sameUser(verification.user, admin.creation);
      admin.session = verification;
      const readback = (await request('runtime', '/user', 'GET', undefined, verification.access_token)).value;
      sameUser(readback, admin.creation);
      if (!browserMfaUser(readback, { userId: admin.creation.id, email: emails.admin, factorId: enrollment.id })) {
        fail('IDENTITY_OWNERSHIP_MISMATCH');
      }
      if (!admin.readback) fail('IDENTITY_RESPONSE_INVALID');
      const receipt = checked(BrowserIdentityReceiptSchema, {
        version: 1, runId: intent.runId, projectRef: intent.projectRef, authorityRef: intent.authorityRef,
        intent: { email: emails.admin, clientName: name, redirectUri, recordedAt },
        before: { matchingUserIds: [], matchingClientIds: [] },
        user: { creation: userReceipt(admin.creation), readback: userReceipt(admin.readback) },
        client: { creation: clientReceipt(client), readback: clientReceipt(clientReadback) },
        factor: { creation: factor, readback: { ...factor, status: 'verified' } },
      });
      await writePrivate(directory, 'browser-identity-receipt.json', receipt);
      await log('prepared', { adminUserId: admin.creation.id, userId: user.creation.id, clientId: client.client_id });
      return {
        receipt, receiptPath: join(directory, 'browser-identity-receipt.json'), clientId: client.client_id,
        admin: {
          userId: admin.creation.id, email: emails.admin, password: adminPassword,
          accessToken: verification.access_token, refreshToken: verification.refresh_token,
        },
        user: {
          userId: user.creation.id, email: emails.user, password: userPassword,
          accessToken: userSession.access_token, refreshToken: userSession.refresh_token,
        },
        mfa: { userId: admin.creation.id, factorId: enrollment.id, secret: enrollment.totp.secret },
      };
    } catch (error) {
      const code = error instanceof IdentityFixtureError ? error.code : 'IDENTITY_RESPONSE_INVALID';
      await log('prepare-stopped', { code });
      throw new IdentityFixtureError(code);
    } finally { busy = false; }
  }
  async function cleanup(): Promise<IdentityCleanupResult> {
    if (busy || cleaning || cleaned) fail('IDENTITY_ALREADY_STARTED');
    cleaning = true;
    let unresolved = unknownWrite;
    try {
      for (const role of ['admin', 'user'] satisfies Role[]) {
        const entry = owned[role];
        if (!entry) continue;
        try {
          const current = await request('management', `/users/${entry.creation.id}`);
          if (current.response.status === 404) {
            await log(`cleanup-${role}-already-absent`, { id: entry.creation.id });
            continue;
          }
          const user = sameUser(current.value, entry.creation);
          // GoTrue 可省略空 factors；出现不属于本轮的 factor 时，连用户级级联删除也禁止。
          if ((user.factors ?? []).some(factor => role !== 'admin' || factor.id !== owned.factorId
            || factor.factor_type !== 'totp' || factor.friendly_name !== name)) {
            fail('IDENTITY_OWNERSHIP_MISMATCH');
          }
          if (entry.session) {
            sameUser((await request('runtime', '/user', 'GET', undefined, entry.session.access_token)).value, entry.creation);
            await mutation(`logout-${role}`, 'runtime', '/logout?scope=local', 'POST', undefined, entry.session.access_token);
            entry.session = null;
          }
          if (role === 'admin' && owned.factorId) {
            const factor = user.factors?.find(value => value.id === owned.factorId);
            if (!factor || factor.factor_type !== 'totp' || factor.friendly_name !== name) {
              fail('IDENTITY_OWNERSHIP_MISMATCH');
            }
            await mutation('delete-factor', 'management',
              `/users/${user.id}/mfa/${owned.factorId}/reset`, 'POST');
            const after = sameUser((await request('management', `/users/${user.id}`)).value, entry.creation);
            if ((after.factors ?? []).length !== 0) fail('IDENTITY_CLEANUP_UNRESOLVED');
            owned.factorId = null;
          }
          await mutation(`delete-${role}`, 'management', `/users/${user.id}`, 'DELETE');
          if ((await request('management', `/users/${user.id}`)).response.status !== 404) fail('IDENTITY_CLEANUP_UNRESOLVED');
          await log(`cleanup-${role}-confirmed`, { id: user.id });
        } catch { unresolved = true; await log(`cleanup-${role}-unresolved`, { id: entry.creation.id }); }
      }
      if (owned.client) {
        const expected = owned.client;
        try {
          const current = await request('management', `/oauth-clients/${expected.client_id}`);
          if (current.response.status !== 404) {
            if (ownedClient(current.value).client_id !== expected.client_id) fail('IDENTITY_OWNERSHIP_MISMATCH');
            await mutation('delete-client', 'management', `/oauth-clients/${expected.client_id}`, 'DELETE');
            if ((await request('management', `/oauth-clients/${expected.client_id}`)).response.status !== 404) {
              fail('IDENTITY_CLEANUP_UNRESOLVED');
            }
          }
          await log('cleanup-client-confirmed', { id: expected.client_id });
        } catch { unresolved = true; await log('cleanup-client-unresolved', { id: expected.client_id }); }
      }
      const result: IdentityCleanupResult = unresolved
        ? { status: 'unresolved', code: 'IDENTITY_CLEANUP_UNRESOLVED' }
        : { status: 'complete', code: 'IDENTITY_CLEANUP_COMPLETE' };
      await log('cleanup-finished', result);
      cleaned = true;
      return result;
    } finally { cleaning = false; }
  }
  return { prepare, cleanup, journalDirectory: directory };
}
