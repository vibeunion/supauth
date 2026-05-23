<script>
  import { onMount } from 'svelte';
  import { listRoles, createRole, deleteRole, createRolePermission, deleteRolePermission } from '$lib/api/client.js';

  let roles = $state([]);
  let loading = $state(true);
  let error = $state(null);
  let showCreate = $state(false);
  let newRole = $state({ name: '', description: '' });
  let expandedRole = $state(null);
  let newPerm = $state({ name: '', description: '' });

  async function load() {
    loading = true;
    try {
      const res = await listRoles();
      roles = res.items || res.data || (Array.isArray(res) ? res : []);
    } catch (e) {
      error = e.message;
    }
    loading = false;
  }

  async function handleCreate() {
    try {
      await createRole({ name: newRole.name, description: newRole.description });
      showCreate = false;
      newRole = { name: '', description: '' };
      await load();
    } catch (e) {
      error = e.message;
    }
  }

  async function handleDelete(id) {
    if (!confirm('Delete this role? All permissions and assignments will be removed.')) return;
    try {
      await deleteRole(id);
      await load();
    } catch (e) {
      error = e.message;
    }
  }

  async function handleAddPermission(roleId) {
    try {
      await createRolePermission(roleId, { name: newPerm.name, description: newPerm.description });
      newPerm = { name: '', description: '' };
      await load();
    } catch (e) {
      error = e.message;
    }
  }

  async function handleDeletePermission(roleId, permId) {
    try {
      await deleteRolePermission(roleId, permId);
      await load();
    } catch (e) {
      error = e.message;
    }
  }

  onMount(load);
</script>

<div class="flex items-center justify-between mb-6">
  <h2 class="text-2xl font-bold text-surface-900">Roles & Permissions</h2>
  <button onclick={() => showCreate = !showCreate} class="px-4 py-2 bg-brand-600 text-white rounded-lg text-sm font-medium hover:bg-brand-700">
    {showCreate ? 'Cancel' : '+ New Role'}
  </button>
</div>

{#if error}
  <div class="bg-red-50 border border-red-200 rounded-lg p-4 text-red-700 mb-4">{error}</div>
{/if}

{#if showCreate}
  <div class="bg-white rounded-xl border border-surface-200 p-6 mb-6">
    <h3 class="text-lg font-semibold text-surface-800 mb-4">New Role</h3>
    <div class="space-y-4">
      <div>
        <label class="block text-sm font-medium text-surface-700 mb-1">Name</label>
        <input bind:value={newRole.name} class="w-full px-3 py-2 border border-surface-300 rounded-lg text-sm" placeholder="admin">
      </div>
      <div>
        <label class="block text-sm font-medium text-surface-700 mb-1">Description</label>
        <input bind:value={newRole.description} class="w-full px-3 py-2 border border-surface-300 rounded-lg text-sm" placeholder="Full administrator access">
      </div>
      <button onclick={handleCreate} class="px-4 py-2 bg-brand-600 text-white rounded-lg text-sm font-medium hover:bg-brand-700">Create</button>
    </div>
  </div>
{/if}

{#if loading}
  <p class="text-surface-400">Loading...</p>
{:else if roles.length === 0}
  <div class="bg-surface-50 rounded-xl border border-surface-200 p-8 text-center">
    <p class="text-surface-500">No roles defined</p>
    <p class="text-sm text-surface-400 mt-2">Create roles to control access with fine-grained permissions</p>
  </div>
{:else}
  <div class="space-y-3">
    {#each roles as role (role.id)}
      <div class="bg-white rounded-xl border border-surface-200 p-5">
        <div class="flex items-start justify-between">
          <div>
            <h4 class="font-semibold text-surface-900">{role.name}</h4>
            {#if role.description}
              <p class="text-sm text-surface-500 mt-1">{role.description}</p>
            {/if}
          </div>
          <div class="flex gap-2">
            <button onclick={() => expandedRole = expandedRole === role.id ? null : role.id} class="text-sm text-brand-600 hover:text-brand-800">
              {expandedRole === role.id ? 'Collapse' : 'Permissions'}
            </button>
            <button onclick={() => handleDelete(role.id)} class="text-sm text-red-500 hover:text-red-700">Delete</button>
          </div>
        </div>

        {#if expandedRole === role.id}
          <div class="mt-4 border-t border-surface-100 pt-4">
            <h5 class="text-sm font-medium text-surface-700 mb-3">Permissions ({role.permissions?.length || 0})</h5>
            {#if role.permissions?.length}
              <div class="flex flex-wrap gap-2 mb-3">
                {#each role.permissions as perm (perm.id)}
                  <span class="inline-flex items-center gap-1 px-3 py-1 bg-brand-50 text-brand-700 rounded-full text-sm font-medium">
                    {perm.name}
                    <button onclick={() => handleDeletePermission(role.id, perm.id)} class="text-brand-400 hover:text-red-500 ml-1">&times;</button>
                  </span>
                {/each}
              </div>
            {/if}
            <div class="flex gap-2">
              <input bind:value={newPerm.name} class="px-3 py-1.5 border border-surface-300 rounded-lg text-sm" placeholder="permission name">
              <input bind:value={newPerm.description} class="px-3 py-1.5 border border-surface-300 rounded-lg text-sm" placeholder="description (optional)">
              <button onclick={() => handleAddPermission(role.id)} class="px-3 py-1.5 bg-brand-600 text-white rounded-lg text-sm font-medium hover:bg-brand-700">Add</button>
            </div>
          </div>
        {/if}
      </div>
    {/each}
  </div>
{/if}
