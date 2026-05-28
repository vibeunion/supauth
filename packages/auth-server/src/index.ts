// SupaOAuth Auth Server — Elysia/Bun Management API + BFF
// Routes are organized into separate modules for OpenAPI tag generation.

import { Elysia } from 'elysia';
import { cors } from '@elysiajs/cors';
import { swagger } from '@elysiajs/swagger';
import { getConfig, validateConfig } from './config/index.js';
import { observabilityMiddleware } from './middleware/index.js';
import { adminAuthGuard, authRoutes } from './auth/index.js';
import { storageRoutes } from './storage/index.js';
import { healthRoutes, runtimeRoutes } from './routes/health.js';
import { applicationRoutes } from './routes/applications.js';
import { connectorRoutes } from './routes/connectors.js';
import { resourceRoutes } from './routes/resources.js';
import { userRoutes } from './routes/users.js';
import { organizationRoutes } from './routes/organizations.js';
import { roleRoutes } from './routes/roles.js';
import { sieRoutes, authConfigRoutes, publicSignInExperienceRoutes, publicOAuthRoutes } from './routes/sign-in-experience.js';
import { webhookRoutes } from './routes/webhooks.js';
import { auditRoutes } from './routes/audit.js';
import { compatibilityRoutes } from './routes/compatibility.js';
import { syncRoutes } from './routes/sync.js';
import { adminToolRoutes } from './routes/admin-tools.js';
import { consentRoutes } from './routes/consents.js';
import { orgTemplateRoutes } from './routes/org-templates.js';
import { securityConfigRoutes } from './routes/security-config.js';
import { provisioningRoutes } from './routes/provisioning.js';
import { enterpriseSSORoutes } from './routes/enterprise-sso.js';
import { passkeyRoutes } from './routes/passkeys.js';
import { apiVersionRoutes } from './routes/api-versions.js';
import { tenantConfigRoutes } from './routes/tenant-config.js';
import { myAccountRoutes } from './routes/my-account.js';

const config = getConfig();
const configErrors = validateConfig(config);

if (configErrors.length > 0) {
  console.warn('SupaOAuth config warnings:', configErrors.join('; '));
}

const app = new Elysia()
  .use(observabilityMiddleware)
  .use(cors({ origin: config.corsOrigins, credentials: true }))
  .use(authRoutes)
  .use(storageRoutes)
  .use(publicSignInExperienceRoutes)
  .use(publicOAuthRoutes)
  .use(swagger({
    path: '/swagger',
    documentation: {
      info: { title: 'SupaOAuth Management API', version: '0.2.0', description: 'SupaOAuth is an independent Identity Provider (IdP) — a standalone user center that orchestrates GoTrue as the OIDC runtime and provides product RBAC, organizations, connectors, and sign-in experience management.' },
      tags: [
        { name: 'Health', description: 'Server health and project info' },
        { name: 'Project', description: 'Project-level metadata' },
        { name: 'Runtime', description: 'OIDC runtime (GoTrue) gateway checks' },
        { name: 'Applications', description: 'OAuth client application management' },
        { name: 'Bindings', description: 'Application-resource/scope bindings' },
        { name: 'Connectors', description: 'Social/enterprise SSO provider management' },
        { name: 'Resources', description: 'API resource and scope definitions' },
        { name: 'Scopes', description: 'OAuth scope management' },
        { name: 'Users', description: 'User CRUD and permission resolution' },
        { name: 'Organizations', description: 'Organization and member management' },
        { name: 'Org Templates', description: 'Organization templates for auto-provisioning roles and permissions' },
        { name: 'Members', description: 'Organization member operations' },
        { name: 'RBAC', description: 'Role-based access control — roles, permissions, assignments' },
        { name: 'Permissions', description: 'Permission management under roles' },
        { name: 'Assignments', description: 'Role assignment and revocation' },
        { name: 'Auth Config', description: 'GoTrue auth configuration proxy' },
        { name: 'Sign-in Experience', description: 'Customizable sign-in flow configuration' },
        { name: 'Compatibility', description: 'Supabase compatibility inspector' },
        { name: 'Audit', description: 'Admin action audit log queries' },
        { name: 'Webhooks', description: 'Webhook endpoint management and event delivery' },
        { name: 'Sync', description: 'Metadata sync to GoTrue app_metadata' },
        { name: 'Auth', description: 'Admin console authentication' },
        { name: 'Storage', description: 'Avatar and branding asset storage proxy' },
        { name: 'Admin Tools', description: 'RLS migration assistant and SDK tools' },
        { name: 'Consents', description: 'User consent management for OAuth authorization' },
        { name: 'Security', description: 'Production security configuration and enforcement' },
        { name: 'Provisioning', description: 'SupaCloud project provisioning and idempotent reconcile' },
        { name: 'Enterprise SSO', description: 'Enterprise SSO configuration, domain discovery, JIT provisioning' },
        { name: 'Passkeys', description: 'WebAuthn passkey enrollment, listing, and revocation' },
        { name: 'API Versions', description: 'API version tracking and breaking change detection' },
        { name: 'Tenant Config', description: 'Captcha, message templates, domains, phrases, branding, and custom profile fields' },
        { name: 'Secrets', description: 'Application client secret lifecycle' },
        { name: 'Consent', description: 'Application consent configuration' },
        { name: 'Connector Factory', description: 'Connector provider catalog and factory definitions' },
        { name: 'Invitations', description: 'Organization invitations' },
        { name: 'JIT', description: 'Organization just-in-time provisioning settings' },
        { name: 'Account Center', description: 'User profile, sessions, identities, MFA, and suspension operations' },
      ],
    },
  }))
  .use(adminAuthGuard)

  // ─── Route groups ────────────────────────────────────
  .use(healthRoutes)
  .use(runtimeRoutes)
  .use(applicationRoutes)
  .use(connectorRoutes)
  .use(resourceRoutes)
  .use(userRoutes)
  .use(organizationRoutes)
  .use(roleRoutes)
  .use(sieRoutes)
  .use(authConfigRoutes)
  .use(webhookRoutes)
  .use(auditRoutes)
  .use(compatibilityRoutes)
  .use(syncRoutes)
  .use(adminToolRoutes)
  .use(consentRoutes)
  .use(orgTemplateRoutes)
  .use(securityConfigRoutes)
  .use(provisioningRoutes)
  .use(enterpriseSSORoutes)
  .use(passkeyRoutes)
  .use(apiVersionRoutes)
  .use(tenantConfigRoutes)
  .use(myAccountRoutes)

  .listen({ port: config.port, hostname: config.host });

console.log(`SupaOAuth Management API running at http://${config.host}:${config.port}`);
console.log(`Swagger docs at http://${config.host}:${config.port}/swagger`);
console.log(`Runtime mode: ${config.runtimeMode}`);

// Export the app for OpenAPI spec extraction (used by scripts/export-openapi.ts)
export { app };
