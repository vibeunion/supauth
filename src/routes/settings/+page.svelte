<script>
  import { getAuthConfig, getOAuthServerStatus } from '$lib/api/client.js';

  let config = $state(null);
  let oauthStatus = $state(null);
  let loading = $state(true);
  let error = $state(null);

  onMount(async () => {
    try {
      [config, oauthStatus] = await Promise.all([
        getAuthConfig(),
        getOAuthServerStatus(),
      ]);
    } catch (e) {
      error = e.message;
    }
    loading = false;
  });
</script>

<h2 class="text-2xl font-bold text-surface-900 mb-6">认证配置</h2>

{#if error}
  <div class="bg-red-50 border border-red-200 rounded-lg p-4 text-red-700 mb-4">{error}</div>
{/if}

{#if loading}
  <p class="text-surface-400">加载中...</p>
{:else}
  <!-- OAuth Server -->
  <div class="bg-white rounded-xl border border-surface-200 p-6 mb-6">
    <h3 class="text-lg font-semibold text-surface-800 mb-4">OAuth 2.0 / OIDC Server</h3>
    <div class="grid grid-cols-2 gap-4">
      <div>
        <p class="text-sm text-surface-500">状态</p>
        <p class="font-medium {oauthStatus?.enabled ? 'text-green-600' : 'text-surface-400'}">
          {oauthStatus?.enabled ? '已启用' : '未启用'}
        </p>
      </div>
      <div>
        <p class="text-sm text-surface-500">签名算法</p>
        <p class="font-medium text-surface-900">{oauthStatus?.signing_alg || 'HS256'}</p>
      </div>
      <div>
        <p class="text-sm text-surface-500">动态注册</p>
        <p class="font-medium text-surface-900">{oauthStatus?.allow_dynamic_registration ? '已启用' : '已关闭'}</p>
      </div>
      <div>
        <p class="text-sm text-surface-500">迁移状态</p>
        <p class="font-medium text-surface-900">{oauthStatus?.migration_status || 'N/A'}</p>
      </div>
    </div>
  </div>

  <!-- Auth settings -->
  <div class="bg-white rounded-xl border border-surface-200 p-6">
    <h3 class="text-lg font-semibold text-surface-800 mb-4">认证设置</h3>
    <div class="grid grid-cols-2 gap-4">
      <div>
        <p class="text-sm text-surface-500">注册</p>
        <p class="font-medium text-surface-900">{config?.enable_signup ? '已开放' : '已关闭'}</p>
      </div>
      <div>
        <p class="text-sm text-surface-500">邮箱确认</p>
        <p class="font-medium text-surface-900">{config?.enable_confirmations ? '需要确认' : '自动确认'}</p>
      </div>
      <div>
        <p class="text-sm text-surface-500">匿名用户</p>
        <p class="font-medium text-surface-900">{config?.external_anonymous_users_enabled ? '已启用' : '已关闭'}</p>
      </div>
      <div>
        <p class="text-sm text-surface-500">JWT 过期时间</p>
        <p class="font-medium text-surface-900">{config?.jwt_expiry || 3600}s</p>
      </div>
      <div>
        <p class="text-sm text-surface-500">密码最小长度</p>
        <p class="font-medium text-surface-900">{config?.password_min_length || 8}</p>
      </div>
      <div>
        <p class="text-sm text-surface-500">MFA 最大因子数</p>
        <p class="font-medium text-surface-900">{config?.mfa_max_enrolled_factors || 10}</p>
      </div>
    </div>
  </div>
{/if}
