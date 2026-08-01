<script>
  import { onMount } from "svelte";
  import { page } from "$app/state";
  import { resolve } from "$app/paths";
  import DetailTabs from "$lib/components/DetailTabs.svelte";
  import RequestState from "$lib/components/RequestState.svelte";
  import { t } from "$lib/i18n.js";
  import { createDurableMutationLockStore } from "$lib/mutation-reconciliation.js";
  import {
    collectionItems,
    createOperationTracker,
    isLatestResourceLoad,
    mutationOutcomeUnknown,
    tabFromRoute,
  } from "$lib/resource-page.js";
  import {
    createResourceScope,
    deleteResourceScope,
    getResource,
    listResourceApplications,
    updateResource,
    updateResourceScope,
  } from "$lib/api/client.js";

  const tabs = [
    { value: "general", labelKey: "detail.general" },
    { value: "permissions", labelKey: "detail.permissions" },
  ];
  const tabValues = tabs.map((tab) => tab.value);

  let resource = $state(null);
  let applications = $state([]);
  let resourceForm = $state({ name: "", indicator: "" });
  let newScope = $state({ name: "", description: "" });
  let loading = $state(true);
  let saving = $state(false);
  const mutationTracker = createOperationTracker((pending) => {
    saving = pending;
  });
  let error = $state(null);
  let mutationLocks = $state({});
  let mutationStorageReady = $state(false);
  let mutationStorageError = $state(null);
  const mutationLockStore = createDurableMutationLockStore({
    storageKey: "supaoauth.admin.api-resource-mutation-locks.v1",
    allowedActions: ["delete-scope"],
    storageProvider: () => globalThis.localStorage,
  });
  let resourceId = $derived(page.params.resourceId);
  let activeTab = $derived(tabFromRoute(page.params.tab, tabValues, "general"));
  let loadGeneration = 0;
  let loadedResourceContext = $state(null);

  function currentLoadContext() {
    return {
      generation: loadGeneration,
      resourceId,
      tab: activeTab,
    };
  }

  function isCurrentLoad(loadContext) {
    return isLatestResourceLoad(loadContext, currentLoadContext());
  }

  function currentMutationContext() {
    return loadedResourceContext && isCurrentLoad(loadedResourceContext)
      ? loadedResourceContext
      : null;
  }

  function isCurrentMutation(operation) {
    return (
      mutationTracker.isCurrent(operation) &&
      isCurrentLoad(operation.ownerContext)
    );
  }

  function mutationStorageFailure() {
    mutationStorageReady = false;
    mutationStorageError = t("mutation.storageUnavailable", {
      resource: t("API Resources"),
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

  function scopeLock(scopeId, ownerId = resourceId) {
    return { action: "delete-scope", ownerId, targetId: scopeId };
  }

  function stageScopeDelete(scopeId, ownerId) {
    return updateMutationLocks(() =>
      mutationLockStore.stage(mutationLocks, scopeLock(scopeId, ownerId)),
    );
  }

  function clearScopeDelete(scopeId, ownerId) {
    return updateMutationLocks(() =>
      mutationLockStore.clear(mutationLocks, scopeLock(scopeId, ownerId)),
    );
  }

  function scopeDeleteUnknown(scopeId) {
    return Boolean(
      resourceId &&
        scopeId &&
        mutationLockStore.isLocked(mutationLocks, scopeLock(scopeId)),
    );
  }

  function acknowledgeScopeDelete(scopeId) {
    if (!confirm(t("I have reconciled the authoritative scope list."))) return;
    if (!confirm(t("Allow this scope deletion to run again?"))) return;
    clearScopeDelete(scopeId);
  }

  function verifiedResourceScopes(resourceResponse, ownerId) {
    if (resourceResponse?.id !== ownerId || !Array.isArray(resourceResponse.scopes)) {
      throw new Error("Management API returned an invalid API resource read-back");
    }
    if (resourceResponse.scopes.some((scope) => typeof scope?.id !== "string")) {
      throw new Error("Management API returned a scope without an identity");
    }
    return resourceResponse.scopes;
  }

  async function loadResource() {
    return loadResourceData();
  }

  async function loadResourceData() {
    const loadContext = {
      generation: loadGeneration + 1,
      resourceId,
      tab: activeTab,
    };
    loadGeneration = loadContext.generation;
    loadedResourceContext = null;
    loading = true;
    error = null;
    resource = null;
    applications = [];
    try {
      const resourceResponse = await getResource(loadContext.resourceId);
      if (!isCurrentLoad(loadContext)) return;
      resource = resourceResponse;
      if (loadContext.tab === "permissions") {
        const applicationResponse = await listResourceApplications(
          loadContext.resourceId,
        );
        if (!isCurrentLoad(loadContext)) return;
        applications = collectionItems(applicationResponse);
      }
      if (!isCurrentLoad(loadContext)) return;
      resourceForm = {
        name: resourceResponse.name || "",
        indicator: resourceResponse.indicator || "",
      };
      loadedResourceContext = loadContext;
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
      await command(operation.ownerContext, operation);
      if (isCurrentMutation(operation)) await loadResourceData();
    } catch (requestError) {
      if (isCurrentMutation(operation)) error = requestError;
    } finally {
      mutationTracker.finish(operation);
    }
  }

  function addScope() {
    return runMutation(async (mutationContext, operation) => {
      await createResourceScope(mutationContext.resourceId, newScope);
      if (isCurrentMutation(operation)) {
        newScope = { name: "", description: "" };
      }
    });
  }

  async function deleteScope(scopeId) {
    if (saving || !mutationStorageReady) return;
    if (scopeDeleteUnknown(scopeId)) return;
    const mutationContext = currentMutationContext();
    if (!mutationContext) return;
    if (!confirm(t("Delete this API resource scope?"))) return;
    const operation = mutationTracker.begin(mutationContext);
    error = null;
    let deletionMayHaveCommitted = false;
    try {
      if (!stageScopeDelete(scopeId, operation.ownerContext.resourceId)) return;
      try {
        await deleteResourceScope(operation.ownerContext.resourceId, scopeId);
        deletionMayHaveCommitted = true;
      } catch (requestError) {
        if (!mutationOutcomeUnknown(requestError)) throw requestError;
        deletionMayHaveCommitted = true;
      }
      const readBack = await getResource(operation.ownerContext.resourceId);
      const scopes = verifiedResourceScopes(
        readBack,
        operation.ownerContext.resourceId,
      );
      if (scopes.some((scope) => scope.id === scopeId)) {
        if (isCurrentMutation(operation)) {
          error = new Error(
            t(
              "Scope deletion could not be verified. Reconcile the authoritative scope list before deleting again.",
            ),
          );
        }
        return;
      }
      if (!clearScopeDelete(scopeId, operation.ownerContext.resourceId)) return;
      if (isCurrentMutation(operation)) resource = readBack;
    } catch (requestError) {
      if (isCurrentMutation(operation)) {
        error = deletionMayHaveCommitted
          ? new Error(
              t(
                "Scope deletion read-back failed. Reconcile the authoritative scope list before deleting again.",
              ),
            )
          : requestError;
      }
      if (!deletionMayHaveCommitted) {
        clearScopeDelete(scopeId, operation.ownerContext.resourceId);
      }
    } finally {
      mutationTracker.finish(operation);
    }
  }

  let lastLoadKey = "";
  $effect(() => {
    const loadKey = `${resourceId}:${activeTab}`;
    if (!resourceId || loadKey === lastLoadKey) return;
    lastLoadKey = loadKey;
    void loadResource();
  });
  onMount(restoreMutationLocks);
</script>

<div class="mb-5">
  <a
    href={resolve("/api-resources")}
    class="text-sm font-medium text-brand-700 hover:text-brand-900"
    >← {t("API Resources")}</a
  >
  <h2 class="mt-4 text-3xl font-bold text-surface-950">
    {resource?.name || resourceId}
  </h2>
  <p class="mt-1 font-mono text-xs text-surface-500">
    {resource?.indicator || resourceId}
  </p>
</div>

{#if mutationStorageError}
  <div
    class="mb-4 rounded-lg border border-red-300 bg-red-50 p-4 text-sm text-red-800"
    role="alert"
  >
    {mutationStorageError}
  </div>
{/if}

<DetailTabs
  {tabs}
  {activeTab}
  basePath={`/api-resources/${encodeURIComponent(resourceId)}`}
/>

<RequestState {loading} {error} onRetry={loadResource}>
  {#if activeTab === "general"}
    <section class="console-card p-6">
      <h3 class="text-lg font-semibold text-surface-900">
        {t("detail.general")}
      </h3>
      <div class="mt-4 grid gap-4 md:grid-cols-2">
        <div>
          <label
            for="resource-name"
            class="mb-1 block text-sm font-medium text-surface-700"
            >{t("Name")}</label
          ><input
            id="resource-name"
            bind:value={resourceForm.name}
            class="w-full"
          />
        </div>
        <div>
          <label
            for="resource-indicator"
            class="mb-1 block text-sm font-medium text-surface-700"
            >{t("Indicator (audience URL)")}</label
          ><input
            id="resource-indicator"
            bind:value={resourceForm.indicator}
            class="w-full"
          />
        </div>
      </div>
      <button
        disabled={saving ||
          !resourceForm.name.trim() ||
          !resourceForm.indicator.trim()}
        onclick={() =>
          runMutation((mutationContext) =>
            updateResource(mutationContext.resourceId, resourceForm),
          )}
        class="mt-5 rounded-lg bg-brand-600 px-4 py-2 text-sm font-medium text-white disabled:opacity-50"
        >{saving ? t("Saving...") : t("Save")}</button
      >
    </section>
  {:else}
    <div class="space-y-5">
      <section class="console-card p-5">
        <h3 class="font-semibold text-surface-900">{t("New Scope")}</h3>
        <div class="mt-4 grid gap-3 md:grid-cols-[1fr_1fr_auto]">
          <input bind:value={newScope.name} placeholder="read:orders" /><input
            bind:value={newScope.description}
            placeholder={t("Description")}
          /><button
            disabled={saving || !newScope.name.trim()}
            onclick={addScope}
            class="rounded-lg bg-brand-600 px-4 py-2 text-sm font-medium text-white disabled:opacity-50"
            >{t("Add")}</button
          >
        </div>
      </section>
      <RequestState
        empty={(resource?.scopes || []).length === 0}
        emptyTitle="No permissions"
        ><div class="space-y-3">
          {#each resource?.scopes || [] as scope (scope.id)}<div
              class="console-card flex items-start justify-between gap-4 p-4"
            >
              <div>
                <p class="font-mono text-sm font-semibold text-surface-900">
                  {scope.name}
                </p>
                <p class="mt-1 text-sm text-surface-500">
                  {scope.description || ""}
                </p>
              </div>
              <div class="flex gap-3">
                <button
                  disabled={saving || !mutationStorageReady}
                  onclick={() =>
                    runMutation((mutationContext) =>
                      updateResourceScope(mutationContext.resourceId, scope.id, {
                        name: scope.name,
                        description: scope.description,
                      }),
                    )}
                  class="text-sm text-brand-700">{t("Save")}</button
                ><button
                  disabled={saving ||
                    !mutationStorageReady ||
                    scopeDeleteUnknown(scope.id)}
                  onclick={() => deleteScope(scope.id)}
                  class="text-sm text-red-600 disabled:opacity-50"
                  >{t("Delete")}</button
                >
              </div>
            </div>
            {#if scopeDeleteUnknown(scope.id)}
              <div
                class="rounded-lg border border-amber-300 bg-amber-50 p-3 text-xs text-amber-900"
                role="alert"
              >
                <p>
                  {t(
                    "Scope deletion outcome is unknown. Reconcile the authoritative scope list before deleting again.",
                  )}
                </p>
                <button
                  onclick={() => acknowledgeScopeDelete(scope.id)}
                  class="mt-2 font-semibold underline"
                  >{t("I verified the scope list; allow delete again")}</button
                >
              </div>
            {/if}
          {/each}
        </div></RequestState
      >
      <section class="console-card p-5">
        <h3 class="font-semibold text-surface-900">{t("Applications")}</h3>
        <p class="mt-1 text-sm text-surface-500">
          {t("Applications using this resource cannot be deleted silently.")}
        </p>
        <div class="mt-4 space-y-2">
          {#each applications as application (application.client_id || application.application_id)}<a
              href={resolve(
                `/applications/${encodeURIComponent(application.client_id || application.application_id)}/settings`,
              )}
              class="block rounded-lg bg-surface-50 px-3 py-2 font-mono text-sm text-brand-700"
              >{application.client_name ||
                application.client_id ||
                application.application_id}</a
            >{/each}
        </div>
      </section>
    </div>
  {/if}
</RequestState>
