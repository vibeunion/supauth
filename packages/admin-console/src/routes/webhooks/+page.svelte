<script>
  import { onMount } from "svelte";
  import { resolve } from "$app/paths";
  import RequestState from "$lib/components/RequestState.svelte";
  import { t } from "$lib/i18n.js";
  import {
    createDurableMutationLockStore,
    reconciledCreatedWebhook,
    validatedWebhookCommandAck,
  } from "$lib/mutation-reconciliation.js";
  import {
    completeCollectionItems,
    completeCursorCollectionItems,
    cursorCollectionPage,
    createKeyedSingleFlightTracker,
    createLatestRequestTracker,
    mutationOutcomeUnknown,
  } from "$lib/resource-page.js";
  import {
    listWebhooks,
    createWebhook,
    deleteWebhook,
    updateWebhook,
    rotateWebhookSecret,
    listWebhookDeliveries,
    listWebhookEvents,
    listWebhookLogs,
    testWebhook,
    replayWebhookDelivery,
  } from "$lib/api/client.js";
  import {
    normalizedWebhookSelection,
    webhookEventChoices,
  } from "$lib/webhook-form.js";

  let webhooks = $state([]);
  let availableEvents = $state([]);
  let availableEventCatalog = $state([]);
  let loading = $state(true);
  let loadError = $state(null);
  let error = $state(null);
  let showCreate = $state(false);
  let newWebhook = $state({ url: "", events: [], enabled: true });
  let diagnostics = $state({});
  let webhookMutationLocks = $state({});
  let mutationStorageReady = $state(false);
  let mutationStorageError = $state(null);
  let creating = $state(false);
  let selectableEvents = $derived(
    webhookEventChoices(availableEventCatalog, availableEvents),
  );
  const diagnosticRequests = createLatestRequestTracker();
  const webhookOperations = createKeyedSingleFlightTracker();
  const webhookListRequests = createLatestRequestTracker();
  const webhookCreateOperations = createKeyedSingleFlightTracker();
  const WEBHOOK_LOCK_OWNER = "webhooks";
  const webhookMutationLockStore = createDurableMutationLockStore({
    storageKey: "supaoauth.admin.webhook-mutation-locks.v2",
    allowedActions: ["create", "delete", "replay", "rotate", "test", "toggle"],
    storageProvider: () => globalThis.localStorage,
    legacyStorageKeys: ["supaoauth.admin.webhook-mutation-locks.v1"],
  });
  const WEBHOOK_ROW_ACTIONS = ["delete", "rotate", "test", "toggle"];

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
    if (!confirm(t("webhooks.confirmReviewedState"))) return;
    if (!confirm(t("webhooks.confirmRetry"))) return;
    clearWebhookMutationLock(action, resourceId);
  }

  function replayResourceId(whId, deliveryId) {
    return `${whId}:${deliveryId}`;
  }

  function webhookIdentity(webhook) {
    return typeof webhook?.id === "string" ? webhook.id : "";
  }

  function completeWebhookList(response) {
    const listedWebhooks = completeCollectionItems(response);
    if (listedWebhooks.every((entry) => webhookIdentity(entry))) return listedWebhooks;
    throw new Error("Management API returned a webhook without an identity");
  }

  function deliveryIdentity(delivery) {
    const identity = getField(delivery, "id", "delivery_id", "deliveryId");
    return typeof identity === "string" ? identity : "";
  }

  function completeDeliveryList(response) {
    const listedDeliveries = completeCursorCollectionItems(response);
    if (listedDeliveries.every((entry) => deliveryIdentity(entry))) {
      return listedDeliveries;
    }
    throw new Error("Management API returned a delivery without an identity");
  }

  async function readWebhookList() {
    const request = webhookListRequests.begin("webhooks");
    try {
      const response = await listWebhooks();
      return { request, webhooks: completeWebhookList(response), requestError: null };
    } catch (requestError) {
      return { request, webhooks: [], requestError };
    }
  }

  function applyWebhookList(readBack) {
    if (!webhookListRequests.isCurrent(readBack.request)) return false;
    if (readBack.requestError) throw readBack.requestError;
    webhooks = readBack.webhooks;
    reconcileDiagnosticState();
    return true;
  }

  function diagnosticState(whId) {
    return (
      diagnostics[whId] || {
        logs: [],
        last: null,
        failures: 0,
        loading: false,
        loaded: false,
        pending: false,
        status: "",
      }
    );
  }

  function updateDiagnostic(whId, diagnosticUpdate) {
    diagnostics[whId] = {
      ...diagnosticState(whId),
      ...diagnosticUpdate,
    };
  }

  function webhookPending(whId) {
    return diagnosticState(whId).pending;
  }

  function beginWebhookOperation(whId, action, operationKey = whId) {
    const operation = webhookOperations.begin(operationKey, {
      action,
      webhookId: whId,
    });
    if (!operation) return null;
    updateDiagnostic(whId, { pending: true, status: t("Loading...") });
    return operation;
  }

  function finishWebhookOperation(operation) {
    if (!webhookOperations.finish(operation)) return;
    const whId = operation.ownerContext.webhookId;
    if (diagnostics[whId]) {
      updateDiagnostic(whId, { pending: false });
    }
  }

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
      wh.secret_configured === true ||
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

  function replayResourceIdForLast(whId) {
    const last = diagnosticState(whId).last;
    const deliveryId = getField(last, "id", "delivery_id", "deliveryId");
    return deliveryId ? replayResourceId(whId, deliveryId) : "";
  }

  function replayLastLocked(whId) {
    const resourceId = replayResourceIdForLast(whId);
    return resourceId ? webhookMutationLocked("replay", resourceId) : false;
  }

  function webhookUnknownLocks(whId) {
    const actionLocks = WEBHOOK_ROW_ACTIONS.filter((action) =>
      webhookMutationLocked(action, whId),
    ).map((action) => ({ action, resourceId: whId }));
    const replayPrefix = `${whId}:`;
    for (const lock of Object.values(webhookMutationLocks)) {
      if (lock.action !== "replay" || !lock.targetId.startsWith(replayPrefix)) {
        continue;
      }
      actionLocks.push({
        action: "replay",
        resourceId: lock.targetId,
      });
    }
    return actionLocks;
  }

  function webhookStillPresent(whId) {
    return webhooks.some((webhook) => webhook.id === whId);
  }

  function diagnosticRequestIsCurrent(request, operation) {
    return (
      diagnosticRequests.isCurrent(request) &&
      webhookOperations.isCurrent(operation) &&
      webhookStillPresent(request.key)
    );
  }

  async function fetchWebhookDiagnostics(whId, operation) {
    const request = diagnosticRequests.begin(whId);
    updateDiagnostic(whId, { loading: true });
    try {
      const response = await listWebhookLogs(whId, 5);
      if (!diagnosticRequestIsCurrent(request, operation)) return false;
      updateDiagnostic(whId, {
        ...summarizeDiagnostics(cursorCollectionPage(response).items),
        loaded: true,
        loading: false,
        status:
          operation.ownerContext?.action === "diagnostics"
            ? ""
            : diagnosticState(whId).status,
      });
      return true;
    } catch (requestError) {
      if (!diagnosticRequestIsCurrent(request, operation)) return false;
      updateDiagnostic(whId, { loading: false, status: requestError.message });
      return false;
    }
  }

  async function loadWebhookDiagnostics(whId, parentOperation = null) {
    if (!parentOperation && webhookPending(whId)) return false;
    const operation =
      parentOperation || beginWebhookOperation(whId, "diagnostics");
    if (!operation) return false;
    const loaded = await fetchWebhookDiagnostics(whId, operation);
    if (!parentOperation) finishWebhookOperation(operation);
    return loaded;
  }

  function reconcileDiagnosticState() {
    const activeWebhookIds = new Set(webhooks.map((webhook) => webhook.id));
    for (const whId of Object.keys(diagnostics)) {
      if (activeWebhookIds.has(whId)) continue;
      diagnosticRequests.invalidate(whId);
      webhookOperations.invalidate(whId);
      delete diagnostics[whId];
    }
  }

  async function load() {
    const request = webhookListRequests.begin("webhooks");
    loading = true;
    loadError = null;
    error = null;
    try {
      const [webhookResponse, eventsRes] = await Promise.all([
        listWebhooks(),
        listWebhookEvents(),
      ]);
      const readBack = {
        request,
        webhooks: completeWebhookList(webhookResponse),
        requestError: null,
      };
      if (!applyWebhookList(readBack)) return;
      availableEvents = eventsRes.events || [];
      availableEventCatalog = Array.isArray(eventsRes.catalog)
        ? eventsRes.catalog
        : [];
    } catch (requestError) {
      if (webhookListRequests.isCurrent(request)) loadError = requestError;
    } finally {
      if (webhookListRequests.isCurrent(request)) loading = false;
    }
  }

  async function handleCreate() {
    if (
      creating ||
      !mutationStorageReady ||
      webhookMutationLocked("create", "new")
    )
      return;
    const operation = webhookCreateOperations.begin("create");
    if (!operation) return;
    creating = true;
    error = null;
    let creationMayHaveCommitted = false;
    try {
      const selectedEvents = normalizedWebhookSelection(
        newWebhook.events,
        selectableEvents.map((event) => event.type),
      );
      if (!selectedEvents) {
        error = t("webhooks.selectEventRequired");
        return;
      }
      const draft = {
        url: newWebhook.url.trim(),
        events: selectedEvents,
        enabled: newWebhook.enabled,
      };
      const beforeReadBack = await readWebhookList();
      if (!webhookCreateOperations.isCurrent(operation)) return;
      if (!webhookListRequests.isCurrent(beforeReadBack.request)) return;
      if (beforeReadBack.requestError) throw beforeReadBack.requestError;
      const beforeIds = new Set(beforeReadBack.webhooks.map(webhookIdentity));
      if (beforeIds.size !== beforeReadBack.webhooks.length) {
        throw new Error("Management API returned duplicate webhook identities");
      }
      if (!stageWebhookMutation("create", "new")) return;
      creationMayHaveCommitted = false;
      let response = null;
      let creationInterrupted = false;
      try {
        response = await createWebhook(draft);
        creationMayHaveCommitted = true;
      } catch (requestError) {
        if (!mutationOutcomeUnknown(requestError)) throw requestError;
        creationMayHaveCommitted = true;
        creationInterrupted = true;
      }
      const readBack = await readWebhookList();
      if (!webhookCreateOperations.isCurrent(operation)) return;
      if (readBack.requestError) throw readBack.requestError;
      const responseId = webhookIdentity(response);
      const created = !creationInterrupted &&
        responseId &&
        !beforeIds.has(responseId)
        ? reconciledCreatedWebhook({
            beforeWebhooks: beforeReadBack.webhooks,
            afterWebhooks: readBack.webhooks,
            createResponse: response,
            draft,
          })
        : null;
      if (!created || !applyWebhookList(readBack)) {
        recordWebhookMutationUnknown("create", "new");
        error = null;
        return;
      }
      if (!clearWebhookMutationLock("create", "new")) {
        error = t(
          "webhooks.creationLockClearFailed",
        );
        return;
      }
      showCreate = false;
      newWebhook = { url: "", events: [], enabled: true };
    } catch (requestError) {
      if (!webhookCreateOperations.isCurrent(operation)) return;
      if (creationMayHaveCommitted) {
        recordWebhookMutationUnknown("create", "new");
        error = null;
      } else {
        clearWebhookMutationLock("create", "new");
        // Show the API error message when available so the user knows why
        error = requestError?.message
          ? `${t("webhooks.createFailed")} (${requestError.message})`
          : t("webhooks.createFailed");
      }
    } finally {
      if (webhookCreateOperations.finish(operation)) creating = false;
    }
  }

  async function handleDelete(id) {
    if (
      webhookPending(id) ||
      !mutationStorageReady ||
      webhookMutationLocked("delete", id)
    )
      return;
    if (!confirm(t("Delete this webhook?"))) return;
    const operation = beginWebhookOperation(id, "delete");
    if (!operation) return;
    if (!stageWebhookMutation("delete", id)) {
      finishWebhookOperation(operation);
      return;
    }
    let deletionMayHaveCommitted = false;
    try {
      try {
        await deleteWebhook(id);
        deletionMayHaveCommitted = true;
      } catch (requestError) {
        if (!mutationOutcomeUnknown(requestError)) throw requestError;
        deletionMayHaveCommitted = true;
      }
      const readBack = await readWebhookList();
      if (!webhookOperations.isCurrent(operation)) return;
      if (readBack.requestError) throw readBack.requestError;
      const stillPresent = readBack.webhooks.some(
        (entry) => webhookIdentity(entry) === id,
      );
      if (stillPresent || !applyWebhookList(readBack)) {
        recordWebhookMutationUnknown("delete", id);
        error = t(
          "Webhook deletion could not be verified. Reconcile the authoritative list before deleting again.",
        );
        return;
      }
      if (!clearWebhookMutationLock("delete", id)) {
        error = t(
          "Webhook deletion was verified but the reconciliation lock could not be cleared. Reconcile storage before trying again.",
        );
        return;
      }
      diagnosticRequests.invalidate(id);
      delete diagnostics[id];
    } catch (requestError) {
      if (!webhookOperations.isCurrent(operation)) return;
      if (deletionMayHaveCommitted) {
        recordWebhookMutationUnknown("delete", id);
        error = t(
          "Webhook deletion read-back failed. Reconcile the authoritative list before deleting again.",
        );
      } else {
        clearWebhookMutationLock("delete", id);
        error = requestError.message;
      }
    } finally {
      finishWebhookOperation(operation);
    }
  }

  async function handleToggle(wh) {
    if (
      webhookPending(wh.id) ||
      !mutationStorageReady ||
      webhookMutationLocked("toggle", wh.id)
    )
      return;
    const operation = beginWebhookOperation(wh.id, "toggle");
    if (!operation) return;
    if (!stageWebhookMutation("toggle", wh.id)) {
      finishWebhookOperation(operation);
      return;
    }
    const expectedEnabled = !wh.enabled;
    let updateMayHaveCommitted = false;
    try {
      try {
        await updateWebhook(wh.id, { enabled: expectedEnabled });
        updateMayHaveCommitted = true;
      } catch (requestError) {
        if (!mutationOutcomeUnknown(requestError)) throw requestError;
        updateMayHaveCommitted = true;
      }
      const readBack = await readWebhookList();
      if (!webhookOperations.isCurrent(operation)) return;
      if (readBack.requestError) throw readBack.requestError;
      const updated = readBack.webhooks.find(
        (entry) => webhookIdentity(entry) === wh.id,
      );
      if (updated?.enabled !== expectedEnabled || !applyWebhookList(readBack)) {
        recordWebhookMutationUnknown("toggle", wh.id);
        error = t(
          "Webhook status update could not be verified. Reconcile the authoritative list before toggling again.",
        );
        return;
      }
      if (!clearWebhookMutationLock("toggle", wh.id)) {
        error = t(
          "Webhook status was verified but the reconciliation lock could not be cleared. Reconcile storage before trying again.",
        );
        return;
      }
    } catch (requestError) {
      if (!webhookOperations.isCurrent(operation)) return;
      if (updateMayHaveCommitted) {
        recordWebhookMutationUnknown("toggle", wh.id);
        error = t(
          "Webhook status read-back failed. Reconcile the authoritative list before toggling again.",
        );
      } else {
        clearWebhookMutationLock("toggle", wh.id);
        error = requestError.message;
      }
    } finally {
      finishWebhookOperation(operation);
    }
  }

  async function handleRotateSecret(whId) {
    if (
      webhookPending(whId) ||
      !mutationStorageReady ||
      webhookMutationLocked("rotate", whId)
    )
      return;
    if (
      !confirm(t("Rotate webhook secret? The old secret will be invalidated."))
    )
      return;
    const operation = beginWebhookOperation(whId, "rotate");
    if (!operation) return;
    if (!stageWebhookMutation("rotate", whId)) {
      finishWebhookOperation(operation);
      return;
    }
    let rotationMayHaveCommitted = false;
    try {
      let response;
      try {
        response = await rotateWebhookSecret(whId);
        rotationMayHaveCommitted = true;
      } catch (requestError) {
        if (!mutationOutcomeUnknown(requestError)) throw requestError;
        rotationMayHaveCommitted = true;
        recordWebhookMutationUnknown("rotate", whId);
        error = t(
          "Webhook secret rotation outcome is unknown. Reconcile signing before rotating again.",
        );
        return;
      }
      const commandAck = validatedWebhookCommandAck(response, whId);
      if (!commandAck) {
        recordWebhookMutationUnknown("rotate", whId);
        error = t(
          "Webhook secret rotation returned an invalid acknowledgment. Reconcile signing before rotating again.",
        );
        return;
      }
      if (!clearWebhookMutationLock("rotate", whId)) {
        error = t(
          "Webhook secret rotation was verified but the reconciliation lock could not be cleared. Reconcile storage before trying again.",
        );
        return;
      }
      webhooks = webhooks.map((entry) =>
        webhookIdentity(entry) === whId ? commandAck : entry,
      );
    } catch (requestError) {
      if (!webhookOperations.isCurrent(operation)) return;
      if (rotationMayHaveCommitted) {
        recordWebhookMutationUnknown("rotate", whId);
        error = t(
          "Webhook secret rotation outcome is unknown. Reconcile signing before rotating again.",
        );
      } else {
        clearWebhookMutationLock("rotate", whId);
        error = requestError.message;
      }
    } finally {
      finishWebhookOperation(operation);
    }
  }

  async function handleTest(whId) {
    if (
      webhookPending(whId) ||
      !mutationStorageReady ||
      webhookMutationLocked("test", whId)
    )
      return;
    const operation = beginWebhookOperation(whId, "test");
    if (!operation) return;
    let testMayHaveCommitted = false;
    try {
      const beforeResponse = await listWebhookDeliveries(whId, { limit: 100 });
      const beforeDeliveries = completeDeliveryList(beforeResponse);
      if (!stageWebhookMutation("test", whId)) return;
      let response = null;
      let testInterrupted = false;
      try {
        response = await testWebhook(whId);
        testMayHaveCommitted = true;
      } catch (requestError) {
        if (!mutationOutcomeUnknown(requestError)) throw requestError;
        testMayHaveCommitted = true;
        testInterrupted = true;
      }
      const afterResponse = await listWebhookDeliveries(whId, { limit: 100 });
      const afterDeliveries = completeDeliveryList(afterResponse);
      if (!webhookOperations.isCurrent(operation)) return;
      const beforeIds = new Set(beforeDeliveries.map(deliveryIdentity));
      const responseId = deliveryIdentity(response);
      const newDeliveries = afterDeliveries.filter(
        (entry) => !beforeIds.has(deliveryIdentity(entry)),
      );
      const verified = responseId
        ? newDeliveries.some((entry) => deliveryIdentity(entry) === responseId)
        : newDeliveries.length === 1;
      if (testInterrupted || !verified) {
        recordWebhookMutationUnknown("test", whId);
        updateDiagnostic(whId, {
          status: t(
            "Webhook test outcome is unknown. Reconcile deliveries before testing again.",
          ),
        });
        return;
      }
      if (!webhookOperations.isCurrent(operation)) return;
      if (!(await loadWebhookDiagnostics(whId, operation))) {
        recordWebhookMutationUnknown("test", whId);
        return;
      }
      if (!webhookOperations.isCurrent(operation)) return;
      if (!clearWebhookMutationLock("test", whId)) {
        updateDiagnostic(whId, {
          status: t(
            "Webhook test was verified but the reconciliation lock could not be cleared. Reconcile storage before trying again.",
          ),
        });
        return;
      }
      updateDiagnostic(whId, {
        status: t("Test delivered"),
      });
    } catch (requestError) {
      if (webhookOperations.isCurrent(operation)) {
        if (testMayHaveCommitted) recordWebhookMutationUnknown("test", whId);
        else clearWebhookMutationLock("test", whId);
        updateDiagnostic(whId, {
          status: testMayHaveCommitted
            ? t(
                "Webhook test read-back failed. Reconcile deliveries before testing again.",
              )
            : requestError.message,
          loading: false,
        });
      }
    } finally {
      finishWebhookOperation(operation);
    }
  }

  async function handleReplayLast(whId) {
    if (webhookPending(whId)) return;
    const last = diagnosticState(whId).last;
    const deliveryId = getField(last, "id", "delivery_id", "deliveryId");
    if (!deliveryId) {
      updateDiagnostic(whId, { status: t("No delivery log to replay") });
      return;
    }
    const mutationResourceId = replayResourceId(whId, deliveryId);
    if (
      !mutationStorageReady ||
      webhookMutationLocked("replay", mutationResourceId)
    )
      return;
    if (!confirm(t("Replay this webhook delivery? This sends it again."))) return;
    const operation = beginWebhookOperation(
      whId,
      "replay",
      mutationResourceId,
    );
    if (!operation) return;
    let replayMayHaveCommitted = false;
    try {
      const beforeResponse = await listWebhookDeliveries(whId, { limit: 100 });
      const beforeDeliveries = completeDeliveryList(beforeResponse);
      if (!beforeDeliveries.some((entry) => deliveryIdentity(entry) === deliveryId)) {
        updateDiagnostic(whId, {
          status: t(
            "The selected delivery is no longer present. Refresh logs before replaying.",
          ),
        });
        return;
      }
      if (!stageWebhookMutation("replay", mutationResourceId)) return;
      let response = null;
      let replayInterrupted = false;
      try {
        response = await replayWebhookDelivery(whId, deliveryId);
        replayMayHaveCommitted = true;
      } catch (requestError) {
        if (!mutationOutcomeUnknown(requestError)) throw requestError;
        replayMayHaveCommitted = true;
        replayInterrupted = true;
      }
      const afterResponse = await listWebhookDeliveries(whId, { limit: 100 });
      const afterDeliveries = completeDeliveryList(afterResponse);
      if (!webhookOperations.isCurrent(operation)) return;
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
        updateDiagnostic(whId, {
          status: t(
            "Webhook replay outcome is unknown. Reconcile this delivery before allowing another replay.",
          ),
        });
        return;
      }
      if (!(await loadWebhookDiagnostics(whId, operation))) {
        recordWebhookMutationUnknown("replay", mutationResourceId);
        updateDiagnostic(whId, {
          status: t(
            "Webhook replay post-write diagnostics failed. Reconcile this delivery before allowing another replay.",
          ),
        });
        return;
      }
      if (!clearWebhookMutationLock("replay", mutationResourceId)) {
        updateDiagnostic(whId, {
          status: t(
            "Webhook replay was verified but the reconciliation lock could not be cleared. Reconcile storage before trying again.",
          ),
        });
        return;
      }
      updateDiagnostic(whId, {
        status: t("Replay queued"),
      });
    } catch (requestError) {
      if (webhookOperations.isCurrent(operation)) {
        if (replayMayHaveCommitted) {
          recordWebhookMutationUnknown("replay", mutationResourceId);
        } else {
          clearWebhookMutationLock("replay", mutationResourceId);
        }
        updateDiagnostic(whId, {
          status: replayMayHaveCommitted
            ? t(
                "Webhook replay read-back failed. Reconcile this delivery before allowing another replay.",
              )
            : requestError.message,
          loading: false,
        });
      }
    } finally {
      finishWebhookOperation(operation);
    }
  }

  async function handleRefreshDiagnostics(whId) {
    await loadWebhookDiagnostics(whId);
  }

  onMount(() => {
    restoreWebhookMutationLocks();
    void load();
  });
</script>

<div class="flex items-center justify-between mb-6">
  <h2 class="text-2xl font-bold text-surface-900">{t("Webhooks")}</h2>
  {#if !showCreate}
    <button
      onclick={() => (showCreate = true)}
      class="px-4 py-2 bg-brand-600 text-white rounded-lg text-sm font-medium hover:bg-brand-700"
    >
      + {t("New Webhook")}
    </button>
  {/if}
</div>

{#if error}
  <div class="bg-red-50 border border-red-200 rounded-lg p-4 text-red-700 mb-4">
    {error}
  </div>
{/if}

{#if mutationStorageError}
  <div
    class="mb-4 rounded-lg border border-red-200 bg-red-50 p-4 text-red-700"
    role="alert"
  >
    {mutationStorageError}
  </div>
{/if}

{#if webhookMutationLocked("create", "new")}
  <div
    class="mb-4 rounded-lg border border-amber-300 bg-amber-50 p-4 text-sm text-amber-900"
    role="alert"
  >
    <p>
      {t("webhooks.creationNeedsReview")}
    </p>
    <button
      onclick={() => acknowledgeWebhookMutation("create", "new")}
      class="mt-3 font-semibold text-amber-950 underline"
      >{t("webhooks.creationAllowRetry")}</button
    >
  </div>
{/if}

{#if showCreate}
  <div class="bg-white rounded-xl border border-surface-200 p-6 mb-6">
    <h3 class="text-lg font-semibold text-surface-800 mb-4">
      {t("New Webhook")}
    </h3>
    <fieldset class="space-y-4" disabled={creating}>
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
        <p class="block text-sm font-medium text-surface-700 mb-2">
          {t("webhooks.events")}
        </p>
        <div class="grid gap-2 md:grid-cols-2">
          {#each selectableEvents as event (event.type)}
            <label
              class="flex cursor-pointer items-start gap-3 rounded-lg border px-3 py-2 {newWebhook.events.includes(event.type)
                ? 'border-brand-300 bg-brand-50'
                : 'border-surface-200 bg-white'}"
            >
              <input
                type="checkbox"
                value={event.type}
                bind:group={newWebhook.events}
                class="mt-0.5"
              />
              <span class="min-w-0">
                <code class="text-xs font-semibold text-surface-800">{event.type}</code>
                <span class="mt-0.5 block text-xs text-surface-500">
                  {t(`webhooks.event.${event.type}`)}
                </span>
              </span>
            </label>
          {/each}
        </div>
      </div>
      <aside class="rounded-lg border border-blue-200 bg-blue-50 p-4 text-sm text-blue-900">
        <p class="font-semibold">{t("webhooks.signingTitle")}</p>
        <p class="mt-1 leading-6">{t("webhooks.signingDescription")}</p>
        <p class="mt-2 font-mono text-xs">webhook-id · webhook-timestamp · webhook-signature</p>
      </aside>
      <div class="flex items-center gap-3 border-t border-surface-200 pt-4">
        <button
          disabled={creating ||
            !mutationStorageReady ||
            webhookMutationLocked("create", "new") ||
            !newWebhook.url.trim() ||
            newWebhook.events.length === 0}
          onclick={handleCreate}
          class="px-4 py-2 bg-brand-600 text-white rounded-lg text-sm font-medium hover:bg-brand-700 disabled:cursor-not-allowed disabled:opacity-50"
          >{creating ? t("Loading...") : t("Create")}</button
        >
        <button
          type="button"
          onclick={() => (showCreate = false)}
          class="rounded-lg border border-surface-300 px-4 py-2 text-sm font-medium text-surface-700 hover:bg-surface-50"
        >{t("Cancel")}</button>
      </div>
    </fieldset>
  </div>
{/if}

<RequestState
  {loading}
  error={loadError}
  onRetry={load}
  empty={webhooks.length === 0}
  emptyTitle="No webhooks configured"
  emptyDescription="Webhooks notify external systems on events like user.created, application.created"
>
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
                  {diagnosticState(wh.id).loaded
                    ? formatTime(
                        getField(
                          diagnosticState(wh.id).last,
                          "created_at",
                          "createdAt",
                          "delivered_at",
                          "deliveredAt",
                        ),
                      )
                    : t("Not reported")}
                </p>
              </div>
              <div
                class="rounded-lg bg-surface-50 border border-surface-200 p-2"
              >
                <p class="font-medium text-surface-700">{t("Last status")}</p>
                <p>
                  {diagnosticState(wh.id).loaded
                    ? deliveryStatus(diagnosticState(wh.id).last)
                    : t("Not reported")}
                </p>
              </div>
              <div
                class="rounded-lg bg-surface-50 border border-surface-200 p-2"
              >
                <p class="font-medium text-surface-700">
                  {t("Recent failures")}
                </p>
                <p>
                  {diagnosticState(wh.id).loading
                    ? t("Loading...")
                    : diagnosticState(wh.id).loaded
                      ? diagnosticState(wh.id).failures
                      : t("Not reported")}
                </p>
              </div>
              <div
                class="rounded-lg bg-surface-50 border border-surface-200 p-2"
              >
                <p class="font-medium text-surface-700">{t("Signing")}</p>
                <p>{signingState(wh)}</p>
                {#if wh.signing_key_id || wh.signingKeyId}
                  <p class="mt-1 font-mono text-[11px] text-surface-500">
                    {wh.signing_key_id || wh.signingKeyId}
                  </p>
                {/if}
              </div>
            </div>
            <p class="mt-2 text-xs text-surface-500">
              {t("Signature check:")}
              {diagnosticState(wh.id).loaded
                ? logSignatureState(diagnosticState(wh.id).last)
                : t("Not reported")}
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
            <fieldset
              class="contents"
              disabled={!mutationStorageReady ||
                webhookMutationLocked("toggle", wh.id)}
            >
              <button
                onclick={() => handleToggle(wh)}
                disabled={webhookPending(wh.id)}
                class="text-xs text-brand-600 hover:text-brand-800 disabled:cursor-not-allowed disabled:text-surface-400"
              >
                {wh.enabled ? t("Disable") : t("Enable")}
              </button>
            </fieldset>
            <fieldset
              class="contents"
              disabled={!mutationStorageReady ||
                webhookMutationLocked("rotate", wh.id)}
            >
              <button
                onclick={() => handleRotateSecret(wh.id)}
                disabled={webhookPending(wh.id)}
                class="text-xs text-surface-600 hover:text-surface-800 disabled:cursor-not-allowed disabled:text-surface-400"
                >{t("Rotate Secret")}</button
              >
            </fieldset>
            <fieldset
              class="contents"
              disabled={!mutationStorageReady ||
                webhookMutationLocked("test", wh.id)}
            >
              <button
                onclick={() => handleTest(wh.id)}
                disabled={webhookPending(wh.id)}
                class="text-xs text-surface-600 hover:text-surface-800 disabled:cursor-not-allowed disabled:text-surface-400"
                >{t("Test")}</button
              >
            </fieldset>
            <button
              onclick={() => handleRefreshDiagnostics(wh.id)}
              disabled={webhookPending(wh.id)}
              class="text-xs text-surface-600 hover:text-surface-800 disabled:cursor-not-allowed disabled:text-surface-400"
              >{webhookPending(wh.id)
                ? t("Loading...")
                : t("Refresh logs")}</button
            >
            <fieldset
              class="contents"
              disabled={!mutationStorageReady ||
                replayLastLocked(wh.id)}
            >
              <button
                onclick={() => handleReplayLast(wh.id)}
                disabled={webhookPending(wh.id)}
                class="text-xs {canRetryLast(wh.id)
                  ? 'text-red-600 hover:text-red-800'
                  : 'text-surface-600 hover:text-surface-800'} disabled:cursor-not-allowed disabled:text-surface-400"
                >{canRetryLast(wh.id)
                  ? t("Retry failed")
                  : t("Replay last")}</button
              >
            </fieldset>
            <fieldset
              class="contents"
              disabled={!mutationStorageReady ||
                webhookMutationLocked("delete", wh.id)}
            >
              <button
                onclick={() => handleDelete(wh.id)}
                disabled={webhookPending(wh.id)}
                class="text-xs text-red-500 hover:text-red-700 disabled:cursor-not-allowed disabled:text-surface-400"
                >{t("Delete")}</button
              >
            </fieldset>
          </div>
        </div>
        {#each webhookUnknownLocks(wh.id) as unknownLock (`${unknownLock.action}:${unknownLock.resourceId}`)}
          <div
            class="mt-3 rounded-lg border border-amber-300 bg-amber-50 p-3 text-xs text-amber-900"
            role="alert"
          >
            <p>
              {t(
                "A webhook action has an unknown outcome. Reconcile the authoritative webhook or delivery state before allowing it again.",
              )}
              <code class="ml-1">{unknownLock.action}</code>
            </p>
            <button
              onclick={() =>
                acknowledgeWebhookMutation(
                  unknownLock.action,
                  unknownLock.resourceId,
                )}
              class="mt-2 font-semibold underline"
              >{t("I reconciled the state; allow this action again")}</button
            >
          </div>
        {/each}
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
</RequestState>
