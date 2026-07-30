// Bun runs this module directly; the Svelte check does not include Bun's test globals.
// @ts-nocheck
import { describe, expect, test } from 'bun:test';
import { createAdminLogoutController } from './admin-logout';

function logoutHarness(overrides = {}) {
  const calls = { initialize: 0, logout: 0, navigations: [] };
  const states = [];
  const options = {
    initializeProvider: async () => { calls.initialize += 1; },
    logout: async () => {
      calls.logout += 1;
      return { success: true, redirectTo: '/admin/login' };
    },
    browserOrigin: () => 'https://admin.example.test',
    navigate: (url) => { calls.navigations.push(url); },
    failureMessage: () => 'fallback failure',
    unsafeRedirectMessage: () => 'unsafe redirect',
    onStateChange: (state) => { states.push(state); },
    ...overrides,
  };
  return { calls, states, controller: createAdminLogoutController(options) };
}

describe('Admin logout controller', () => {
  test('initializes the provider, logs out, and follows a same-origin redirect', async () => {
    const { calls, states, controller } = logoutHarness();

    await controller.run();

    expect(calls.initialize).toBe(1);
    expect(calls.logout).toBe(1);
    expect(calls.navigations).toEqual(['https://admin.example.test/admin/login']);
    expect(states).toEqual([
      { pending: true, error: '' },
      { pending: false, error: '' },
    ]);
  });

  test('does not navigate when provider logout already owns RP navigation', async () => {
    const { calls, controller } = logoutHarness({
      logout: async () => {
        calls.logout += 1;
        return { success: true };
      },
    });

    await controller.run();

    expect(calls.logout).toBe(1);
    expect(calls.navigations).toEqual([]);
  });

  for (const redirectTo of [
    'https://evil.example.test/admin/login',
    'https://user:secret@admin.example.test/admin/login',
    'http://%',
  ]) {
    test(`rejects unsafe logout redirect ${redirectTo}`, async () => {
      const { calls, states, controller } = logoutHarness({
        logout: async () => {
          calls.logout += 1;
          return { success: true, redirectTo };
        },
      });

      await controller.run();

      expect(calls.navigations).toEqual([]);
      expect(states.at(-1)).toEqual({ pending: false, error: 'unsafe redirect' });
    });
  }

  test('surfaces a thrown logout error and restores pending state', async () => {
    const { calls, states, controller } = logoutHarness({
      logout: async () => {
        calls.logout += 1;
        throw new Error('logout unavailable');
      },
    });

    await controller.run();

    expect(calls.navigations).toEqual([]);
    expect(states.at(-1)).toEqual({ pending: false, error: 'logout unavailable' });
  });

  test('surfaces an unsuccessful provider result', async () => {
    const { calls, states, controller } = logoutHarness({
      logout: async () => {
        calls.logout += 1;
        return { success: false, error: { message: 'session revoke failed' } };
      },
    });

    await controller.run();

    expect(calls.navigations).toEqual([]);
    expect(states.at(-1)).toEqual({ pending: false, error: 'session revoke failed' });
  });

  test('deduplicates concurrent runs and restores pending after completion', async () => {
    let finishLogout;
    const logoutFinished = new Promise((resolve) => { finishLogout = resolve; });
    const { calls, states, controller } = logoutHarness({
      logout: async () => {
        calls.logout += 1;
        await logoutFinished;
        return { success: true };
      },
    });

    const firstRun = controller.run();
    const duplicateRun = controller.run();
    await duplicateRun;
    finishLogout();
    await firstRun;

    expect(calls.initialize).toBe(1);
    expect(calls.logout).toBe(1);
    expect(states).toEqual([
      { pending: true, error: '' },
      { pending: false, error: '' },
    ]);
  });
});
