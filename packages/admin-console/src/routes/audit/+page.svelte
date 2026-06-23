<script>
  import { onMount } from 'svelte';
  import { t } from '$lib/i18n.js';
  import { getAuditLog, listAuditLogs } from '$lib/api/client.js';

  let entries = $state([]);
  let loading = $state(true);
  let error = $state(null);
  let filter = $state({ event_type: '', resource_type: '', resource_id: '', actor_id: '', from: '', to: '' });
  let selectedEntry = $state(null);
  let detailLoading = $state(false);

  function shortId(value) {
    if (!value) return '-';
    const text = String(value);
    return text.length > 12 ? `${text.slice(0, 8)}...` : text;
  }

  function entryId(entry) {
    return entry?.id || entry?.log_id || entry?.logId || '';
  }

  function entryTime(entry) {
    const value = entry.created_at || entry.createdAt || entry.timestamp;
    return value ? new Date(value).toLocaleString() : '-';
  }

  function prettyJson(value) {
    if (value === undefined || value === null || value === '') return '{}';
    if (typeof value === 'string') {
      try {
        return JSON.stringify(JSON.parse(value), null, 2);
      } catch {
        return value;
      }
    }
    return JSON.stringify(value, null, 2);
  }

  async function openDetail(entry) {
    selectedEntry = entry;
    const id = entryId(entry);
    if (!id) return;
    detailLoading = true;
    try {
      selectedEntry = await getAuditLog(id);
    } catch (e) {
      error = e.message;
    }
    detailLoading = false;
  }

  async function load() {
    loading = true;
    error = null;
    try {
      const data = await listAuditLogs({ ...filter, limit: 100 });
      entries = data.items || [];
    } catch (e) {
      error = e.message;
    }
    loading = false;
  }

  async function resetFilters() {
    filter = { event_type: '', resource_type: '', resource_id: '', actor_id: '', from: '', to: '' };
    await load();
  }

  onMount(() => {
    const params = new URLSearchParams(window.location.search);
    filter = {
      event_type: params.get('event_type') || '',
      resource_type: params.get('resource_type') || '',
      resource_id: params.get('resource_id') || '',
      actor_id: params.get('actor_id') || '',
      from: params.get('from') || '',
      to: params.get('to') || '',
    };
    load();
  });
</script>

<div class="flex items-center justify-between mb-6">
  <h2 class="text-2xl font-bold text-surface-900">{t('Audit Logs')}</h2>
  <button onclick={load} class="px-3 py-1.5 text-sm bg-surface-100 text-surface-700 rounded-lg hover:bg-surface-200">{t('Refresh')}</button>
</div>

{#if error}
  <div class="bg-red-50 border border-red-200 rounded-lg p-4 text-red-700 mb-4">{error}</div>
{/if}

<div class="grid gap-3 mb-4 sm:grid-cols-2 xl:grid-cols-6">
  <input bind:value={filter.event_type} class="px-3 py-1.5 border border-surface-300 rounded-lg text-sm" placeholder={t('Filter: event type')}>
  <input bind:value={filter.resource_type} class="px-3 py-1.5 border border-surface-300 rounded-lg text-sm" placeholder={t('Filter: resource type')}>
  <input bind:value={filter.resource_id} class="px-3 py-1.5 border border-surface-300 rounded-lg text-sm" placeholder={t('Filter: resource ID')}>
  <input bind:value={filter.actor_id} class="px-3 py-1.5 border border-surface-300 rounded-lg text-sm" placeholder={t('Filter: actor ID')}>
  <input bind:value={filter.from} type="datetime-local" class="px-3 py-1.5 border border-surface-300 rounded-lg text-sm" aria-label={t('From time')}>
  <input bind:value={filter.to} type="datetime-local" class="px-3 py-1.5 border border-surface-300 rounded-lg text-sm" aria-label={t('To time')}>
</div>
<div class="flex gap-2 mb-4">
  <button onclick={load} class="px-3 py-1.5 bg-brand-600 text-white rounded-lg text-sm font-medium hover:bg-brand-700">{t('Apply')}</button>
  <button onclick={resetFilters} class="px-3 py-1.5 bg-surface-100 text-surface-700 rounded-lg text-sm font-medium hover:bg-surface-200">{t('Clear filters')}</button>
</div>

{#if loading}
  <p class="text-surface-400">{t('Loading...')}</p>
{:else if entries.length === 0}
  <div class="bg-surface-50 rounded-xl border border-surface-200 p-8 text-center">
    <p class="text-surface-500">{t('No audit log entries')}</p>
  </div>
{:else}
  <div class="bg-white rounded-xl border border-surface-200 overflow-hidden">
    <table class="w-full text-sm">
      <thead class="bg-surface-50 border-b border-surface-200">
        <tr>
          <th class="text-left px-4 py-3 font-medium text-surface-600">{t('Time')}</th>
          <th class="text-left px-4 py-3 font-medium text-surface-600">{t('Event')}</th>
          <th class="text-left px-4 py-3 font-medium text-surface-600">{t('Actor')}</th>
          <th class="text-left px-4 py-3 font-medium text-surface-600">{t('Resource')}</th>
          <th class="text-left px-4 py-3 font-medium text-surface-600">{t('ID')}</th>
          <th class="text-right px-4 py-3 font-medium text-surface-600">{t('audit.action')}</th>
        </tr>
      </thead>
      <tbody>
        {#each entries as entry (entryId(entry))}
          <tr class="border-b border-surface-100">
            <td class="px-4 py-3 text-surface-500 text-xs">{entryTime(entry)}</td>
            <td class="px-4 py-3"><span class="px-2 py-0.5 bg-brand-50 text-brand-700 rounded text-xs font-medium">{entry.event_type || entry.eventType || '-'}</span></td>
            <td class="px-4 py-3 text-surface-600 text-xs">{entry.actor_type || entry.actorType || '-'}</td>
            <td class="px-4 py-3 text-surface-600 text-xs">{entry.resource_type || entry.resourceType || '-'}</td>
            <td class="px-4 py-3 font-mono text-xs text-surface-500">{shortId(entry.resource_id || entry.resourceId)}</td>
            <td class="px-4 py-3 text-right">
              <button onclick={() => openDetail(entry)} class="rounded-lg border border-surface-300 px-2.5 py-1 text-xs font-semibold text-surface-600 hover:bg-surface-50">{t('View')}</button>
            </td>
          </tr>
        {/each}
      </tbody>
    </table>
  </div>
{/if}

{#if selectedEntry}
  <div class="fixed inset-0 z-50 bg-surface-950/30 p-4" role="presentation">
    <div class="ml-auto flex h-full max-w-2xl flex-col overflow-hidden rounded-2xl bg-white shadow-xl" role="dialog" aria-modal="true" aria-label={t('audit.detailTitle')} tabindex="-1">
      <div class="flex items-start justify-between gap-4 border-b border-surface-200 p-5">
        <div>
          <h3 class="text-lg font-semibold text-surface-950">{t('audit.detailTitle')}</h3>
          <p class="mt-1 text-xs text-surface-500">{entryTime(selectedEntry)}</p>
        </div>
        <button onclick={() => selectedEntry = null} class="rounded-lg border border-surface-300 px-3 py-1.5 text-sm font-semibold text-surface-600 hover:bg-surface-50">{t('Close')}</button>
      </div>
      <div class="flex-1 space-y-4 overflow-auto p-5">
        {#if detailLoading}
          <p class="text-sm text-surface-400">{t('Loading...')}</p>
        {/if}
        <div class="grid gap-3 sm:grid-cols-2">
          <div class="rounded-xl bg-surface-50 p-3">
            <p class="text-xs font-medium text-surface-400">{t('Event')}</p>
            <p class="mt-1 text-sm font-semibold text-surface-900">{selectedEntry.event_type || selectedEntry.eventType || '-'}</p>
          </div>
          <div class="rounded-xl bg-surface-50 p-3">
            <p class="text-xs font-medium text-surface-400">{t('Actor')}</p>
            <p class="mt-1 text-sm font-semibold text-surface-900">{selectedEntry.actor_id || selectedEntry.actorId || selectedEntry.actor_type || selectedEntry.actorType || '-'}</p>
          </div>
          <div class="rounded-xl bg-surface-50 p-3">
            <p class="text-xs font-medium text-surface-400">{t('Resource')}</p>
            <p class="mt-1 text-sm font-semibold text-surface-900">{selectedEntry.resource_type || selectedEntry.resourceType || '-'}</p>
          </div>
          <div class="rounded-xl bg-surface-50 p-3">
            <p class="text-xs font-medium text-surface-400">{t('ID')}</p>
            <p class="mt-1 break-all font-mono text-xs text-surface-700">{selectedEntry.resource_id || selectedEntry.resourceId || '-'}</p>
          </div>
        </div>
        <div>
          <h4 class="text-sm font-semibold text-surface-900">{t('audit.details')}</h4>
          <pre class="mt-2 max-h-80 overflow-auto rounded-xl bg-surface-950 p-4 text-xs leading-5 text-surface-50">{prettyJson(selectedEntry.details || selectedEntry.metadata || selectedEntry)}</pre>
        </div>
      </div>
    </div>
  </div>
{/if}
