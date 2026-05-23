<script>
  import { onMount } from 'svelte';
  import { listApplications, listOrganizations, listUsers, getCompatibilityReport, getProject } from '$lib/api/client.js';

  let entries = $state([]);
  let loading = $state(true);
  let error = $state(null);
  let filter = $state({ event_type: '', resource_type: '' });

  async function load() {
    loading = true;
    try {
      const res = await fetch(`${import.meta.env.VITE_AUTH_SERVER_URL || '/api'}/v1/audit?event_type=${filter.event_type}&resource_type=${filter.resource_type}&limit=100`);
      if (!res.ok) throw new Error(`API ${res.status}`);
      const data = await res.json();
      entries = data.items || [];
    } catch (e) {
      error = e.message;
    }
    loading = false;
  }

  onMount(load);
</script>

<div class="flex items-center justify-between mb-6">
  <h2 class="text-2xl font-bold text-surface-900">Audit Logs</h2>
  <button onclick={load} class="px-3 py-1.5 text-sm bg-surface-100 text-surface-700 rounded-lg hover:bg-surface-200">Refresh</button>
</div>

{#if error}
  <div class="bg-red-50 border border-red-200 rounded-lg p-4 text-red-700 mb-4">{error}</div>
{/if}

<div class="flex gap-3 mb-4">
  <input bind:value={filter.event_type} class="px-3 py-1.5 border border-surface-300 rounded-lg text-sm" placeholder="Filter: event type">
  <input bind:value={filter.resource_type} class="px-3 py-1.5 border border-surface-300 rounded-lg text-sm" placeholder="Filter: resource type">
  <button onclick={load} class="px-3 py-1.5 bg-brand-600 text-white rounded-lg text-sm font-medium hover:bg-brand-700">Apply</button>
</div>

{#if loading}
  <p class="text-surface-400">Loading...</p>
{:else if entries.length === 0}
  <div class="bg-surface-50 rounded-xl border border-surface-200 p-8 text-center">
    <p class="text-surface-500">No audit log entries</p>
  </div>
{:else}
  <div class="bg-white rounded-xl border border-surface-200 overflow-hidden">
    <table class="w-full text-sm">
      <thead class="bg-surface-50 border-b border-surface-200">
        <tr>
          <th class="text-left px-4 py-3 font-medium text-surface-600">Time</th>
          <th class="text-left px-4 py-3 font-medium text-surface-600">Event</th>
          <th class="text-left px-4 py-3 font-medium text-surface-600">Actor</th>
          <th class="text-left px-4 py-3 font-medium text-surface-600">Resource</th>
          <th class="text-left px-4 py-3 font-medium text-surface-600">ID</th>
        </tr>
      </thead>
      <tbody>
        {#each entries as entry (entry.id)}
          <tr class="border-b border-surface-100">
            <td class="px-4 py-3 text-surface-500 text-xs">{new Date(entry.created_at).toLocaleString()}</td>
            <td class="px-4 py-3"><span class="px-2 py-0.5 bg-brand-50 text-brand-700 rounded text-xs font-medium">{entry.event_type}</span></td>
            <td class="px-4 py-3 text-surface-600 text-xs">{entry.actor_type}</td>
            <td class="px-4 py-3 text-surface-600 text-xs">{entry.resource_type}</td>
            <td class="px-4 py-3 font-mono text-xs text-surface-500">{entry.resource_id?.slice(0,8)}...</td>
          </tr>
        {/each}
      </tbody>
    </table>
  </div>
{/if}
