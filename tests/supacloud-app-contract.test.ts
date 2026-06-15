import { describe, expect, it } from 'bun:test';
import { readFileSync } from 'node:fs';
import {
  createSupacloudAppManifest,
  SUPAOAUTH_TABLE_OWNERSHIP,
} from '../scripts/supacloud-app-contract.js';
import { MIGRATION_SQL } from '../packages/auth-server/src/db/migrate.js';

describe('SupAuth SupaCloud app contract', () => {
  it('declares SupaCloud Functions as the only HTTP runtime', () => {
    const manifest = createSupacloudAppManifest({
      functionBundle: 'packages/auth-server/dist/supacloud-function/supacloud-function.js',
      adminStaticDir: 'packages/admin-console/build',
      openapiPath: 'artifacts/supacloud-app/openapi.json',
    });

    expect(manifest.http_runtime).toBe('supacloud-functions-only');
    expect(manifest.source_of_truth).toBe('supacloud-management-api');
    expect(manifest.forbidden_runtime_forms).toEqual(expect.arrayContaining([
      'standalone-http-server',
      'systemd-service',
      'pm2-process',
      'webhook-worker-process',
      'cron-process-owned-by-supauth',
    ]));
    expect(manifest.functions).toHaveLength(1);
    expect(manifest.functions[0].entrypoint).toBe('packages/auth-server/dist/supacloud-function/supacloud-function.js');
  });

  it('declares SupaCloud-owned management domains and managed jobs', () => {
    const manifest = createSupacloudAppManifest({
      functionBundle: 'function.js',
      adminStaticDir: 'admin',
      openapiPath: 'openapi.json',
    });

    expect(manifest.supacloud_owned_management_domains).toEqual(expect.arrayContaining([
      'applications',
      'application_secrets',
      'users',
      'user_sessions',
      'user_passkeys',
      'organizations',
      'rbac_roles',
      'audit',
      'webhooks',
      'webhook_delivery',
    ]));
    expect(manifest.supacloud_managed_background_jobs.map((job) => job.name)).toEqual([
      'webhook-delivery',
      'account-provisioning-import',
    ]);
    expect(manifest.supauth_overlay_domains).toEqual(expect.arrayContaining([
      'hosted_auth_pages',
      'sign_in_experience_overrides',
      'oauth_consents',
      'account_provisioning_records',
    ]));
  });

  it('classifies every supaoauth schema table owner', () => {
    const schema = readFileSync('packages/auth-server/src/db/schema.ts', 'utf8');
    const tables = [...schema.matchAll(/supaoauth\.table\('([^']+)'/g)].map((match) => match[1]).sort();
    const classified = Object.keys(SUPAOAUTH_TABLE_OWNERSHIP).sort();

    expect(classified).toEqual(tables);
    expect(SUPAOAUTH_TABLE_OWNERSHIP.webhooks.class).toBe('legacy-temporary');
    expect(SUPAOAUTH_TABLE_OWNERSHIP.application_secrets.class).toBe('legacy-temporary');
    expect(SUPAOAUTH_TABLE_OWNERSHIP.passkeys.class).toBe('legacy-temporary');
    expect(SUPAOAUTH_TABLE_OWNERSHIP.sign_in_experience.class).toBe('supauth-overlay');
    expect(SUPAOAUTH_TABLE_OWNERSHIP.account_provisioning_records.class).toBe('supauth-overlay');
  });

  it('new project migration creates only overlay tables, not legacy source-of-truth tables', () => {
    const legacyTables = Object.entries(SUPAOAUTH_TABLE_OWNERSHIP)
      .filter(([, ownership]) => ownership.class === 'legacy-temporary')
      .map(([table]) => table);
    const overlayTables = Object.entries(SUPAOAUTH_TABLE_OWNERSHIP)
      .filter(([, ownership]) => ownership.class === 'supauth-overlay')
      .map(([table]) => table);

    for (const table of legacyTables) {
      expect(MIGRATION_SQL).not.toContain(`CREATE TABLE IF NOT EXISTS supaoauth.${table}`);
    }
    for (const table of overlayTables) {
      expect(MIGRATION_SQL).toContain(`CREATE TABLE IF NOT EXISTS supaoauth.${table}`);
    }
    expect(MIGRATION_SQL).toContain("auth.jwt() -> 'app_metadata' -> 'supaoauth'");
    expect(MIGRATION_SQL).not.toContain('JOIN supaoauth.permissions');
    expect(MIGRATION_SQL).not.toContain('FROM supaoauth.role_assignments');
  });

  it('legacy management repositories are SupaCloud facades, not local source-of-truth writes', () => {
    const repositoryContracts = [
      {
        file: 'packages/auth-server/src/repositories/roles.ts',
        forbidden: ["from '../db/index.js'", "from '../db/schema.js'"],
      },
      {
        file: 'packages/auth-server/src/repositories/organizations.ts',
        forbidden: ["from '../db/index.js'", "from '../db/schema.js'"],
      },
      {
        file: 'packages/auth-server/src/repositories/webhooks.ts',
        forbidden: ["from '../db/index.js'", "from '../db/schema.js'"],
      },
      {
        file: 'packages/auth-server/src/repositories/application-control.ts',
        forbidden: ['applicationSecrets', 'randomBytes'],
      },
      {
        file: 'packages/auth-server/src/repositories/organization-control.ts',
        forbidden: ["from '../db/index.js'", "from '../db/schema.js'", 'randomBytes', 'createHash'],
      },
      {
        file: 'packages/auth-server/src/repositories/account-control.ts',
        forbidden: ["from '../db/index.js'", "from '../db/schema.js'", 'accountSessions'],
      },
      {
        file: 'packages/auth-server/src/repositories/rbac-bridge.ts',
        forbidden: ["from '../db/index.js'", "from '../db/schema.js'", 'roleAssignments'],
      },
    ];

    for (const contract of repositoryContracts) {
      const source = readFileSync(contract.file, 'utf8');
      expect(source).toContain('getSupaCloudAdapter');
      for (const token of contract.forbidden) {
        expect(source).not.toContain(token);
      }
    }
  });

  it('legacy route verifier delegates to installed SupaCloud app verification', () => {
    const verifierSource = readFileSync('scripts/kong-verify.ts', 'utf8');

    expect(verifierSource).toContain('verifySupacloudInstalledApp');
    expect(verifierSource).toContain('SUPAUTH_INSTALLED_BASE_URL');
    expect(verifierSource).not.toContain('Host routing');
    expect(verifierSource).not.toContain("headers['Host']");
    expect(verifierSource).not.toContain('localhost:8000');
  });
});
