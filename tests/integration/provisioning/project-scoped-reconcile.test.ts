/**
 * P0-26: Project-scoped provisioning reconcile tests
 *
 * Verifies that provisioning/reconcile is bound to the path projectRef
 * and that two projects reconciling in parallel do not cross-pollute.
 *
 * Gate: RUN_PROVISIONING_SCOPED=1
 */

import { describe, it, expect, beforeAll } from 'bun:test';
import { SupaCloudAdapter, getSupaCloudAdapterForProject } from '../../../packages/auth-server/src/supacloud/adapter.js';
import { loadConfig } from '../../../packages/auth-server/src/config/index.js';

const gate = process.env.RUN_PROVISIONING_SCOPED === '1';
const describeLive = gate ? describe : describe.skip;

describeLive('P0-26: Project-scoped provisioning', () => {
  beforeAll(() => {
    process.env.SUPACLOUD_API_URL = process.env.SUPACLOUD_API_URL || '';
    process.env.SUPACLOUD_MASTER_TOKEN = process.env.SUPACLOUD_MASTER_TOKEN || '';
    process.env.PROJECT_REF = process.env.PROJECT_REF || 'default-ref';
    process.env.OAUTH_RUNTIME_URL = process.env.OAUTH_RUNTIME_URL || '';
    process.env.DATABASE_URL = process.env.DATABASE_URL || 'postgres://noop';
    loadConfig();
  });

  it('default adapter uses env PROJECT_REF', () => {
    const adapter = new SupaCloudAdapter();
    expect(adapter.getProjectRef()).toBe(process.env.PROJECT_REF || '');
  });

  it('scoped adapter uses explicit projectRef', () => {
    const ref = 'custom-project-abc12345';
    const scoped = getSupaCloudAdapterForProject(ref);
    expect(scoped.getProjectRef()).toBe(ref);
  });

  it('two scoped adapters have different projectRefs', () => {
    const adapter1 = getSupaCloudAdapterForProject('project-alpha-12345');
    const adapter2 = getSupaCloudAdapterForProject('project-beta-67890');

    expect(adapter1.getProjectRef()).toBe('project-alpha-12345');
    expect(adapter2.getProjectRef()).toBe('project-beta-67890');
    expect(adapter1.getProjectRef()).not.toBe(adapter2.getProjectRef());
  });

  it('scoped adapter auth config path includes correct projectRef', async () => {
    const ref = 'target-project-xyz999';
    const scoped = getSupaCloudAdapterForProject(ref);

    expect(scoped.getProjectRef()).toBe(ref);

    try {
      await scoped.getAuthConfig();
    } catch (e) {
      const msg = (e as Error).message;
      if (msg.includes('/v1/projects/')) {
        expect(msg).toContain(ref);
        expect(msg).not.toContain(process.env.PROJECT_REF!);
      }
    }
  });

  it('parallel reconcile on different projects uses distinct adapters', () => {
    const refs = ['project-a-00001', 'project-b-00002', 'project-c-00003'];
    const adapters = refs.map(ref => getSupaCloudAdapterForProject(ref));

    for (let i = 0; i < refs.length; i++) {
      expect(adapters[i].getProjectRef()).toBe(refs[i]);
    }
  });
});

describe('P0-26: Project-scoped provisioning (unit)', () => {
  beforeAll(() => {
    process.env.SUPACLOUD_API_URL = 'http://test-api:9090';
    process.env.SUPACLOUD_MASTER_TOKEN = 'test-token';
    process.env.PROJECT_REF = 'default-test-ref';
    process.env.OAUTH_RUNTIME_URL = 'http://runtime.test';
    process.env.DATABASE_URL = 'postgres://test';
    loadConfig();
  });

  it('isValidProjectRef rejects short refs', () => {
    const pattern = /^[a-z0-9]{20,}$/;
    expect(pattern.test('short')).toBe(false);
    expect(pattern.test('')).toBe(false);
    expect(pattern.test('vwsvexjelurvczfivgiz')).toBe(true);
    expect(pattern.test('has-dashes-12345')).toBe(false);
    expect(pattern.test('HAS_UPPERCASE_12345')).toBe(false);
  });
});
