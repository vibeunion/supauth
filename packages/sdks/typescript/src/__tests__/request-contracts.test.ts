import { afterEach, expect, mock, test } from 'bun:test';
import { SupaOAuthClient, type RequestContract } from '../index.js';

const originalFetch = globalThis.fetch;
afterEach(() => { globalThis.fetch = originalFetch; });
const client = new SupaOAuthClient({ baseUrl: 'https://auth.example.test', accessToken: 'test-token' });
const contract: RequestContract<{ name: string }, { id: string }> = {
  input(value) {
    if (!value || typeof value !== 'object' || !('name' in value)
      || typeof value.name !== 'string' || !value.name.trim()) throw new Error('private input');
    return { name: value.name };
  },
  result(value) {
    if (!value || typeof value !== 'object' || !('id' in value) || typeof value.id !== 'string') {
      throw new Error('private result');
    }
    return { id: value.id };
  },
  request: (input) => ({ path: '/custom', options: { method: 'POST', body: JSON.stringify(input) } }),
};

test('invalid input cannot reach transport and failed receipts are not replayed', async () => {
  const fetcher = mock(async () => Response.json({ token: 'private result' }));
  globalThis.fetch = fetcher as unknown as typeof fetch;
  await expect(client.execute(contract, { name: '' })).rejects.toMatchObject({ code: 'SUPAUTH_REQUEST_CONTRACT_INVALID' });
  expect(fetcher).not.toHaveBeenCalled();
  const failure = await client.execute(contract, { name: 'name' }).catch((error: unknown) => error);
  expect(failure).toMatchObject({ code: 'SUPAUTH_RESPONSE_CONTRACT_INVALID' });
  expect(String(failure)).not.toContain('private');
  expect(fetcher).toHaveBeenCalledTimes(1);
});

test('permission payloads are decoded and never converted into an empty permission set on failure', async () => {
  globalThis.fetch = mock(async () => Response.json({ roles: ['member'], permissions: ['item:read'], scopes: [] })) as unknown as typeof fetch;
  expect(await client.getUserPermissions('user')).toEqual({ roles: ['member'], permissions: ['item:read'], scopes: [] });
  for (const payload of [null, {}, { roles: [], permissions: [true], scopes: [] }]) {
    globalThis.fetch = mock(async () => Response.json(payload)) as unknown as typeof fetch;
    await expect(client.getUserPermissions('user')).rejects.toMatchObject({ code: 'SUPAUTH_RESPONSE_CONTRACT_INVALID' });
  }
});

test('a malformed response does not clear the access token for subsequent calls', async () => {
  const seen: unknown[] = [];
  globalThis.fetch = mock(async (_url: unknown, init?: RequestInit) => {
    seen.push(new Headers(init?.headers).get('authorization'));
    return Response.json(seen.length === 1 ? null : { id: 'saved' });
  }) as unknown as typeof fetch;
  await expect(client.execute(contract, { name: 'name' })).rejects.toMatchObject({ reason: 'invalid_payload' });
  expect(await client.execute(contract, { name: 'name' })).toEqual({ id: 'saved' });
  expect(seen).toEqual(['Bearer test-token', 'Bearer test-token']);
});
