/**
 * Real Supabase component compatibility checks.
 *
 * The fixture project must expose the RLS table, private bucket, Realtime
 * publication, and JWT-protected Function named below. Strict mode fails when
 * the project URL or keys are absent; it never registers skipped tests.
 */

import { afterAll, beforeAll, describe, expect, it } from 'bun:test';
import { createClient, type RealtimeChannel, type SupabaseClient } from '@supabase/supabase-js';

const STRICT_COMPAT = process.env.REQUIRE_SUPABASE_AUTH_COMPAT === '1';
const RUN_FULL_STACK = STRICT_COMPAT || process.env.RUN_SUPABASE_FULL_STACK_COMPAT === '1';
const RUNTIME_URL = trimTrailingSlash(
  process.env.SUPABASE_FULLSTACK_URL || process.env.OAUTH_RUNTIME_URL || '',
);
const ANON_KEY = process.env.SUPABASE_FULLSTACK_ANON_KEY || process.env.SUPABASE_ANON_KEY || '';
const SERVICE_ROLE_KEY = process.env.SUPABASE_FULLSTACK_SERVICE_ROLE_KEY
  || process.env.SUPABASE_SERVICE_ROLE_KEY
  || '';
const TEST_PASSWORD = process.env.SUPABASE_FULLSTACK_TEST_PASSWORD
  || process.env.SUPABASE_TEST_PASSWORD
  || 'GotrueCompat123!';
const RLS_TABLE = process.env.SUPABASE_COMPAT_RLS_TABLE || 'gotrue_compat_items';
const STORAGE_BUCKET = process.env.SUPABASE_COMPAT_STORAGE_BUCKET || 'gotrue-compat-private';
const FUNCTION_NAME = process.env.SUPABASE_COMPAT_FUNCTION_NAME || 'compat-claims';
const TEST_TIMEOUT_MS = parseInt(process.env.SUPABASE_FULLSTACK_TIMEOUT_MS || '30000', 10);
const RUN_ID = `${Date.now()}-${crypto.randomUUID().slice(0, 8)}`;

if (STRICT_COMPAT) {
  assertRequiredValues({
    SUPABASE_FULLSTACK_URL: RUNTIME_URL,
    SUPABASE_FULLSTACK_ANON_KEY: ANON_KEY,
    SUPABASE_FULLSTACK_SERVICE_ROLE_KEY: SERVICE_ROLE_KEY,
  });
}

interface AuthenticatedFixture {
  client: SupabaseClient;
  userId: string;
}

type FullStackTestHandler = () => void | Promise<unknown>;

function fullStackIt(name: string, handler: FullStackTestHandler) {
  if (RUN_FULL_STACK) it(name, handler, TEST_TIMEOUT_MS);
}

describe('Stock GoTrue token compatibility with Supabase services', () => {
  let adminClient: SupabaseClient;
  let primary: AuthenticatedFixture;
  let secondary: AuthenticatedFixture;
  let realtimeChannel: RealtimeChannel | undefined;
  const createdRowIds: string[] = [];
  const primaryObjectPath = () => `${primary.userId}/${RUN_ID}.txt`;

  beforeAll(async () => {
    if (!RUN_FULL_STACK) return;
    adminClient = supabaseClient(SERVICE_ROLE_KEY);
    primary = await createAuthenticatedFixture(adminClient, 'primary');
    secondary = await createAuthenticatedFixture(adminClient, 'secondary');
  }, TEST_TIMEOUT_MS);

  fullStackIt('enforces owner-based PostgREST RLS with a real GoTrue JWT', async () => {
    const primaryRow = await insertOwnedRow(primary, `primary-${RUN_ID}`);
    const secondaryRow = await insertOwnedRow(secondary, `secondary-${RUN_ID}`);
    createdRowIds.push(primaryRow.id, secondaryRow.id);

    const crossOwnerInsert = await secondary.client
      .from(RLS_TABLE)
      .insert({ owner_id: primary.userId, payload: `forbidden-${RUN_ID}` })
      .select('id');
    expect(crossOwnerInsert.error).not.toBeNull();

    const visibleRows = await primary.client
      .from(RLS_TABLE)
      .select('id, owner_id')
      .in('id', [primaryRow.id, secondaryRow.id]);
    expect(visibleRows.error).toBeNull();
    expect(visibleRows.data).toEqual([{ id: primaryRow.id, owner_id: primary.userId }]);
  });

  fullStackIt('applies Storage RLS to real upload and download requests', async () => {
    const contents = `storage-${RUN_ID}`;
    const upload = await primary.client.storage
      .from(STORAGE_BUCKET)
      .upload(primaryObjectPath(), contents, { contentType: 'text/plain' });
    expect(upload.error).toBeNull();

    const ownerDownload = await primary.client.storage.from(STORAGE_BUCKET).download(primaryObjectPath());
    expect(ownerDownload.error).toBeNull();
    expect(await ownerDownload.data?.text()).toBe(contents);

    const crossOwnerDownload = await secondary.client.storage
      .from(STORAGE_BUCKET)
      .download(primaryObjectPath());
    expect(crossOwnerDownload.error).not.toBeNull();
    expect(crossOwnerDownload.data).toBeNull();
  });

  fullStackIt('delivers an authenticated Postgres change through Realtime', async () => {
    const expectedPayload = `realtime-${RUN_ID}`;
    const observation = observeOwnerInsert(primary.client, expectedPayload);
    realtimeChannel = observation.channel;
    await waitForSubscription(realtimeChannel);

    const insertedRow = await insertOwnedRow(primary, expectedPayload);
    createdRowIds.push(insertedRow.id);

    const payload = await observation.event;
    expect(payload.id).toBe(insertedRow.id);
    expect(payload.owner_id).toBe(primary.userId);
  });

  fullStackIt('invokes a JWT-protected Edge Function with the GoTrue session', async () => {
    const invocation = await primary.client.functions.invoke(FUNCTION_NAME, { body: { run_id: RUN_ID } });
    expect(invocation.error).toBeNull();
    expect(invocation.data).toEqual({ sub: primary.userId, role: 'authenticated' });

    const rejected = await fetch(`${RUNTIME_URL}/functions/v1/${FUNCTION_NAME}`, {
      method: 'POST',
      headers: { apikey: ANON_KEY, authorization: 'Bearer invalid.jwt.token' },
    });
    expect(rejected.status).toBe(401);
  });

  afterAll(async () => {
    if (!RUN_FULL_STACK) return;
    if (realtimeChannel) await primary.client.removeChannel(realtimeChannel);
    await adminClient.storage.from(STORAGE_BUCKET).remove([primaryObjectPath()]);
    if (createdRowIds.length > 0) await adminClient.from(RLS_TABLE).delete().in('id', createdRowIds);
    await Promise.all([
      adminClient.auth.admin.deleteUser(primary.userId),
      adminClient.auth.admin.deleteUser(secondary.userId),
    ]);
  }, TEST_TIMEOUT_MS);
});

function supabaseClient(key: string): SupabaseClient {
  return createClient(RUNTIME_URL, key, {
    auth: { autoRefreshToken: false, persistSession: false, detectSessionInUrl: false },
  });
}

async function createAuthenticatedFixture(
  adminClient: SupabaseClient,
  label: string,
): Promise<AuthenticatedFixture> {
  const email = `supaoauth-${label}-${RUN_ID}@example.test`;
  const created = await adminClient.auth.admin.createUser({ email, password: TEST_PASSWORD, email_confirm: true });
  if (created.error || !created.data.user) {
    throw new Error(`Unable to create ${label} compatibility user: ${created.error?.message || 'missing user'}`);
  }

  const client = supabaseClient(ANON_KEY);
  const signedIn = await client.auth.signInWithPassword({ email, password: TEST_PASSWORD });
  if (signedIn.error || !signedIn.data.session) {
    throw new Error(`Unable to sign in ${label} compatibility user: ${signedIn.error?.message || 'missing session'}`);
  }
  return { client, userId: created.data.user.id };
}

async function insertOwnedRow(fixture: AuthenticatedFixture, payload: string): Promise<{ id: string }> {
  const inserted = await fixture.client
    .from(RLS_TABLE)
    .insert({ owner_id: fixture.userId, payload })
    .select('id')
    .single();
  if (inserted.error || !inserted.data) throw new Error(`Unable to insert RLS fixture: ${inserted.error?.message}`);
  return inserted.data as { id: string };
}

function waitForSubscription(channel: RealtimeChannel): Promise<void> {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error('Realtime subscription timed out')), TEST_TIMEOUT_MS);
    channel.subscribe((status) => {
      if (status === 'SUBSCRIBED') {
        clearTimeout(timer);
        resolve();
      } else if (status === 'CHANNEL_ERROR' || status === 'TIMED_OUT') {
        clearTimeout(timer);
        reject(new Error(`Realtime subscription failed: ${status}`));
      }
    });
  });
}

function observeOwnerInsert(client: SupabaseClient, expectedPayload: string) {
  const channel = client.channel(`gotrue-compat-${RUN_ID}`);
  const event = new Promise<Record<string, unknown>>((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error('Realtime insert event timed out')), TEST_TIMEOUT_MS);
    channel.on(
      'postgres_changes',
      { event: 'INSERT', schema: 'public', table: RLS_TABLE, filter: `payload=eq.${expectedPayload}` },
      ({ new: insertedRow }) => {
        clearTimeout(timer);
        resolve(insertedRow as Record<string, unknown>);
      },
    );
  });
  return { channel, event };
}

function assertRequiredValues(values: Record<string, string>) {
  const missing = Object.entries(values).filter(([, value]) => !value).map(([name]) => name);
  if (missing.length > 0) {
    throw new Error(`Missing required full-stack compatibility env: ${missing.join(', ')}`);
  }
}

function trimTrailingSlash(value: string): string {
  return value.replace(/\/+$/, '');
}
