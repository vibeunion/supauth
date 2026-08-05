<script>
  import { onMount } from "svelte";
  import { t } from "$lib/i18n.js";
  import { createDurableMutationLockStore } from "$lib/mutation-reconciliation.js";
  import {
    completeCollectionItems,
    createKeyedSingleFlightTracker,
    createLatestRequestTracker,
    mutationOutcomeUnknown,
  } from "$lib/resource-page.js";
  import {
    createConnectorFromFactory,
    getConnector,
    listConnectors,
    updateConnector,
    testConnector,
    listConnectorFactories,
  } from "$lib/api/client.js";

  let connectors = $state([]);
  let factories = $state([]);
  let loading = $state(true);
  let error = $state(null);
  let testing = $state(null);
  let runtimeCheckStatus = $state(null);
  let selectedFactory = $state(null);
  let factoryForm = $state({});
  let creatingFactory = $state(false);
  let mutationLocks = $state({});
  let mutationStorageReady = $state(false);
  let mutationStorageError = $state(null);
  const connectorListRequests = createLatestRequestTracker();
  const factoryCreateOperations = createKeyedSingleFlightTracker();
  const connectorToggleOperations = createKeyedSingleFlightTracker();
  const factoryCreateLock = {
    action: "create",
    ownerId: "connectors",
    targetId: "new",
  };
  const connectorMutationLockStore = createDurableMutationLockStore({
    storageKey: "supaoauth.admin.connector-factory-mutation-locks.v1",
    allowedActions: ["create", "toggle"],
    storageProvider: () => globalThis.localStorage,
  });
  let factoryCreateOutcomeUnknown = $derived(
    connectorMutationLockStore.isLocked(mutationLocks, factoryCreateLock),
  );
  let connectorToggleOutcomeUnknown = $derived(
    Object.values(mutationLocks).some((lock) => lock.action === "toggle"),
  );

  const chinaConnectors = [
    "wechat",
    "wechat_miniprogram",
    "wechat_mp",
    "qq",
    "weibo",
    "alipay",
    "dingtalk",
    "douyin",
    "baidu",
    "huawei",
    "xiaomi",
    "kuaishou",
    "bilibili",
  ];

  function connectorRecordId(connector) {
    return typeof connector?.connector_record_id === "string"
      ? connector.connector_record_id
      : "";
  }

  function completeConnectorList(response) {
    const listedConnectors = completeCollectionItems(response);
    if (listedConnectors.every((connector) => typeof connector?.id === "string")) {
      return listedConnectors;
    }
    throw new Error("Management API returned a connector without an identity");
  }

  async function readConnectorList() {
    const request = connectorListRequests.begin("connectors");
    try {
      const response = await listConnectors();
      return { request, connectors: completeConnectorList(response), requestError: null };
    } catch (requestError) {
      return { request, connectors: [], requestError };
    }
  }

  function applyConnectorList(readBack) {
    if (!connectorListRequests.isCurrent(readBack.request)) return false;
    if (readBack.requestError) throw readBack.requestError;
    connectors = readBack.connectors;
    return true;
  }

  async function load() {
    loading = true;
    error = null;
    try {
      const [readBack, factoryResponse] = await Promise.all([
        readConnectorList(),
        listConnectorFactories(),
      ]);
      if (!applyConnectorList(readBack)) return;
      factories = completeCollectionItems(factoryResponse);
      await reconcilePersistedToggleLocks();
    } catch (requestError) {
      error = requestError.message;
    } finally {
      loading = false;
    }
  }

  function connectorToggleLock(connectorId) {
    return { action: "toggle", ownerId: "connectors", targetId: connectorId };
  }

  function connectorToggleLocked(connectorId) {
    return connectorMutationLockStore.isLocked(
      mutationLocks,
      connectorToggleLock(connectorId),
    );
  }

  function connectorTogglePending(connectorId) {
    return connectorToggleOperations.isPending(connectorId);
  }

  function stageConnectorToggleLock(connectorId) {
    return updateMutationLocks(() =>
      connectorMutationLockStore.stage(
        mutationLocks,
        connectorToggleLock(connectorId),
      ),
    );
  }

  function clearConnectorToggleLock(connectorId) {
    return updateMutationLocks(() =>
      connectorMutationLockStore.clear(
        mutationLocks,
        connectorToggleLock(connectorId),
      ),
    );
  }

  async function submitConnectorToggle(connectorId, enabled) {
    try {
      await updateConnector(connectorId, { enabled });
    } catch (requestError) {
      if (requestError?.code === "connector_update_outcome_unknown") {
        throw requestError;
      }
      if (!mutationOutcomeUnknown(requestError)) throw requestError;
    }
  }

  function connectorToggleFailure(requestError) {
    if (requestError?.statusCode === 400) {
      return t("Connector status update was rejected. Refresh and review the connector settings.");
    }
    return t("Connector status update failed. Verify the authentication runtime and try again.");
  }

  async function reconcileSubmittedToggle(connectorId, expectedEnabled, operation) {
    const readBack = await readConnectorList();
    if (!connectorToggleOperations.isCurrent(operation)) return;
    if (readBack.requestError) throw readBack.requestError;
    const updated = readBack.connectors.find((entry) => entry.id === connectorId);
    if (updated?.enabled !== expectedEnabled || !applyConnectorList(readBack)) {
      throw new Error("Connector status update did not match authoritative readback");
    }
    if (!clearConnectorToggleLock(connectorId)) {
      throw new Error("Connector status reconciliation lock could not be cleared");
    }
  }

  function reportConnectorToggleFailure(connectorId, submitted, requestError) {
    const updateMayHaveCommitted = submitted || mutationOutcomeUnknown(requestError);
    if (!updateMayHaveCommitted) clearConnectorToggleLock(connectorId);
    error = updateMayHaveCommitted
      ? t("Connector status update could not be verified. Reconcile the authoritative state before toggling again.")
      : connectorToggleFailure(requestError);
  }

  async function handleToggle(connector) {
    if (!mutationStorageReady || connectorToggleLocked(connector.id)) return;
    const operation = connectorToggleOperations.begin(connector.id);
    if (!operation) return;
    if (!stageConnectorToggleLock(connector.id)) {
      connectorToggleOperations.finish(operation);
      return;
    }
    const expectedEnabled = !connector.enabled;
    let submitted = false;
    try {
      await submitConnectorToggle(connector.id, expectedEnabled);
      submitted = true;
      await reconcileSubmittedToggle(connector.id, expectedEnabled, operation);
    } catch (requestError) {
      if (!connectorToggleOperations.isCurrent(operation)) return;
      reportConnectorToggleFailure(connector.id, submitted, requestError);
    } finally {
      connectorToggleOperations.finish(operation);
    }
  }

  async function handleTest(connectorId) {
    testing = connectorId;
    runtimeCheckStatus = null;
    try {
      await testConnector(connectorId);
      runtimeCheckStatus = {
        tone: "success",
        message: t("Connector runtime configuration check passed."),
      };
    } catch (requestError) {
      runtimeCheckStatus = {
        tone: "error",
        message: requestError?.statusCode === 404
          ? t("Connector runtime check is unavailable. Ask an administrator to verify the runtime route.")
          : t("Connector runtime configuration check failed. Verify the provider settings and try again."),
      };
    }
    testing = null;
  }

  function factorySchema(factory) {
    return factory?.configSchema || factory?.config_schema || {};
  }

  function factoryFields(factory) {
    const schema = factorySchema(factory);
    return [
      ...new Set([
        ...(schema.required || []),
        ...(schema.secret_fields || []),
        ...(schema.optional || []),
        ...(schema.one_of || []).flat(),
      ]),
    ];
  }

  function configureFactory(factory) {
    error = null;
    selectedFactory = factory;
    factoryForm = Object.fromEntries(
      factoryFields(factory).map((fieldName) => [fieldName, ""]),
    );
  }

  function cancelFactoryConfiguration() {
    selectedFactory = null;
    factoryForm = {};
    error = null;
  }

  function updateMutationLocks(lockCommand) {
    try {
      mutationLocks = lockCommand();
      mutationStorageReady = true;
      mutationStorageError = null;
      return true;
    } catch {
      mutationStorageReady = false;
      mutationStorageError = t("mutation.storageUnavailable", {
        resource: t("Connectors"),
      });
      return false;
    }
  }

  function restoreMutationLocks() {
    updateMutationLocks(() => connectorMutationLockStore.restore());
  }

  function stageFactoryCreateLock() {
    return updateMutationLocks(() =>
      connectorMutationLockStore.stage(mutationLocks, factoryCreateLock),
    );
  }

  function clearFactoryCreateLock() {
    return updateMutationLocks(() =>
      connectorMutationLockStore.clear(mutationLocks, factoryCreateLock),
    );
  }

  async function reconcilePersistedToggleLocks() {
    const persistedToggles = Object.values(mutationLocks).filter(
      (lock) => lock.action === "toggle" && lock.ownerId === "connectors",
    );
    for (const lock of persistedToggles) {
      try {
        const state = await getConnector(lock.targetId);
        const listed = connectors.find((connector) => connector.id === lock.targetId);
        if (state?.enabled === state?.provider_enabled && listed?.enabled === state.enabled) {
          clearConnectorToggleLock(lock.targetId);
        }
      } catch {
        error = t("Connector status readback failed. The reconciliation lock remains active.");
      }
    }
  }

  function acknowledgeUnknownFactoryCreate() {
    if (!confirm(t("I have reconciled the authoritative connector list."))) return;
    if (!confirm(t("Allow another connector factory create?"))) return;
    clearFactoryCreateLock();
  }

  function factoryCreationFailure(requestError) {
    if (requestError?.code === "connector_creation_outcome_unknown") {
      return t("Connector creation outcome is unknown. Verify the authoritative connector list before trying again.");
    }
    if (requestError?.statusCode === 400) {
      return t("Connector settings are invalid. Check the required fields and try again.");
    }
    return t("Connector creation failed. Verify the authentication runtime capability and try again.");
  }

  function factoryRuntimeKind(factory) {
    return factory.protocol === "saml" ? "saml" : "custom_oidc";
  }

  function reconciledFactoryConnector({ beforeConnectors, afterConnectors, response, factory, draft }) {
    const responseRecordId = connectorRecordId(response);
    if (!responseRecordId) return null;
    const beforeRecordIds = new Set(beforeConnectors.map(connectorRecordId).filter(Boolean));
    if (beforeRecordIds.has(responseRecordId)) return null;
    return afterConnectors.find((connector) =>
      connectorRecordId(connector) === responseRecordId &&
      connector.runtime_kind === factoryRuntimeKind(factory) &&
      connector.name === draft.name &&
      connector.enabled === true
    ) || null;
  }

  function factoryDraft(factory) {
    const schema = factorySchema(factory);
    const missingField = (schema.required || []).find(
      (fieldName) => !String(factoryForm[fieldName] || "").trim(),
    );
    if (missingField) {
      return {
        draft: null,
        errorMessage: t("Required connector field is missing: {field}", {
          field: missingField,
        }),
      };
    }
    const invalidAlternative = (schema.one_of || []).find(
      (fieldNames) =>
        fieldNames.filter((fieldName) =>
          String(factoryForm[fieldName] || "").trim()
        ).length !== 1,
    );
    if (invalidAlternative) {
      return {
        draft: null,
        errorMessage: t("Exactly one connector field is required: {fields}", {
          fields: invalidAlternative.join(" / "),
        }),
      };
    }
    return {
      draft: { ...factoryForm, enabled: true },
      errorMessage: null,
    };
  }

  async function saveFactoryConnector() {
    if (creatingFactory || !mutationStorageReady || factoryCreateOutcomeUnknown) return;
    const operation = factoryCreateOperations.begin("create");
    if (!operation) return;
    creatingFactory = true;
    error = null;
    let creationMayHaveCommitted = false;
    try {
      const factory = selectedFactory;
      const draftState = factoryDraft(factory);
      if (!draftState.draft) {
        error = draftState.errorMessage;
        return;
      }
      const draft = draftState.draft;
      const beforeReadBack = await readConnectorList();
      if (!factoryCreateOperations.isCurrent(operation)) return;
      if (beforeReadBack.requestError) throw beforeReadBack.requestError;
      if (!stageFactoryCreateLock()) return;
      let response = null;
      let creationInterrupted = false;
      try {
        response = await createConnectorFromFactory(
          factory.factoryId || factory.factory_id,
          draft,
        );
        creationMayHaveCommitted = true;
      } catch (requestError) {
        if (!mutationOutcomeUnknown(requestError)) throw requestError;
        creationMayHaveCommitted = true;
        creationInterrupted = true;
      }
      const readBack = await readConnectorList();
      if (!factoryCreateOperations.isCurrent(operation)) return;
      if (readBack.requestError) throw readBack.requestError;
      const created = creationInterrupted
        ? null
        : reconciledFactoryConnector({
            beforeConnectors: beforeReadBack.connectors,
            afterConnectors: readBack.connectors,
            response,
            factory,
            draft,
          });
      if (!created || !applyConnectorList(readBack)) {
        error = t("Connector creation could not be reconciled. Verify the authoritative connector list before creating again.");
        return;
      }
      if (!clearFactoryCreateLock()) {
        error = t("Connector creation was verified but the reconciliation lock could not be cleared.");
        return;
      }
      selectedFactory = null;
      factoryForm = {};
    } catch (requestError) {
      if (!factoryCreateOperations.isCurrent(operation)) return;
      error = creationMayHaveCommitted
        ? t("Connector creation outcome is unknown. Verify the authoritative connector list before trying again.")
        : factoryCreationFailure(requestError);
      if (!creationMayHaveCommitted) clearFactoryCreateLock();
    } finally {
      if (factoryCreateOperations.finish(operation)) creatingFactory = false;
    }
  }

  onMount(() => {
    restoreMutationLocks();
    void load();
  });
</script>

<div class="flex items-center justify-between mb-6">
  <h2 class="text-2xl font-bold text-surface-900">{t("Connectors")}</h2>
</div>

{#if error}
  <div class="bg-red-50 border border-red-200 rounded-lg p-4 text-red-700 mb-4">
    {error}
  </div>
{/if}

{#if mutationStorageError}
  <div class="mb-4 rounded-lg border border-red-200 bg-red-50 p-4 text-red-700" role="alert">
    {mutationStorageError}
  </div>
{/if}

{#if factoryCreateOutcomeUnknown}
  <div class="mb-4 rounded-lg border border-amber-300 bg-amber-50 p-4 text-sm text-amber-900" role="alert">
    <p>
      {t("A previous connector creation has an unknown outcome. Reconcile the authoritative connector list before creating again.")}
    </p>
    <button onclick={acknowledgeUnknownFactoryCreate} class="mt-3 font-semibold underline">
      {t("I verified the list; allow another create")}
    </button>
  </div>
{/if}

{#if connectorToggleOutcomeUnknown}
  <div class="mb-4 rounded-lg border border-amber-300 bg-amber-50 p-4 text-sm text-amber-900" role="alert">
    {t("A previous connector status update has an unknown outcome. Locked connectors will be released only after authoritative runtime and local state agree.")}
  </div>
{/if}

<div aria-live="polite" aria-atomic="true">
  {#if runtimeCheckStatus}
    <div
      class="mb-4 rounded-lg border p-4 text-sm {runtimeCheckStatus.tone ===
      'success'
        ? 'border-green-200 bg-green-50 text-green-800'
        : 'border-red-200 bg-red-50 text-red-700'}"
    >
      {runtimeCheckStatus.message}
    </div>
  {/if}
</div>

{#if loading}
  <p class="text-surface-400">{t("Loading...")}</p>
{:else}
  <h3 class="text-lg font-semibold text-surface-800 mb-3">
    {t("Factory Catalog")}
  </h3>
  <div class="grid grid-cols-3 gap-3 mb-8">
    {#each factories as factory (factory.id)}
      <div class="bg-white rounded-lg border border-surface-200 p-4">
        <p class="font-medium text-surface-900">{factory.name}</p>
        <p class="text-xs text-surface-500 mt-1">
          {factory.factoryId || factory.factory_id} · {factory.protocol} · {factory.category}
        </p>
        <button
          disabled={!factory.enabled}
          onclick={() => configureFactory(factory)}
          class="mt-3 text-xs font-semibold text-brand-700 disabled:text-surface-400"
          >{factory.enabled ? t("Configure") : t("Unavailable")}</button
        >
      </div>
    {/each}
    {#if factories.length === 0}
      <div
        class="bg-surface-50 rounded-lg border border-surface-200 p-4 text-sm text-surface-500"
      >
        {t("No factory definitions yet.")}
      </div>
    {/if}
  </div>

  {#if selectedFactory}
    <section class="console-card mb-8 p-6">
      <div class="flex items-start justify-between gap-4">
        <div>
          <h3 class="font-semibold text-surface-900">{selectedFactory.name}</h3>
          <p class="mt-1 text-sm text-surface-500">
            {factorySchema(selectedFactory).notes ||
              t(
                "Configure the inbound identity provider with the typed factory schema.",
              )}
          </p>
        </div>
        <button
          type="button"
          onclick={cancelFactoryConfiguration}
          class="text-sm text-surface-500">{t("Cancel")}</button
        >
      </div>
      <div class="mt-4 grid gap-4 md:grid-cols-2">
        {#each factoryFields(selectedFactory) as fieldName (fieldName)}
          {@const secretField = (
            factorySchema(selectedFactory).secret_fields || []
          ).includes(fieldName)}
          <div>
            <label
              for={`connector-${fieldName}`}
              class="mb-1 block text-sm font-medium text-surface-700"
              >{fieldName}</label
            ><input
              id={`connector-${fieldName}`}
              type={secretField ? "password" : "text"}
              bind:value={factoryForm[fieldName]}
              autocomplete={secretField ? "new-password" : "off"}
              class="w-full"
            />
            <p class="mt-1 text-xs text-surface-400">
              {secretField
                ? t("Secret is sent once and is never returned by the API.")
                : (factorySchema(selectedFactory).required || []).includes(
                      fieldName,
                    )
                  ? t("Required")
                  : t("Optional")}
            </p>
          </div>
        {/each}
      </div>
      <button
        disabled={creatingFactory || !mutationStorageReady || factoryCreateOutcomeUnknown}
        onclick={saveFactoryConnector}
        class="mt-5 rounded-lg bg-brand-600 px-4 py-2 text-sm font-medium text-white hover:bg-brand-700 disabled:opacity-50"
        >{creatingFactory ? t("Loading...") : t("Save")}</button
      >
    </section>
  {/if}

  {#if connectors.length === 0}
    <div
      class="bg-surface-50 rounded-xl border border-surface-200 p-8 text-center"
    >
      <p class="text-surface-500">{t("No connectors available")}</p>
      <p class="text-sm text-surface-400 mt-2">
        {t(
          "Connectors are configured through SupaCloud. Check your project settings.",
        )}
      </p>
    </div>
  {:else}
    <!-- International -->
    <h3 class="text-lg font-semibold text-surface-800 mb-3">
      {t("Social Connectors")}
    </h3>
    <div class="grid grid-cols-4 gap-3 mb-8">
      {#each connectors.filter((c) => !chinaConnectors.includes(c.id)) as connector (connector.id)}
        <div
          class="bg-white rounded-lg border {connector.enabled
            ? 'border-green-300 bg-green-50'
            : 'border-surface-200'} p-4"
        >
          <div class="flex items-center justify-between mb-2">
            <span class="font-medium text-surface-900 capitalize"
              >{connector.id}</span
            >
            <span
              class="text-xs px-2 py-0.5 rounded-full {connector.enabled
                ? 'bg-green-100 text-green-700'
                : 'bg-surface-100 text-surface-500'}"
            >
              {connector.enabled ? t("Enabled") : t("Disabled")}
            </span>
          </div>
          <div class="flex gap-2">
            <button
              onclick={() => handleToggle(connector)}
              disabled={!mutationStorageReady || connectorTogglePending(connector.id) || connectorToggleLocked(connector.id)}
              class="text-xs text-brand-600 hover:text-brand-800 disabled:text-surface-400"
            >
              {connector.enabled ? t("Disable") : t("Enable")}
            </button>
            {#if connector.enabled}
              <button
                onclick={() => handleTest(connector.id)}
                class="text-xs text-surface-600 hover:text-surface-800"
                disabled={testing === connector.id}
              >
                {testing === connector.id
                  ? t("Checking runtime...")
                  : t("Check runtime configuration")}
              </button>
            {/if}
          </div>
        </div>
      {/each}
    </div>

    <!-- China -->
    <h3 class="text-lg font-semibold text-surface-800 mb-3">
      {t("China Connectors")}
    </h3>
    <div class="grid grid-cols-4 gap-3">
      {#each connectors.filter( (c) => chinaConnectors.includes(c.id), ) as connector (connector.id)}
        <div
          class="bg-white rounded-lg border {connector.enabled
            ? 'border-green-300 bg-green-50'
            : 'border-surface-200'} p-4"
        >
          <div class="flex items-center justify-between mb-2">
            <span class="font-medium text-surface-900">{connector.id}</span>
            <span
              class="text-xs px-2 py-0.5 rounded-full {connector.enabled
                ? 'bg-green-100 text-green-700'
                : 'bg-surface-100 text-surface-500'}"
            >
              {connector.enabled ? t("Enabled") : t("Disabled")}
            </span>
          </div>
          <div class="flex gap-2">
            <button
              onclick={() => handleToggle(connector)}
              disabled={!mutationStorageReady || connectorTogglePending(connector.id) || connectorToggleLocked(connector.id)}
              class="text-xs text-brand-600 hover:text-brand-800 disabled:text-surface-400"
            >
              {connector.enabled ? t("Disable") : t("Enable")}
            </button>
            {#if connector.enabled}
              <button
                onclick={() => handleTest(connector.id)}
                class="text-xs text-surface-600 hover:text-surface-800"
                disabled={testing === connector.id}
              >
                {testing === connector.id
                  ? t("Checking runtime...")
                  : t("Check runtime configuration")}
              </button>
            {/if}
          </div>
        </div>
      {/each}
    </div>
  {/if}
{/if}
