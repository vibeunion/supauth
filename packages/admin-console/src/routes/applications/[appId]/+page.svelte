<script>
  import { onMount } from 'svelte';
  import { page } from '$app/state';
  import { getApplication, updateApplication, deleteApplication, rotateApplicationSecret, listApplicationBindings, createApplicationBinding, deleteApplicationBinding, listResources } from '$lib/api/client.js';
  import { goto } from '$app/navigation';
  import { resolve } from '$app/paths';

  let appId = $derived(page.params.appId);
  let app = $state(null);
  let bindings = $state([]);
  let resources = $state([]);
  let loading = $state(true);
  let error = $state(null);
  let editing = $state(false);
  let editForm = $state({ name: '', redirect_uris: '', grant_types: '' });
  let revealedSecret = $state(null);
  let showBinding = $state(false);
  let newBinding = $state({ resource_id: '', scope_id: '' });

  async function load() {
    loading = true;
    try {
      const [appData, bindingData, resData] = await Promise.all([
        getApplication(appId).catch(() => null),
        listApplicationBindings(appId).catch(() => ({ items: [] })),
        listResources().catch(() => ({ items: [] })),
      ]);
      app = appData;
      bindings = bindingData.items || [];
      resources = resData.items || [];
      if (app) {
        editForm = {
          name: app.client_name || '',
          redirect_uris: (app.redirect_uris || []).join(', '),
          grant_types: (app.grant_types || []).join(', '),
        };
      }
    } catch (e) {
      error = e.message;
    }
    loading = false;
  }

  async function handleUpdate() {
    try {
      await updateApplication(appId, {
        client_name: editForm.name,
        redirect_uris: editForm.redirect_uris.split(',').map(s => s.trim()).filter(Boolean),
        grant_types: editForm.grant_types.split(',').map(s => s.trim()).filter(Boolean),
      });
      editing = false;
      await load();
    } catch (e) {
      error = e.message;
    }
  }

  async function handleDelete() {
    if (!confirm('Delete this application permanently?')) return;
    try {
      await deleteApplication(appId);
      goto(resolve('/applications'));
    } catch (e) {
      error = e.message;
    }
  }

  async function handleRotate() {
    if (!confirm('Rotate client secret? The old secret will be invalidated immediately.')) return;
    try {
      const res = await rotateApplicationSecret(appId);
      if (res.client_secret) revealedSecret = res.client_secret;
    } catch (e) {
      error = e.message;
    }
  }

  async function handleAddBinding() {
    try {
      await createApplicationBinding(appId, {
        resource_id: newBinding.resource_id,
        scope_id: newBinding.scope_id || undefined,
      });
      showBinding = false;
      newBinding = { resource_id: '', scope_id: '' };
      await load();
    } catch (e) {
      error = e.message;
    }
  }

  async function handleDeleteBinding(bindingId) {
    try {
      await deleteApplicationBinding(appId, bindingId);
      await load();
    } catch (e) {
      error = e.message;
    }
  }

  onMount(load);
</script>

<div class="mb-4">
  <a href={resolve('/applications')} class="text-sm text-brand-600 hover:text-brand-800">&larr; Back to Applications</a>
</div>

{#if error}
  <div class="bg-red-50 border border-red-200 rounded-lg p-4 text-red-700 mb-4">{error}</div>
{/if}

{#if loading}
  <p class="text-surface-400">Loading...</p>
{:else if !app}
  <div class="bg-surface-50 rounded-xl border border-surface-200 p-8 text-center">
    <p class="text-surface-500">Application not found</p>
  </div>
{:else}
  <div class="flex items-start justify-between mb-6">
    <div>
      <h2 class="text-2xl font-bold text-surface-900">{app.client_name || app.client_id}</h2>
      <p class="text-sm font-mono text-surface-500 mt-1">client_id: {app.client_id}</p>
    </div>
    <div class="flex gap-2">
      <button onclick={() => editing = !editing} class="px-3 py-1.5 text-sm bg-surface-100 text-surface-700 rounded-lg hover:bg-surface-200">
        {editing ? 'Cancel' : 'Edit'}
      </button>
      <button onclick={handleRotate} class="px-3 py-1.5 text-sm bg-brand-50 text-brand-700 rounded-lg hover:bg-brand-100">Rotate Secret</button>
      <button onclick={handleDelete} class="px-3 py-1.5 text-sm bg-red-50 text-red-700 rounded-lg hover:bg-red-100">Delete</button>
    </div>
  </div>

  {#if revealedSecret}
    <div class="bg-yellow-50 border border-yellow-200 rounded-lg p-4 mb-6">
      <p class="text-xs text-yellow-700 font-medium mb-1">New Client Secret (shown only once)</p>
      <code class="text-sm font-mono text-yellow-900 break-all">{revealedSecret}</code>
      <button onclick={() => revealedSecret = null} class="ml-2 text-xs text-yellow-600">Dismiss</button>
    </div>
  {/if}

  {#if editing}
    <div class="bg-white rounded-xl border border-surface-200 p-6 mb-6">
      <h3 class="text-lg font-semibold text-surface-800 mb-4">Edit Application</h3>
      <div class="space-y-4">
        <div>
          <label for="application-name" class="block text-sm font-medium text-surface-700 mb-1">Name</label>
          <input id="application-name" bind:value={editForm.name} class="w-full px-3 py-2 border border-surface-300 rounded-lg text-sm">
        </div>
        <div>
          <label for="application-redirect-uris" class="block text-sm font-medium text-surface-700 mb-1">Redirect URIs (comma-separated)</label>
          <input id="application-redirect-uris" bind:value={editForm.redirect_uris} class="w-full px-3 py-2 border border-surface-300 rounded-lg text-sm">
        </div>
        <div>
          <label for="application-grant-types" class="block text-sm font-medium text-surface-700 mb-1">Grant Types (comma-separated)</label>
          <input id="application-grant-types" bind:value={editForm.grant_types} class="w-full px-3 py-2 border border-surface-300 rounded-lg text-sm">
        </div>
        <button onclick={handleUpdate} class="px-4 py-2 bg-brand-600 text-white rounded-lg text-sm font-medium hover:bg-brand-700">Save</button>
      </div>
    </div>
  {:else}
    <div class="bg-white rounded-xl border border-surface-200 p-6 mb-6">
      <h3 class="text-lg font-semibold text-surface-800 mb-4">Details</h3>
      <div class="grid grid-cols-2 gap-4">
        <div>
          <p class="text-sm text-surface-500">Type</p>
          <p class="font-medium text-surface-900">{app.client_type || 'confidential'}</p>
        </div>
        <div>
          <p class="text-sm text-surface-500">Auth Method</p>
          <p class="font-medium text-surface-900">{app.token_endpoint_auth_method || 'client_secret_basic'}</p>
        </div>
      </div>
      {#if app.redirect_uris?.length}
        <div class="mt-4">
          <p class="text-sm text-surface-500 mb-2">Redirect URIs</p>
          {#each app.redirect_uris as uri (uri)}
            <code class="text-xs font-mono text-brand-700 bg-surface-50 px-2 py-0.5 rounded block mb-1">{uri}</code>
          {/each}
        </div>
      {/if}
    </div>
  {/if}

  <!-- Resource/Scope bindings -->
  <div class="bg-white rounded-xl border border-surface-200 p-6">
    <div class="flex items-center justify-between mb-4">
      <h3 class="text-lg font-semibold text-surface-800">Resource Bindings</h3>
      <button onclick={() => showBinding = !showBinding} class="px-3 py-1.5 text-sm bg-brand-600 text-white rounded-lg hover:bg-brand-700">
        {showBinding ? 'Cancel' : '+ Bind Resource'}
      </button>
    </div>

    {#if showBinding}
      <div class="border border-surface-200 rounded-lg p-4 mb-4">
        <div class="flex gap-3">
          <select bind:value={newBinding.resource_id} class="px-3 py-2 border border-surface-300 rounded-lg text-sm flex-1">
            <option value="">Select resource...</option>
            {#each resources as res (res.id)}
              <option value={res.id}>{res.name} ({res.indicator})</option>
            {/each}
          </select>
          <button onclick={handleAddBinding} class="px-4 py-2 bg-brand-600 text-white rounded-lg text-sm font-medium hover:bg-brand-700">Bind</button>
        </div>
      </div>
    {/if}

    {#if bindings.length === 0}
      <p class="text-sm text-surface-400">No resource bindings. Bind API resources to grant this application access to specific scopes.</p>
    {:else}
      <div class="space-y-2">
        {#each bindings as b (b.id)}
          <div class="flex items-center justify-between py-2 border-b border-surface-100">
            <div>
              <span class="text-sm font-medium text-surface-900">{b.resourceId}</span>
              {#if b.scopeId}
                <span class="ml-2 px-2 py-0.5 bg-brand-50 text-brand-700 rounded text-xs">{b.scopeId}</span>
              {/if}
            </div>
            <button onclick={() => handleDeleteBinding(b.id)} class="text-xs text-red-500 hover:text-red-700">Unbind</button>
          </div>
        {/each}
      </div>
    {/if}
  </div>
{/if}
