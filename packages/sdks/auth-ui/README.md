# @supauth/sdk-auth-ui

SupaOAuth adapter for Supabase Auth UI React and Svelte components. Bridges SupaOAuth sign-in experience configuration to `@supabase/auth-ui-react` / `@supabase/auth-ui-svelte` props.

## Installation

```bash
npm install @supauth/sdk-auth-ui
# or
bun add @supauth/sdk-auth-ui
```

## Quick Start

### One-shot resolve (recommended)

```typescript
import { resolveSupabaseAuthUiConfig } from '@supauth/sdk-auth-ui';

const config = await resolveSupabaseAuthUiConfig({
  baseUrl: 'https://auth.your-domain.com',
  applicationId: 'your-app-client-id',
  locale: 'zh-CN',
  view: 'sign_in',
  redirectTo: 'https://your-app.com/callback',
});

// Pass config.auth to Auth UI component
```

### Manual build from experience data

```typescript
import {
  buildSupabaseAuthUiConfig,
  mapConnectorsToSupabaseProviders,
  buildHostedBrandingCss,
} from '@supauth/sdk-auth-ui';

// After fetching experience via @supauth/sdk-typescript
const { experience, phrases } = await fetchExperience();

const config = buildSupabaseAuthUiConfig({
  experience,
  phrases: phrases?.phrases,
  view: 'sign_in',
  redirectTo: 'https://your-app.com/callback',
});

// Get provider mapping
const { supportedProviders, unsupportedConnectors } = mapConnectorsToSupabaseProviders(experience.connectors);

// Generate branding CSS for hosted page
const css = buildHostedBrandingCss(config.brand);
```

### Usage with @supabase/auth-ui-react

```tsx
import { resolveSupabaseAuthUiConfig } from '@supauth/sdk-auth-ui';
import { Auth } from '@supabase/auth-ui-react';

function LoginPage() {
  const [authConfig, setAuthConfig] = useState(null);

  useEffect(() => {
    resolveSupabaseAuthUiConfig({
      baseUrl: 'https://auth.your-domain.com',
      applicationId: 'your-app-client-id',
      locale: 'zh-CN',
    }).then(setAuthConfig);
  }, []);

  if (!authConfig) return <div>Loading...</div>;

  return (
    <Auth
      supabaseClient={supabase}
      {...authConfig.auth}
    />
  );
}
```

## Supported Providers

The adapter maps SupaOAuth connectors to Supabase Auth UI provider IDs:

`apple`, `azure`, `bitbucket`, `discord`, `facebook`, `github`, `gitlab`, `google`, `keycloak`, `linkedin`, `notion`, `spotify`, `slack`, `twitch`, `twitter`, `workos`, `zoom`, `email`, `phone`, `saml`

Connectors not in this list are returned as `unsupportedConnectors` for custom rendering (e.g., enterprise SSO buttons).

## API

### `resolveSupabaseAuthUiConfig(options)`

Resolves sign-in experience and phrases from the SupaOAuth public API, then builds the Auth UI config in one call.

**Options:**
- `baseUrl` (string, required) — SupaOAuth auth-server base URL
- `applicationId` (string, optional) — OAuth client ID for per-app branding
- `authorizationId` (string, optional) — GoTrue authorization ID
- `locale` (string, optional) — Language tag for i18n phrases (e.g., `'zh-CN'`, `'en'`)
- `view` (EmbeddedAuthUiView, optional) — `'sign_in'` | `'sign_up'` | `'forgotten_password'`
- `redirectTo` (string, optional) — Post-login redirect URL

### `buildSupabaseAuthUiConfig(input)`

Builds Auth UI config from pre-fetched experience and phrase data.

### `mapConnectorsToSupabaseProviders(connectors)`

Splits connectors into `supportedProviders` (mapped to Supabase provider IDs) and `unsupportedConnectors` (needs custom rendering).

### `buildHostedBrandingCss(branding)`

Generates CSS string for hosted authorize page background and custom styles.

## Types

```typescript
import type {
  SupabaseAuthUiProvider,
  EmbeddedAuthUiView,
  HostedBranding,
  AuthUiLocalizationVariables,
  SupabaseAuthUiBridgeConfig,
  ResolveSupabaseAuthUiConfigOptions,
} from '@supauth/sdk-auth-ui';
```

## License

MIT
