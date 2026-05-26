<script>
  import { onMount } from 'svelte';
  import { listUsers, suspendUser, listUserSessions, revokeUserSession, resetUserMfa, unlinkUserIdentity } from '$lib/api/client.js';

  let users = $state([]);
  let loading = $state(true);
  let error = $state(null);
  let selectedUser = $state(null);
  let sessions = $state([]);
  let factorId = $state('');
  let identityId = $state('');

  onMount(async () => {
    try {
      const res = await listUsers();
      users = Array.isArray(res) ? res : (res.users || res.items || res.data || []);
    } catch (e) {
      error = e.message;
    }
    loading = false;
  });

  async function openAccountCenter(user) {
    selectedUser = user;
    const res = await listUserSessions(user.id).catch(() => ({ items: [] }));
    sessions = res.items || [];
  }

  async function handleSuspend(userId) {
    if (!confirm('Suspend this user?')) return;
    try {
      await suspendUser(userId, { reason: 'admin_console' });
    } catch (e) {
      error = e.message;
    }
  }

  async function handleRevokeSession(sessionId) {
    try {
      await revokeUserSession(selectedUser.id, sessionId);
      await openAccountCenter(selectedUser);
    } catch (e) {
      error = e.message;
    }
  }

  async function handleResetMfa() {
    try {
      await resetUserMfa(selectedUser.id, factorId);
      factorId = '';
    } catch (e) {
      error = e.message;
    }
  }

  async function handleUnlinkIdentity() {
    try {
      await unlinkUserIdentity(selectedUser.id, identityId);
      identityId = '';
    } catch (e) {
      error = e.message;
    }
  }
</script>

<h2 class="text-2xl font-bold text-surface-900 mb-6">Users</h2>

{#if error}
  <div class="bg-red-50 border border-red-200 rounded-lg p-4 text-red-700 mb-4">{error}</div>
{/if}

{#if loading}
  <p class="text-surface-400">Loading...</p>
{:else if users.length === 0}
  <div class="bg-surface-50 rounded-xl border border-surface-200 p-8 text-center">
    <p class="text-surface-500">No users found</p>
  </div>
{:else}
  <div class="bg-white rounded-xl border border-surface-200 overflow-hidden">
    <table class="w-full text-sm">
      <thead class="bg-surface-50 border-b border-surface-200">
        <tr>
          <th class="text-left px-4 py-3 font-medium text-surface-600">ID</th>
          <th class="text-left px-4 py-3 font-medium text-surface-600">Email</th>
          <th class="text-left px-4 py-3 font-medium text-surface-600">Role</th>
          <th class="text-left px-4 py-3 font-medium text-surface-600">Created</th>
          <th class="text-right px-4 py-3 font-medium text-surface-600">Actions</th>
        </tr>
      </thead>
      <tbody>
        {#each users as user (user.id)}
          <tr class="border-b border-surface-100">
            <td class="px-4 py-3 font-mono text-xs text-surface-500">{user.id?.slice(0,8)}...</td>
            <td class="px-4 py-3 text-surface-900">{user.email || '-'}</td>
            <td class="px-4 py-3 text-surface-600">{user.role || '-'}</td>
            <td class="px-4 py-3 text-surface-500">{user.created_at?.slice(0,10) || '-'}</td>
            <td class="px-4 py-3 text-right">
              <button onclick={() => openAccountCenter(user)} class="text-xs text-brand-600 hover:text-brand-800 mr-3">Account Center</button>
              <button onclick={() => handleSuspend(user.id)} class="text-xs text-red-600 hover:text-red-800">Suspend</button>
            </td>
          </tr>
        {/each}
      </tbody>
    </table>
  </div>
{/if}

{#if selectedUser}
  <div class="bg-white rounded-xl border border-surface-200 p-6 mt-6">
    <h3 class="text-lg font-semibold text-surface-800 mb-4">Account Center · {selectedUser.email || selectedUser.id}</h3>
    <div class="grid grid-cols-1 lg:grid-cols-3 gap-5">
      <div>
        <h4 class="text-sm font-semibold text-surface-700 mb-2">Sessions</h4>
        {#each sessions as session (session.id)}
          <div class="flex items-center justify-between text-xs border-b border-surface-100 py-2">
            <span>{session.sessionId || session.session_id}</span>
            <button onclick={() => handleRevokeSession(session.sessionId || session.session_id)} class="text-red-600">Revoke</button>
          </div>
        {/each}
        {#if sessions.length === 0}
          <p class="text-xs text-surface-400">No locally tracked sessions.</p>
        {/if}
      </div>
      <div>
        <h4 class="text-sm font-semibold text-surface-700 mb-2">MFA Reset</h4>
        <input bind:value={factorId} class="w-full px-2 py-1 border border-surface-300 rounded text-sm mb-2" placeholder="factor_id">
        <button onclick={handleResetMfa} class="px-2 py-1 bg-brand-600 text-white rounded text-xs">Reset Factor</button>
      </div>
      <div>
        <h4 class="text-sm font-semibold text-surface-700 mb-2">Linked Identity</h4>
        <input bind:value={identityId} class="w-full px-2 py-1 border border-surface-300 rounded text-sm mb-2" placeholder="identity_id">
        <button onclick={handleUnlinkIdentity} class="px-2 py-1 bg-brand-600 text-white rounded text-xs">Unlink Identity</button>
      </div>
    </div>
  </div>
{/if}
