<script>
  import { onMount } from 'svelte';
  import { listOrganizations, createOrganization, deleteOrganization } from '$lib/api/client.js';

  let organizations = $state([]);
  let loading = $state(true);
  let error = $state(null);
  let showCreate = $state(false);
  let newOrg = $state({ name: '', description: '' });

  async function load() {
    loading = true;
    try {
      const res = await listOrganizations();
      organizations = res.items || res.data || (Array.isArray(res) ? res : []);
    } catch (e) {
      error = e.message;
    }
    loading = false;
  }

  async function handleCreate() {
    try {
      await createOrganization({ name: newOrg.name, description: newOrg.description });
      showCreate = false;
      newOrg = { name: '', description: '' };
      await load();
    } catch (e) {
      error = e.message;
    }
  }

  async function handleDelete(id) {
    if (!confirm('Delete this organization?')) return;
    try {
      await deleteOrganization(id);
      await load();
    } catch (e) {
      error = e.message;
    }
  }

  onMount(load);
</script>

<div class="flex items-center justify-between mb-6">
  <h2 class="text-2xl font-bold text-surface-900">Organizations</h2>
  <button onclick={() => showCreate = !showCreate} class="px-4 py-2 bg-brand-600 text-white rounded-lg text-sm font-medium hover:bg-brand-700">
    {showCreate ? 'Cancel' : '+ New Organization'}
  </button>
</div>

{#if error}
  <div class="bg-red-50 border border-red-200 rounded-lg p-4 text-red-700 mb-4">{error}</div>
{/if}

{#if showCreate}
  <div class="bg-white rounded-xl border border-surface-200 p-6 mb-6">
    <h3 class="text-lg font-semibold text-surface-800 mb-4">New Organization</h3>
    <div class="space-y-4">
      <div>
        <label for="org-name" class="block text-sm font-medium text-surface-700 mb-1">Name</label>
        <input id="org-name" bind:value={newOrg.name} class="w-full px-3 py-2 border border-surface-300 rounded-lg text-sm" placeholder="Acme Corp">
      </div>
      <div>
        <label for="org-desc" class="block text-sm font-medium text-surface-700 mb-1">Description</label>
        <input id="org-desc" bind:value={newOrg.description} class="w-full px-3 py-2 border border-surface-300 rounded-lg text-sm" placeholder="Optional description">
      </div>
      <button onclick={handleCreate} class="px-4 py-2 bg-brand-600 text-white rounded-lg text-sm font-medium hover:bg-brand-700">Create</button>
    </div>
  </div>
{/if}

{#if loading}
  <p class="text-surface-400">Loading...</p>
{:else if organizations.length === 0}
  <div class="bg-surface-50 rounded-xl border border-surface-200 p-8 text-center">
    <p class="text-surface-500">No organizations yet</p>
    <p class="text-sm text-surface-400 mt-2">Organizations enable multi-tenant isolation and org-level policies</p>
  </div>
{:else}
  <div class="space-y-3">
    {#each organizations as org (org.id)}
      <div class="bg-white rounded-xl border border-surface-200 p-5">
        <div class="flex items-start justify-between">
          <div>
            <h4 class="font-semibold text-surface-900">{org.name}</h4>
            {#if org.description}
              <p class="text-sm text-surface-500 mt-1">{org.description}</p>
            {/if}
          </div>
          <button onclick={() => handleDelete(org.id)} class="text-sm text-red-500 hover:text-red-700">Delete</button>
        </div>
      </div>
    {/each}
  </div>
{/if}
