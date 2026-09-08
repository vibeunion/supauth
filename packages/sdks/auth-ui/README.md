# @supauth/sdk-auth-ui

SupaOAuth adapter for Supabase Auth UI React and Svelte components. It maps SupaOAuth sign-in experience configuration to `@supabase/auth-ui-react` and `@supabase/auth-ui-svelte` props.
SupaOAuth 为 Supabase Auth UI React 和 Svelte 组件提供适配层，将登录体验配置映射为 `@supabase/auth-ui-react` 与 `@supabase/auth-ui-svelte` 的 props。

## Installation / 安装

```bash
npm install @supauth/sdk-auth-ui
# or
bun add @supauth/sdk-auth-ui
```

## Quick Start / 快速开始

### One-shot resolve (recommended) / 一次性解析（推荐）

```typescript
import { resolveSupabaseAuthUiConfig } from '@supauth/sdk-auth-ui';

const config = await resolveSupabaseAuthUiConfig({
  baseUrl: 'https://auth.your-domain.com',
  applicationId: 'your-app-client-id',
  locale: 'en',
  view: 'sign_in',
  redirectTo: 'https://your-app.com/callback',
});

// Pass config.auth to the Auth UI component.
```

Resolve the public sign-in experience and localized phrases in one call.
一次调用即可解析公开登录体验和本地化短语。

### Manual build from experience data / 使用体验数据手动构建

```typescript
import {
  buildSupabaseAuthUiConfig,
  mapConnectorsToSupabaseProviders,
  buildHostedBrandingCss,
} from '@supauth/sdk-auth-ui';

// Fetch experience data with @supauth/sdk-typescript first.
const { experience, phrases } = await fetchExperience();

const config = buildSupabaseAuthUiConfig({
  experience,
  phrases: phrases?.phrases,
  view: 'sign_in',
  redirectTo: 'https://your-app.com/callback',
});

const { supportedProviders, unsupportedConnectors } =
  mapConnectorsToSupabaseProviders(experience.connectors);
const css = buildHostedBrandingCss(config.brand);
```

Build the adapter config when experience and phrase data are already available.
如果已经取得体验和短语数据，可以直接手动构建适配器配置。

### Usage with `@supabase/auth-ui-react` / 与 `@supabase/auth-ui-react` 一起使用

```tsx
import { useEffect, useState } from 'react';
import { Auth } from '@supabase/auth-ui-react';
import { resolveSupabaseAuthUiConfig } from '@supauth/sdk-auth-ui';

function LoginPage() {
  const [authConfig, setAuthConfig] = useState(null);

  useEffect(() => {
    resolveSupabaseAuthUiConfig({
      baseUrl: 'https://auth.your-domain.com',
      applicationId: 'your-app-client-id',
      locale: 'en',
    }).then(setAuthConfig);
  }, []);

  if (!authConfig) return <div>Loading...</div>;
  return <Auth supabaseClient={supabase} {...authConfig.auth} />;
}
```

## Complete Logout and Account Switching / 完整退出与切换账号

When an application signs out, clear its local session first, then navigate the top-level window to SupAuth's same-origin `/logout` page. That page revokes the central GoTrue session with `scope=local`; clearing only the application token can cause the next authorization request to silently sign the user back into the previous account.
业务应用退出时应先清理本地会话，再让顶层窗口导航到 SupAuth 同源的 `/logout` 页面。该页面会使用 `scope=local` 撤销中央 GoTrue 会话；仅清理业务应用 token 可能导致下一次授权时静默登录回原账号。

```ts
import { buildHostedLogoutUrl } from '@supauth/sdk-auth-ui';

const logoutUrl = buildHostedLogoutUrl({
  supauthUrl: 'https://auth.example.com',
  clientId: 'my-app',
  idTokenHint: session.idToken,
  postLogoutRedirectUri: 'https://app.example.com/login',
  state: crypto.randomUUID(),
});

await clearApplicationSession();
window.location.assign(logoutUrl);
```

`postLogoutRedirectUri` must exactly match the URI registered for the OAuth client. SupAuth validates the `id_token_hint` signature, issuer, audience/azp, and client ownership; failed validation returns only to the SupAuth sign-in page.
`postLogoutRedirectUri` 必须与 OAuth client 登记的 URI 完全一致。SupAuth 会校验 `id_token_hint` 的签名、issuer、audience/azp 和 client 归属；校验失败时只会返回 SupAuth 自身登录页。

## Supported Providers / 支持的 Provider

The adapter maps SupaOAuth connectors to these Supabase Auth UI provider IDs:
适配器会将 SupaOAuth connector 映射为以下 Supabase Auth UI provider ID：

`apple`, `azure`, `bitbucket`, `discord`, `facebook`, `github`, `gitlab`, `google`, `keycloak`, `linkedin`, `notion`, `spotify`, `slack`, `twitch`, `twitter`, `workos`, `zoom`, `email`, `phone`, `saml`

Connectors outside this list are returned as `unsupportedConnectors` for custom rendering, such as enterprise SSO buttons.
不在此列表中的 connector 会通过 `unsupportedConnectors` 返回，供业务侧自定义渲染，例如企业 SSO 按钮。

## API / API 参考

### `resolveSupabaseAuthUiConfig(options)`

Resolves sign-in experience and phrases from the SupaOAuth public API, then builds the Auth UI config.
从 SupaOAuth 公共 API 解析登录体验和短语，并构建 Auth UI 配置。

Options / 参数：

- `baseUrl` (string, required / 必填) - SupaOAuth auth-server base URL / auth-server 基础 URL
- `applicationId` (string, optional / 可选) - OAuth client ID for per-app branding / 用于应用级品牌配置的 OAuth client ID
- `authorizationId` (string, optional / 可选) - GoTrue authorization ID / GoTrue authorization ID
- `locale` (string, optional / 可选) - Language tag for i18n phrases / 本地化短语的语言标签，例如 `'en'` 或 `'zh-CN'`
- `view` (EmbeddedAuthUiView, optional / 可选) - `'sign_in'` | `'sign_up'` | `'forgotten_password'`
- `redirectTo` (string, optional / 可选) - Post-login redirect URL / 登录后的跳转 URL

### `buildSupabaseAuthUiConfig(input)`

Builds Auth UI config from pre-fetched experience and phrase data.
使用预先取得的体验和短语数据构建 Auth UI 配置。

### `mapConnectorsToSupabaseProviders(connectors)`

Splits connectors into supported provider IDs and connectors that require custom rendering.
将 connector 分为受支持的 provider ID，以及需要自定义渲染的 connector。

### `buildHostedBrandingCss(branding)`

Generates CSS for the hosted authorize page background and custom styles.
为 hosted authorize page 的背景和自定义样式生成 CSS。

## Types / 类型

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

## License / 许可证

MIT
