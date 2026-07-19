<script>
  import { onMount } from "svelte";
  import { resolve } from "$app/paths";
  import { t } from "$lib/i18n.js";
  import {
    listWebhooks,
    createWebhook,
    deleteWebhook,
    updateWebhook,
    rotateWebhookSecret,
    listWebhookEvents,
    listWebhookLogs,
    testWebhook,
    replayWebhookDelivery,
  } from "$lib/api/client.js";

  let webhooks = $state([]);
  let availableEvents = $state([]);
  let availableEventCatalog = $state([]);
  let loading = $state(true);
  let error = $state(null);
  let showCreate = $state(false);
  let newWebhook = $state({ url: "", events: "", enabled: true });
  let diagnostics = $state({});

  function getField(record, ...keys) {
    for (const key of keys) {
      if (record && record[key] !== undefined && record[key] !== null)
        return record[key];
    }
    return null;
  }

  function deliverySucceeded(log) {
    const explicit = getField(log, "success", "ok", "delivered");
    if (typeof explicit === "boolean") return explicit;
    const rawStatus = getField(
      log,
      "status_code",
      "statusCode",
      "http_status",
      "httpStatus",
      "status",
    );
    if (typeof rawStatus === "string" && /fail|error|timeout/i.test(rawStatus))
      return false;
    if (
      typeof rawStatus === "string" &&
      /success|delivered|ok/i.test(rawStatus)
    )
      return true;
    const status = Number(rawStatus);
    if (Number.isFinite(status)) return status >= 200 && status < 400;
    return !getField(log, "error", "error_message", "errorMessage");
  }

  function deliveryStatus(log) {
    if (!log) return t("No deliveries");
    const status = getField(
      log,
      "status_code",
      "statusCode",
      "http_status",
      "httpStatus",
      "status",
    );
    if (status !== null) return String(status);
    return deliverySucceeded(log) ? t("delivered") : t("failed");
  }

  function formatTime(value) {
    return value ? new Date(value).toLocaleString() : t("Never delivered");
  }

  function logSignatureState(log) {
    if (!log) return t("Not reported");
    const state = getField(
      log,
      "signature_status",
      "signatureStatus",
      "signature_verification",
      "signatureVerification",
    );
    if (state) return String(state);
    const verified = getField(
      log,
      "signature_verified",
      "signatureVerified",
      "signature_valid",
      "signatureValid",
    );
    if (verified === true) return t("Verified");
    if (verified === false) return t("Failed");
    const signed = getField(log, "signed", "has_signature", "hasSignature");
    if (signed === true) return t("Signed");
    if (signed === false) return t("Unsigned");
    return t("Not reported");
  }

  function summarizeDiagnostics(logs) {
    const items = Array.isArray(logs) ? logs : [];
    const last = items[0] || null;
    const failures = items.filter((log) => !deliverySucceeded(log)).length;
    return { logs: items, last, failures };
  }

  function signingState(wh) {
    if (
      wh.has_secret === true ||
      wh.hasSecret === true ||
      wh.signing_key_id ||
      wh.signingKeyId
    )
      return t("Signing configured");
    return t("Signing not reported");
  }

  function canRetryLast(whId) {
    const last = diagnostics[whId]?.last;
    return Boolean(last && !deliverySucceeded(last));
  }

  async function loadWebhookDiagnostics(whId) {
    const current = diagnostics[whId] || {};
    diagnostics[whId] = { ...current, loading: true };
    try {
      const logs = await listWebhookLogs(whId, 5);
      diagnostics[whId] = {
        ...summarizeDiagnostics(logs.items || []),
        loading: false,
        status: current.status || "",
      };
    } catch (e) {
      diagnostics[whId] = {
        logs: [],
        last: null,
        failures: 0,
        loading: false,
        status: e.message,
      };
    }
  }

  async function load() {
    loading = true;
    error = null;
    try {
      const [whRes, eventsRes] = await Promise.all([
        listWebhooks(),
        listWebhookEvents(),
      ]);
      webhooks =
        whRes.items || whRes.data || (Array.isArray(whRes) ? whRes : []);
      availableEvents = eventsRes.events || [];
      availableEventCatalog = Array.isArray(eventsRes.catalog)
        ? eventsRes.catalog
        : [];
      await Promise.all(webhooks.map((wh) => loadWebhookDiagnostics(wh.id)));
    } catch (e) {
      error = e.message;
    }
    loading = false;
  }

  async function handleCreate() {
    try {
      const events = newWebhook.events
        .split(",")
        .map((s) => s.trim())
        .filter(Boolean);
      await createWebhook({
        url: newWebhook.url,
        events,
        enabled: newWebhook.enabled,
      });
      showCreate = false;
      newWebhook = { url: "", events: "", enabled: true };
      await load();
    } catch (e) {
      error = e.message;
    }
  }

  async function handleDelete(id) {
    if (!confirm(t("Delete this webhook?"))) return;
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
    if (
      !confirm(t("Rotate webhook secret? The old secret will be invalidated."))
    )
      return;
    try {
      await rotateWebhookSecret(whId);
      await load();
    } catch (e) {
      error = e.message;
    }
  }

  async function handleTest(whId) {
    try {
      diagnostics[whId] = {
        status: "testing",
        logs: diagnostics[whId]?.logs || [],
      };
      const result = await testWebhook(whId);
      const logs = await listWebhookLogs(whId, 5);
      diagnostics[whId] = {
        ...summarizeDiagnostics(logs.items || []),
        loading: false,
        status: result.ok
          ? t("Test delivered")
          : result.error || `HTTP ${result.status}`,
      };
    } catch (e) {
      diagnostics[whId] = {
        status: e.message,
        logs: [],
        last: null,
        failures: 0,
        loading: false,
      };
    }
  }

  async function handleReplayLast(whId) {
    const last = diagnostics[whId]?.last;
    const deliveryId = getField(last, "id", "delivery_id", "deliveryId");
    if (!deliveryId) {
      diagnostics[whId] = {
        ...(diagnostics[whId] || {}),
        status: t("No delivery log to replay"),
      };
      return;
    }
    try {
      diagnostics[whId] = { ...(diagnostics[whId] || {}), status: "replaying" };
      const result = await replayWebhookDelivery(whId, deliveryId);
      await loadWebhookDiagnostics(whId);
      diagnostics[whId] = {
        ...(diagnostics[whId] || {}),
        status: result.ok
          ? t("Replay queued")
          : result.error || `HTTP ${result.status}`,
      };
    } catch (e) {
      diagnostics[whId] = {
        ...(diagnostics[whId] || {}),
        status: e.message,
        loading: false,
      };
    }
  }

  async function handleRefreshDiagnostics(whId) {
    await loadWebhookDiagnostics(whId);
  }

  onMount(load);
</script>

<div class="flex items-center justify-between mb-6">
  <h2 class="text-2xl font-bold text-surface-900">{t("Webhooks")}</h2>
  <button
    onclick={() => (showCreate = !showCreate)}
    class="px-4 py-2 bg-brand-600 text-white rounded-lg text-sm font-medium hover:bg-brand-700"
  >
    {showCreate ? t("Cancel") : `+ ${t("New Webhook")}`}
  </button>
</div>

{#if error}
  <div class="bg-red-50 border border-red-200 rounded-lg p-4 text-red-700 mb-4">
    {error}
  </div>
{/if}

{#if showCreate}
  <div class="bg-white rounded-xl border border-surface-200 p-6 mb-6">
    <h3 class="text-lg font-semibold text-surface-800 mb-4">
      {t("New Webhook")}
    </h3>
    <div class="space-y-4">
      <div>
        <label
          for="new-webhook-url"
          class="block text-sm font-medium text-surface-700 mb-1"
          >{t("URL")}</label
        >
        <input
          id="new-webhook-url"
          bind:value={newWebhook.url}
          class="w-full px-3 py-2 border border-surface-300 rounded-lg text-sm"
          placeholder="https://example.com/webhook"
        />
      </div>
      <div>
        <label
          for="new-webhook-events"
          class="block text-sm font-medium text-surface-700 mb-1"
          >{t("Events (comma-separated)")}</label
        >
        <input
          id="new-webhook-events"
          bind:value={newWebhook.events}
          class="w-full px-3 py-2 border border-surface-300 rounded-lg text-sm"
          placeholder="user.created, application.created"
        />
        {#if availableEventCatalog.length}
          <div class="flex flex-wrap gap-1.5 mt-2">
            {#each availableEventCatalog as event (event.type)}
              <span
                class="inline-flex items-center gap-1 rounded bg-surface-100 px-2 py-1 font-mono text-xs text-surface-700"
              >
                {event.type}
                <span
                  class="rounded px-1 py-0.5 text-[10px] {event.guarantee ===
                  'transactional'
                    ? 'bg-green-100 text-green-700'
                    : 'bg-amber-100 text-amber-700'}"
                  >{event.guarantee}</span
                >
              </span>
            {/each}
          </div>
        {:else if availableEvents.length}
          <p class="text-xs text-surface-400 mt-1">
            {t("Available:")}
            {availableEvents.join(", ")}
          </p>
        {/if}
      </div>
      <button
        onclick={handleCreate}
        class="px-4 py-2 bg-brand-600 text-white rounded-lg text-sm font-medium hover:bg-brand-700"
        >{t("Create")}</button
      >
    </div>
  </div>
{/if}

{#if loading}
  <p class="text-surface-400">{t("Loading...")}</p>
{:else if webhooks.length === 0}
  <div
    class="bg-surface-50 rounded-xl border border-surface-200 p-8 text-center"
  >
    <p class="text-surface-500">{t("No webhooks configured")}</p>
    <p class="text-sm text-surface-400 mt-2">
      {t(
        "Webhooks notify external systems on events like user.created, application.created",
      )}
    </p>
  </div>
{:else}
  <div class="space-y-3">
    {#each webhooks as wh (wh.id)}
      <div class="bg-white rounded-xl border border-surface-200 p-5">
        <div class="flex items-start justify-between">
          <div>
            <a
              href={resolve(`/webhooks/${encodeURIComponent(wh.id)}/settings`)}
              class="font-mono text-sm text-surface-900 break-all hover:text-brand-700"
              >{wh.url}</a
            >
            <div class="flex flex-wrap gap-1 mt-2">
              {#each wh.events || [] as evt (evt)}
                <span
                  class="px-2 py-0.5 bg-brand-50 text-brand-700 rounded text-xs font-medium"
                  >{evt}</span
                >
              {/each}
            </div>
            <div
              class="grid gap-2 mt-3 text-xs text-surface-600 sm:grid-cols-2 xl:grid-cols-4"
            >
              <div
                class="rounded-lg bg-surface-50 border border-surface-200 p-2"
              >
                <p class="font-medium text-surface-700">{t("Last delivery")}</p>
                <p>
                  {formatTime(
                    getField(
                      diagnostics[wh.id]?.last,
                      "created_at",
                      "createdAt",
                      "delivered_at",
                      "deliveredAt",
                    ),
                  )}
                </p>
              </div>
              <div
                class="rounded-lg bg-surface-50 border border-surface-200 p-2"
              >
                <p class="font-medium text-surface-700">{t("Last status")}</p>
                <p>{deliveryStatus(diagnostics[wh.id]?.last)}</p>
              </div>
              <div
                class="rounded-lg bg-surface-50 border border-surface-200 p-2"
              >
                <p class="font-medium text-surface-700">
                  {t("Recent failures")}
                </p>
                <p>
                  {diagnostics[wh.id]?.loading
                    ? t("Loading...")
                    : diagnostics[wh.id]?.failures || 0}
                </p>
              </div>
              <div
                class="rounded-lg bg-surface-50 border border-surface-200 p-2"
              >
                <p class="font-medium text-surface-700">{t("Signing")}</p>
                <p>{signingState(wh)}</p>
              </div>
            </div>
            <p class="mt-2 text-xs text-surface-500">
              {t("Signature check:")}
              {logSignatureState(diagnostics[wh.id]?.last)}
            </p>
          </div>
          <div class="flex items-center gap-3">
            <span
              class="text-xs px-2 py-0.5 rounded-full {wh.enabled
                ? 'bg-green-100 text-green-700'
                : 'bg-surface-100 text-surface-500'}"
            >
              {wh.enabled ? t("Active") : t("Disabled")}
            </span>
            <button
              onclick={() => handleToggle(wh)}
              class="text-xs text-brand-600 hover:text-brand-800"
            >
              {wh.enabled ? t("Disable") : t("Enable")}
            </button>
            <button
              onclick={() => handleRotateSecret(wh.id)}
              class="text-xs text-surface-600 hover:text-surface-800"
              >{t("Rotate Secret")}</button
            >
            <button
              onclick={() => handleTest(wh.id)}
              class="text-xs text-surface-600 hover:text-surface-800"
              >{t("Test")}</button
            >
            <button
              onclick={() => handleRefreshDiagnostics(wh.id)}
              class="text-xs text-surface-600 hover:text-surface-800"
              >{t("Refresh logs")}</button
            >
            <button
              onclick={() => handleReplayLast(wh.id)}
              class="text-xs {canRetryLast(wh.id)
                ? 'text-red-600 hover:text-red-800'
                : 'text-surface-600 hover:text-surface-800'}"
              >{canRetryLast(wh.id)
                ? t("Retry failed")
                : t("Replay last")}</button
            >
            <button
              onclick={() => handleDelete(wh.id)}
              class="text-xs text-red-500 hover:text-red-700"
              >{t("Delete")}</button
            >
          </div>
        </div>
        {#if diagnostics[wh.id]}
          <div
            class="mt-3 rounded-lg border border-surface-200 bg-surface-50 p-3"
          >
            <p class="text-xs font-medium text-surface-700">
              {t("Diagnostic:")}
              {diagnostics[wh.id].status}
            </p>
            {#each diagnostics[wh.id].logs as log, index (log.id || `${wh.id}-${index}`)}
              <p class="text-xs text-surface-500 mt-1">
                {log.eventType ||
                  log.event_type ||
                  log.event ||
                  t("unknown event")} · {formatTime(
                  log.createdAt || log.created_at,
                )} · {deliverySucceeded(log) ? t("delivered") : t("failed")}
              </p>
            {/each}
          </div>
        {/if}
      </div>
    {/each}
  </div>
{/if}
