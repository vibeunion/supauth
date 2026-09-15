import { SupaOAuthClient } from '@supauth/sdk-typescript';
import { sdkEndpoints, type SdkEndpointInput, type SdkEndpointResult } from '@supauth/shared';
import { configurationEndpoints, type ConfigurationEndpointInput } from '../../../shared/dist/server-configuration.js';
import type { SupaOAuthJWTClaims } from '@supauth/shared';

const client = new SupaOAuthClient({ baseUrl: 'https://auth.example.test', fetch: (input, init) => fetch(input, init) });
const input: SdkEndpointInput<'getUserPermissions'> = { params: { userId: 'user' }, query: { application_id: 'app' } };
const permissions: Promise<SdkEndpointResult<'getUserPermissions'>> = client.getUserPermissions(input.params.userId, undefined, input.query?.application_id);
const download: Promise<Blob> = client.getAuditExportDownload('export');
const method: string = sdkEndpoints.getUser.method;
void permissions; void download; void method;
const consent: ConfigurationEndpointInput<'submitOAuthConsent'> = {
  params: { authorizationId: 'one' }, headers: { authorization: 'Bearer test' }, body: { action: 'approve' },
};
void consent;
const consentPath: string = configurationEndpoints.submitOAuthConsent.path;
void consentPath;
// @ts-expect-error Consent choices must be concrete.
const invalidConsent: ConfigurationEndpointInput<'submitOAuthConsent'>['body'] = { action: 'allow' };
void invalidConsent;
const claims: Pick<SupaOAuthJWTClaims, 'sub' | 'azp'> = { sub: 'subject', azp: 'authorized-party' };
void claims;
// @ts-expect-error Identity integration azp is optional but cannot be null.
const invalidClaims: Pick<SupaOAuthJWTClaims, 'sub' | 'azp'> = { sub: 'subject', azp: null };
void invalidClaims;

// @ts-expect-error Browser DOM globals must not leak into workers.
document.createElement('div');
// @ts-expect-error No Bun ambient globals.
Bun.serve({});
client.updateTenantMember('member', { role: ' ADMIN ', status: ' SUSPENDED ' });
client.updateResource('resource');
client.addScope('resource', { name: 'read', description: null });
client.updateScope('resource', 'scope', { description: null });
client.createResource({ name: 'Documents', indicator: 'https://api.example.test', scopes: [{ name: 'read', description: null }] });
client.createResource({ name: 'Documents', indicator: 'https://api.example.test', description: 'Document API' });
client.createResource({ name: 'Documents', indicator: 'https://api.example.test', description: null });
client.updateResource('resource', { description: 'Updated description' });
client.updateResource('resource', { description: null });
// @ts-expect-error Resource descriptions are nullable text, not arbitrary JSON.
client.createResource({ name: 'Documents', indicator: 'https://api.example.test', description: { text: 'invalid' } });
// @ts-expect-error Updates retain the same nullable text domain.
client.updateResource('resource', { description: 42 });
client.upsertConnectorFactory('oidc', {
  name: 'Example', protocol: 'oidc', category: 'enterprise_sso', config_schema: null, enabled: null,
});
client.createEnterpriseSSOConfig({
  connector_id: 'connector', domains: ['example.test'],
  jit_provisioning: null, org_membership_mapping: null, role_mapping: null,
});
client.updateSignInExperience({ branding: null, password_policy: null });
client.updateApplicationSignInExperience('app', { branding: null });
client.upsertTenantConfig('domain', 'default', { enabled: null });
// @ts-expect-error Nullable tenant defaults still require boolean values.
client.upsertTenantConfig('domain', 'default', { enabled: 'true' });
// @ts-expect-error Nullable descriptions still reject non-text values.
client.addScope('resource', { name: 'read', description: 42 });
// @ts-expect-error Nullable mapping containers retain string value types.
client.createEnterpriseSSOConfig({ connector_id: 'connector', domains: [], role_mapping: { 'line\nbreak': 42 } });
// @ts-expect-error Nullable configuration defaults do not accept string booleans.
client.upsertConnectorFactory('oidc', { name: 'Example', protocol: 'oidc', category: 'enterprise_sso', enabled: 'true' });
// @ts-expect-error Nullable request containers do not widen response containers.
const invalidExperience: SdkEndpointResult<'updateSignInExperience'>['password_policy'] = null;
void invalidExperience;
client.createApplication({ redirect_uris: ['https://client.example.test/callback'], type: { vendor: ['custom'] } });
// @ts-expect-error Opaque OAuth extensions still must be JSON-compatible.
client.createApplication({ redirect_uris: ['https://client.example.test/callback'], type: () => 'service' });
// @ts-expect-error Role wire values remain strings, with spelling checked at runtime.
client.updateTenantMember('member', { role: 123 });
// @ts-expect-error Normalized response roles remain the closed canonical enum.
const invalidMemberRole: SdkEndpointResult<'updateTenantMember'>['role'] = 'superuser';
void invalidMemberRole;
// @ts-expect-error Hook status is a domain response, not an untyped dictionary.
client.getAuthHookStatus().then(status => { status.private_secret; });
