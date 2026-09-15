import { afterEach, describe, expect, test } from 'bun:test';
import { adminEndpoints, decodeSchema } from '@supauth/shared';
import { adminEndpointRequest, setAdminAuthenticatedFetch } from './admin-api.js';
import { updateResource } from './api/client.js';

afterEach(() => setAdminAuthenticatedFetch(null));

describe('opaque server paths and safe Admin URL construction', () => {
  test('resource wrapper omits an absent optional body but preserves explicit empty objects', async () => {
    const bodies: Array<BodyInit | null | undefined> = [];
    setAdminAuthenticatedFetch(async (_input, init) => {
      bodies.push(init?.body);
      return Response.json({
        id: 'resource', name: 'Documents', indicator: 'https://api.example.test',
        description: null, createdAt: '2026-09-08T00:00:00Z', updatedAt: '2026-09-08T00:00:00Z',
      });
    });
    await updateResource('resource');
    await updateResource('resource', {});
    expect(bodies).toEqual([undefined, '{}']);
  });

  test('still rejects empty and dot segments before the authenticated fetch', async () => {
    let requests = 0;
    setAdminAuthenticatedFetch(async () => {
      requests++;
      return Response.json({ client_id: 'app-one' });
    });
    for (const appId of ['', '.', '..']) {
      expect(decodeSchema(adminEndpoints.getApplication.input, { params: { appId } })).toEqual({ params: { appId } });
      await expect(adminEndpointRequest(adminEndpoints.getApplication, { params: { appId } }))
        .rejects.toMatchObject({ statusCode: 400, code: 'invalid_request' });
    }
    expect(requests).toBe(0);
  });

  test('encodes a slash as data instead of adding a route segment', async () => {
    const paths: string[] = [];
    setAdminAuthenticatedFetch(async (input) => {
      paths.push(input instanceof Request ? input.url : String(input));
      return Response.json({ client_id: 'vendor/app?name#fragment' });
    });
    await adminEndpointRequest(adminEndpoints.getApplication, {
      params: { appId: 'vendor/app?name#fragment' },
    });
    expect(paths).toHaveLength(1);
    expect(paths[0]).toEndWith('/v1/applications/vendor%2Fapp%3Fname%23fragment');
    expect(paths[0]).not.toContain('/vendor/app');
  });
});
