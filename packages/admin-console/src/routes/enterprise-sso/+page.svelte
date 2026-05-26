<script>
  import { onMount } from 'svelte';
  import { listEnterpriseSSOConfigs, createEnterpriseSSOConfig } from '$lib/api/client.js';

  let configs = $state([]);
  let loading = $state(true);
  let error = $state(null);
  let showCreate = $state(false);
  let form = $state({
    connector_id: '',
    domains: '',
    sso_protocol: 'oidc',
    jit_provisioning: true,
    org_membership_mapping: '{}',
    role_mapping: '{}',
  });

  async function load() {
    loading = true;
    error = null;
    try {
      const res = await listEnterpriseSSOConfigs();
      configs = res.items || [];
    } catch (e) {
      error = e.message;
    }
    loading = false;
  }

  async function handleCreate() {
    try {
      await createEnterpriseSSOConfig({
        connector_id: form.connector_id,
        domains: form.domains.split(',').map((item) => item.trim()).filter(Boolean),
        sso_protocol: form.sso_protocol,
        jit_provisioning: form.jit_provisioning,
        org_membership_mapping: JSON.parse(form.org_membership_mapping || '{}'),
        role_mapping: JSON.parse(form.role_mapping || '{}'),
      });
      showCreate = false;
      await load();
    } catch (e) {
      error = e.message;
    }
  }

  onMount(load);
</script>

<div class="flex items-center justify-between mb-6">
  <h2 class="text-2xl font-bold text-surface-900">Enterprise SSO</h2>
  <button onclick={() => showCreate = !showCreate} class="px-4 py-2 bg-brand-600 text-white rounded-lg text-sm font-medium hover:bg-brand-700">
    {showCreate ? 'Cancel' : '+ New SSO'}
  </button>
</div>

{#if error}
  <div class="bg-red-50 border border-red-200 rounded-lg p-4 text-red-700 mb-4">{error}</div>
{/if}

{#if showCreate}
  <section class="bg-white rounded-xl border border-surface-200 p-6 mb-6 space-y-4">
    <div>
      <label for="connector-id" class="block text-sm font-medium text-surface-700 mb-1">Connector ID</label>
      <input id="connector-id" bind:value={form.connector_id} class="w-full px-3 py-2 border border-surface-300 rounded-lg text-sm font-mono">
    </div>
    <div>
      <label for="domains" class="block text-sm font-medium text-surface-700 mb-1">Domains</label>
      <input id="domains" bind:value={form.domains} class="w-full px-3 py-2 border border-surface-300 rounded-lg text-sm" placeholder="example.com, company.com">
    </div>
    <div class="grid grid-cols-2 gap-4">
      <div>
        <label for="protocol" class="block text-sm font-medium text-surface-700 mb-1">Protocol</label>
        <select id="protocol" bind:value={form.sso_protocol} class="w-full px-3 py-2 border border-surface-300 rounded-lg text-sm">
          <option value="oidc">OIDC</option>
          <option value="saml">SAML</option>
        </select>
      </div>
      <label class="flex items-center gap-2 text-sm text-surface-700 mt-7">
        <input type="checkbox" bind:checked={form.jit_provisioning}>
        JIT provisioning
      </label>
    </div>
    <div>
      <label for="org-map" class="block text-sm font-medium text-surface-700 mb-1">Org Mapping JSON</label>
      <textarea id="org-map" bind:value={form.org_membership_mapping} class="w-full h-20 px-3 py-2 border border-surface-300 rounded-lg text-sm font-mono"></textarea>
    </div>
    <div>
      <label for="role-map" class="block text-sm font-medium text-surface-700 mb-1">Role Mapping JSON</label>
      <textarea id="role-map" bind:value={form.role_mapping} class="w-full h-20 px-3 py-2 border border-surface-300 rounded-lg text-sm font-mono"></textarea>
    </div>
    <button onclick={handleCreate} class="px-4 py-2 bg-brand-600 text-white rounded-lg text-sm font-medium hover:bg-brand-700">Create</button>
  </section>
{/if}

{#if loading}
  <p class="text-surface-400">Loading...</p>
{:else if configs.length === 0}
  <div class="bg-surface-50 rounded-xl border border-surface-200 p-8 text-center">
    <p class="text-surface-500">No enterprise SSO configuration</p>
  </div>
{:else}
  <div class="space-y-3">
    {#each configs as config (config.id)}
      <div class="bg-white rounded-xl border border-surface-200 p-5">
        <p class="font-mono text-sm text-surface-900">{config.connectorId || config.connector_id}</p>
        <p class="text-sm text-surface-500 mt-2">{(config.domains || []).join(', ')}</p>
        <p class="text-xs text-surface-400 mt-1">Protocol: {config.ssoProtocol || config.sso_protocol} · JIT: {(config.jitProvisioning ?? config.jit_provisioning) ? 'enabled' : 'disabled'}</p>
      </div>
    {/each}
  </div>
{/if}
