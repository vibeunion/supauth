import { describe, expect, mock, test } from 'bun:test';
import {
  SupaOAuthClient, SupaOAuthRequestContractError, SupaOAuthResponseContractError,
} from '../index.js';

const key = 'line\nbreak';

describe('SDK string maps validate newline keys on the wire', () => {
  test.each(['org_membership_mapping', 'role_mapping'] as const)(
    'preserves valid %s values and rejects invalid values before fetch',
    async (field) => {
      const response = { id: 'sso-one', domains: [], [field]: { [key]: 'reader' } };
      const fetcher = mock(async (_url: string | URL | Request, init?: RequestInit) => {
        expect(JSON.parse(String(init?.body))).toEqual({
          connector_id: 'connector-one', domains: [], [field]: { [key]: 'reader' },
        });
        return Response.json(response);
      });
      const client = new SupaOAuthClient({ baseUrl: 'https://auth.example.test', fetch: fetcher });
      expect(await client.createEnterpriseSSOConfig({
        connector_id: 'connector-one', domains: [], [field]: { [key]: 'reader' },
      })).toEqual(response);
      expect(fetcher).toHaveBeenCalledTimes(1);

      expect(() => client.createEnterpriseSSOConfig({
        connector_id: 'connector-one', domains: [], [field]: { [key]: 42 },
      })).toThrow(SupaOAuthRequestContractError);
      expect(fetcher).toHaveBeenCalledTimes(1);
    },
  );

  test.each(['orgMembershipMapping', 'org_membership_mapping', 'roleMapping', 'role_mapping'] as const)(
    'rejects numeric upstream %s values behind newline keys',
    async (field) => {
      const fetcher = mock(async () => Response.json({
        items: [{ id: 'sso-one', domains: [], [field]: { [key]: 42 } }], total: 1,
      }));
      const client = new SupaOAuthClient({ baseUrl: 'https://auth.example.test', fetch: fetcher });
      await expect(client.listEnterpriseSSOConfigs()).rejects.toBeInstanceOf(SupaOAuthResponseContractError);
      expect(fetcher).toHaveBeenCalledTimes(1);
    },
  );
});
