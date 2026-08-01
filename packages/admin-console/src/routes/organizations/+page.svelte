<script>
  import { onMount } from "svelte";
  import { resolve } from "$app/paths";
  import RequestState from "$lib/components/RequestState.svelte";
  import {
    createOrganization,
    deleteOrganization,
    getOrganization,
    listOrganizations,
  } from "$lib/api/client.js";
  import { t } from "$lib/i18n.js";
  import {
    collectionPage,
    createKeyedSingleFlightTracker,
    createLatestRequestTracker,
    emptyCollectionFallbackPage,
    mutationOutcomeUnknown,
  } from "$lib/resource-page.js";

  const ORGANIZATION_MUTATION_LOCKS_KEY =
    "supaoauth.admin.organization-mutation-locks.v1";
  const ORGANIZATION_MUTATION_ACTIONS = new Set(["create", "delete"]);
  const ORGANIZATION_MUTATION_LOCK_FIELDS = new Set([
    "action",
    "recordedAt",
    "resourceId",
  ]);

  let organizations = $state([]);
  let loading = $state(true);
  let error = $state(null);
  let showCreate = $state(false);
  let newOrganization = $state({ name: "", description: "" });
  let search = $state("");
  let searchDraft = $state("");
  let currentPage = $state(1);
  let pageLimit = $state(25);
  let totalOrganizations = $state(0);
  let organizationMutationLocks = $state({});
  let organizationMutationPending = $state({});
  let mutationStorageReady = $state(false);
  let mutationStorageError = $state(null);
  const organizationUnverifiedMutations = $derived(
    Object.entries(organizationMutationLocks).filter(
      ([mutationKey]) => !organizationMutationPending[mutationKey],
    ),
  );
  const organizationRequests = createLatestRequestTracker();
  const organizationMutationTracker = createKeyedSingleFlightTracker();

  function organizationMutationKey(action, resourceId) {
    return `${action}:${resourceId}`;
  }

  function validOrganizationMutationLock(mutationKey, lock) {
    if (!lock || typeof lock !== "object" || Array.isArray(lock)) return false;
    const lockFields = Object.keys(lock);
    return (
      lockFields.length === ORGANIZATION_MUTATION_LOCK_FIELDS.size &&
      lockFields.every((field) =>
        ORGANIZATION_MUTATION_LOCK_FIELDS.has(field),
      ) &&
      ORGANIZATION_MUTATION_ACTIONS.has(lock.action) &&
      typeof lock.resourceId === "string" &&
      Boolean(lock.resourceId) &&
      Number.isSafeInteger(lock.recordedAt) &&
      lock.recordedAt > 0 &&
      (lock.action !== "create" || lock.resourceId === "new") &&
      mutationKey === organizationMutationKey(lock.action, lock.resourceId)
    );
  }

  function parseOrganizationMutationLocks(serializedLocks) {
    if (serializedLocks === null) return {};
    let storedLocks;
    try {
      storedLocks = JSON.parse(serializedLocks);
    } catch (parseError) {
      if (parseError instanceof SyntaxError) return null;
      throw parseError;
    }
    if (!storedLocks || typeof storedLocks !== "object" || Array.isArray(storedLocks)) {
      return null;
    }
    return Object.entries(storedLocks).every(([key, lock]) =>
      validOrganizationMutationLock(key, lock),
    )
      ? storedLocks
      : null;
  }

  function mutationStorageFailure() {
    mutationStorageReady = false;
    mutationStorageError = t("mutation.storageUnavailable", {
      resource: t("organizations.title"),
    });
  }

  function restoreOrganizationMutationLocks() {
    try {
      const storedLocks = parseOrganizationMutationLocks(
        globalThis.localStorage.getItem(ORGANIZATION_MUTATION_LOCKS_KEY),
      );
      if (!storedLocks) return mutationStorageFailure();
      organizationMutationLocks = storedLocks;
      mutationStorageReady = true;
      mutationStorageError = null;
    } catch {
      mutationStorageFailure();
    }
  }

  function persistOrganizationMutationLocks(nextLocks) {
    try {
      globalThis.localStorage.setItem(
        ORGANIZATION_MUTATION_LOCKS_KEY,
        JSON.stringify(nextLocks),
      );
      return true;
    } catch {
      mutationStorageFailure();
      return false;
    }
  }

  function stageOrganizationMutation(operation) {
    const context = operation.ownerContext;
    const nextLocks = {
      ...organizationMutationLocks,
      [operation.key]: { ...context, recordedAt: Date.now() },
    };
    if (!persistOrganizationMutationLocks(nextLocks)) return false;
    organizationMutationLocks = nextLocks;
    return true;
  }

  function clearOrganizationMutationLock(context) {
    const nextLocks = { ...organizationMutationLocks };
    delete nextLocks[
      organizationMutationKey(context.action, context.resourceId)
    ];
    if (!persistOrganizationMutationLocks(nextLocks)) return false;
    organizationMutationLocks = nextLocks;
    return true;
  }

  function organizationResourcePending(resourceId) {
    const ownsResource = (entry) => entry.resourceId === resourceId;
    return Object.values(organizationMutationPending).some(ownsResource);
  }

  function organizationResourceBusy(resourceId) {
    const ownsResource = (entry) => entry.resourceId === resourceId;
    return (
      organizationResourcePending(resourceId) ||
      Object.values(organizationMutationLocks).some(ownsResource)
    );
  }

  function beginOrganizationMutation(ownerContext) {
    if (
      !mutationStorageReady ||
      organizationResourceBusy(ownerContext.resourceId)
    ) {
      return null;
    }
    const mutationKey = organizationMutationKey(
      ownerContext.action,
      ownerContext.resourceId,
    );
    const operation = organizationMutationTracker.begin(
      mutationKey,
      ownerContext,
    );
    if (!operation) return null;
    organizationMutationPending = {
      ...organizationMutationPending,
      [mutationKey]: {
        ...ownerContext,
        operationGeneration: operation.generation,
      },
    };
    return operation;
  }

  function finishOrganizationMutation(operation) {
    organizationMutationTracker.finish(operation);
    if (
      organizationMutationPending[operation.key]?.operationGeneration !==
      operation.generation
    )
      return;
    const nextPending = { ...organizationMutationPending };
    delete nextPending[operation.key];
    organizationMutationPending = nextPending;
  }

  function acknowledgeOrganizationMutation(lock) {
    if (!mutationStorageReady) return;
    if (
      !confirm(
        t("mutation.verifyAuthoritative", {
          resource: t("organizations.title"),
        }),
      )
    )
      return;
    if (!confirm(t("mutation.allowRetry"))) return;
    clearOrganizationMutationLock(lock);
  }

  function organizationMutationUnknown() {
    error = t("mutation.outcomeUnknown");
  }

  async function submitOrganizationMutation(operation, writeCommand) {
    try {
      return await writeCommand();
    } catch (requestError) {
      if (mutationOutcomeUnknown(requestError)) {
        // 写入响应丢失时必须继续权威读回，不能把传输失败当作业务失败。
        return null;
      }
      clearOrganizationMutationLock(operation.ownerContext);
      throw requestError;
    }
  }

  function reportOrganizationMutationFailure(operation, requestError) {
    if (!organizationMutationTracker.isCurrent(operation)) return;
    if (organizationMutationLocks[operation.key]) organizationMutationUnknown();
    else error = requestError;
  }

  function organizationIdentity(payload) {
    const candidate = payload?.organization || payload;
    return typeof candidate?.id === "string" ? candidate.id : "";
  }

  function validatedOrganization(payload, expectedId) {
    const candidate = payload?.organization || payload;
    if (
      !candidate ||
      typeof candidate !== "object" ||
      Array.isArray(candidate) ||
      organizationIdentity(candidate) !== expectedId
    ) {
      throw new Error("Management API returned an invalid organization read-back");
    }
    return candidate;
  }

  function completeOrganizationSearch(response) {
    const page = collectionPage(response);
    if (
      !page.complete ||
      !page.items.every((organization) => organizationIdentity(organization))
    ) {
      throw new Error("Management API returned an incomplete organization search");
    }
    return page.items;
  }

  async function readCompleteOrganizationSearch(name) {
    return completeOrganizationSearch(
      await listOrganizations({ page: 1, limit: 100, search: name }),
    );
  }

  function createdOrganizationFromReadBack(
    organizationsReadBack,
    beforeOrganizationIds,
    response,
    name,
  ) {
    const responseId = organizationIdentity(response);
    const newMatches = organizationsReadBack.filter(
      (organization) =>
        !beforeOrganizationIds.has(organizationIdentity(organization)) &&
        organization.name === name,
    );
    if (responseId) {
      return (
        newMatches.find(
          (organization) => organizationIdentity(organization) === responseId,
        ) || null
      );
    }
    return newMatches.length === 1 ? newMatches[0] : null;
  }

  function organizationNotFound(requestError) {
    return (
      Number(requestError?.statusCode) === 404 ||
      requestError?.code === "not_found"
    );
  }

  async function organizationDeletedFromReadBack(organizationId) {
    try {
      validatedOrganization(
        await getOrganization(organizationId),
        organizationId,
      );
      return false;
    } catch (requestError) {
      if (organizationNotFound(requestError)) return true;
      throw requestError;
    }
  }

  async function loadOrganizations() {
    const request = organizationRequests.begin("organizations", {
      page: currentPage,
      limit: pageLimit,
      search,
    });
    loading = true;
    error = null;
    try {
      const page = collectionPage(
        await listOrganizations(request.ownerContext),
      );
      if (!organizationRequests.isCurrent(request)) return;
      const fallbackPage = emptyCollectionFallbackPage(
        page,
        request.ownerContext.page,
      );
      if (fallbackPage) {
        currentPage = fallbackPage;
        await loadOrganizations();
        return;
      }
      organizations = page.items;
      totalOrganizations = page.total;
      currentPage = page.page;
      pageLimit = page.limit;
    } catch (requestError) {
      if (organizationRequests.isCurrent(request)) error = requestError;
    } finally {
      if (organizationRequests.isCurrent(request)) loading = false;
    }
  }

  function applySearch(event) {
    event.preventDefault();
    search = searchDraft.trim();
    currentPage = 1;
    void loadOrganizations();
  }

  function changePage(nextPage) {
    currentPage = nextPage;
    void loadOrganizations();
  }

  async function createNewOrganization() {
    const draft = {
      ...newOrganization,
      name: newOrganization.name.trim(),
    };
    if (!draft.name) return;
    const operation = beginOrganizationMutation({
      action: "create",
      resourceId: "new",
    });
    if (!operation) return;
    error = null;
    try {
      const beforeOrganizations = await readCompleteOrganizationSearch(
        draft.name,
      );
      if (!organizationMutationTracker.isCurrent(operation)) return;
      const beforeOrganizationIds = new Set(
        beforeOrganizations.map(organizationIdentity),
      );
      if (!stageOrganizationMutation(operation)) return;
      const createResponse = await submitOrganizationMutation(operation, () =>
        createOrganization(draft),
      );
      if (!organizationMutationTracker.isCurrent(operation)) return;
      const organizationsReadBack = await readCompleteOrganizationSearch(
        draft.name,
      );
      if (!organizationMutationTracker.isCurrent(operation)) return;
      const createdOrganization = createdOrganizationFromReadBack(
        organizationsReadBack,
        beforeOrganizationIds,
        createResponse,
        draft.name,
      );
      if (!createdOrganization) return organizationMutationUnknown();
      if (!clearOrganizationMutationLock(operation.ownerContext)) return;
      newOrganization = { name: "", description: "" };
      showCreate = false;
      search = "";
      searchDraft = "";
      currentPage = 1;
      await loadOrganizations();
    } catch (requestError) {
      reportOrganizationMutationFailure(operation, requestError);
    } finally {
      finishOrganizationMutation(operation);
    }
  }

  async function removeOrganization(organizationId) {
    if (!confirm(t("organizations.deleteConfirm"))) return;
    const operation = beginOrganizationMutation({
      action: "delete",
      resourceId: organizationId,
    });
    if (!operation) return;
    error = null;
    try {
      if (!stageOrganizationMutation(operation)) return;
      await submitOrganizationMutation(operation, () =>
        deleteOrganization(organizationId),
      );
      if (!organizationMutationTracker.isCurrent(operation)) return;
      const deletionConfirmed = await organizationDeletedFromReadBack(
        organizationId,
      );
      if (!organizationMutationTracker.isCurrent(operation)) return;
      if (!deletionConfirmed) return organizationMutationUnknown();
      if (!clearOrganizationMutationLock(operation.ownerContext)) return;
      await loadOrganizations();
    } catch (requestError) {
      reportOrganizationMutationFailure(operation, requestError);
    } finally {
      finishOrganizationMutation(operation);
    }
  }

  onMount(() => {
    restoreOrganizationMutationLocks();
    void loadOrganizations();
  });
</script>

<div class="mb-6 flex items-start justify-between gap-4">
  <div>
    <h2 class="text-3xl font-bold text-surface-950">
      {t("organizations.title")}
    </h2>
    <p class="mt-2 text-sm text-surface-500">{t("organizations.noDataHint")}</p>
  </div>
  <div class="flex flex-wrap items-center justify-end gap-2">
    <form onsubmit={applySearch} class="flex items-center gap-2">
      <input
        bind:value={searchDraft}
        aria-label={t("organizations.searchPlaceholder")}
        placeholder={t("organizations.searchPlaceholder")}
        class="w-64 max-w-full rounded-lg border border-surface-300 px-3 py-2 text-sm"
      />
      <button
        type="submit"
        class="rounded-lg border border-surface-300 px-3 py-2 text-sm font-medium text-surface-700 hover:bg-surface-50"
        >{t("Apply")}</button
      >
    </form>
    <button
      type="button"
      disabled={!showCreate &&
        (!mutationStorageReady || organizationResourceBusy("new"))}
      onclick={() => (showCreate = !showCreate)}
      class="rounded-lg bg-brand-600 px-4 py-2 text-sm font-medium text-white hover:bg-brand-700 disabled:cursor-not-allowed disabled:opacity-50"
      >{showCreate ? t("common.cancel") : `+ ${t("organizations.new")}`}</button
    >
  </div>
</div>

{#if mutationStorageError}
  <div
    class="mb-4 rounded-lg border border-red-200 bg-red-50 p-4 text-sm text-red-800"
    role="alert"
  >
    {mutationStorageError}
  </div>
{/if}

{#if organizationUnverifiedMutations.length}
  <section class="console-card mb-4 border-amber-200 bg-amber-50 p-4">
    <h3 class="font-semibold text-amber-900">{t("mutation.reconcile")}</h3>
    <p class="mt-1 text-sm text-amber-800">{t("mutation.outcomeUnknown")}</p>
    <div class="mt-3 grid gap-2">
      {#each organizationUnverifiedMutations as [mutationKey, lock] (mutationKey)}
        <div
          class="flex flex-wrap items-center justify-between gap-3 rounded-lg border border-amber-200 bg-white px-3 py-2"
        >
          <code class="break-all text-xs text-surface-700">
            {t("mutation.pending", {
              action: lock.action,
              resourceId: lock.resourceId,
            })}
          </code>
          <button
            type="button"
            disabled={!mutationStorageReady ||
              organizationResourcePending(lock.resourceId)}
            onclick={() => acknowledgeOrganizationMutation(lock)}
            class="shrink-0 rounded-lg border border-amber-300 px-3 py-1.5 text-xs font-semibold text-amber-900 hover:bg-amber-100 disabled:cursor-not-allowed disabled:opacity-50"
            >{t("mutation.allowRetry")}</button
          >
        </div>
      {/each}
    </div>
  </section>
{/if}

{#if showCreate}
  <section class="console-card mb-6 p-6">
    <h3 class="text-lg font-semibold text-surface-900">
      {t("organizations.new")}
    </h3>
    <div class="mt-4 grid gap-4 md:grid-cols-2">
      <div>
        <label
          for="org-name"
          class="mb-1 block text-sm font-medium text-surface-700"
          >{t("organizations.name")}</label
        ><input
          id="org-name"
          bind:value={newOrganization.name}
          class="w-full"
        />
      </div>
      <div>
        <label
          for="org-description"
          class="mb-1 block text-sm font-medium text-surface-700"
          >{t("organizations.description")}</label
        ><input
          id="org-description"
          bind:value={newOrganization.description}
          class="w-full"
        />
      </div>
    </div>
    <button
      disabled={!newOrganization.name.trim() ||
        !mutationStorageReady ||
        organizationResourceBusy("new")}
      onclick={createNewOrganization}
      class="mt-4 rounded-lg bg-brand-600 px-4 py-2 text-sm font-medium text-white hover:bg-brand-700 disabled:cursor-not-allowed disabled:opacity-50"
      >{t("organizations.create")}</button
    >
  </section>
{/if}

<RequestState
  {loading}
  {error}
  empty={organizations.length === 0}
  emptyTitle="organizations.noData"
  emptyDescription="organizations.noDataHint"
  onRetry={loadOrganizations}
>
  <div class="grid gap-4 lg:grid-cols-2">
    {#each organizations as organization (organization.id)}
      <article class="console-card console-card-hover p-5">
        <div class="flex items-start justify-between gap-4">
          <a
            href={resolve(
              `/organizations/${encodeURIComponent(organization.id)}/settings`,
            )}
            class="min-w-0"
          >
            <h3 class="truncate font-semibold text-surface-950">
              {organization.name}
            </h3>
            <p class="mt-1 line-clamp-2 text-sm text-surface-500">
              {organization.description ||
                t("organizations.optionalDescription")}
            </p>
            <p class="mt-3 font-mono text-xs text-surface-400">
              {organization.id}
            </p>
          </a>
          <button
            type="button"
            disabled={!mutationStorageReady ||
              organizationResourceBusy(organization.id)}
            onclick={() => removeOrganization(organization.id)}
            class="text-sm font-medium text-red-600 hover:text-red-800 disabled:cursor-not-allowed disabled:opacity-50"
            >{t("organizations.delete")}</button
          >
        </div>
      </article>
    {/each}
  </div>
  <div class="mt-5 flex flex-wrap items-center justify-between gap-3">
    <p class="text-sm text-surface-500">
      {t("organizations.resultCount", { count: totalOrganizations })}
    </p>
    <div class="flex items-center gap-3">
      <span class="text-sm text-surface-500">
        {t("pagination.pageOf", {
          page: currentPage,
          pages: Math.max(1, Math.ceil(totalOrganizations / pageLimit)),
        })}
      </span>
      <button
        onclick={() => changePage(currentPage - 1)}
        disabled={loading || currentPage <= 1}
        class="rounded-lg border border-surface-300 px-3 py-1.5 text-sm font-medium text-surface-700 disabled:cursor-not-allowed disabled:opacity-40"
        >{t("audit.previousPage")}</button
      >
      <button
        onclick={() => changePage(currentPage + 1)}
        disabled={loading || currentPage * pageLimit >= totalOrganizations}
        class="rounded-lg border border-surface-300 px-3 py-1.5 text-sm font-medium text-surface-700 disabled:cursor-not-allowed disabled:opacity-40"
        >{t("audit.nextPage")}</button
      >
    </div>
  </div>
</RequestState>
