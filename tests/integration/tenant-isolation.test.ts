import { describe, expect, it } from 'bun:test';

const RUN_LIVE = process.env.RUN_TENANT_ISOLATION === '1';
const MANAGEMENT_URL = (process.env.MANAGEMENT_URL || 'http://localhost:4000').replace(/\/+$/, '');
const ADMIN_TOKEN_A = process.env.TENANT_A_ADMIN_TOKEN || '';
const TENANT_B_PROJECT_REF = process.env.TENANT_B_PROJECT_REF || '';
const liveIt = RUN_LIVE && ADMIN_TOKEN_A && TENANT_B_PROJECT_REF ? it : it.skip;

describe('tenant isolation and browser secret boundary', () => {
  it('server-only env names are not exposed through VITE prefix', () => {
    const forbidden = [
      'VITE_SUPACLOUD_MASTER_TOKEN',
      'VITE_SERVICE_ROLE_KEY',
      'VITE_DATABASE_URL',
      'VITE_ADMIN_TOKEN',
    ];

    for (const name of forbidden) {
      expect(process.env[name]).toBeUndefined();
    }
  });

  liveIt('tenant A admin token cannot access tenant B project resources', async () => {
    const res = await fetch(`${MANAGEMENT_URL}/v1/provisioning/${TENANT_B_PROJECT_REF}`, {
      headers: { Authorization: `Bearer ${ADMIN_TOKEN_A}` },
    });

    expect([401, 403, 404]).toContain(res.status);
  });
});
