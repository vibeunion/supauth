// P0-28: RBAC compatibility bridge tests

import { describe, it, expect } from 'bun:test';
import {
  buildDefaultPolicy,
  generateCompatibilityHelper,
} from '../repositories/rbac-bridge.js';

describe('P0-28: RBAC Bridge', () => {
  it('buildDefaultPolicy returns valid migration policy', () => {
    const policy = buildDefaultPolicy();

    expect(policy.dryRun).toBe(true);
    expect(policy.autoCreateRoles).toBe(true);
    expect(policy.preserveLegacyRole).toBe(true);
    expect(policy.batchSize).toBe(100);
    expect(policy.mappings.length).toBeGreaterThan(0);

    // Check expected mappings exist
    const mappingNames = policy.mappings.map(m => m.legacyRole);
    expect(mappingNames).toContain('admin');
    expect(mappingNames).toContain('fa_expert');
    expect(mappingNames).toContain('operator');
    expect(mappingNames).toContain('inspector');
    expect(mappingNames).toContain('authenticated');
  });

  it('each mapping has required fields', () => {
    const policy = buildDefaultPolicy();
    for (const mapping of policy.mappings) {
      expect(mapping.legacyRole).toBeDefined();
      expect(mapping.supaoauthRole).toBeDefined();
      expect(typeof mapping.legacyRole).toBe('string');
      expect(typeof mapping.supaoauthRole).toBe('string');
    }
  });

  it('generateCompatibilityHelper produces valid SQL', () => {
    const sql = generateCompatibilityHelper('test-project-12345');

    expect(sql).toContain('supaoauth.legacy_role_for_user');
    expect(sql).toContain('test-project-12345');
    expect(sql).toContain('raw_app_meta_data');
    expect(sql).toContain("'supaoauth' -> 'projects' -> 'test-project-12345' -> 'roles'");
    expect(sql).not.toContain("'supaoauth' -> 'roles'");
    expect(sql).not.toContain('role_assignments');
    expect(sql).not.toContain('supaoauth.roles');
    expect(sql).toContain('admin');
    expect(sql).toContain('fa_expert');
    expect(sql).toContain('operator');
    expect(sql).toContain('inspector');
    expect(sql).toContain('authenticated');
    expect(sql).toContain('SECURITY DEFINER');
  });

  it('quotes project refs used in the generated SQL path', () => {
    const sql = generateCompatibilityHelper("project'oops\ncomment");

    expect(sql).toContain("'projects' -> 'project''oops");
    expect(sql).not.toContain("project'oops\ncomment");
  });

  it('legacy roles map to distinct SupaOAuth roles', () => {
    const policy = buildDefaultPolicy();
    const supaoauthRoles = policy.mappings.map(m => m.supaoauthRole);
    const uniqueRoles = [...new Set(supaoauthRoles)];
    expect(uniqueRoles.length).toBe(supaoauthRoles.length);
  });
});
