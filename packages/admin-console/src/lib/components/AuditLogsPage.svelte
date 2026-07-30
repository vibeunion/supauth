<script>
  import { onMount } from "svelte";
  import { resolve } from "$app/paths";
  import AuditLogDetail from "$lib/components/AuditLogDetail.svelte";
  import { t } from "$lib/i18n.js";
  import {
    downloadAuditExport,
    exportAuditLogs,
    getAuditExport,
    getAuditIntegrity,
    getAuditLog,
    listAuditLogs,
  } from "$lib/api/client.js";
  import { collectionItems } from "$lib/resource-page.js";

  let entries = $state([]);
  let total = $state(0);
  let currentCursor = $state(null);
  let nextCursor = $state(null);
  let cursorHistory = $state([]);
  let loading = $state(true);
  let error = $state(null);
  let filter = $state({
    event_type: "",
    resource_type: "",
    resource_id: "",
    actor_id: "",
    from: "",
    to: "",
  });
  let selectedEntry = $state(null);
  let detailLoading = $state(false);
  let integrity = $state(null);
  let integrityError = $state(null);
  let exportJob = $state(null);
  let exporting = $state(false);
  let downloading = $state(false);

  function shortId(value) {
    if (!value) return "-";
    const text = String(value);
    return text.length > 12 ? `${text.slice(0, 8)}...` : text;
  }

  function entryId(entry) {
    return entry?.id || entry?.log_id || entry?.logId || "";
  }

  function entryTime(entry) {
    const value = entry.created_at || entry.createdAt || entry.timestamp;
    return value ? new Date(value).toLocaleString() : "-";
  }

  function exportId(job) {
    return job?.id || job?.export_id || job?.exportId || "";
  }

  function exportCompleted(job) {
    return String(job?.status || "").toLowerCase() === "completed";
  }

  function checkpointSummary(checkpoint) {
    return (
      checkpoint?.last_event_hash ||
      checkpoint?.last_event_id ||
      checkpoint?.checkpoint_id ||
      "-"
    );
  }

  async function openDetail(entry) {
    selectedEntry = entry;
    const id = entryId(entry);
    if (!id) return;
    detailLoading = true;
    try {
      selectedEntry = await getAuditLog(id);
    } catch (requestError) {
      error = requestError;
    }
    detailLoading = false;
  }

  async function loadPage(cursor) {
    loading = true;
    error = null;
    try {
      const response = await listAuditLogs({
        ...filter,
        cursor: cursor || undefined,
        limit: 50,
      });
      entries = collectionItems(response);
      total = Number(response.total ?? entries.length);
      currentCursor = cursor;
      nextCursor = response.next_cursor || null;
    } catch (requestError) {
      error = requestError;
    }
    loading = false;
  }

  function load() {
    return loadPage(currentCursor);
  }

  function applyFilters() {
    cursorHistory = [];
    currentCursor = null;
    return loadPage(null);
  }

  function nextPage() {
    if (!nextCursor) return;
    cursorHistory = [...cursorHistory, currentCursor];
    return loadPage(nextCursor);
  }

  function previousPage() {
    if (cursorHistory.length === 0) return;
    const previousCursor = cursorHistory[cursorHistory.length - 1];
    cursorHistory = cursorHistory.slice(0, -1);
    return loadPage(previousCursor);
  }

  async function resetFilters() {
    filter = {
      event_type: "",
      resource_type: "",
      resource_id: "",
      actor_id: "",
      from: "",
      to: "",
    };
    cursorHistory = [];
    currentCursor = null;
    await loadPage(null);
  }

  async function loadIntegrity() {
    integrityError = null;
    try {
      integrity = await getAuditIntegrity();
    } catch (requestError) {
      integrityError = requestError;
    }
  }

  async function createExport() {
    exporting = true;
    error = null;
    try {
      exportJob = await exportAuditLogs(filter);
    } catch (requestError) {
      error = requestError.message;
    }
    exporting = false;
  }

  async function refreshExport() {
    const id = exportId(exportJob);
    if (!id) return;
    error = null;
    try {
      exportJob = await getAuditExport(id);
    } catch (requestError) {
      error = requestError;
    }
  }

  async function downloadExport() {
    const id = exportId(exportJob);
    if (!id || !exportCompleted(exportJob)) return;
    downloading = true;
    error = null;
    try {
      const blob = await downloadAuditExport(id);
      const extension = exportJob?.format === "csv" ? "csv" : "jsonl";
      const downloadUrl = URL.createObjectURL(blob);
      const link = document.createElement("a");
      link.href = downloadUrl;
      link.download = `audit-${id}.${extension}`;
      link.click();
      URL.revokeObjectURL(downloadUrl);
    } catch (requestError) {
      error = requestError;
    }
    downloading = false;
  }

  onMount(() => {
    const params = new URLSearchParams(window.location.search);
    filter = {
      event_type: params.get("event_type") || "",
      resource_type: params.get("resource_type") || "",
      resource_id: params.get("resource_id") || "",
      actor_id: params.get("actor_id") || "",
      from: params.get("from") || "",
      to: params.get("to") || "",
    };
    loadPage(null);
    loadIntegrity();
  });
</script>

<div class="flex items-center justify-between mb-6">
  <h2 class="text-2xl font-bold text-surface-900">{t("Audit Logs")}</h2>
  <div class="flex gap-2">
    <button
      disabled={exporting}
      onclick={createExport}
      class="rounded-lg border border-surface-300 px-3 py-1.5 text-sm font-medium text-surface-700 disabled:opacity-50"
      >{exporting ? t("Loading...") : t("Export")}</button
    >
    <button
      onclick={load}
      class="px-3 py-1.5 text-sm bg-surface-100 text-surface-700 rounded-lg hover:bg-surface-200"
      >{t("Refresh")}</button
    >
  </div>
</div>

{#if error}
  <div class="bg-red-50 border border-red-200 rounded-lg p-4 text-red-700 mb-4">
    {error.message || error}
  </div>
{/if}

<div class="mb-4 grid gap-3 md:grid-cols-2">
  <section class="console-card p-4">
    <p class="text-xs font-semibold uppercase tracking-wide text-surface-500">
      {t("Audit integrity")}
    </p>
    {#if integrityError}
      <p class="mt-2 text-sm text-red-700">
        {integrityError.message || integrityError}
      </p>
    {:else if integrity}
      <p class="mt-2 text-sm font-semibold text-surface-900">
        {integrity.consistent === true && integrity.status === "verified"
          ? t("Verified")
          : integrity.status || t("Review required")}
      </p>
      <p class="mt-1 font-mono text-xs text-surface-500">
        {checkpointSummary(integrity.checkpoint)}
      </p>
      <p class="mt-1 text-xs text-surface-500">
        {t("audit.eventCount", {
          count: integrity.checkpoint?.event_count ?? 0,
        })}
      </p>
    {:else}
      <p class="mt-2 text-sm text-surface-500">{t("Loading...")}</p>
    {/if}
  </section>
  <section class="console-card p-4">
    <p class="text-xs font-semibold uppercase tracking-wide text-surface-500">
      {t("Latest export")}
    </p>
    <p class="mt-2 text-sm font-semibold text-surface-900">
      {exportJob?.status || t("common.notAvailable")}
    </p>
    <p class="mt-1 font-mono text-xs text-surface-500">
      {exportId(exportJob) || "-"}
    </p>
    {#if exportJob}
      <div class="mt-3 flex flex-wrap gap-2">
        <button
          onclick={refreshExport}
          class="rounded-lg border border-surface-300 px-2.5 py-1 text-xs font-semibold text-surface-600"
          >{t("Refresh")}</button
        >
        {#if exportCompleted(exportJob)}
          <button
            disabled={downloading}
            onclick={downloadExport}
            class="rounded-lg border border-brand-300 px-2.5 py-1 text-xs font-semibold text-brand-700 disabled:opacity-50"
            >{downloading ? t("Loading...") : t("audit.download")}</button
          >
        {/if}
      </div>
    {/if}
  </section>
</div>

<div class="grid gap-3 mb-4 sm:grid-cols-2 xl:grid-cols-6">
  <input
    bind:value={filter.event_type}
    class="px-3 py-1.5 border border-surface-300 rounded-lg text-sm"
    placeholder={t("Filter: event type")}
  />
  <input
    bind:value={filter.resource_type}
    class="px-3 py-1.5 border border-surface-300 rounded-lg text-sm"
    placeholder={t("Filter: resource type")}
  />
  <input
    bind:value={filter.resource_id}
    class="px-3 py-1.5 border border-surface-300 rounded-lg text-sm"
    placeholder={t("Filter: resource ID")}
  />
  <input
    bind:value={filter.actor_id}
    class="px-3 py-1.5 border border-surface-300 rounded-lg text-sm"
    placeholder={t("Filter: actor ID")}
  />
  <input
    bind:value={filter.from}
    type="datetime-local"
    class="px-3 py-1.5 border border-surface-300 rounded-lg text-sm"
    aria-label={t("From time")}
  />
  <input
    bind:value={filter.to}
    type="datetime-local"
    class="px-3 py-1.5 border border-surface-300 rounded-lg text-sm"
    aria-label={t("To time")}
  />
</div>
<div class="flex gap-2 mb-4">
  <button
    onclick={applyFilters}
    class="px-3 py-1.5 bg-brand-600 text-white rounded-lg text-sm font-medium hover:bg-brand-700"
    >{t("Apply")}</button
  >
  <button
    onclick={resetFilters}
    class="px-3 py-1.5 bg-surface-100 text-surface-700 rounded-lg text-sm font-medium hover:bg-surface-200"
    >{t("Clear filters")}</button
  >
</div>

{#if loading}
  <p class="text-surface-400">{t("Loading...")}</p>
{:else if entries.length === 0}
  <div
    class="bg-surface-50 rounded-xl border border-surface-200 p-8 text-center"
  >
    <p class="text-surface-500">{t("No audit log entries")}</p>
  </div>
{:else}
  <div class="mb-2 flex items-center justify-between text-xs text-surface-500">
    <span>{t("audit.eventCount", { count: total })}</span>
    <span>{t("audit.pageNumber", { page: cursorHistory.length + 1 })}</span>
  </div>
  <div class="bg-white rounded-xl border border-surface-200 overflow-hidden">
    <table class="w-full text-sm">
      <thead class="bg-surface-50 border-b border-surface-200">
        <tr>
          <th class="text-left px-4 py-3 font-medium text-surface-600"
            >{t("Time")}</th
          >
          <th class="text-left px-4 py-3 font-medium text-surface-600"
            >{t("Event")}</th
          >
          <th class="text-left px-4 py-3 font-medium text-surface-600"
            >{t("Actor")}</th
          >
          <th class="text-left px-4 py-3 font-medium text-surface-600"
            >{t("Resource")}</th
          >
          <th class="text-left px-4 py-3 font-medium text-surface-600"
            >{t("ID")}</th
          >
          <th class="text-right px-4 py-3 font-medium text-surface-600"
            >{t("audit.action")}</th
          >
        </tr>
      </thead>
      <tbody>
        {#each entries as entry (entryId(entry))}
          <tr class="border-b border-surface-100">
            <td class="px-4 py-3 text-surface-500 text-xs"
              >{entryTime(entry)}</td
            >
            <td class="px-4 py-3"
              ><span
                class="px-2 py-0.5 bg-brand-50 text-brand-700 rounded text-xs font-medium"
                >{entry.event_type || entry.eventType || "-"}</span
              ></td
            >
            <td class="px-4 py-3 text-surface-600 text-xs"
              >{entry.actor_type || entry.actorType || "-"}</td
            >
            <td class="px-4 py-3 text-surface-600 text-xs"
              >{entry.resource_type || entry.resourceType || "-"}</td
            >
            <td class="px-4 py-3 font-mono text-xs text-surface-500"
              >{shortId(entry.resource_id || entry.resourceId)}</td
            >
            <td class="px-4 py-3 text-right">
              <a
                href={resolve(
                  `/audit-logs/${encodeURIComponent(entryId(entry))}`,
                )}
                class="mr-2 rounded-lg border border-surface-300 px-2.5 py-1 text-xs font-semibold text-surface-600 hover:bg-surface-50"
                >{t("audit.openDetail")}</a
              >
              <button
                onclick={() => openDetail(entry)}
                class="rounded-lg border border-surface-300 px-2.5 py-1 text-xs font-semibold text-surface-600 hover:bg-surface-50"
                >{t("View")}</button
              >
            </td>
          </tr>
        {/each}
      </tbody>
    </table>
  </div>
  <div class="mt-4 flex justify-end gap-2">
    <button
      disabled={cursorHistory.length === 0 || loading}
      onclick={previousPage}
      class="rounded-lg border border-surface-300 px-3 py-1.5 text-sm font-medium text-surface-700 disabled:opacity-50"
      >{t("audit.previousPage")}</button
    >
    <button
      disabled={!nextCursor || loading}
      onclick={nextPage}
      class="rounded-lg border border-surface-300 px-3 py-1.5 text-sm font-medium text-surface-700 disabled:opacity-50"
      >{t("audit.nextPage")}</button
    >
  </div>
{/if}

{#if selectedEntry}
  <div class="fixed inset-0 z-50 bg-surface-950/30 p-4" role="presentation">
    <div
      class="ml-auto flex h-full max-w-2xl flex-col overflow-hidden rounded-2xl bg-white shadow-xl"
      role="dialog"
      aria-modal="true"
      aria-label={t("audit.detailTitle")}
      tabindex="-1"
    >
      <div
        class="flex items-start justify-between gap-4 border-b border-surface-200 p-5"
      >
        <div>
          <h3 class="text-lg font-semibold text-surface-950">
            {t("audit.detailTitle")}
          </h3>
          <p class="mt-1 text-xs text-surface-500">
            {entryTime(selectedEntry)}
          </p>
        </div>
        <button
          onclick={() => (selectedEntry = null)}
          class="rounded-lg border border-surface-300 px-3 py-1.5 text-sm font-semibold text-surface-600 hover:bg-surface-50"
          >{t("Close")}</button
        >
      </div>
      <div class="flex-1 space-y-4 overflow-auto p-5">
        {#if detailLoading}
          <p class="text-sm text-surface-400">{t("Loading...")}</p>
        {:else}
          <AuditLogDetail entry={selectedEntry} />
        {/if}
      </div>
    </div>
  </div>
{/if}
