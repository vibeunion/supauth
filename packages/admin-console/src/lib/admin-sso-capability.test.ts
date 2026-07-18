// Bun runs this module directly; the Svelte check does not include Bun's test globals.
// @ts-nocheck
import { describe, expect, test } from 'bun:test';
import { requireAdminAuthenticatedFetch } from './admin-sso-capability.js';

describe('admin SSO refresh capability', () => {
  test('fails explicitly when the provider cannot refresh and replay requests', () => {
    expect(() => requireAdminAuthenticatedFetch({})).toThrow('createAuthenticatedFetch');
  });

  test('preserves the provider receiver when creating authenticated fetch', () => {
    const provider = {
      marker: 'bound',
      createAuthenticatedFetch(this: { marker: string }) {
        expect(this.marker).toBe('bound');
        return fetch;
      },
    };

    expect(requireAdminAuthenticatedFetch(provider)).toBe(fetch);
  });
});
