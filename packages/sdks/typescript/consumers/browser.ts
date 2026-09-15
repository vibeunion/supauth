import { SupaOAuthClient, sdkEndpoints, type SupaOAuthFetch } from '@supauth/sdk-typescript';
import { decodeSchema, type SdkEndpointInput, type SdkEndpointResult } from '@supauth/shared';

const transport: SupaOAuthFetch = (input, init) => fetch(input, init);
const client = new SupaOAuthClient({ baseUrl: 'https://auth.example.test', fetch: transport });
const input: SdkEndpointInput<'createRole'> = { body: { name: 'Reader', description: null, permissions: ['documents.read'] } };
const role: Promise<SdkEndpointResult<'createRole'>> = client.createRole(input.body);
const userId: Promise<string> = client.getUser('user').then(user => user.id);
const blob: Promise<Blob> = client.getAuditExportDownload('export');
client.updateUser('user', { upstream_extension: { enabled: true } });
decodeSchema(sdkEndpoints.getUser.result, {});
void role; void userId; void blob;

// @ts-expect-error Bun must not leak into the published consumer environment.
Bun.file('secret');
// @ts-expect-error No implicit Node environment.
process.env.SECRET;
// @ts-expect-error Domain requests cannot widen their input.
client.createRole({ name: 123 });
// @ts-expect-error Real responses have concrete user fields.
client.getUser('user').then(user => { user.not_a_user_field; });
// @ts-expect-error Metadata is JSON, not executable data.
client.createUser({ user_metadata: { callback: () => 1 } });
// @ts-expect-error Unknown authorization operations are rejected.
client.compileAuthorizationPlan({ tables: [{ table: 'items', operations: ['execute'] }] });
client.compileAuthorizationPlan({ project_ref: 'project-one' });
client.updateAuthConfig({ disable_signup: true });
client.getRuntimeHealth().then(health => {
  const reachable: boolean = health.discovery;
  const algorithm: string | null = health.signing_alg;
  void reachable; void algorithm;
  // @ts-expect-error Runtime health has component diagnostics, not a status string.
  health.status;
});
// @ts-expect-error Signup state must be boolean.
client.updateAuthConfig({ disable_signup: 'true' });
client.getSecurityStatus().then(status => {
  const code: 'admin_token_enabled' | 'security_config_missing' | undefined = status.warning_codes[0];
  void code;
});
// @ts-expect-error Project references are strings.
client.compileAuthorizationPlan({ project_ref: 42 });
client.updateSignInExperience({ branding: { logo_url: null, content: ['copy', 42] }, password_policy: { min_length: 12 } });
client.listWebhookLogs('hook').then(logs => {
  const cursor: string | null = logs.next_cursor;
  void cursor;
});
client.listWebhookEvents().then(events => {
  const guarantee: 'transactional' | 'post_mutation' | undefined = events.catalog[0]?.guarantee;
  void guarantee;
});
// @ts-expect-error Optional means absent, not an explicit undefined value.
client.createRole({ name: 'Reader', description: undefined });
// @ts-expect-error With unchecked indexing enabled, list elements can be missing.
client.listUsers().then(page => page.items[0].id);
// @ts-expect-error Response typing comes from the schema, not a caller-supplied generic.
client.getUser<{ trusted: true }>('user');
// @ts-expect-error An extension dictionary does not weaken known user fields.
client.updateUser('user', { email: false, upstream_extension: true });
// @ts-expect-error Extension values must still be JSON.
client.updateUser('user', { upstream_extension: () => 1 });
