export const fixtureTime = '2026-09-08T00:00:00.000Z';

export function fixtureUser(id = 'one') {
  return {
    id, aud: 'authenticated', email: 'user@example.test',
    app_metadata: {}, user_metadata: {}, created_at: fixtureTime,
  };
}

export function fixtureOrganization() {
  return {
    id: 'one', name: 'Organization', description: '', members: [],
    created_at: fixtureTime, updated_at: fixtureTime,
  };
}

export function fixtureAssignment() {
  return {
    id: 'one', role_id: 'role-one', user_id: 'user-one',
    application_id: 'app-one', organization_id: 'org-one', created_at: fixtureTime,
  };
}

export function managementReadFixture(path: string, method: string): unknown {
  if (path.endsWith('/audit')) return {
    items: [{ id: 'one', event_type: 'user.updated', actor_type: 'admin', resource_type: 'user',
      resource_id: 'user-one', details: {}, created_at: fixtureTime }],
    total: 1,
  };
  if (path.endsWith('/webhooks')) return {
    items: [{ id: 'one', url: 'https://example.test/webhook', events: [], enabled: true,
      secret_configured: true, created_at: fixtureTime, updated_at: fixtureTime }],
    total: 1,
  };
  if (path.endsWith('/mfa/factor-one/reset')) return { reset: true, factor_id: 'factor-one', result: null };
  if (/\/auth\/users\/[^/]+\/permissions$/.test(path)) return { roles: [], permissions: [], scopes: [] };
  if (/\/roles\/[^/]+\/assign$/.test(path)) {
    return method === 'GET' ? { items: [fixtureAssignment()], total: 1 } : fixtureAssignment();
  }
  if (/\/auth\/users\/[^/]+\/roles$/.test(path)) return { items: [fixtureAssignment()], total: 1 };
  if (path.endsWith('/rbac/roles')) return { items: [{ id: 'one', name: 'Role', permissions: [] }], total: 1 };
  if (path.endsWith('/organizations')) return { items: [fixtureOrganization()], total: 1 };
  if (/\/auth\/users(?:\/[^/]+)?$/.test(path)) {
    return path.endsWith('/auth/users') && method === 'GET'
      ? { items: [fixtureUser()], total: 1 }
      : fixtureUser();
  }
  return { items: [{ id: 'one' }], total: 1, id: 'one' };
}
