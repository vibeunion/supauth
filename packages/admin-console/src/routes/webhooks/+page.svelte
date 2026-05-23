<script>
  import { onMount } from 'svelte';
  import { listWebhooks, createWebhook, deleteWebhook, updateWebhook, rotateWebhookSecret, listWebhookEvents } from '$lib/api/client.js';

  let webhooks = $state([]);
  let availableEvents = $state([]);
  let loading = $state(true);
  let error = $state(null);
  let showCreate = $state(false);
  let newWebhook = $state({ url: '', events: '', enabled: true });
  let revealedSecrets = $state({});

  async function load() {
    loading = true;
    try {
      const [whRes, eventsRes] = await Promise.all([
        listWebhooks(),
        listWebhookEvents().catch(() => ({ events: [] })),
      ]);
      webhooks = whRes.items || whRes.data || (Array.isArray(whRes) ? whRes : []);
      availableEvents = eventsRes.events || [];
    } catch (e) {
      error = e.message;
    }
    loading = false;
  }

  async function handleCreate() {
    try {
      const events = newWebhook.events.split(',').map(s => s.trim()).filter(Boolean);
      await createWebhook({ url: newWebhook.url, events, enabled: newWebhook.enabled });
      showCreate = false;
      newWebhook = { url: '', events: '', enabled: true };
      await load();
    } catch (e) {
      error = e.message;
    }
  }

  async function handleDelete(id) {
    if (!confirm('Delete this webhook?')) return;
    try {
      await deleteWebhook(id);
      await load();
    } catch (e) {
      error = e.message;
    }
  }

  async function handleToggle(wh) {
    try {
      await updateWebhook(wh.id, { enabled: !wh.enabled });
      await load();
    } catch (e) {
      error = e.message;
    }
  }

  async function handleRotateSecret(whId) {
    if (!confirm('Rotate webhook secret? The old secret will be invalidated.')) return;
    try {
      const res = await rotateWebhookSecret(whId);
      if (res.secret) {
        revealedSecrets[whId] = res.secret;
      }
    } catch (e) {
      error = e.message;
    }
  }

  onMount(load);
</script>

<div class="flex items-center justify-between mb-6">
  <h2 class="text-2xl font-bold text-surface-900">Webhooks</h2>
  <button onclick={() => showCreate = !showCreate} class="px-4 py-2 bg-brand-600 text-white rounded-lg text-sm font-medium hover:bg-brand-700">
    {showCreate ? 'Cancel' : '+ New Webhook'}
  </button>
</div>

{#if error}
  <div class="bg-red-50 border border-red-200 rounded-lg p-4 text-red-700 mb-4">{error}</div>
{/if}

{#if showCreate}
  <div class="bg-white rounded-xl border border-surface-200 p-6 mb-6">
    <h3 class="text-lg font-semibold text-surface-800 mb-4">New Webhook</h3>
    <div class="space-y-4">
      <div>
        <label class="block text-sm font-medium text-surface-700 mb-1">URL</label>
        <input bind:value={newWebhook.url} class="w-full px-3 py-2 border border-surface-300 rounded-lg text-sm" placeholder="https://example.com/webhook">
      </div>
      <div>
        <label class="block text-sm font-medium text-surface-700 mb-1">Events (comma-separated)</label>
        <input bind:value={newWebhook.events} class="w-full px-3 py-2 border border-surface-300 rounded-lg text-sm" placeholder="user.created, user.signed_in">
        {#if availableEvents.length}
          <p class="text-xs text-surface-400 mt-1">Available: {availableEvents.join(', ')}</p>
        {/if}
      </div>
      <button onclick={handleCreate} class="px-4 py-2 bg-brand-600 text-white rounded-lg text-sm font-medium hover:bg-brand-700">Create</button>
    </div>
  </div>
{/if}

{#if loading}
  <p class="text-surface-400">Loading...</p>
{:else if webhooks.length === 0}
  <div class="bg-surface-50 rounded-xl border border-surface-200 p-8 text-center">
    <p class="text-surface-500">No webhooks configured</p>
    <p class="text-sm text-surface-400 mt-2">Webhooks notify external systems on events like user.created, application.created</p>
  </div>
{:else}
  <div class="space-y-3">
    {#each webhooks as wh (wh.id)}
      <div class="bg-white rounded-xl border border-surface-200 p-5">
        <div class="flex items-start justify-between">
          <div>
            <p class="font-mono text-sm text-surface-900 break-all">{wh.url}</p>
            <div class="flex flex-wrap gap-1 mt-2">
              {#each wh.events as evt (evt)}
                <span class="px-2 py-0.5 bg-brand-50 text-brand-700 rounded text-xs font-medium">{evt}</span>
              {/each}
            </div>
          </div>
          <div class="flex items-center gap-3">
            <span class="text-xs px-2 py-0.5 rounded-full {wh.enabled ? 'bg-green-100 text-green-700' : 'bg-surface-100 text-surface-500'}">
              {wh.enabled ? 'Active' : 'Disabled'}
            </span>
            <button onclick={() => handleToggle(wh)} class="text-xs text-brand-600 hover:text-brand-800">
              {wh.enabled ? 'Disable' : 'Enable'}
            </button>
            <button onclick={() => handleRotateSecret(wh.id)} class="text-xs text-surface-600 hover:text-surface-800">Rotate Secret</button>
            <button onclick={() => handleDelete(wh.id)} class="text-xs text-red-500 hover:text-red-700">Delete</button>
          </div>
        </div>
        {#if revealedSecrets[wh.id]}
          <div class="mt-3 bg-yellow-50 border border-yellow-200 rounded-lg p-3">
            <p class="text-xs text-yellow-700 font-medium mb-1">Secret (shown only once)</p>
            <code class="text-sm font-mono text-yellow-900 break-all">{revealedSecrets[wh.id]}</code>
          </div>
        {/if}
      </div>
    {/each}
  </div>
{/if}
