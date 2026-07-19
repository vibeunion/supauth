<script>
  import { page } from "$app/state";
  import { resolve } from "$app/paths";
  import DetailTabs from "$lib/components/DetailTabs.svelte";
  import RequestState from "$lib/components/RequestState.svelte";
  import { t } from "$lib/i18n.js";
  import { collectionItems, tabFromRoute } from "$lib/resource-page.js";
  import {
    getWebhook,
    getWebhookDelivery,
    listWebhookDeliveries,
    replayWebhookDelivery,
    rotateWebhookSecret,
    testWebhook,
    updateWebhook,
  } from "$lib/api/client.js";

  const tabs = [
    { value: "settings", labelKey: "detail.settings" },
    { value: "requests", labelKey: "detail.recentRequests" },
  ];
  const tabValues = tabs.map((tab) => tab.value);

  let webhook = $state(null);
  let deliveries = $state([]);
  let selectedDelivery = $state(null);
  let webhookForm = $state({ url: "", events: "", enabled: true });
  let loading = $state(true);
  let saving = $state(false);
  let error = $state(null);
  let webhookId = $derived(page.params.webhookId);
  let activeTab = $derived(
    tabFromRoute(page.params.tab, tabValues, "settings"),
  );

  function timestamp(value) {
    return value ? new Date(value).toLocaleString() : t("common.notAvailable");
  }

  async function loadWebhook() {
    loading = true;
    error = null;
    try {
      webhook = await getWebhook(webhookId);
      deliveries =
        activeTab === "requests"
          ? collectionItems(
              await listWebhookDeliveries(webhookId, { limit: 50 }),
            )
          : [];
      webhookForm = {
        url: webhook.url || "",
        events: (webhook.events || []).join(", "),
        enabled: webhook.enabled ?? true,
      };
    } catch (requestError) {
      error = requestError;
    }
    loading = false;
  }

  async function runMutation(command) {
    saving = true;
    error = null;
    try {
      await command();
      await loadWebhook();
    } catch (requestError) {
      error = requestError;
    }
    saving = false;
  }

  function saveWebhook() {
    return runMutation(() =>
      updateWebhook(webhookId, {
        url: webhookForm.url,
        enabled: webhookForm.enabled,
        events: webhookForm.events
          .split(",")
          .map((eventName) => eventName.trim())
          .filter(Boolean),
      }),
    );
  }

  async function inspectDelivery(deliveryId) {
    error = null;
    try {
      selectedDelivery = await getWebhookDelivery(webhookId, deliveryId);
    } catch (requestError) {
      error = requestError;
    }
  }

  let lastLoadKey = "";
  $effect(() => {
    const loadKey = `${webhookId}:${activeTab}`;
    if (!webhookId || loadKey === lastLoadKey) return;
    lastLoadKey = loadKey;
    void loadWebhook();
  });
</script>

<div class="mb-5">
  <a
    href={resolve("/webhooks")}
    class="text-sm font-medium text-brand-700 hover:text-brand-900"
    >← {t("Webhooks")}</a
  >
  <h2 class="mt-4 break-all text-2xl font-bold text-surface-950">
    {webhook?.url || webhookId}
  </h2>
  <p class="mt-1 font-mono text-xs text-surface-500">{webhookId}</p>
</div>

<DetailTabs
  {tabs}
  {activeTab}
  basePath={`/webhooks/${encodeURIComponent(webhookId)}`}
/>

<RequestState {loading} {error} onRetry={loadWebhook}>
  {#if activeTab === "settings"}
    <div class="space-y-5">
      <section class="console-card p-6">
        <h3 class="text-lg font-semibold text-surface-900">
          {t("detail.settings")}
        </h3>
        <div class="mt-4 space-y-4">
          <div>
            <label
              for="webhook-url"
              class="mb-1 block text-sm font-medium text-surface-700"
              >{t("URL")}</label
            ><input
              id="webhook-url"
              bind:value={webhookForm.url}
              class="w-full"
            />
          </div>
          <div>
            <label
              for="webhook-events"
              class="mb-1 block text-sm font-medium text-surface-700"
              >{t("Events (comma-separated)")}</label
            ><input
              id="webhook-events"
              bind:value={webhookForm.events}
              class="w-full"
            />
          </div>
          <label
            class="flex items-center justify-between rounded-lg border border-surface-200 p-4"
            ><span class="font-medium text-surface-900">{t("Active")}</span
            ><input type="checkbox" bind:checked={webhookForm.enabled} /></label
          >
        </div>
        <button
          disabled={saving || !webhookForm.url.trim()}
          onclick={saveWebhook}
          class="mt-5 rounded-lg bg-brand-600 px-4 py-2 text-sm font-medium text-white disabled:opacity-50"
          >{saving ? t("Saving...") : t("Save")}</button
        >
      </section>
      <section class="console-card p-6">
        <h3 class="font-semibold text-surface-900">{t("Signing")}</h3>
        <p class="mt-2 text-sm text-surface-500">
          {t(
            "Secrets are encrypted by SupaCloud and are never returned to the browser.",
          )}
        </p>
        <button
          disabled={saving}
          onclick={() => runMutation(() => rotateWebhookSecret(webhookId))}
          class="mt-4 rounded-lg border border-surface-300 px-3 py-2 text-sm font-medium text-surface-700 disabled:opacity-50"
          >{t("Rotate Secret")}</button
        >
      </section>
      <button
        disabled={saving}
        onclick={() => runMutation(() => testWebhook(webhookId))}
        class="rounded-lg border border-brand-300 px-3 py-2 text-sm font-semibold text-brand-700 disabled:opacity-50"
        >{t("Test")}</button
      >
    </div>
  {:else}
    <RequestState empty={deliveries.length === 0} emptyTitle="No deliveries">
      <div class="space-y-4">
        <div class="console-card overflow-hidden">
          <table>
            <thead
              ><tr
                ><th>{t("Time")}</th><th>{t("Event")}</th><th>{t("Status")}</th
                ><th></th></tr
              ></thead
            ><tbody
              >{#each deliveries as delivery (delivery.id)}<tr
                  ><td
                    >{timestamp(delivery.created_at || delivery.createdAt)}</td
                  ><td>{delivery.event_type || delivery.eventType}</td><td
                    >{delivery.status_code ||
                      delivery.statusCode ||
                      delivery.status}</td
                  ><td class="text-right"
                    ><button
                      onclick={() => inspectDelivery(delivery.id)}
                      class="text-sm font-medium text-brand-700"
                      >{t("View")}</button
                    ><button
                      disabled={saving}
                      onclick={() =>
                        runMutation(() =>
                          replayWebhookDelivery(webhookId, delivery.id),
                        )}
                      class="ml-3 text-sm font-medium text-red-600 disabled:opacity-50"
                      >{t("Replay")}</button
                    ></td
                  ></tr
                >{/each}</tbody
            >
          </table>
        </div>
        {#if selectedDelivery}<section class="console-card p-5">
            <h3 class="font-semibold text-surface-900">
              {t("Delivery detail")}
            </h3>
            <pre
              class="mt-4 max-h-96 overflow-auto rounded-lg bg-surface-950 p-4 text-xs text-surface-100">{JSON.stringify(
                selectedDelivery,
                null,
                2,
              )}</pre>
          </section>{/if}
      </div>
    </RequestState>
  {/if}
</RequestState>
