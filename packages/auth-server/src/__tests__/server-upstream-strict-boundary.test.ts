import { afterEach, describe, expect, it } from 'bun:test';
import { decodeSignupPolicy, handleBeforeUserCreated } from '../auth/hooks-bridge.js';
import { SupaCloudAdapter } from '../supacloud/adapter.js';
import { ApiContractError } from '../utils/api-contract.js';
import { definedFields } from '../utils/defined-fields.js';
import { readUpstreamObject, decodeProviderReadback, decodeUserReadback } from '../utils/upstream-contract.js';

const originalFetch = globalThis.fetch;
afterEach(() => {
  globalThis.fetch = originalFetch;
});

function reply(value: unknown): void {
  globalThis.fetch = Object.assign(async () => Response.json(value), { preconnect() {} });
}

function storageAdapter(): SupaCloudAdapter {
  return new SupaCloudAdapter({
    projectRef: 'strict-test-project',
    runtimeUrl: 'https://runtime.invalid',
    storageUrl: 'https://storage.invalid',
    storageServiceRoleKey: 'synthetic-strict-test-fixture',
  });
}

describe('strict upstream and persisted-policy boundaries', () => {
  it('enforces the own-data invariant required by the mapped defined-fields return type', () => {
    const date = new Date(0);
    expect(definedFields({ id: 'one', optional: undefined, date })).toEqual({ id: 'one', date });
    expect(() => definedFields(new Date(0))).toThrow(TypeError);
    expect(() => definedFields({ [Symbol('hidden')]: 'value' })).toThrow(TypeError);
    const hidden = Object.defineProperty({}, 'hidden', { value: 'value' });
    expect(() => definedFields(hidden)).toThrow(TypeError);
    let getterCalled = false;
    const getter = {
      get value() { getterCalled = true; return 'value'; },
    };
    expect(() => definedFields(getter)).toThrow(TypeError);
    expect(getterCalled).toBe(false);
  });
  it('validates user IDs and suspension fields before provisioning or sync uses them', () => {
    for (const value of [null, [], {}, { id: '' }, { id: ' ' }, { id: 'user', banned_until: 1 }]) {
      expect(() => decodeUserReadback(value)).toThrow(ApiContractError);
    }
    expect(decodeUserReadback({ id: 'user', banned_until: null })).toEqual({ id: 'user', banned_until: null });
  });
  it('validates provider metadata while retaining authoritative requested IDs', () => {
    for (const value of [null, [], { enabled: 'false' }, { name: 42 }, { clientSecret: true }]) {
      expect(() => decodeProviderReadback(value, 'google')).toThrow(ApiContractError);
    }
    expect(decodeProviderReadback({ name: 'Google', enabled: true }, 'google')).toEqual({
      id: 'google', name: 'Google', enabled: true,
    });
  });
  it('rejects invalid persisted signup policy instead of interpreting truthiness', () => {
    for (const value of [
      null, [], { allowed_email_domains: 'example.test' },
      { allowed_email_domains: [1] }, { invite_only: 0 },
      { invite_only: 'false' }, { blocked_oauth_providers: [null] },
    ]) {
      expect(() => decodeSignupPolicy(value)).toThrow();
    }
  });

  it('retains valid invitation and domain policy behavior', () => {
    const policy = decodeSignupPolicy({ invite_only: true, allowed_email_domains: ['example.test'] });
    const payload = { user: { email: 'person@example.test' } };
    expect(handleBeforeUserCreated(payload, policy)).toHaveProperty('error.code', 'invitation_required');
    expect(handleBeforeUserCreated(payload, policy, { invitation_verified: true })).toEqual({});
  });

  it('rejects malformed JSON, scalar, null and array response bodies', async () => {
    for (const value of [123, true, 'value', null, [1]]) {
      await expect(readUpstreamObject(Response.json(value))).rejects.toBeInstanceOf(ApiContractError);
    }
    await expect(readUpstreamObject(new Response('{'))).rejects.toBeInstanceOf(ApiContractError);
    expect(await readUpstreamObject(new Response(null, { status: 204 }))).toBeNull();
    expect(await readUpstreamObject(Response.json({ id: 'valid' }))).toEqual({ id: 'valid' });
  });

  it('validates every storage bucket receipt before exposing typed values', async () => {
    const adapter = storageAdapter();
    for (const value of [null, [], { id: 'avatars', public: 'false' }]) {
      reply(value);
      await expect(adapter.getStorageBucket('avatars')).rejects.toBeInstanceOf(ApiContractError);
      await expect(adapter.createStorageBucket('avatars')).rejects.toBeInstanceOf(ApiContractError);
    }
    reply([{ id: 'avatars', public: false }]);
    expect(await adapter.listStorageBuckets()).toEqual([{ id: 'avatars', public: false }]);
    reply([{ id: 'avatars', public: 0 }]);
    await expect(adapter.listStorageBuckets()).rejects.toBeInstanceOf(ApiContractError);
  });

  it('does not manufacture a string upload key from an invalid receipt', async () => {
    const adapter = storageAdapter();
    const file = new Blob(['fixture'], { type: 'image/png' });
    for (const value of [null, [], { Key: 42 }, { Key: '' }]) {
      reply(value);
      await expect(adapter.uploadFile('avatars', 'test.png', file, 'image/png')).rejects.toBeInstanceOf(ApiContractError);
    }
    reply({ Key: 'avatars/test.png' });
    expect(await adapter.uploadFile('avatars', 'test.png', file, 'image/png')).toEqual({ key: 'avatars/test.png' });
    reply({});
    expect(await adapter.uploadFile('avatars', 'test.png', file, 'image/png')).toEqual({ key: 'avatars/test.png' });
  });

  it('rejects invalid signed-url receipt shapes before URL normalization', async () => {
    for (const value of [null, [], { signedURL: 42 }]) {
      reply(value);
      await expect(storageAdapter().createSignedUrl('avatars', 'test.png')).rejects.toBeInstanceOf(ApiContractError);
    }
  });
});
