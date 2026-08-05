// Bun runs this module directly; the Svelte check does not include Bun's test globals.
// @ts-nocheck
import { describe, expect, mock, test } from 'bun:test';
import {
  isLegacyCustomUiServiceWorkerScope,
  retireLegacyCustomUiServiceWorkers,
} from './legacy-custom-ui-service-workers.js';

const ADMIN_ORIGIN = 'https://admin.example.test';

function registration(scope, unregisterImplementation = async () => true) {
  return {
    scope,
    unregister: mock(unregisterImplementation),
  };
}

function registrationContainer(...snapshots) {
  let readIndex = 0;
  return {
    getRegistrations: mock(async () => {
      const snapshot = snapshots[Math.min(readIndex, snapshots.length - 1)] ?? [];
      readIndex += 1;
      if (snapshot instanceof Error) throw snapshot;
      return snapshot;
    }),
  };
}

describe('legacy Custom UI service-worker cleanup', () => {
  test.each([
    'https://admin.example.test/custom-ui',
    'https://admin.example.test/custom-ui/',
    'https://admin.example.test/custom-ui/tenant/sign-in',
    'https://ADMIN.example.test:443/custom-ui/./tenant',
    'https://admin.example.test/custom%2dui/tenant',
    'https://admin.example.test/custom-u%69/tenant',
    'https://admin.example.test/v1/public/custom-ui',
    'https://admin.example.test/v1/public/custom-ui/',
    'https://admin.example.test/v1/public/custom-ui/tenant/assets',
    'https://admin.example.test/v1/public/custom%2Dui/tenant/assets',
  ])('matches the retired same-origin scope tree: %s', (scope) => {
    expect(isLegacyCustomUiServiceWorkerScope(scope, ADMIN_ORIGIN)).toBe(true);
  });

  test.each([
    'https://admin.example.test/custom-ui-evil/',
    'https://admin.example.test/custom-uis/',
    'https://admin.example.test/v1/public/custom-ui-evil/',
    'https://admin.example.test/v1/public/custom-uis/',
    'https://admin.example.test/dashboard/custom-ui/',
    'https://admin.example.test/custom-ui%2fother/',
    'https://other.example.test/custom-ui/',
  ])('rejects unrelated, similar-prefix, and cross-origin scopes: %s', (scope) => {
    expect(isLegacyCustomUiServiceWorkerScope(scope, ADMIN_ORIGIN)).toBe(false);
  });

  test('returns clean without a second read when no target registration exists', async () => {
    const unrelated = registration(`${ADMIN_ORIGIN}/app/`);
    const serviceWorkers = registrationContainer([unrelated]);

    await expect(
      retireLegacyCustomUiServiceWorkers(serviceWorkers, ADMIN_ORIGIN),
    ).resolves.toEqual({ status: 'clean', matchedCount: 0 });
    expect(serviceWorkers.getRegistrations).toHaveBeenCalledTimes(1);
    expect(unrelated.unregister).not.toHaveBeenCalled();
  });

  test('treats an unavailable Service Worker API as having no registration capability', async () => {
    await expect(
      retireLegacyCustomUiServiceWorkers(undefined, ADMIN_ORIGIN),
    ).resolves.toEqual({ status: 'unsupported' });
  });

  test('unregisters every target sub-scope and leaves other registrations untouched', async () => {
    const firstTarget = registration(`${ADMIN_ORIGIN}/custom-ui/tenant-a/`);
    const secondTarget = registration(`${ADMIN_ORIGIN}/v1/public/custom-ui/tenant-b/`);
    const similarPrefix = registration(`${ADMIN_ORIGIN}/custom-ui-evil/`);
    const serviceWorkers = registrationContainer(
      [firstTarget, secondTarget, similarPrefix],
      [similarPrefix],
    );

    await expect(
      retireLegacyCustomUiServiceWorkers(serviceWorkers, ADMIN_ORIGIN),
    ).resolves.toEqual({ status: 'retired', matchedCount: 2 });
    expect(firstTarget.unregister).toHaveBeenCalledTimes(1);
    expect(secondTarget.unregister).toHaveBeenCalledTimes(1);
    expect(similarPrefix.unregister).not.toHaveBeenCalled();
    expect(serviceWorkers.getRegistrations).toHaveBeenCalledTimes(2);
  });

  test('accepts unregister=false only after authoritative read-back confirms removal', async () => {
    const racedTarget = registration(
      `${ADMIN_ORIGIN}/custom-ui/tenant-a/`,
      async () => false,
    );
    const serviceWorkers = registrationContainer([racedTarget], []);

    await expect(
      retireLegacyCustomUiServiceWorkers(serviceWorkers, ADMIN_ORIGIN),
    ).resolves.toEqual({ status: 'retired', matchedCount: 1 });
    expect(serviceWorkers.getRegistrations).toHaveBeenCalledTimes(2);
  });

  test('fails closed when unregister=false leaves a target registered', async () => {
    const persistedTarget = registration(
      `${ADMIN_ORIGIN}/custom-ui/tenant-a/`,
      async () => false,
    );
    const serviceWorkers = registrationContainer([persistedTarget], [persistedTarget]);

    await expect(
      retireLegacyCustomUiServiceWorkers(serviceWorkers, ADMIN_ORIGIN),
    ).resolves.toEqual({
      status: 'failed',
      code: 'target_registration_persisted',
      scopes: [`${ADMIN_ORIGIN}/custom-ui/tenant-a/`],
    });
  });

  test('fails closed when a target unregister call rejects', async () => {
    const rejectedTarget = registration(
      `${ADMIN_ORIGIN}/v1/public/custom-ui/tenant-a/`,
      async () => { throw new Error('browser rejected unregister'); },
    );
    const serviceWorkers = registrationContainer([rejectedTarget]);

    await expect(
      retireLegacyCustomUiServiceWorkers(serviceWorkers, ADMIN_ORIGIN),
    ).resolves.toEqual({
      status: 'failed',
      code: 'registration_unregistration_failed',
      scopes: [`${ADMIN_ORIGIN}/v1/public/custom-ui/tenant-a/`],
    });
    expect(serviceWorkers.getRegistrations).toHaveBeenCalledTimes(1);
  });

  test.each([
    [
      'initial enumeration',
      [new Error('enumeration rejected')],
      'registration_enumeration_failed',
    ],
    [
      'authority read-back',
      [[registration(`${ADMIN_ORIGIN}/custom-ui/`)], new Error('read-back rejected')],
      'authority_readback_failed',
    ],
  ])('fails closed when %s rejects', async (_label, snapshots, expectedCode) => {
    const serviceWorkers = registrationContainer(...snapshots);

    await expect(
      retireLegacyCustomUiServiceWorkers(serviceWorkers, ADMIN_ORIGIN),
    ).resolves.toEqual({ status: 'failed', code: expectedCode, scopes: [] });
  });
});
