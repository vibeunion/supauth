// Bun runs this module directly; the Svelte check does not include Bun's test globals.
// @ts-nocheck
import { afterEach, describe, expect, mock, test } from 'bun:test';
import { AdminApiError, setAdminAuthenticatedFetch } from '../admin-api.js';
import { getProject, uploadFile } from './client.js';

afterEach(() => {
  setAdminAuthenticatedFetch(null);
});

describe('admin business API authentication recovery', () => {
  test('delegates JSON requests to the refresh-aware fetch layer', async () => {
    const fetcher = mock(async () => new Response(JSON.stringify({ ref: 'project-ref' }), {
      headers: { 'Content-Type': 'application/json' },
    }));
    setAdminAuthenticatedFetch(fetcher);

    await expect(getProject()).resolves.toEqual({ ref: 'project-ref' });
    expect(fetcher).toHaveBeenCalledTimes(1);
  });

  test('accepts the single replay performed by the authenticated fetch layer', async () => {
    const transport = mock()
      .mockResolvedValueOnce(new Response('Unauthorized', { status: 401 }))
      .mockResolvedValueOnce(new Response(JSON.stringify({ ref: 'project-ref' }), {
        headers: { 'Content-Type': 'application/json' },
      }));
    const authenticatedFetch = mock(async (input, init) => {
      const firstResponse = await transport(input, init);
      return firstResponse.status === 401 ? transport(input, init) : firstResponse;
    });
    setAdminAuthenticatedFetch(authenticatedFetch);

    await expect(getProject()).resolves.toEqual({ ref: 'project-ref' });
    expect(authenticatedFetch).toHaveBeenCalledTimes(1);
    expect(transport).toHaveBeenCalledTimes(2);
  });

  test('keeps 403 structured without attempting a replay', async () => {
    const transport = mock(async () => new Response(JSON.stringify({
      code: 'insufficient_permissions',
      message: 'Forbidden',
    }), {
      status: 403,
      headers: { 'Content-Type': 'application/json' },
    }));
    const authenticatedFetch = mock(async (input, init) => {
      const response = await transport(input, init);
      return response.status === 401 ? transport(input, init) : response;
    });
    setAdminAuthenticatedFetch(authenticatedFetch);

    try {
      await getProject();
      throw new Error('Expected request to fail');
    } catch (error) {
      expect(error).toBeInstanceOf(AdminApiError);
      expect(error).toMatchObject({
        statusCode: 403,
        code: 'insufficient_permissions',
      });
    }
    expect(transport).toHaveBeenCalledTimes(1);
  });

  test('preserves binary bodies and explicit content types', async () => {
    const file = new Blob(['brand'], { type: 'image/png' });
    const fetcher = mock(async (_input, init) => {
      expect(init.body).toBe(file);
      expect(new Headers(init.headers).get('Content-Type')).toBe('image/png');
      return new Response(JSON.stringify({ path: 'branding/logo.png' }), {
        headers: { 'Content-Type': 'application/json' },
      });
    });
    setAdminAuthenticatedFetch(fetcher);

    await expect(uploadFile('branding', 'logo.png', file, file.type))
      .resolves.toEqual({ path: 'branding/logo.png' });
    expect(fetcher).toHaveBeenCalledTimes(1);
  });
});
