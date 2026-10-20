import { defineModule } from '@supacloud/app';
import { AuthModule } from './features/auth.module.js';
import { HostedPageModule } from './features/hosted-page.module.js';
import { PublicSignInExperienceModule } from './features/public-sign-in-experience.module.js';
import { PublicOAuthModule } from './features/public-oauth.module.js';
import { PublicConnectorModule } from './features/public-connector.module.js';
import { PublicPhrasesModule } from './features/public-phrases.module.js';
import { PublicCustomUiModule } from './features/public-custom-ui.module.js';
import { PublicAccountClaimModule } from './features/public-account-claim.module.js';
import { PublicAccountPasswordModule } from './features/public-account-password.module.js';
import { PublicAccountModule } from './features/public-account.module.js';
import { AuthHookModule } from './features/auth-hook.module.js';
import { OauthSsoModule } from './features/oauth-sso.module.js';
import { PublicOauthSsoModule } from './features/public-oauth-sso.module.js';
import { StorageModule } from './features/storage.module.js';
import { HealthModule } from './features/health.module.js';
import { RuntimeModule } from './features/runtime.module.js';
import { AuthHookAdminModule } from './features/auth-hook-admin.module.js';
import { CapabilityModule } from './features/capability.module.js';
import { ApplicationModule } from './features/application.module.js';
import { ConnectorModule } from './features/connector.module.js';
import { ResourceModule } from './features/resource.module.js';
import { UserModule } from './features/user.module.js';
import { OrganizationModule } from './features/organization.module.js';
import { RoleModule } from './features/role.module.js';
import { SieModule } from './features/sie.module.js';
import { AuthConfigModule } from './features/auth-config.module.js';
import { WebhookModule } from './features/webhook.module.js';
import { AuditModule } from './features/audit.module.js';
import { CompatibilityModule } from './features/compatibility.module.js';
import { SyncModule } from './features/sync.module.js';
import { AdminToolModule } from './features/admin-tool.module.js';
import { ConsentModule } from './features/consent.module.js';
import { OrgTemplateModule } from './features/org-template.module.js';
import { SecurityConfigModule } from './features/security-config.module.js';
import { ProvisioningModule } from './features/provisioning.module.js';
import { EnterpriseSSOModule } from './features/enterprise-sso.module.js';
import { PasskeyModule } from './features/passkey.module.js';
import { ApiVersionModule } from './features/api-version.module.js';
import { TenantConfigModule } from './features/tenant-config.module.js';
import { TenantModule } from './features/tenant.module.js';
import { MyAccountModule } from './features/my-account.module.js';
import { RbacBridgeModule } from './features/rbac-bridge.module.js';
import { RouteGateModule } from './features/route-gate.module.js';
import { AccountProvisioningModule } from './features/account-provisioning.module.js';

export const AuthServerModule = defineModule({
  name: 'supauth',
  tags: ['type:app', 'scope:supauth'],
  imports: [AuthModule, HostedPageModule, PublicSignInExperienceModule, PublicOAuthModule, PublicConnectorModule, PublicPhrasesModule, PublicCustomUiModule, PublicAccountClaimModule, PublicAccountPasswordModule, PublicAccountModule, AuthHookModule, OauthSsoModule, PublicOauthSsoModule, StorageModule, HealthModule, RuntimeModule, AuthHookAdminModule, CapabilityModule, ApplicationModule, ConnectorModule, ResourceModule, UserModule, OrganizationModule, RoleModule, SieModule, AuthConfigModule, WebhookModule, AuditModule, CompatibilityModule, SyncModule, AdminToolModule, ConsentModule, OrgTemplateModule, SecurityConfigModule, ProvisioningModule, EnterpriseSSOModule, PasskeyModule, ApiVersionModule, TenantConfigModule, TenantModule, MyAccountModule, RbacBridgeModule, RouteGateModule, AccountProvisioningModule],
});
