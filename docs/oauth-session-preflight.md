# OAuth Session Configuration Preflight

An authorization-code login succeeding does not prove that the same client can
refresh its session. A long-lived consumer must explicitly require both
`authorization_code` and `refresh_token`. Discovery describes server capabilities,
not the grants assigned to an individual client.

## SDK Usage

Use the Management SDK only in a trusted provisioning or release process:

```ts
import { SupaOAuthClient, assertOAuthSessionGrants } from '@supauth/sdk-typescript';

const client = new SupaOAuthClient({
  baseUrl: process.env.SUPAUTH_URL!,
  accessToken: process.env.SUPAUTH_MANAGEMENT_TOKEN!,
});

const application = await client.getApplication('application-id');
assertOAuthSessionGrants(application, 'refreshable');
```

The assertion is read-only, does not log the response, and rejects absent or
malformed grants. It does not replace checks for client identity, public versus
confidential type, token endpoint authentication, exact callback allowlists,
issuer, or token application binding.

For new applications, opt into the same check before sending a write:

```ts
await client.createApplication({
  client_name: 'Operations',
  client_type: 'public',
  token_endpoint_auth_method: 'none',
  redirect_uris: ['https://operations.example.test/auth/callback'],
  grant_types: ['authorization_code', 'refresh_token'],
}, { sessionRequirement: 'refreshable' });
```

`updateApplication(id, payload, options)` accepts the same local option. A guarded
update must include the intended full `grant_types` array; partial updates without
it fail locally rather than guessing from a stale read. Read back the resulting
client and validate it independently after a successful write.

Omitting the option preserves existing behavior. `'authorization-code'` requires
only `authorization_code`. The SDK never adds grants, changes existing clients,
persists a new server policy, retries a write, or serializes the local option.
A read-back check is a point-in-time preflight, not a guarantee against subsequent
administrator changes or a real token-refresh acceptance test.

The two write methods additionally accept `CreateOAuthClientInput`, matching
the server's `client_name`, `client_type`, and `token_endpoint_auth_method`
fields. The existing `CreateApplicationInput` remains accepted for compatibility;
neither input is silently renamed or otherwise rewritten.

## Acceptance

```gherkin
Scenario: A long-lived client omits refresh authorization
  Given a client allows only authorization_code
  When provisioning requires a refreshable session
  Then the SDK rejects before making a write
  And identifies refresh_token as missing without exposing credentials

Scenario: A short-lived client is intentional
  Given a caller does not request a refreshable session
  When the client is created or updated
  Then its existing grant configuration is preserved

Scenario: Release checks the actual client
  Given discovery advertises refresh_token but the client does not
  When the release reads back and validates the client
  Then preflight fails without modifying the client
```

Scope: SDK configuration guard only. Browser session coordination, token rotation,
business drafts, authorization rules, server defaults, deployment, and runtime
acceptance are outside this change. Rollback removes the opt-in SDK calls; no
database migration or client grant rollback is implied.
