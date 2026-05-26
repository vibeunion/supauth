<script>
  import { revokeConsent, listApplicationConsents } from '$lib/api/client.js';

  let applicationId = $state('');
  let consents = $state([]);
  let loading = $state(false);
  let error = $state(null);

  async function load() {
    if (!applicationId) return;
    loading = true;
    error = null;
    try {
      const res = await listApplicationConsents(applicationId);
      consents = res.items || [];
    } catch (e) {
      error = e.message;
    }
    loading = false;
  }

  async function handleRevoke(id) {
    if (!confirm('Revoke this consent?')) return;
    await revokeConsent(id);
    await load();
  }
</script>

<div class="flex items-center justify-between mb-6">
  <h2 class="text-2xl font-bold text-surface-900">Consents</h2>
  <button onclick={load} disabled={!applicationId || loading} class="px-4 py-2 bg-brand-600 text-white rounded-lg text-sm font-medium hover:bg-brand-700 disabled:opacity-50">
    {loading ? 'Loading...' : 'Load'}
  </button>
</div>

{#if error}
  <div class="bg-red-50 border border-red-200 rounded-lg p-4 text-red-700 mb-4">{error}</div>
{/if}

<section class="bg-white rounded-xl border border-surface-200 p-6 mb-6">
  <label for="application-id" class="block text-sm font-medium text-surface-700 mb-1">Application client_id</label>
  <input id="application-id" bind:value={applicationId} class="w-full px-3 py-2 border border-surface-300 rounded-lg text-sm font-mono" placeholder="GoTrue OAuth client_id">
</section>

{#if consents.length === 0}
  <div class="bg-surface-50 rounded-xl border border-surface-200 p-8 text-center">
    <p class="text-surface-500">No consent records loaded</p>
  </div>
{:else}
  <div class="space-y-3">
    {#each consents as consent (consent.id)}
      <div class="bg-white rounded-xl border border-surface-200 p-5 flex items-center justify-between gap-4">
        <div class="min-w-0">
          <p class="font-mono text-sm text-surface-900 truncate">{consent.userId || consent.user_id}</p>
          <p class="text-xs text-surface-500 mt-1">
            scope: {consent.scopeId || consent.scope_id || 'all'} · org: {consent.organizationId || consent.organization_id || 'none'}
          </p>
          <p class="text-xs text-surface-400 mt-1">granted: {new Date(consent.grantedAt || consent.granted_at).toLocaleString()}</p>
        </div>
        <button onclick={() => handleRevoke(consent.id)} class="text-sm text-red-500 hover:text-red-700">Revoke</button>
      </div>
    {/each}
  </div>
{/if}
