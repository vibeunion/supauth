import { describe, expect, it } from 'bun:test';
import { isNavigationEntryActive, navigationSections, resolveConsolePath } from './navigation.js';

describe('admin navigation', () => {
  it('keeps the Logto section order and visible entry count', () => {
    expect(navigationSections.map((navigationSection) => navigationSection.labelKey)).toEqual([
      'nav.section.overview',
      'nav.section.authentication',
      'nav.section.authorization',
      'nav.section.users',
      'nav.section.developer',
      'nav.section.tenant',
    ]);
    expect(navigationSections.flatMap((navigationSection) => navigationSection.entries.map((navigationEntry) => navigationEntry.path))).toEqual([
      '/get-started',
      '/dashboard',
      '/applications',
      '/sign-in-experience',
      '/mfa',
      '/connectors',
      '/enterprise-sso',
      '/security',
      '/api-resources',
      '/roles',
      '/organization-template',
      '/organizations',
      '/users',
      '/customize-jwt',
      '/webhooks',
      '/audit-logs',
      '/tenant-settings',
    ]);
  });

  it('marks nested routes active without matching sibling prefixes', () => {
    expect(isNavigationEntryActive('/admin/applications/client-1/settings', '/admin', '/applications')).toBe(true);
    expect(isNavigationEntryActive('/admin/applications-other', '/admin', '/applications')).toBe(false);
    expect(isNavigationEntryActive('/admin/dashboard/', '/admin', '/dashboard')).toBe(true);
  });

  it('resolves dynamic resource paths within the configured console base', () => {
    expect(resolveConsolePath('/applications/client%2F1/settings?tab=details#fields', '/admin'))
      .toBe('/admin/applications/client%2F1/settings?tab=details#fields');
    expect(resolveConsolePath('/dashboard', '')).toBe('/dashboard');
    expect(resolveConsolePath('/../dashboard', '/admin')).toBe('/admin/dashboard');
  });

  it('rejects external, relative and browser-normalized network paths', () => {
    for (const path of ['https://example.invalid', '//example.invalid', '/\\example.invalid', 'dashboard', '/\n/example.invalid']) {
      expect(() => resolveConsolePath(path, '/admin')).toThrow(TypeError);
    }
  });
});
