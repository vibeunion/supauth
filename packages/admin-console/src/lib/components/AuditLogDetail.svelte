<script>
  import { resolve } from "$app/paths";
  import { auditResourcePath } from "$lib/audit-resource.js";
  import { t } from "$lib/i18n.js";

  let { entry } = $props();
  let resourcePath = $derived(auditResourcePath(entry));

  function entryTime(auditEntry) {
    const timestamp =
      auditEntry?.created_at || auditEntry?.createdAt || auditEntry?.timestamp;
    return timestamp ? new Date(timestamp).toLocaleString() : "-";
  }

  function prettyJson(details) {
    if (details === undefined || details === null || details === "")
      return "{}";
    if (typeof details !== "string") return JSON.stringify(details, null, 2);
    try {
      return JSON.stringify(JSON.parse(details), null, 2);
    } catch {
      return details;
    }
  }
</script>

<div class="space-y-4">
  <p class="text-xs text-surface-500">{entryTime(entry)}</p>
  <div class="grid gap-3 sm:grid-cols-2">
    <div class="rounded-xl bg-surface-50 p-3">
      <p class="text-xs font-medium text-surface-400">{t("Event")}</p>
      <p class="mt-1 text-sm font-semibold text-surface-900">
        {entry?.event_type || entry?.eventType || "-"}
      </p>
    </div>
    <div class="rounded-xl bg-surface-50 p-3">
      <p class="text-xs font-medium text-surface-400">{t("Actor")}</p>
      <p class="mt-1 break-all text-sm font-semibold text-surface-900">
        {entry?.actor_id ||
          entry?.actorId ||
          entry?.actor_type ||
          entry?.actorType ||
          "-"}
      </p>
    </div>
    <div class="rounded-xl bg-surface-50 p-3">
      <p class="text-xs font-medium text-surface-400">{t("Resource")}</p>
      <p class="mt-1 text-sm font-semibold text-surface-900">
        {entry?.resource_type || entry?.resourceType || "-"}
      </p>
    </div>
    <div class="rounded-xl bg-surface-50 p-3">
      <p class="text-xs font-medium text-surface-400">{t("ID")}</p>
      {#if resourcePath}
        <a
          href={resolve(resourcePath)}
          class="mt-1 block break-all font-mono text-xs font-semibold text-brand-700 hover:text-brand-900"
        >
          {entry?.resource_id || entry?.resourceId}
        </a>
      {:else}
        <p class="mt-1 break-all font-mono text-xs text-surface-700">
          {entry?.resource_id || entry?.resourceId || "-"}
        </p>
      {/if}
    </div>
  </div>
  <div>
    <h4 class="text-sm font-semibold text-surface-900">
      {t("audit.details")}
    </h4>
    <pre
      class="mt-2 max-h-[32rem] overflow-auto rounded-xl bg-surface-950 p-4 text-xs leading-5 text-surface-50">{prettyJson(
        entry?.details || entry?.metadata || entry,
      )}</pre>
  </div>
</div>
