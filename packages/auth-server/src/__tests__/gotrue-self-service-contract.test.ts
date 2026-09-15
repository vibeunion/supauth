import { Type as StrictType, decodeSchema as strictDecodeSchema } from '../../../shared/src/schema.js';
import { describe, expect, test } from 'bun:test';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { renderHostedPage } from '../../../admin-console/src/hosted/build.js';

function workspaceSource(path: string) {
  return readFileSync(resolve(import.meta.dir, '../../../..', path), 'utf8');
}

describe('stock GoTrue account and administrator boundaries', () => {
  test('does not expose incompatible administrator or per-session UI actions', async () => {
    const accountHtml = await renderHostedPage('account');
    const adminClient = workspaceSource('packages/admin-console/src/lib/api/client.js');
    const userPages = [
      workspaceSource('packages/admin-console/src/routes/users/+page.svelte'),
      workspaceSource('packages/admin-console/src/routes/users/[userId]/+page.svelte'),
    ].join('\n');

    for (const removedToken of [
      '/account/sessions',
      'revoke-session',
      'sessions-list',
      'data-section="sessions"',
    ]) {
      expect(accountHtml).not.toContain(removedToken);
    }
    expect(workspaceSource('scripts/generate-hosted-pages.ts')).toContain("await renderHostedPage('account')");
    expect(accountHtml).not.toContain('/account/logout?scope=');
    expect(accountHtml).toContain('hostedAuth.signOut({ scope })');
    expect(accountHtml).toContain('data-logout-scope="local"');
    expect(accountHtml).toContain('data-logout-scope="global"');
    expect(accountHtml).toContain('data-logout-scope="others"');

    for (const removedMethod of [
      'listUserSessions',
      'revokeUserSession',
      'unlinkUserIdentity',
      'revokeUserGrant',
    ]) {
      expect(adminClient).not.toContain(`function ${removedMethod}`);
      expect(userPages).not.toContain(removedMethod);
    }
    expect(adminClient).toContain('function listUserGrants');
    expect(userPages).toContain('listUserGrants');
  });

  test('keeps the manual provider-linking entry hidden until public capability negotiation enables it', async () => {
    const accountHtml = await renderHostedPage('account');

    expect(accountHtml).toContain('id="identity-link-form" class="inline-form" hidden');
    expect(accountHtml).toContain("providerLinkingCapability.available");
    expect(accountHtml).toContain("/account/identities/authorize");
    expect(accountHtml).toContain("redirect_to: providerLinkingCapability.redirect_to");
    expect(accountHtml).not.toContain('service_role');
  });

  test('hides compatibility routes from OpenAPI while publishing bearer self-service', async () => {
    process.env["SUPACLOUD_API_URL"] ||= 'http://localhost:9090';
    process.env["SUPACLOUD_MASTER_TOKEN"] ||= 'contract-test';
    process.env["PROJECT_REF"] ||= 'contract-test';
    process.env["DATABASE_URL"] ||= 'postgres://placeholder';
    process.env["RUNTIME_MODE"] = 'gotrue';

    const { app } = await import('../index.js');
    const response = await app.handle(new Request('http://localhost/swagger/json'));
    const specification = strictDecodeSchema(StrictType.Object({ "paths": StrictType.Optional(StrictType.Record(StrictType.String({ pattern: "^[\\s\\S]*$" }), StrictType.Unknown())) }), await response.json());
    const paths = Object.keys(specification.paths || {});

    expect(response.ok).toBe(true);
    expect(paths).toContain('/v1/public/account/grants');
    expect(paths).toContain('/v1/public/account/grants/{clientId}');
    expect(paths).toContain('/v1/public/account/identities/authorize');
    expect(paths).toContain('/v1/public/account/identities/{identityId}');
    expect(paths).toContain('/v1/public/account/logout');
    for (const hiddenPath of [
      '/v1/public/account/sessions',
      '/v1/public/account/sessions/{sessionId}/revoke',
      '/v1/my-account/profile',
      '/v1/users/{userId}/sessions',
      '/v1/users/{userId}/sessions/{sessionId}/revoke',
      '/v1/users/{userId}/identities/{identityId}',
      '/v1/users/{userId}/grants/{clientId}',
      '/v1/consents',
    ]) {
      expect(paths).not.toContain(hiddenPath);
    }
    expect(paths).toContain('/v1/users/{userId}/grants');
  });
});
