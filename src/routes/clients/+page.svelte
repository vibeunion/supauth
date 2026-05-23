<script>
  import { onMount } from 'svelte';
  import { listOAuthClients, createOAuthClient, deleteOAuthClient } from '$lib/api/client.js';

  let clients = $state([]);
  let loading = $state(true);
  let error = $state(null);
  let showCreate = $state(false);
  let newClient = $state({ name: '', redirect_uris: '', client_type: 'confidential' });

  async function load() {
    loading = true;
    try {
      const res = await listOAuthClients();
      clients = Array.isArray(res) ? res : (res.items || res.data || []);
    } catch (e) {
      error = e.message;
    }
    loading = false;
  }

  async function handleCreate() {
    try {
      await createOAuthClient({
        client_name: newClient.name,
        redirect_uris: newClient.redirect_uris.split(',').map(s => s.trim()).filter(Boolean),
        client_type: newClient.client_type,
        grant_types: ['authorization_code', 'refresh_token'],
        token_endpoint_auth_method: newClient.client_type === 'public' ? 'none' : 'client_secret_basic',
      });
      showCreate = false;
      newClient = { name: '', redirect_uris: '', client_type: 'confidential' };
      await load();
    } catch (e) {
      error = e.message;
    }
  }

  async function handleDelete(id) {
    if (!confirm('确认删除此 OAuth 客户端？')) return;
    try {
      await deleteOAuthClient(id);
      await load();
    } catch (e) {
      error = e.message;
    }
  }

  onMount(load);
</script>

<div class="flex items-center justify-between mb-6">
  <h2 class="text-2xl font-bold text-surface-900">OAuth 客户端</h2>
  <button onclick={() => showCreate = !showCreate} class="px-4 py-2 bg-brand-600 text-white rounded-lg text-sm font-medium hover:bg-brand-700">
    {showCreate ? '取消' : '+ 新建客户端'}
  </button>
</div>

{#if error}
  <div class="bg-red-50 border border-red-200 rounded-lg p-4 text-red-700 mb-4">{error}</div>
{/if}

{#if showCreate}
  <div class="bg-white rounded-xl border border-surface-200 p-6 mb-6">
    <h3 class="text-lg font-semibold text-surface-800 mb-4">新建 OAuth 客户端</h3>
    <div class="space-y-4">
      <div>
        <label for="client-name" class="block text-sm font-medium text-surface-700 mb-1">名称</label>
        <input id="client-name" bind:value={newClient.name} class="w-full px-3 py-2 border border-surface-300 rounded-lg text-sm" placeholder="My App">
      </div>
      <div>
        <label for="client-redirects" class="block text-sm font-medium text-surface-700 mb-1">回调地址 (逗号分隔)</label>
        <input id="client-redirects" bind:value={newClient.redirect_uris} class="w-full px-3 py-2 border border-surface-300 rounded-lg text-sm" placeholder="http://localhost:3000/auth/callback">
      </div>
      <div>
        <label for="client-type" class="block text-sm font-medium text-surface-700 mb-1">类型</label>
        <select id="client-type" bind:value={newClient.client_type} class="px-3 py-2 border border-surface-300 rounded-lg text-sm">
          <option value="confidential">机密 (Confidential)</option>
          <option value="public">公共 (Public / SPA)</option>
        </select>
      </div>
      <button onclick={handleCreate} class="px-4 py-2 bg-brand-600 text-white rounded-lg text-sm font-medium hover:bg-brand-700">创建</button>
    </div>
  </div>
{/if}

{#if loading}
  <p class="text-surface-400">加载中...</p>
{:else if clients.length === 0}
  <div class="bg-surface-50 rounded-xl border border-surface-200 p-8 text-center">
    <p class="text-surface-500">暂无 OAuth 客户端</p>
    <p class="text-sm text-surface-400 mt-2">点击"新建客户端"注册你的第一个应用</p>
  </div>
{:else}
  <div class="space-y-3">
    {#each clients as client (client.client_id)}
      <div class="bg-white rounded-xl border border-surface-200 p-5">
        <div class="flex items-start justify-between">
          <div>
            <h4 class="font-semibold text-surface-900">{client.client_name || client.client_id}</h4>
            <p class="text-sm font-mono text-surface-500 mt-1">client_id: {client.client_id}</p>
          </div>
          <button onclick={() => handleDelete(client.client_id)} class="text-sm text-red-500 hover:text-red-700">删除</button>
        </div>
        <div class="mt-3 space-y-1">
          <p class="text-sm text-surface-600">类型: <span class="font-medium">{client.client_type || 'confidential'}</span></p>
          {#if client.redirect_uris?.length}
            <p class="text-sm text-surface-600">回调:</p>
            {#each client.redirect_uris as uri (uri)}
              <code class="text-xs font-mono text-brand-700 bg-surface-50 px-2 py-0.5 rounded ml-4">{uri}</code>
            {/each}
          {/if}
        </div>
      </div>
    {/each}
  </div>
{/if}
