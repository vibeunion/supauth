<script>
  import { page } from "$app/state";
  import { resolve } from "$app/paths";
  import AuditLogDetail from "$lib/components/AuditLogDetail.svelte";
  import RequestState from "$lib/components/RequestState.svelte";
  import { getAuditLog } from "$lib/api/client.js";
  import { isLatestResourceLoad } from "$lib/resource-page.js";
  import { t } from "$lib/i18n.js";

  let entry = $state(null);
  let loading = $state(true);
  let error = $state(null);
  let logId = $derived(page.params.logId);
  let loadGeneration = 0;

  function isCurrentLoad(loadContext) {
    return isLatestResourceLoad(loadContext, {
      generation: loadGeneration,
      resourceId: logId,
      tab: "detail",
    });
  }

  async function loadEntry() {
    const loadContext = {
      generation: loadGeneration + 1,
      resourceId: logId,
      tab: "detail",
    };
    loadGeneration = loadContext.generation;
    loading = true;
    error = null;
    entry = null;
    try {
      const entryResponse = await getAuditLog(loadContext.resourceId);
      if (isCurrentLoad(loadContext)) entry = entryResponse;
    } catch (requestError) {
      if (isCurrentLoad(loadContext)) error = requestError;
    } finally {
      if (isCurrentLoad(loadContext)) loading = false;
    }
  }

  let lastLoadId = "";
  $effect(() => {
    if (!logId || logId === lastLoadId) return;
    lastLoadId = logId;
    void loadEntry();
  });
</script>

<div class="mb-5">
  <a
    href={resolve("/audit-logs")}
    class="text-sm font-medium text-brand-700 hover:text-brand-900"
    >← {t("Audit Logs")}</a
  >
  <h2 class="mt-4 text-2xl font-bold text-surface-950">
    {t("audit.detailTitle")}
  </h2>
  <p class="mt-1 break-all font-mono text-xs text-surface-500">{logId}</p>
</div>

<RequestState {loading} {error} onRetry={loadEntry}>
  <section class="console-card p-6">
    <AuditLogDetail {entry} />
  </section>
</RequestState>
