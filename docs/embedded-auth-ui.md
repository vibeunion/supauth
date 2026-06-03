# Embedded Auth UI

SupaOAuth 的嵌入式登录页推荐直接复用官方 `@supabase/auth-ui-react` 或 `@supabase/auth-ui-svelte`，不要先自造一套 Clerk 风格组件树。

原因：

- GoTrue 已经负责认证 runtime，Auth UI 只需要渲染表单和 social providers。
- `@supabase/auth-ui-*` 已支持 `providers`、`appearance`、`view`、`redirectTo`、`localization`。
- SupaOAuth 只需要补一层“品牌/文案/provider 适配”，而不是重写 UI runtime。

## 安装

React:

```bash
bun add @supabase/supabase-js @supabase/auth-ui-react
```

Svelte:

```bash
bun add @supabase/supabase-js @supabase/auth-ui-svelte
```

桥接包：

```bash
bun add @supaoauth/sdk-auth-ui
```

## 首次 npm 发布

首次创建 `@supaoauth/*` 包时，需要维护者在本地 npm 会话中手动发布一次，顺序是：

```bash
bun install
bun run --filter '@supaoauth/shared' build
bun run --filter '@supaoauth/sdk-typescript' build
bun run --filter '@supaoauth/sdk-auth-ui' build
node .github/scripts/prepare-auth-ui-npm-package.mjs --write

(cd packages/shared && npm publish --access public)
(cd packages/sdks/typescript && npm publish --access public)
(cd packages/sdks/auth-ui && npm publish --access public)
```

首次发布完成后，再在 npmjs 为这三个包配置 GitHub Trusted Publisher。之后 GitHub release workflow 会使用 npm OIDC provenance 自动发布新版本；如果包名尚未 bootstrap，workflow 只做打包验证并跳过自动 publish。

## React 示例

```tsx
import { useEffect, useState } from 'react';
import { Auth } from '@supabase/auth-ui-react';
import { createClient } from '@supabase/supabase-js';
import { resolveSupabaseAuthUiConfig } from '@supaoauth/sdk-auth-ui';

const supabase = createClient(import.meta.env.VITE_SUPABASE_URL, import.meta.env.VITE_SUPABASE_ANON_KEY);

export function SignInScreen() {
  const [config, setConfig] = useState(null);

  useEffect(() => {
    resolveSupabaseAuthUiConfig({
      baseUrl: 'https://auth.example.com',
      applicationId: 'my-client-id',
      locale: 'zh-CN',
      redirectTo: 'https://app.example.com/auth/callback',
    }).then(setConfig);
  }, []);

  if (!config) return null;

  return (
    <Auth
      supabaseClient={supabase}
      {...config.auth}
    />
  );
}
```

如果需要把品牌背景、title、favicon 应用到宿主页，可以使用 `config.brand` 和 `buildHostedBrandingCss()`。

## Svelte 示例

```svelte
<script lang="ts">
  import { onMount } from 'svelte';
  import { Auth } from '@supabase/auth-ui-svelte';
  import { createClient } from '@supabase/supabase-js';
  import { resolveSupabaseAuthUiConfig } from '@supaoauth/sdk-auth-ui';

  const supabase = createClient(
    import.meta.env.VITE_SUPABASE_URL,
    import.meta.env.VITE_SUPABASE_ANON_KEY
  );

  let config = null;

  onMount(async () => {
    config = await resolveSupabaseAuthUiConfig({
      baseUrl: 'https://auth.example.com',
      applicationId: 'my-client-id',
      locale: 'zh-CN',
      redirectTo: 'https://app.example.com/auth/callback',
    });
  });
</script>

{#if config}
  <Auth supabaseClient={supabase} {...config.auth} />
{/if}
```

## 边界

- `@supabase/auth-ui-*` 支持的 provider 有固定集合；SupaOAuth 返回的自定义 enterprise connector 会出现在 `unsupportedConnectors` 中，需要业务侧单独渲染按钮。
- `config.brand.backgroundUrl`、`faviconUrl`、`pageTitle`、`customCss` 是宿主页能力，不是 Auth UI 组件本身的 props。
- 如果未来要做到 Clerk 那种 `<UserButton />`、`<OrganizationSwitcher />`，建议在这个桥接层之上再做自有组件，而不是直接 fork `@supabase/auth-ui-*`。
