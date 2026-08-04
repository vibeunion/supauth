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
bun add @supauth/sdk-auth-ui
```

## npm 发布边界

现有 `@supauth/shared`、`@supauth/sdk-typescript` 和 `@supauth/sdk-auth-ui` 包名已经完成 bootstrap，使用者只需通过 npm 或 Bun 安装，不应执行仓库内的发布命令。

新建的 npm 包名仍需维护者从本地认证会话完成一次 bootstrap，之后才能配置 `.github/workflows/release-please.yml` 的 Trusted Publisher。后续版本由 release tag 驱动：工作流先构建和 dry-run，再只发布目标包。发布完成必须回读 npm registry、执行全新安装/import smoke，并在声称 OIDC provenance 时验证 attestation；“版本已存在而跳过”只证明幂等，不证明该版本带 provenance。

## React 示例

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
