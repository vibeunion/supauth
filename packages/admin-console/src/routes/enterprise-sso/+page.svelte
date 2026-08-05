<script>
  import { onMount } from "svelte";
  import { resolve } from "$app/paths";
  import { t } from "$lib/i18n.js";
  import { createDurableMutationLockStore } from "$lib/mutation-reconciliation.js";
  import {
    completeCollectionItems,
    createKeyedSingleFlightTracker,
    createLatestRequestTracker,
    mutationOutcomeUnknown,
  } from "$lib/resource-page.js";
  import {
    listEnterpriseSSOConfigs,
    createEnterpriseSSOConfig,
    listConnectors,
  } from "$lib/api/client.js";

  let configs = $state([]);
  let enterpriseConnectors = $state([]);
  let loading = $state(true);
  let error = $state(null);
  let showCreate = $state(false);
  let creating = $state(false);
  let mutationLocks = $state({});
  let mutationStorageReady = $state(false);
  let mutationStorageError = $state(null);
  const createOperations = createKeyedSingleFlightTracker();
  const listRequests = createLatestRequestTracker();
  const createLock = {
    action: "create",
    ownerId: "enterprise-sso",
    targetId: "new",
  };
  const mutationLockStore = createDurableMutationLockStore({
    storageKey: "supaoauth.admin.enterprise-sso-mutation-locks.v1",
    allowedActions: ["create"],
    storageProvider: () => globalThis.localStorage,
  });
  let createOutcomeUnknown = $derived(
    mutationLockStore.isLocked(mutationLocks, createLock),
  );
  let form = $state(newEnterpriseSsoForm());

  function newEnterpriseSsoForm() {
    return {
      connector_id: "",
      domains: "",
      sso_protocol: "oidc",
      jit_provisioning: true,
      org_membership_mapping: "{}",
      role_mapping: "{}",
    };
  }

  function connectorRecordId(connector) {
    return connector.connector_record_id || connector._meta?.id || "";
  }

  function connectorProtocol(connector) {
    return connector.runtime_kind === "saml" ? "saml" : "oidc";
  }

  function completeEnterpriseConnectors(response) {
    return completeCollectionItems(response).filter(
      (connector) =>
        connector.enabled === true &&
        (connector.category || connector.type) === "enterprise_sso" &&
        ["custom_oidc", "saml"].includes(connector.runtime_kind) &&
        connectorRecordId(connector),
    );
  }

  function selectConnector(connectorRecordIdValue) {
    form.connector_id = connectorRecordIdValue;
    const connector = enterpriseConnectors.find(
      (candidate) => connectorRecordId(candidate) === connectorRecordIdValue,
    );
    form.sso_protocol = connector ? connectorProtocol(connector) : "oidc";
  }

  function configIdentity(config) {
    return typeof config?.id === "string" ? config.id : "";
  }

  function mutationStorageFailure() {
    mutationStorageReady = false;
    mutationStorageError = t("mutation.storageUnavailable", {
      resource: t("Enterprise SSO"),
    });
  }

  function updateMutationLocks(lockCommand) {
    try {
      mutationLocks = lockCommand();
      mutationStorageReady = true;
      mutationStorageError = null;
      return true;
    } catch {
      mutationStorageFailure();
      return false;
    }
  }

  function restoreMutationLocks() {
    updateMutationLocks(() => mutationLockStore.restore());
  }

  function stageCreateLock() {
    return updateMutationLocks(() =>
      mutationLockStore.stage(mutationLocks, createLock),
    );
  }

  function clearCreateLock() {
    return updateMutationLocks(() =>
      mutationLockStore.clear(mutationLocks, createLock),
    );
  }

  function mappingRecord(serializedMapping, fieldLabel) {
    try {
      const mapping = JSON.parse(serializedMapping || "{}");
      if (mapping && typeof mapping === "object" && !Array.isArray(mapping)) {
        return mapping;
      }
    } catch {
      // 统一由下方本地化错误说明处理，避免显示浏览器原始 JSON 异常。
    }
    throw new Error(t("{field} must be a valid JSON object.", { field: fieldLabel }));
  }

  function createDraft() {
    return {
      connector_id: form.connector_id,
      domains: form.domains
        .split(",")
        .map((domain) => domain.trim())
        .filter(Boolean),
      sso_protocol: form.sso_protocol,
      jit_provisioning: form.jit_provisioning,
      org_membership_mapping: mappingRecord(
        form.org_membership_mapping,
        t("Org Mapping JSON"),
      ),
      role_mapping: mappingRecord(
        form.role_mapping,
        t("Role Mapping JSON"),
      ),
    };
  }

  function startCreate() {
    error = null;
    showCreate = true;
  }

  function cancelCreate() {
    form = newEnterpriseSsoForm();
    error = null;
    showCreate = false;
  }

  function enterpriseSsoCreationFailure(requestError) {
    if (requestError?.statusCode === 400) {
      return t("Enterprise SSO settings are invalid. Check the connector and mappings, then try again.");
    }
    return t("Enterprise SSO creation failed. Verify the connector runtime and try again.");
  }

  function completeConfigList(response) {
    const listedConfigs = completeCollectionItems(response);
    if (listedConfigs.every((config) => configIdentity(config))) return listedConfigs;
    throw new Error("Management API returned an SSO config without an identity");
  }

  async function readConfigList() {
    const request = listRequests.begin("enterprise-sso");
    try {
      const response = await listEnterpriseSSOConfigs();
      return { request, configs: completeConfigList(response), requestError: null };
    } catch (requestError) {
      return { request, configs: [], requestError };
    }
  }

  function applyConfigList(readBack) {
    if (!listRequests.isCurrent(readBack.request)) return false;
    if (readBack.requestError) throw readBack.requestError;
    configs = readBack.configs;
    return true;
  }

  async function load() {
    loading = true;
    error = null;
    try {
      const [readBack, connectorResponse] = await Promise.all([
        readConfigList(),
        listConnectors(),
      ]);
      enterpriseConnectors = completeEnterpriseConnectors(connectorResponse);
      if (applyConfigList(readBack)) loading = false;
    } catch (requestError) {
      error = requestError.message;
      loading = false;
    }
  }

  async function handleCreate() {
    if (creating || !mutationStorageReady || createOutcomeUnknown) return;
    const operation = createOperations.begin("create");
    if (!operation) return;
    creating = true;
    error = null;
    let creationMayHaveCommitted = false;
    try {
      const draft = createDraft();
      const beforeReadBack = await readConfigList();
      if (!createOperations.isCurrent(operation)) return;
      if (!listRequests.isCurrent(beforeReadBack.request)) return;
      if (beforeReadBack.requestError) throw beforeReadBack.requestError;
      const beforeIds = new Set(beforeReadBack.configs.map(configIdentity));
      if (!stageCreateLock()) return;
      let response = null;
      try {
        response = await createEnterpriseSSOConfig(draft);
        creationMayHaveCommitted = true;
      } catch (requestError) {
        if (!mutationOutcomeUnknown(requestError)) throw requestError;
        creationMayHaveCommitted = true;
      }
      const readBack = await readConfigList();
      if (!createOperations.isCurrent(operation)) return;
      if (readBack.requestError) throw readBack.requestError;
      const responseId = configIdentity(response);
      const created = readBack.configs.find(
        (config) =>
          !beforeIds.has(configIdentity(config)) &&
          (!responseId || configIdentity(config) === responseId) &&
          (config.connectorId || config.connector_id) === draft.connector_id,
      );
      if (!created || !applyConfigList(readBack)) {
        error = t(
          "Enterprise SSO creation could not be reconciled. Verify the authoritative list before creating again.",
        );
        return;
      }
      if (!clearCreateLock()) return;
      form = newEnterpriseSsoForm();
      showCreate = false;
    } catch (requestError) {
      if (!createOperations.isCurrent(operation)) return;
      if (creationMayHaveCommitted) {
        error = t(
          "Enterprise SSO creation outcome is unknown. Reconcile the authoritative list before trying again.",
        );
      } else {
        clearCreateLock();
        error = enterpriseSsoCreationFailure(requestError);
      }
    } finally {
      if (createOperations.finish(operation)) creating = false;
    }
  }

  function acknowledgeUnknownCreate() {
    if (!confirm(t("I have reconciled the authoritative SSO configuration list."))) {
      return;
    }
    if (!confirm(t("Allow another enterprise SSO configuration create?"))) return;
    clearCreateLock();
  }

  onMount(() => {
    restoreMutationLocks();
    void load();
  });
</script>

<div class="flex items-center justify-between mb-6">
  <h2 class="text-2xl font-bold text-surface-900">{t("Enterprise SSO")}</h2>
  {#if !showCreate}
    <button
      onclick={startCreate}
      class="rounded-lg bg-brand-600 px-4 py-2 text-sm font-medium text-white hover:bg-brand-700"
    >
      + {t("New SSO")}
    </button>
  {/if}
</div>

{#if error}
  <div
    class="bg-red-50 border border-red-200 rounded-lg p-4 text-red-700 mb-4"
    role="alert"
    aria-live="assertive"
  >
    {error}
  </div>
{/if}

{#if mutationStorageError}
  <div
    class="mb-4 rounded-lg border border-red-300 bg-red-50 p-4 text-sm text-red-800"
    role="alert"
  >
    {mutationStorageError}
  </div>
{/if}

{#if createOutcomeUnknown}
  <div
    class="mb-4 rounded-lg border border-amber-300 bg-amber-50 p-4 text-sm text-amber-900"
    role="alert"
  >
    <p>
      {t(
        "Enterprise SSO creation has an unknown outcome. Reconcile the authoritative list before creating again.",
      )}
    </p>
    <button
      onclick={acknowledgeUnknownCreate}
      class="mt-3 font-semibold underline"
      >{t("I verified the list; allow another create")}</button
    >
  </div>
{/if}

{#if showCreate}
  <fieldset
    class="bg-white rounded-xl border border-surface-200 p-6 mb-6 space-y-4"
    disabled={creating}
  >
    <div>
      <label
        for="connector-id"
        class="block text-sm font-medium text-surface-700 mb-1"
        >{t("Enterprise Connector")}</label
      >
      <select
        id="connector-id"
        value={form.connector_id}
        onchange={(event) => selectConnector(event.currentTarget.value)}
        class="w-full px-3 py-2 border border-surface-300 rounded-lg text-sm"
      >
        <option value="">{t("Select an enabled enterprise connector...")}</option>
        {#each enterpriseConnectors as connector (connectorRecordId(connector))}
          <option value={connectorRecordId(connector)}>
            {connector.name || connector.id} · {connectorProtocol(connector).toUpperCase()}
          </option>
        {/each}
      </select>
      {#if enterpriseConnectors.length === 0}
        <p class="mt-2 text-sm text-amber-700">
          {t("Create and enable an enterprise connector before adding SSO domain routing.")}
        </p>
      {/if}
    </div>
    <div>
      <label
        for="domains"
        class="block text-sm font-medium text-surface-700 mb-1"
        >{t("Domains")}</label
      >
      <input
        id="domains"
        bind:value={form.domains}
        class="w-full px-3 py-2 border border-surface-300 rounded-lg text-sm"
        placeholder="example.com, company.com"
      />
    </div>
    <div class="grid grid-cols-2 gap-4">
      <div>
        <label
          for="protocol"
          class="block text-sm font-medium text-surface-700 mb-1"
          >{t("Protocol")}</label
        >
        <select
          id="protocol"
          value={form.sso_protocol}
          disabled
          class="w-full px-3 py-2 border border-surface-300 rounded-lg bg-surface-50 text-sm"
        >
          <option value="oidc">OIDC</option>
          <option value="saml">SAML</option>
        </select>
      </div>
      <label class="flex items-center gap-2 text-sm text-surface-700 mt-7">
        <input type="checkbox" bind:checked={form.jit_provisioning} />
        {t("JIT provisioning")}
      </label>
    </div>
    <div>
      <label
        for="org-map"
        class="block text-sm font-medium text-surface-700 mb-1"
        >{t("Org Mapping JSON")}</label
      >
      <textarea
        id="org-map"
        bind:value={form.org_membership_mapping}
        class="w-full h-20 px-3 py-2 border border-surface-300 rounded-lg text-sm font-mono"
      ></textarea>
    </div>
    <div>
      <label
        for="role-map"
        class="block text-sm font-medium text-surface-700 mb-1"
        >{t("Role Mapping JSON")}</label
      >
      <textarea
        id="role-map"
        bind:value={form.role_mapping}
        class="w-full h-20 px-3 py-2 border border-surface-300 rounded-lg text-sm font-mono"
      ></textarea>
    </div>
    <p class="text-sm text-surface-500">
      {t("Organization and role mappings are saved only; the runtime JIT flow does not apply them yet.")}
    </p>
    <div class="flex items-center gap-3">
      <button
        disabled={creating ||
          !mutationStorageReady ||
          createOutcomeUnknown ||
          !form.connector_id.trim()}
        onclick={handleCreate}
        class="px-4 py-2 bg-brand-600 text-white rounded-lg text-sm font-medium hover:bg-brand-700 disabled:opacity-50"
        >{creating ? t("Loading...") : t("Create")}</button
      >
      <button
        type="button"
        onclick={cancelCreate}
        class="rounded-lg border border-surface-300 bg-white px-4 py-2 text-sm font-medium text-surface-700 hover:bg-surface-50"
      >
        {t("Cancel")}
      </button>
    </div>
  </fieldset>
{/if}

{#if loading}
  <p class="text-surface-400">{t("Loading...")}</p>
{:else if configs.length === 0}
  <div
    class="bg-surface-50 rounded-xl border border-surface-200 p-8 text-center"
  >
    <p class="text-surface-500">{t("No enterprise SSO configuration")}</p>
  </div>
{:else}
  <div class="space-y-3">
    {#each configs as config (config.id)}
      <div class="bg-white rounded-xl border border-surface-200 p-5">
        <a
          href={resolve(
            `/enterprise-sso/${encodeURIComponent(config.id)}/connection`,
          )}
          class="font-mono text-sm text-surface-900 hover:text-brand-700"
          >{config.connectorId || config.connector_id}</a
        >
        <p class="text-sm text-surface-500 mt-2">
          {(config.domains || []).join(", ")}
        </p>
        <p class="text-xs text-surface-400 mt-1">
          {t("Protocol:")}
          {config.ssoProtocol || config.sso_protocol} · {t("JIT:")}
          {(config.jitProvisioning ?? config.jit_provisioning)
            ? t("enabled")
            : t("disabled")}
        </p>
      </div>
    {/each}
  </div>
{/if}
