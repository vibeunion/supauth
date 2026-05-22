<script>
  import { listUsers } from '$lib/api/client.js';

  let users = $state([]);
  let loading = $state(true);
  let error = $state(null);

  onMount(async () => {
    try {
      const res = await listUsers();
      users = Array.isArray(res) ? res : (res.users || res.items || res.data || []);
    } catch (e) {
      error = e.message;
    }
    loading = false;
  });
</script>

<h2 class="text-2xl font-bold text-surface-900 mb-6">用户管理</h2>

{#if error}
  <div class="bg-red-50 border border-red-200 rounded-lg p-4 text-red-700 mb-4">{error}</div>
{/if}

{#if loading}
  <p class="text-surface-400">加载中...</p>
{:else if users.length === 0}
  <div class="bg-surface-50 rounded-xl border border-surface-200 p-8 text-center">
    <p class="text-surface-500">暂无用户</p>
  </div>
{:else}
  <div class="bg-white rounded-xl border border-surface-200 overflow-hidden">
    <table class="w-full text-sm">
      <thead class="bg-surface-50 border-b border-surface-200">
        <tr>
          <th class="text-left px-4 py-3 font-medium text-surface-600">ID</th>
          <th class="text-left px-4 py-3 font-medium text-surface-600">邮箱</th>
          <th class="text-left px-4 py-3 font-medium text-surface-600">角色</th>
          <th class="text-left px-4 py-3 font-medium text-surface-600">创建时间</th>
        </tr>
      </thead>
      <tbody>
        {#each users as user}
          <tr class="border-b border-surface-100">
            <td class="px-4 py-3 font-mono text-xs text-surface-500">{user.id?.slice(0,8)}...</td>
            <td class="px-4 py-3 text-surface-900">{user.email || '-'}</td>
            <td class="px-4 py-3 text-surface-600">{user.role || '-'}</td>
            <td class="px-4 py-3 text-surface-500">{user.created_at?.slice(0,10) || '-'}</td>
          </tr>
        {/each}
      </tbody>
    </table>
  </div>
{/if}
