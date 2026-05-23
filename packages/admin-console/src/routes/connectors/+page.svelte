<script>
  import { onMount } from 'svelte';
  import { listConnectors, updateConnector, testConnector } from '$lib/api/client.js';

  let connectors = $state([]);
  let loading = $state(true);
  let error = $state(null);
  let testing = $state(null);

  const chinaConnectors = ['wechat', 'wechat_miniprogram', 'wechat_mp', 'qq', 'weibo', 'alipay', 'dingtalk', 'douyin', 'baidu', 'huawei', 'xiaomi', 'kuaishou', 'bilibili'];

  async function load() {
    loading = true;
    try {
      const res = await listConnectors();
      connectors = Array.isArray(res) ? res : (res.items || res.data || []);
    } catch (e) {
      error = e.message;
    }
    loading = false;
  }

  async function handleToggle(connector) {
    try {
      await updateConnector(connector.id, { enabled: !connector.enabled });
      await load();
    } catch (e) {
      error = e.message;
    }
  }

  async function handleTest(connectorId) {
    testing = connectorId;
    try {
      const result = await testConnector(connectorId);
      alert(result.status === 'reachable' ? 'Connection test passed' : 'Connection test failed');
    } catch (e) {
      alert('Test failed: ' + e.message);
    }
    testing = null;
  }

  onMount(load);
</script>

<div class="flex items-center justify-between mb-6">
  <h2 class="text-2xl font-bold text-surface-900">Connectors</h2>
</div>

{#if error}
  <div class="bg-red-50 border border-red-200 rounded-lg p-4 text-red-700 mb-4">{error}</div>
{/if}

{#if loading}
  <p class="text-surface-400">Loading...</p>
{:else}
  <!-- International -->
  <h3 class="text-lg font-semibold text-surface-800 mb-3">Social Connectors</h3>
  <div class="grid grid-cols-4 gap-3 mb-8">
    {#each connectors.filter(c => !chinaConnectors.includes(c.id)) as connector (connector.id)}
      <div class="bg-white rounded-lg border {connector.enabled ? 'border-green-300 bg-green-50' : 'border-surface-200'} p-4">
        <div class="flex items-center justify-between mb-2">
          <span class="font-medium text-surface-900 capitalize">{connector.id}</span>
          <span class="text-xs px-2 py-0.5 rounded-full {connector.enabled ? 'bg-green-100 text-green-700' : 'bg-surface-100 text-surface-500'}">
            {connector.enabled ? 'Enabled' : 'Disabled'}
          </span>
        </div>
        <div class="flex gap-2">
          <button onclick={() => handleToggle(connector)} class="text-xs text-brand-600 hover:text-brand-800">
            {connector.enabled ? 'Disable' : 'Enable'}
          </button>
          {#if connector.enabled}
            <button onclick={() => handleTest(connector.id)} class="text-xs text-surface-600 hover:text-surface-800" disabled={testing === connector.id}>
              {testing === connector.id ? 'Testing...' : 'Test'}
            </button>
          {/if}
        </div>
      </div>
    {/each}
  </div>

  <!-- China -->
  <h3 class="text-lg font-semibold text-surface-800 mb-3">China Connectors</h3>
  <div class="grid grid-cols-4 gap-3">
    {#each connectors.filter(c => chinaConnectors.includes(c.id)) as connector (connector.id)}
      <div class="bg-white rounded-lg border {connector.enabled ? 'border-green-300 bg-green-50' : 'border-surface-200'} p-4">
        <div class="flex items-center justify-between mb-2">
          <span class="font-medium text-surface-900">{connector.id}</span>
          <span class="text-xs px-2 py-0.5 rounded-full {connector.enabled ? 'bg-green-100 text-green-700' : 'bg-surface-100 text-surface-500'}">
            {connector.enabled ? 'Enabled' : 'Disabled'}
          </span>
        </div>
        <div class="flex gap-2">
          <button onclick={() => handleToggle(connector)} class="text-xs text-brand-600 hover:text-brand-800">
            {connector.enabled ? 'Disable' : 'Enable'}
          </button>
          {#if connector.enabled}
            <button onclick={() => handleTest(connector.id)} class="text-xs text-surface-600 hover:text-surface-800" disabled={testing === connector.id}>
              {testing === connector.id ? 'Testing...' : 'Test'}
            </button>
          {/if}
        </div>
      </div>
    {/each}
  </div>
{/if}
