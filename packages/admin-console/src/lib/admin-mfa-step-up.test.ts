// Bun runs this module directly; the Svelte check does not include Bun's test globals.
// @ts-nocheck
import { describe, expect, mock, test } from 'bun:test';
import { AdminMfaStepUp, createAdminSsoStorage } from './admin-mfa-step-up.js';

function storage() {
  const values = new Map();
  return {
    values,
    getItem: (key) => values.get(key) ?? null,
    setItem: (key, value) => values.set(key, value),
    removeItem: (key) => values.delete(key),
  };
}

function session(accessToken = 'access-aal1') {
  return {
    access_token: accessToken,
    refresh_token: 'refresh-aal1',
    id_token: 'id-token',
    token_type: 'Bearer',
    expires_at: 100,
  };
}

function client(overrides = {}) {
  return {
    setSession: mock(async () => ({
      data: { session: { access_token: 'access-aal1', refresh_token: 'refresh-aal1' } },
      error: null,
    })),
    mfa: {
      listFactors: mock(async () => ({ data: { totp: [{ id: 'factor-1', status: 'verified', friendly_name: 'Admin key' }] }, error: null })),
      challengeAndVerify: mock(async () => ({
        data: { access_token: 'access-aal2', refresh_token: 'refresh-aal2', token_type: 'bearer', expires_at: 200 },
        error: null,
      })),
    },
    ...overrides,
  };
}

describe('admin MFA post-exchange step-up', () => {
  test('replaces the observed complete OAuth session atomically after TOTP verification', async () => {
    const backing = storage();
    const observed = createAdminSsoStorage(backing);
    backing.setItem('actual-provider-key', JSON.stringify(session()));
    const provider = {
      getSession: mock(async () => {
        observed.getItem('actual-provider-key');
        return session();
      }),
    };
    const mfaClient = client();
    const stepUp = new AdminMfaStepUp(provider, observed, mfaClient);

    await expect(stepUp.state()).resolves.toEqual({
      factors: [{ id: 'factor-1', label: 'Admin key' }],
    });
    await stepUp.verify('factor-1', '123456');

    expect(mfaClient.mfa.challengeAndVerify).toHaveBeenCalledWith({ factorId: 'factor-1', code: '123456' });
    expect(JSON.parse(backing.getItem('actual-provider-key'))).toEqual({
      access_token: 'access-aal2',
      refresh_token: 'refresh-aal2',
      id_token: 'id-token',
      token_type: 'bearer',
      expires_at: 200,
    });
  });

  test('fails closed when the OAuth session was not written by the provider or has no refresh token', async () => {
    const observed = createAdminSsoStorage(storage());
    const stepUp = new AdminMfaStepUp(
      { getSession: mock(async () => ({ access_token: 'access-aal1', token_type: 'Bearer' })) },
      observed,
      client(),
    );

    await expect(stepUp.state()).rejects.toThrow('缺少刷新凭据');
  });

  test('fails closed when no verified factor exists', async () => {
    const backing = storage();
    const observed = createAdminSsoStorage(backing);
    observed.setItem('actual-provider-key', JSON.stringify(session()));
    const stepUp = new AdminMfaStepUp(
      { getSession: mock(async () => session()) },
      observed,
      client({ mfa: { ...client().mfa, listFactors: mock(async () => ({ data: { totp: [] }, error: null })) } }),
    );

    await expect(stepUp.state()).resolves.toEqual({ factors: [] });
  });

  test('does not write a partial MFA token response', async () => {
    const backing = storage();
    const observed = createAdminSsoStorage(backing);
    observed.setItem('actual-provider-key', JSON.stringify(session()));
    const stepUp = new AdminMfaStepUp(
      { getSession: mock(async () => session()) },
      observed,
      client({ mfa: { ...client().mfa, challengeAndVerify: mock(async () => ({ data: { access_token: 'access-aal2' }, error: null })) } }),
    );

    await expect(stepUp.verify('factor-1', '123456')).rejects.toThrow('未返回可用于管理员 MFA 的升级会话');
    expect(JSON.parse(backing.getItem('actual-provider-key'))).toEqual(session());
  });

  test('does not observe a partial provider session without a refresh token', () => {
    const backing = storage();
    const observed = createAdminSsoStorage(backing);
    observed.setItem('partial-provider-key', JSON.stringify({
      access_token: 'access-aal1',
      token_type: 'Bearer',
    }));

    expect(() => observed.replaceWithMfaSession(
      { access_token: 'access-aal1', refresh_token: 'refresh-aal1' },
      { access_token: 'access-aal2', refresh_token: 'refresh-aal2' },
    )).toThrow('尚未建立');
  });

  test('does not overwrite a session that changes while MFA verification is in flight', async () => {
    const backing = storage();
    const observed = createAdminSsoStorage(backing);
    observed.setItem('actual-provider-key', JSON.stringify(session()));
    const mfaClient = client({
      mfa: {
        ...client().mfa,
        challengeAndVerify: mock(async () => {
          backing.setItem('actual-provider-key', JSON.stringify(session('access-new-login')));
          return {
            data: { access_token: 'access-aal2', refresh_token: 'refresh-aal2' },
            error: null,
          };
        }),
      },
    });
    const stepUp = new AdminMfaStepUp(
      { getSession: mock(async () => session()) },
      observed,
      mfaClient,
    );

    await expect(stepUp.verify('factor-1', '123456')).rejects.toThrow('会话在 MFA 验证期间已变化');
    expect(JSON.parse(backing.getItem('actual-provider-key'))).toEqual(session('access-new-login'));
  });
});
