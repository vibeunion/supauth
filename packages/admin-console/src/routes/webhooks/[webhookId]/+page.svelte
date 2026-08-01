<script>
  import { onMount } from "svelte";
  import { page } from "$app/state";
  import { resolve } from "$app/paths";
  import DetailTabs from "$lib/components/DetailTabs.svelte";
  import RequestState from "$lib/components/RequestState.svelte";
  import { t } from "$lib/i18n.js";
  import {
    createDurableMutationLockStore,
    validatedWebhookCommandAck,
  } from "$lib/mutation-reconciliation.js";
  import {
    completeCursorCollectionItems,
    cursorCollectionPage,
    createKeyedSingleFlightTracker,
    createOperationTracker,
    isLatestResourceLoad,
    mutationOutcomeUnknown,
    tabFromRoute,
  } from "$lib/resource-page.js";
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
  const mutationTracker = createOperationTracker((pending) => {
    saving = pending;
  });
  let error = $state(null);
  let webhookMutationLocks = $state({});
  let mutationStorageReady = $state(false);
  let mutationStorageError = $state(null);
  const replayOperations = createKeyedSingleFlightTracker();
  let webhookId = $derived(page.params.webhookId);
  let activeTab = $derived(
    tabFromRoute(page.params.tab, tabValues, "settings"),
  );
  let loadGeneration = 0;
  let deliveryLoadGeneration = 0;
  let loadedWebhookContext = $state(null);
  const WEBHOOK_LOCK_OWNER = "webhooks";
  const webhookMutationLockStore = createDurableMutationLockStore({
    storageKey: "supaoauth.admin.webhook-mutation-locks.v2",
    allowedActions: ["create", "delete", "replay", "rotate", "test", "toggle"],
    storageProvider: () => globalThis.localStorage,
    legacyStorageKeys: ["supaoauth.admin.webhook-mutation-locks.v1"],
  });

  function mutationStorageFailure() {
    mutationStorageReady = false;
    mutationStorageError = t(
      "Mutation reconciliation storage is unavailable. High-impact webhook actions are blocked.",
    );
  }

  function webhookMutationDescriptor(action, targetId) {
    return { action, ownerId: WEBHOOK_LOCK_OWNER, targetId };
  }

  function updateWebhookMutationLocks(lockCommand) {
    try {
      webhookMutationLocks = lockCommand();
      mutationStorageReady = true;
      mutationStorageError = null;
      return true;
    } catch {
      mutationStorageFailure();
      return false;
    }
  }

  function restoreWebhookMutationLocks() {
    updateWebhookMutationLocks(() => webhookMutationLockStore.restore());
  }

  function stageWebhookMutation(action, targetId) {
    return updateWebhookMutationLocks(() =>
      webhookMutationLockStore.stage(
        webhookMutationLocks,
        webhookMutationDescriptor(action, targetId),
      ),
    );
  }

  function clearWebhookMutationLock(action, targetId) {
    return updateWebhookMutationLocks(() =>
      webhookMutationLockStore.clear(
        webhookMutationLocks,
        webhookMutationDescriptor(action, targetId),
      ),
    );
  }

  function recordWebhookMutationUnknown(action, targetId) {
    if (webhookMutationLocked(action, targetId)) return true;
    return stageWebhookMutation(action, targetId);
  }

  function webhookMutationLocked(action, targetId) {
    return webhookMutationLockStore.isLocked(
      webhookMutationLocks,
      webhookMutationDescriptor(action, targetId),
    );
  }

  function acknowledgeWebhookMutation(action, resourceId) {
    if (!confirm(t("I have reconciled the authoritative webhook state."))) return;
    if (!confirm(t("Allow this high-impact webhook action to run again?"))) return;
    clearWebhookMutationLock(action, resourceId);
  }

  function replayResourceId(ownerId, deliveryId) {
    return `${ownerId}:${deliveryId}`;
  }

  function webhookIdentity(webhookResponse) {
    return typeof webhookResponse?.id === "string" ? webhookResponse.id : "";
  }

  function deliveryIdentity(delivery) {
    const identity =
      delivery?.id || delivery?.delivery_id || delivery?.deliveryId;
    return typeof identity === "string" ? identity : "";
  }

  function completeDeliveryList(response) {
    const listedDeliveries = completeCursorCollectionItems(response);
    if (listedDeliveries.every((entry) => deliveryIdentity(entry))) {
      return listedDeliveries;
    }
    throw new Error("Management API returned a delivery without an identity");
  }

  function currentWebhookReplayLocks() {
    const replayPrefix = `${webhookId}:`;
    return Object.values(webhookMutationLocks)
      .filter(
        (lock) =>
          lock.action === "replay" && lock.targetId.startsWith(replayPrefix),
      )
      .map((lock) => lock.targetId);
  }

  function timestamp(value) {
    return value ? new Date(value).toLocaleString() : t("common.notAvailable");
  }

  function currentLoadContext() {
    return {
      generation: loadGeneration,
      resourceId: webhookId,
      tab: activeTab,
    };
  }

  function isCurrentLoad(loadContext) {
    return isLatestResourceLoad(loadContext, currentLoadContext());
  }

  function currentMutationContext() {
    return loadedWebhookContext && isCurrentLoad(loadedWebhookContext)
      ? loadedWebhookContext
      : null;
  }

  function isCurrentMutation(operation) {
    return (
      mutationTracker.isCurrent(operation) &&
      isCurrentLoad(operation.ownerContext)
    );
  }

  async function loadWebhook() {
    return loadWebhookData();
  }

  async function loadWebhookData() {
    const loadContext = {
      generation: loadGeneration + 1,
      resourceId: webhookId,
      tab: activeTab,
    };
    loadGeneration = loadContext.generation;
    deliveryLoadGeneration += 1;
    loadedWebhookContext = null;
    loading = true;
    error = null;
    webhook = null;
    deliveries = [];
    selectedDelivery = null;
    try {
      const webhookResponse = await getWebhook(loadContext.resourceId);
      if (!isCurrentLoad(loadContext)) return;
      webhook = webhookResponse;
      if (loadContext.tab === "requests") {
        const deliveryResponse = await listWebhookDeliveries(
          loadContext.resourceId,
          { limit: 50 },
        );
        if (!isCurrentLoad(loadContext)) return;
        deliveries = cursorCollectionPage(deliveryResponse).items;
      }
      if (!isCurrentLoad(loadContext)) return;
      webhookForm = {
        url: webhookResponse.url || "",
        events: (webhookResponse.events || []).join(", "),
        enabled: webhookResponse.enabled ?? true,
      };
      loadedWebhookContext = loadContext;
    } catch (requestError) {
      if (isCurrentLoad(loadContext)) error = requestError;
    } finally {
      if (isCurrentLoad(loadContext)) loading = false;
    }
  }

  async function runMutation(command) {
    if (saving) return;
    const mutationContext = currentMutationContext();
    if (!mutationContext) return;
    const operation = mutationTracker.begin(mutationContext);
    error = null;
    try {
      await command(operation.ownerContext.resourceId);
      if (isCurrentMutation(operation)) await loadWebhookData();
    } catch (requestError) {
      if (isCurrentMutation(operation)) error = requestError;
    } finally {
      mutationTracker.finish(operation);
    }
  }

  function saveWebhook() {
    return runMutation((ownerId) =>
      updateWebhook(ownerId, {
        url: webhookForm.url,
        enabled: webhookForm.enabled,
        events: webhookForm.events
          .split(",")
          .map((eventName) => eventName.trim())
          .filter(Boolean),
      }),
    );
  }

  async function rotateSecret() {
    if (
      saving ||
      !mutationStorageReady ||
      webhookMutationLocked("rotate", webhookId)
    )
      return;
    const mutationContext = currentMutationContext();
    if (!mutationContext) return;
    if (!confirm(t("Rotate webhook secret? The old secret will be invalidated."))) {
      return;
    }
    const operation = mutationTracker.begin(mutationContext);
    if (!stageWebhookMutation("rotate", operation.ownerContext.resourceId)) {
      mutationTracker.finish(operation);
      return;
    }
    error = null;
    let rotationMayHaveCommitted = false;
    try {
      let response;
      try {
        response = await rotateWebhookSecret(operation.ownerContext.resourceId);
        rotationMayHaveCommitted = true;
      } catch (requestError) {
        if (!mutationOutcomeUnknown(requestError)) throw requestError;
        rotationMayHaveCommitted = true;
        recordWebhookMutationUnknown("rotate", operation.ownerContext.resourceId);
        if (isCurrentMutation(operation)) {
          error = new Error(
            t(
              "Webhook secret rotation outcome is unknown. Reconcile signing before rotating again.",
            ),
          );
        }
        return;
      }
      const commandAck = validatedWebhookCommandAck(
        response,
        operation.ownerContext.resourceId,
      );
      if (!commandAck) {
        recordWebhookMutationUnknown("rotate", operation.ownerContext.resourceId);
        if (isCurrentMutation(operation)) {
          error = new Error(
            t(
              "Webhook secret rotation returned an invalid acknowledgment. Reconcile signing before rotating again.",
            ),
          );
        }
        return;
      }
      if (!clearWebhookMutationLock("rotate", operation.ownerContext.resourceId)) {
        if (isCurrentMutation(operation)) {
          error = new Error(
            t(
              "Webhook secret rotation was verified but the reconciliation lock could not be cleared. Reconcile storage before trying again.",
            ),
          );
        }
        return;
      }
      if (isCurrentMutation(operation)) webhook = commandAck;
    } catch (requestError) {
      if (rotationMayHaveCommitted) {
        recordWebhookMutationUnknown("rotate", operation.ownerContext.resourceId);
      } else {
        clearWebhookMutationLock("rotate", operation.ownerContext.resourceId);
      }
      if (isCurrentMutation(operation)) {
        error = rotationMayHaveCommitted
          ? new Error(
              t(
                "Webhook secret rotation outcome is unknown. Reconcile signing before rotating again.",
              ),
            )
          : requestError;
      }
    } finally {
      mutationTracker.finish(operation);
    }
  }

  async function sendTestWebhook() {
    if (
      saving ||
      !mutationStorageReady ||
      webhookMutationLocked("test", webhookId)
    )
      return;
    const mutationContext = currentMutationContext();
    if (!mutationContext) return;
    const operation = mutationTracker.begin(mutationContext);
    error = null;
    let testMayHaveCommitted = false;
    try {
      const beforeResponse = await listWebhookDeliveries(
        operation.ownerContext.resourceId,
        { limit: 100 },
      );
      const beforeDeliveries = completeDeliveryList(beforeResponse);
      if (!stageWebhookMutation("test", operation.ownerContext.resourceId)) return;
      let response = null;
      let testInterrupted = false;
      try {
        response = await testWebhook(operation.ownerContext.resourceId);
        testMayHaveCommitted = true;
      } catch (requestError) {
        if (!mutationOutcomeUnknown(requestError)) throw requestError;
        testMayHaveCommitted = true;
        testInterrupted = true;
      }
      const afterResponse = await listWebhookDeliveries(
        operation.ownerContext.resourceId,
        { limit: 100 },
      );
      const afterDeliveries = completeDeliveryList(afterResponse);
      const beforeIds = new Set(beforeDeliveries.map(deliveryIdentity));
      const responseId = deliveryIdentity(response);
      const newDeliveries = afterDeliveries.filter(
        (entry) => !beforeIds.has(deliveryIdentity(entry)),
      );
      const verified = responseId
        ? newDeliveries.some((entry) => deliveryIdentity(entry) === responseId)
        : newDeliveries.length === 1;
      if (testInterrupted || !verified) {
        recordWebhookMutationUnknown("test", operation.ownerContext.resourceId);
        if (isCurrentMutation(operation)) {
          error = new Error(
            t(
              "Webhook test outcome is unknown. Reconcile deliveries before testing again.",
            ),
          );
        }
        return;
      }
      if (!clearWebhookMutationLock("test", operation.ownerContext.resourceId)) {
        if (isCurrentMutation(operation)) {
          error = new Error(
            t(
              "Webhook test was verified but the reconciliation lock could not be cleared. Reconcile storage before trying again.",
            ),
          );
        }
        return;
      }
      if (isCurrentMutation(operation) && activeTab === "requests") {
        deliveries = afterDeliveries;
      }
    } catch (requestError) {
      if (testMayHaveCommitted) {
        recordWebhookMutationUnknown("test", operation.ownerContext.resourceId);
      } else {
        clearWebhookMutationLock("test", operation.ownerContext.resourceId);
      }
      if (isCurrentMutation(operation)) {
        error = testMayHaveCommitted
          ? new Error(
              t(
                "Webhook test read-back failed. Reconcile deliveries before testing again.",
              ),
            )
          : requestError;
      }
    } finally {
      mutationTracker.finish(operation);
    }
  }

  async function replayDelivery(deliveryId) {
    const mutationContext = currentMutationContext();
    if (!mutationContext) return;
    const mutationResourceId = replayResourceId(
      mutationContext.resourceId,
      deliveryId,
    );
    if (
      saving ||
      !mutationStorageReady ||
      webhookMutationLocked("replay", mutationResourceId)
    )
      return;
    if (!confirm(t("Replay this webhook delivery? This sends it again."))) return;
    const replayOperation = replayOperations.begin(mutationResourceId);
    if (!replayOperation) return;
    const operation = mutationTracker.begin(mutationContext);
    error = null;
    let replayMayHaveCommitted = false;
    try {
      const beforeResponse = await listWebhookDeliveries(
        operation.ownerContext.resourceId,
        { limit: 100 },
      );
      const beforeDeliveries = completeDeliveryList(beforeResponse);
      if (!beforeDeliveries.some((entry) => deliveryIdentity(entry) === deliveryId)) {
        if (isCurrentMutation(operation)) {
          error = new Error(
            t("The selected delivery is no longer present. Refresh before replaying."),
          );
        }
        return;
      }
      if (!stageWebhookMutation("replay", mutationResourceId)) return;
      let response = null;
      let replayInterrupted = false;
      try {
        response = await replayWebhookDelivery(
          operation.ownerContext.resourceId,
          deliveryId,
        );
        replayMayHaveCommitted = true;
      } catch (requestError) {
        if (!mutationOutcomeUnknown(requestError)) throw requestError;
        replayMayHaveCommitted = true;
        replayInterrupted = true;
      }
      const afterResponse = await listWebhookDeliveries(
        operation.ownerContext.resourceId,
        { limit: 100 },
      );
      const afterDeliveries = completeDeliveryList(afterResponse);
      const replayedDeliveryId = deliveryIdentity(response);
      const beforeIds = new Set(beforeDeliveries.map(deliveryIdentity));
      const replayVerified =
        replayedDeliveryId &&
        !beforeIds.has(replayedDeliveryId) &&
        afterDeliveries.some(
          (entry) => deliveryIdentity(entry) === replayedDeliveryId,
        );
      if (replayInterrupted || !replayVerified) {
        recordWebhookMutationUnknown("replay", mutationResourceId);
        if (isCurrentMutation(operation)) {
          error = new Error(
            t(
              "Webhook replay outcome is unknown. Reconcile this delivery before allowing another replay.",
            ),
          );
        }
        return;
      }
      if (!clearWebhookMutationLock("replay", mutationResourceId)) {
        if (isCurrentMutation(operation)) {
          error = new Error(
            t(
              "Webhook replay was verified but the reconciliation lock could not be cleared. Reconcile storage before trying again.",
            ),
          );
        }
        return;
      }
      if (isCurrentMutation(operation)) deliveries = afterDeliveries;
    } catch (requestError) {
      if (replayMayHaveCommitted) {
        recordWebhookMutationUnknown("replay", mutationResourceId);
      } else {
        clearWebhookMutationLock("replay", mutationResourceId);
      }
      if (isCurrentMutation(operation)) {
        error = replayMayHaveCommitted
          ? new Error(
              t(
                "Webhook replay read-back failed. Reconcile this delivery before allowing another replay.",
              ),
            )
          : requestError;
      }
    } finally {
      replayOperations.finish(replayOperation);
      mutationTracker.finish(operation);
    }
  }

  async function inspectDelivery(deliveryId) {
    const mutationContext = currentMutationContext();
    if (!mutationContext) return;
    const inspectGeneration = deliveryLoadGeneration + 1;
    deliveryLoadGeneration = inspectGeneration;
    error = null;
    selectedDelivery = null;
    try {
      const deliveryResponse = await getWebhookDelivery(
        mutationContext.resourceId,
        deliveryId,
      );
      if (
        isCurrentLoad(mutationContext) &&
        inspectGeneration === deliveryLoadGeneration
      ) {
        selectedDelivery = deliveryResponse;
      }
    } catch (requestError) {
      if (
        isCurrentLoad(mutationContext) &&
        inspectGeneration === deliveryLoadGeneration
      ) {
        error = requestError;
      }
    }
  }

  let lastLoadKey = "";
  $effect(() => {
    const loadKey = `${webhookId}:${activeTab}`;
    if (!webhookId || loadKey === lastLoadKey) return;
    lastLoadKey = loadKey;
    void loadWebhook();
  });

  onMount(restoreWebhookMutationLocks);
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

{#if mutationStorageError}
  <div
    class="mb-4 rounded-lg border border-red-200 bg-red-50 p-4 text-red-700"
    role="alert"
  >
    {mutationStorageError}
  </div>
{/if}

{#each ["rotate", "test"] as action (action)}
  {#if webhookMutationLocked(action, webhookId)}
    <div
      class="mb-4 rounded-lg border border-amber-300 bg-amber-50 p-4 text-sm text-amber-900"
      role="alert"
    >
      <p>
        {t(
          "A webhook action has an unknown outcome. Reconcile the authoritative webhook or delivery state before allowing it again.",
        )}
        <code class="ml-1">{action}</code>
      </p>
      <button
        onclick={() => acknowledgeWebhookMutation(action, webhookId)}
        class="mt-3 font-semibold underline"
        >{t("I reconciled the state; allow this action again")}</button
      >
    </div>
  {/if}
{/each}

{#each currentWebhookReplayLocks() as replayId (replayId)}
  <div
    class="mb-4 rounded-lg border border-amber-300 bg-amber-50 p-4 text-sm text-amber-900"
    role="alert"
  >
    <p>
      {t(
        "A webhook replay has an unknown outcome. Reconcile the delivery before allowing another replay.",
      )}
    </p>
    <button
      onclick={() => acknowledgeWebhookMutation("replay", replayId)}
      class="mt-3 font-semibold underline"
      >{t("I reconciled the delivery; allow replay again")}</button
    >
  </div>
{/each}

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
          disabled={saving ||
            !mutationStorageReady ||
            webhookMutationLocked("rotate", webhookId)}
          onclick={rotateSecret}
          class="mt-4 rounded-lg border border-surface-300 px-3 py-2 text-sm font-medium text-surface-700 disabled:opacity-50"
          >{t("Rotate Secret")}</button
        >
      </section>
      <button
        disabled={saving ||
          !mutationStorageReady ||
          webhookMutationLocked("test", webhookId)}
        onclick={sendTestWebhook}
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
                      disabled={saving ||
                        !mutationStorageReady ||
                        webhookMutationLocked(
                          "replay",
                          replayResourceId(webhookId, delivery.id),
                        )}
                      onclick={() => replayDelivery(delivery.id)}
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
