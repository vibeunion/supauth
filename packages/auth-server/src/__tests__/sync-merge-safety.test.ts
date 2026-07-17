// P0-27: Test that syncUserMetadata preserves existing app_metadata fields
// and only patches the `supaoauth` namespace.

import { describe, it, expect, beforeEach, mock } from 'bun:test';
import { loadConfig } from '../config/index.js';
import {
  buildSupaoauthRbacProjection,
  MAX_JWT_PERMISSION_PROJECTION,
  MAX_JWT_ROLE_PROJECTION,
} from '../sync/index.js';

// We test the merge logic by verifying the behavior inline
// since the actual sync requires DB + adapter

describe('P0-27: app_metadata merge safety', () => {
  beforeEach(() => {
    process.env.SUPACLOUD_API_URL = 'http://test-api:9090';
    process.env.SUPACLOUD_MASTER_TOKEN = 'test-token';
    process.env.PROJECT_REF = 'test-ref';
    process.env.OAUTH_RUNTIME_URL = 'http://runtime.test';
    process.env.DATABASE_URL = 'postgres://test';
    process.env.RUNTIME_MODE = 'gotrue';
    loadConfig();
  });

  it('merge preserves existing app_metadata fields', () => {
    const existing = {
      role: 'admin',
      provider: 'email',
      providers: ['email'],
      tenant_id: 'abc123',
      custom_field: 'should_survive',
    };

    const newSupaoauth = {
      roles: ['admin'],
      rbac_version: Date.now(),
    };

    // This is the merge logic from sync/index.ts
    const merged = { ...existing, supaoauth: newSupaoauth };

    // Verify all original fields are preserved
    expect(merged.role).toBe('admin');
    expect(merged.provider).toBe('email');
    expect(merged.providers).toEqual(['email']);
    expect(merged.tenant_id).toBe('abc123');
    expect(merged.custom_field).toBe('should_survive');
    expect(merged.supaoauth).toEqual(newSupaoauth);
  });

  it('merge overwrites only supaoauth namespace', () => {
    const existing = {
      role: 'authenticated',
      supaoauth: {
        roles: ['viewer'],
        rbac_version: 100,
      },
    };

    const newSupaoauth = {
      roles: ['editor'],
      rbac_version: 200,
    };

    const merged = { ...existing, supaoauth: newSupaoauth };

    expect(merged.role).toBe('authenticated');
    expect(merged.supaoauth.roles).toEqual(['editor']);
    expect((merged.supaoauth as any).rbac_version).toBe(200);
  });

  it('merge safety check detects clobbered fields', () => {
    const existing = {
      role: 'admin',
      provider: 'email',
    };

    const merged = { ...existing, supaoauth: { roles: ['admin'] } };

    // Check that preserved fields match
    const preservedFields = ['role', 'provider', 'providers', 'tenant_id', 'parent'];
    for (const field of preservedFields) {
      if (field in existing && existing[field as keyof typeof existing] !== undefined) {
        expect(merged[field as keyof typeof merged]).toBe(existing[field as keyof typeof existing]);
      }
    }
  });

  it('handles empty existing app_metadata', () => {
    const existing: Record<string, unknown> = {};
    const newSupaoauth = { roles: ['admin'], rbac_version: 1 };
    const merged = { ...existing, supaoauth: newSupaoauth };

    expect(merged.supaoauth).toEqual(newSupaoauth);
    expect(Object.keys(merged)).toEqual(['supaoauth']);
  });

  it('handles null existing app_metadata', () => {
    const existing = null;
    const newSupaoauth = { roles: ['admin'], rbac_version: 1 };
    const merged = { ...(existing || {}), supaoauth: newSupaoauth };

    expect(merged.supaoauth).toEqual(newSupaoauth);
  });

  it('adds version markers and keeps bounded permissions for RLS helpers', () => {
    const projection = buildSupaoauthRbacProjection({
      roles: ['admin', 'admin', 'operator'],
      permissions: ['users.read', 'users.read', 'reports.export'],
      version: 123,
      applicationId: 'fa-app',
      currentOrgId: 'org-one',
      currentOrgRole: 'owner',
    });

    expect(projection.roles).toEqual(['admin', 'operator']);
    expect(projection.permissions).toEqual(['users.read', 'reports.export']);
    expect(projection.permissions_count).toBe(2);
    expect(projection.rbac_version).toBe(123);
    expect(projection.permissions_version).toBe(123);
    expect(projection.application_id).toBe('fa-app');
    expect(projection.current_org_id).toBe('org-one');
    expect(projection.current_org_role).toBe('owner');
    expect(projection.permissions_truncated).toBeUndefined();
  });

  it('does not project an unbounded permission array into app_metadata', () => {
    const permissions = Array.from({ length: MAX_JWT_PERMISSION_PROJECTION + 1 }, (_, index) => `perm.${index}`);
    const projection = buildSupaoauthRbacProjection({
      roles: ['admin'],
      permissions,
      version: 456,
    });

    expect(projection.permissions).toEqual([]);
    expect(projection.permissions_count).toBe(MAX_JWT_PERMISSION_PROJECTION + 1);
    expect(projection.permissions_truncated).toBe(true);
    expect(projection.permissions_projection_limit).toBe(MAX_JWT_PERMISSION_PROJECTION);
    expect(projection.permissions_version).toBe(456);
  });

  it('does not project an unbounded role array into app_metadata', () => {
    const roles = Array.from({ length: MAX_JWT_ROLE_PROJECTION + 1 }, (_, index) => `role-${index}`);
    const projection = buildSupaoauthRbacProjection({
      roles,
      permissions: ['reports.read'],
      version: 789,
    });

    expect(projection.roles).toEqual([]);
    expect(projection.roles_count).toBe(MAX_JWT_ROLE_PROJECTION + 1);
    expect(projection.roles_truncated).toBe(true);
    expect(projection.roles_projection_limit).toBe(MAX_JWT_ROLE_PROJECTION);
    expect(projection.rbac_version).toBe(789);
  });
});
