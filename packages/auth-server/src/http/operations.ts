import { authRoutes } from '../auth/index.js';
import { hostedPageRoutes } from '../routes/hosted-pages.js';
import { publicSignInExperienceRoutes } from '../routes/sign-in-experience.js';
import { publicOAuthRoutes } from '../routes/sign-in-experience.js';
import { publicConnectorRoutes } from '../routes/sign-in-experience.js';
import { publicPhrasesRoutes } from '../routes/sign-in-experience.js';
import { publicCustomUiRoutes } from '../routes/sign-in-experience.js';
import { publicAccountClaimRoutes } from '../routes/account-provisioning.js';
import { publicAccountPasswordRoutes } from '../routes/account-password.js';
import { publicAccountRoutes } from '../routes/account-self-service.js';
import { authHookRoutes } from '../routes/auth-hooks.js';
import { publicOrganizationRoutes } from '../routes/organizations.js';
import { oauthSsoRoutes } from '../routes/sso-authorize.js';
import { publicOauthSsoRoutes } from '../routes/sso-authorize.js';
import { storageRoutes } from '../storage/index.js';
import { healthRoutes } from '../routes/health.js';
import { runtimeRoutes } from '../routes/health.js';
import { authHookAdminRoutes } from '../routes/auth-hooks.js';
import { capabilityRoutes } from '../routes/capabilities.js';
import { applicationRoutes } from '../routes/applications.js';
import { connectorRoutes } from '../routes/connectors.js';
import { resourceRoutes } from '../routes/resources.js';
import { userRoutes } from '../routes/users.js';
import { organizationRoutes } from '../routes/organizations.js';
import { roleRoutes } from '../routes/roles.js';
import { sieRoutes } from '../routes/sign-in-experience.js';
import { authConfigRoutes } from '../routes/sign-in-experience.js';
import { webhookRoutes } from '../routes/webhooks.js';
import { auditRoutes } from '../routes/audit.js';
import { compatibilityRoutes } from '../routes/compatibility.js';
import { syncRoutes } from '../routes/sync.js';
import { adminToolRoutes } from '../routes/admin-tools.js';
import { consentRoutes } from '../routes/consents.js';
import { orgTemplateRoutes } from '../routes/org-templates.js';
import { securityConfigRoutes } from '../routes/security-config.js';
import { provisioningRoutes } from '../routes/provisioning.js';
import { enterpriseSSORoutes } from '../routes/enterprise-sso.js';
import { passkeyRoutes } from '../routes/passkeys.js';
import { apiVersionRoutes } from '../routes/api-versions.js';
import { tenantConfigRoutes } from '../routes/tenant-config.js';
import { tenantRoutes } from '../routes/tenant.js';
import { myAccountRoutes } from '../routes/my-account.js';
import { rbacBridgeRoutes } from '../routes/rbac-bridge.js';
import { routeGateRoutes } from '../routes/route-gate.js';
import { accountProvisioningRoutes } from '../routes/account-provisioning.js';

export const httpOperationGroups = [
  authRoutes,
  hostedPageRoutes,
  publicSignInExperienceRoutes,
  publicOAuthRoutes,
  publicConnectorRoutes,
  publicPhrasesRoutes,
  publicCustomUiRoutes,
  publicAccountClaimRoutes,
  publicAccountPasswordRoutes,
  publicAccountRoutes,
  authHookRoutes,
  publicOrganizationRoutes,
  oauthSsoRoutes,
  publicOauthSsoRoutes,
  storageRoutes,
  healthRoutes,
  runtimeRoutes,
  authHookAdminRoutes,
  capabilityRoutes,
  applicationRoutes,
  connectorRoutes,
  resourceRoutes,
  userRoutes,
  organizationRoutes,
  roleRoutes,
  sieRoutes,
  authConfigRoutes,
  webhookRoutes,
  auditRoutes,
  compatibilityRoutes,
  syncRoutes,
  adminToolRoutes,
  consentRoutes,
  orgTemplateRoutes,
  securityConfigRoutes,
  provisioningRoutes,
  enterpriseSSORoutes,
  passkeyRoutes,
  apiVersionRoutes,
  tenantConfigRoutes,
  tenantRoutes,
  myAccountRoutes,
  rbacBridgeRoutes,
  routeGateRoutes,
  accountProvisioningRoutes,
] as const;

export const httpOperations = httpOperationGroups.flatMap(group =>
  Object.values(group.operations).map(operation => ({
    method: operation.method,
    path: `${group.prefix}${operation.path}`,
    options: operation.options,
  })),
);
