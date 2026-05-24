<script>
  import { onMount } from 'svelte';
  import { resolve } from '$app/paths';
  import { listApplications, createApplication, deleteApplication, rotateApplicationSecret } from '$lib/api/client.js';

  let applications = $state([]);
  let loading = $state(true);
  let error = $state(null);
  let showCreate = $state(false);
  let newApp = $state({ name: '', redirect_uris: '', type: 'web' });
  let revealedSecrets = $state({});

  async function load() {
    loading = true;
    try {
      const res = await listApplications();
      applications = Array.isArray(res) ? res : (res.items || res.data || []);
    } catch (e) {
      error = e.message;
    }
    loading = false;
  }

  async function handleCreate() {
    try {
      const created = await createApplication({
        client_name: newApp.name,
        redirect_uris: newApp.redirect_uris.split(',').map(s => s.trim()).filter(Boolean),
        client_type: newApp.type === 'spa' ? 'public' : 'confidential',
        grant_types: newApp.type === 'm2m'
          ? ['client_credentials']
          : ['authorization_code', 'refresh_token'],
        token_endpoint_auth_method: newApp.type === 'spa' ? 'none' : 'client_secret_basic',
      });
      // Show secret once on creation
      if (created.client_secret) {
        revealedSecrets[created.client_id] = created.client_secret;
      }
      showCreate = false;
      newApp = { name: '', redirect_uris: '', type: 'web' };
      await load();
    } catch (e) {
      error = e.message;
    }
  }

  async function handleRotateSecret(appId) {
    if (!confirm('确认轮换此应用的密钥？旧密钥将立即失效。')) return;
    try {
      const res = await rotateApplicationSecret(appId);
      if (res.client_secret) {
        revealedSecrets[appId] = res.client_secret;
      }
    } catch (e) {
      error = e.message;
    }
  }

  async function handleDelete(id) {
    if (!confirm('确认删除此应用？')) return;
    try {
      await deleteApplication(id);
      await load();
    } catch (e) {
      error = e.message;
    }
  }

  onMount(load);
</script>

<div class="flex items-center justify-between mb-6">
  <h2 class="text-2xl font-bold text-surface-900">Applications</h2>
  <button onclick={() => showCreate = !showCreate} class="px-4 py-2 bg-brand-600 text-white rounded-lg text-sm font-medium hover:bg-brand-700">
    {showCreate ? 'Cancel' : '+ New Application'}
  </button>
</div>

{#if error}
  <div class="bg-red-50 border border-red-200 rounded-lg p-4 text-red-700 mb-4">{error}</div>
{/if}

{#if showCreate}
  <div class="bg-white rounded-xl border border-surface-200 p-6 mb-6">
    <h3 class="text-lg font-semibold text-surface-800 mb-4">New Application</h3>
    <div class="space-y-4">
      <div>
        <label for="app-name" class="block text-sm font-medium text-surface-700 mb-1">Name</label>
        <input id="app-name" bind:value={newApp.name} class="w-full px-3 py-2 border border-surface-300 rounded-lg text-sm" placeholder="My App">
      </div>
      <div>
        <label for="app-type" class="block text-sm font-medium text-surface-700 mb-1">Type</label>
        <select id="app-type" bind:value={newApp.type} class="px-3 py-2 border border-surface-300 rounded-lg text-sm">
          <option value="web">Web (Confidential)</option>
          <option value="spa">SPA / Native (Public)</option>
          <option value="m2m">Machine-to-Machine</option>
        </select>
      </div>
      {#if newApp.type !== 'm2m'}
        <div>
          <label for="app-redirects" class="block text-sm font-medium text-surface-700 mb-1">Redirect URIs (comma-separated)</label>
          <input id="app-redirects" bind:value={newApp.redirect_uris} class="w-full px-3 py-2 border border-surface-300 rounded-lg text-sm" placeholder="http://localhost:3000/auth/callback">
        </div>
      {/if}
      <button onclick={handleCreate} class="px-4 py-2 bg-brand-600 text-white rounded-lg text-sm font-medium hover:bg-brand-700">Create</button>
    </div>
  </div>
{/if}

{#if loading}
  <p class="text-surface-400">Loading...</p>
{:else if applications.length === 0}
  <div class="bg-surface-50 rounded-xl border border-surface-200 p-8 text-center">
    <p class="text-surface-500">No applications yet</p>
    <p class="text-sm text-surface-400 mt-2">Click "New Application" to register your first app</p>
  </div>
{:else}
  <div class="space-y-3">
    {#each applications as app (app.client_id)}
      <div class="bg-white rounded-xl border border-surface-200 p-5">
        <div class="flex items-start justify-between">
          <div>
            <a href={resolve(`/applications/${app.client_id}`)} class="font-semibold text-surface-900 hover:text-brand-600 transition-colors">{app.client_name || app.client_id}</a>
            <p class="text-sm font-mono text-surface-500 mt-1">client_id: {app.client_id}</p>
          </div>
          <div class="flex gap-2">
            <a href={resolve(`/applications/${app.client_id}`)} class="text-sm text-brand-600 hover:text-brand-800">View</a>
            <button onclick={() => handleRotateSecret(app.client_id)} class="text-sm text-brand-600 hover:text-brand-800">Rotate Secret</button>
            <button onclick={() => handleDelete(app.client_id)} class="text-sm text-red-500 hover:text-red-700">Delete</button>
          </div>
        </div>
        {#if revealedSecrets[app.client_id]}
          <div class="mt-3 bg-yellow-50 border border-yellow-200 rounded-lg p-3">
            <p class="text-xs text-yellow-700 font-medium mb-1">Client Secret (shown only once)</p>
            <code class="text-sm font-mono text-yellow-900 break-all">{revealedSecrets[app.client_id]}</code>
          </div>
        {/if}
        <div class="mt-3 space-y-1">
          <p class="text-sm text-surface-600">Type: <span class="font-medium">{app.client_type || 'confidential'}</span></p>
          {#if app.redirect_uris?.length}
            <p class="text-sm text-surface-600">Redirect URIs:</p>
            {#each app.redirect_uris as uri (uri)}
              <code class="text-xs font-mono text-brand-700 bg-surface-50 px-2 py-0.5 rounded ml-4">{uri}</code>
            {/each}
          {/if}
        </div>
      </div>
    {/each}
  </div>
{/if}
