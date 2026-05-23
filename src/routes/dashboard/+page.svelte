<script>
  import { onMount } from 'svelte';
  import { getOAuthServerStatus, getDiscovery, getProject } from '$lib/api/client.js';

  let status = $state(null);
  let discovery = $state(null);
  let project = $state(null);
  let loading = $state(true);
  let error = $state(null);

  onMount(async () => {
    try {
      [status, discovery, project] = await Promise.all([
        getOAuthServerStatus(),
        getDiscovery(),
        getProject(),
      ]);
    } catch (e) {
      error = e.message;
    }
    loading = false;
  });
</script>

<h2 class="text-2xl font-bold text-surface-900 mb-6">授权中心概览</h2>

{#if loading}
  <p class="text-surface-400">加载中...</p>
{:else if error}
  <div class="bg-red-50 border border-red-200 rounded-lg p-4 text-red-700">{error}</div>
{:else}
  <!-- Status cards -->
  <div class="grid grid-cols-3 gap-4 mb-8">
    <div class="bg-white rounded-xl border border-surface-200 p-5">
      <p class="text-sm text-surface-500 mb-1">OAuth Server</p>
      <p class="text-xl font-bold {status?.enabled ? 'text-green-600' : 'text-surface-400'}">
        {status?.enabled ? '已启用' : '未启用'}
      </p>
      <p class="text-xs text-surface-400 mt-2">签名: {status?.signing_alg || 'N/A'}</p>
    </div>

    <div class="bg-white rounded-xl border border-surface-200 p-5">
      <p class="text-sm text-surface-500 mb-1">Issuer</p>
      <p class="text-sm font-mono text-brand-700 break-all">{status?.issuer || 'N/A'}</p>
      <p class="text-xs text-surface-400 mt-2">迁移: {status?.migration_status || 'N/A'}</p>
    </div>

    <div class="bg-white rounded-xl border border-surface-200 p-5">
      <p class="text-sm text-surface-500 mb-1">项目</p>
      <p class="text-xl font-bold text-surface-900">{project?.name || 'N/A'}</p>
      <p class="text-xs text-surface-400 mt-2">ref: {project?.ref || 'N/A'}</p>
    </div>
  </div>

  <!-- OIDC Endpoints -->
  <div class="bg-white rounded-xl border border-surface-200 p-6 mb-8">
    <h3 class="text-lg font-semibold text-surface-800 mb-4">OIDC 端点</h3>
    <div class="space-y-2">
      {#if discovery}
        {#each [
          ['Authorization', discovery.authorization_endpoint],
          ['Token', discovery.token_endpoint],
          ['UserInfo', discovery.userinfo_endpoint],
          ['JWKS', discovery.jwks_uri],
          ['Discovery', discovery.issuer + '/.well-known/openid-configuration'],
        ] as [label, url] (label)}
          <div class="flex items-center gap-4 py-2">
            <span class="text-sm font-medium text-surface-600 w-28 shrink-0">{label}</span>
            <code class="text-sm font-mono text-brand-700 break-all bg-surface-50 px-2 py-1 rounded flex-1">{url}</code>
          </div>
        {/each}
      {/if}
    </div>
  </div>

  <!-- Supported features -->
  {#if discovery}
    <div class="bg-white rounded-xl border border-surface-200 p-6">
      <h3 class="text-lg font-semibold text-surface-800 mb-4">支持的能力</h3>
      <div class="flex flex-wrap gap-2">
        {#each discovery.scopes_supported || [] as scope (scope)}
          <span class="px-3 py-1 bg-brand-50 text-brand-700 rounded-full text-sm font-medium">{scope}</span>
        {/each}
        {#each discovery.code_challenge_methods_supported || [] as method (method)}
          <span class="px-3 py-1 bg-surface-100 text-surface-700 rounded-full text-sm font-medium">PKCE {method}</span>
        {/each}
        {#each discovery.id_token_signing_alg_values_supported || [] as alg (alg)}
          <span class="px-3 py-1 bg-surface-100 text-surface-700 rounded-full text-sm font-medium">{alg}</span>
        {/each}
      </div>
    </div>
  {/if}
{/if}
