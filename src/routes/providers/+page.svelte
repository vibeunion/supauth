<script>
  import { listProviders } from '$lib/api/client.js';

  let providers = $state([]);
  let loading = $state(true);
  let error = $state(null);

  onMount(async () => {
    try {
      providers = await listProviders();
    } catch (e) {
      error = e.message;
    }
    loading = false;
  });

  // Group by category
  const chinaProviders = ['wechat', 'wechat_miniprogram', 'wechat_mp', 'qq', 'weibo', 'alipay', 'dingtalk', 'douyin', 'baidu', 'huawei', 'xiaomi', 'kuaishou', 'bilibili'];
</script>

<h2 class="text-2xl font-bold text-surface-900 mb-6">SSO 提供商</h2>

{#if error}
  <div class="bg-red-50 border border-red-200 rounded-lg p-4 text-red-700 mb-4">{error}</div>
{/if}

{#if loading}
  <p class="text-surface-400">加载中...</p>
{:else}
  <!-- International -->
  <h3 class="text-lg font-semibold text-surface-800 mb-3">国际提供商</h3>
  <div class="grid grid-cols-4 gap-3 mb-8">
    {#each providers.filter(p => !chinaProviders.includes(p.id)) as provider}
      <div class="bg-white rounded-lg border {provider.enabled ? 'border-green-300 bg-green-50' : 'border-surface-200'} p-4">
        <div class="flex items-center justify-between">
          <span class="font-medium text-surface-900 capitalize">{provider.id}</span>
          <span class="text-xs px-2 py-0.5 rounded-full {provider.enabled ? 'bg-green-100 text-green-700' : 'bg-surface-100 text-surface-500'}">
            {provider.enabled ? '已启用' : '未启用'}
          </span>
        </div>
      </div>
    {/each}
  </div>

  <!-- China -->
  <h3 class="text-lg font-semibold text-surface-800 mb-3">国内提供商</h3>
  <div class="grid grid-cols-4 gap-3">
    {#each providers.filter(p => chinaProviders.includes(p.id)) as provider}
      <div class="bg-white rounded-lg border {provider.enabled ? 'border-green-300 bg-green-50' : 'border-surface-200'} p-4">
        <div class="flex items-center justify-between">
          <span class="font-medium text-surface-900">{provider.id}</span>
          <span class="text-xs px-2 py-0.5 rounded-full {provider.enabled ? 'bg-green-100 text-green-700' : 'bg-surface-100 text-surface-500'}">
            {provider.enabled ? '已启用' : '未启用'}
          </span>
        </div>
      </div>
    {/each}
  </div>
{/if}
