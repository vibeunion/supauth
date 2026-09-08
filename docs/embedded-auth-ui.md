# Embedded Auth UI / 嵌入式 Auth UI

SupaOAuth recommends reusing the official `@supabase/auth-ui-react` or `@supabase/auth-ui-svelte` packages for embedded sign-in pages instead of creating a separate Clerk-style component tree.
SupaOAuth 建议嵌入式登录页直接复用官方 `@supabase/auth-ui-react` 或 `@supabase/auth-ui-svelte`，不要另行创建 Clerk 风格的组件树。

Reasons / 原因：

- GoTrue owns the authentication runtime; Auth UI only renders forms and social providers.
  GoTrue 负责认证 runtime，Auth UI 只需渲染表单和 social provider。
- `@supabase/auth-ui-*` already supports `providers`, `appearance`, `view`, `redirectTo`, and `localization`.
  `@supabase/auth-ui-*` 已支持 `providers`、`appearance`、`view`、`redirectTo` 和 `localization`。
- SupaOAuth only adds branding, phrase, and provider mapping; it does not replace the UI runtime.
  SupaOAuth 只补充品牌、文案和 provider 映射，不重写 UI runtime。

## Installation / 安装

React:

```bash
bun add @supabase/supabase-js @supabase/auth-ui-react
```

Svelte:

```bash
bun add @supabase/supabase-js @supabase/auth-ui-svelte
```

Bridge package / 桥接包：

```bash
bun add @supauth/sdk-auth-ui
```

## npm Publishing Boundary / npm 发布边界

The published `@supauth/shared`, `@supauth/sdk-typescript`, and `@supauth/sdk-auth-ui` packages are installed through npm or Bun; consumers should not run repository publishing commands.
已发布的 `@supauth/shared`、`@supauth/sdk-typescript` 和 `@supauth/sdk-auth-ui` 应通过 npm 或 Bun 安装，使用者不应执行仓库内的发布命令。

New package names require maintainer bootstrap and Trusted Publisher configuration. After Release Please creates a release, the same workflow publishes changed public packages in dependency order with npm OIDC and provenance. The single-tag `workflow_dispatch` entry point only republishes an existing release tag; historical versions lower than npm `latest` use the `backfill` dist-tag and must not move `latest` backward. Verify each publication through the npm registry, a clean install/import smoke test, and a provenance attestation; skipping an existing version proves idempotency, not provenance.
新建的 npm 包名仍需维护者从本地认证会话完成一次 bootstrap，之后才能配置 `.github/workflows/release-please.yml` 的 Trusted Publisher。Release Please 创建版本后，同一工作流会按依赖顺序使用 npm OIDC 和 provenance 自动发布本次变更的公开包；`workflow_dispatch` 单标签入口仅用于补发已有 release tag，低于当前 npm `latest` 的历史版本使用 `backfill` dist-tag，不能回退 `latest`。发布完成必须回读 npm registry、执行全新安装/import smoke，并验证 provenance attestation；“版本已存在而跳过”只证明幂等，不证明该版本带 provenance。

## React Example / React 示例

```tsx
import { useEffect, useState } from 'react';
import { Auth } from '@supabase/auth-ui-react';
import { createClient } from '@supabase/supabase-js';
import { resolveSupabaseAuthUiConfig } from '@supauth/sdk-auth-ui';

const supabase = createClient(import.meta.env.VITE_SUPABASE_URL, import.meta.env.VITE_SUPABASE_ANON_KEY);

export function SignInScreen() {
  const [config, setConfig] = useState(null);

  useEffect(() => {
    resolveSupabaseAuthUiConfig({
      baseUrl: 'https://auth.example.com',
      applicationId: 'my-client-id',
      locale: 'en',
      redirectTo: 'https://app.example.com/auth/callback',
    }).then(setConfig);
  }, []);

  if (!config) return null;
  return <Auth supabaseClient={supabase} {...config.auth} />;
}
```

Use `config.brand` and `buildHostedBrandingCss()` to apply the brand background, title, favicon, and custom CSS to a host page.
可以使用 `config.brand` 和 `buildHostedBrandingCss()` 将品牌背景、标题、favicon 与自定义 CSS 应用到宿主页。

## Svelte Example / Svelte 示例

```svelte
<script lang="ts">
  import { onMount } from 'svelte';
  import { Auth } from '@supabase/auth-ui-svelte';
  import { createClient } from '@supabase/supabase-js';
  import { resolveSupabaseAuthUiConfig } from '@supauth/sdk-auth-ui';

  const supabase = createClient(
    import.meta.env.VITE_SUPABASE_URL,
    import.meta.env.VITE_SUPABASE_ANON_KEY
  );

  let config = null;

  onMount(async () => {
    config = await resolveSupabaseAuthUiConfig({
      baseUrl: 'https://auth.example.com',
      applicationId: 'my-client-id',
      locale: 'en',
      redirectTo: 'https://app.example.com/auth/callback',
    });
  });
</script>

{#if config}
  <Auth supabaseClient={supabase} {...config.auth} />
{/if}
```

## Boundaries / 边界

- `@supabase/auth-ui-*` supports a fixed provider set. Custom enterprise connectors returned by SupaOAuth appear in `unsupportedConnectors` and require application-side buttons.
  `@supabase/auth-ui-*` 支持固定的 provider 集合。SupaOAuth 返回的自定义企业 connector 会出现在 `unsupportedConnectors` 中，需要业务侧自行渲染按钮。
- `config.brand.backgroundUrl`, `faviconUrl`, `pageTitle`, and `customCss` are host-page capabilities, not Auth UI component props.
  `config.brand.backgroundUrl`、`faviconUrl`、`pageTitle` 和 `customCss` 属于宿主页能力，不是 Auth UI 组件本身的 props。
- For Clerk-style `<UserButton />` or `<OrganizationSwitcher />` components, build application-owned components above this bridge instead of forking `@supabase/auth-ui-*`.
  如果需要 Clerk 风格的 `<UserButton />` 或 `<OrganizationSwitcher />`，应在该桥接层之上构建业务自有组件，而不是直接 fork `@supabase/auth-ui-*`。
