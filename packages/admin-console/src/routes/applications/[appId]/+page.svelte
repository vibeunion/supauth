<script>
  import { onMount } from "svelte";
  import { goto } from "$app/navigation";
  import { resolve } from "$app/paths";
  import { page } from "$app/state";
  import DetailTabs from "$lib/components/DetailTabs.svelte";
  import RequestState from "$lib/components/RequestState.svelte";
  import OneTimeSecret from "$lib/components/OneTimeSecret.svelte";
  import { AdminApiError } from "$lib/admin-api.js";
  import { t } from "$lib/i18n.js";
  import { createDurableMutationLockStore } from "$lib/mutation-reconciliation.js";
  import {
    GOTRUE_OAUTH_GRANT_TYPES,
    supportedOAuthGrantTypes,
  } from "$lib/oauth-grant-types.js";
  import {
    applicationDetailTabValues,
    collectionItems,
    completeCollectionItems,
    createOperationTracker,
    isLatestResourceLoad,
    mutationOutcomeUnknown,
    tabFromRoute,
  } from "$lib/resource-page.js";
  import {
    createApplicationBinding,
    deleteApplication,
    deleteApplicationBinding,
    deleteApplicationSignInExperience,
    getApplication,
    getApplicationAccessControl,
    getApplicationConsent,
    getApplicationSignInExperience,
    listApplications,
    listApplicationBindings,
    listApplicationLogs,
    listApplicationOrganizations,
    listApplicationRoles,
    listResources,
    rotateApplicationSecret,
    updateApplication,
    updateApplicationAccessControl,
    updateApplicationConsent,
    updateApplicationSignInExperience,
  } from "$lib/api/client.js";

  const allTabs = [
    { value: "settings", labelKey: "detail.settings" },
    { value: "roles", labelKey: "detail.roles" },
    { value: "logs", labelKey: "detail.logs" },
    { value: "branding", labelKey: "detail.branding" },
    { value: "permissions", labelKey: "detail.permissions" },
    { value: "rules", labelKey: "detail.rules" },
    { value: "organizations", labelKey: "detail.organizations" },
  ];
  const confidentialAuthMethods = ["client_secret_basic", "client_secret_post"];
  const APPLICATION_LOCK_OWNER = "applications";
  const applicationMutationLockStore = createDurableMutationLockStore({
    storageKey: "supaoauth.admin.application-mutation-locks.v2",
    allowedActions: ["clear-sign-in", "create", "delete", "rotate", "unbind"],
    storageProvider: () => globalThis.localStorage,
    legacyStorageKeys: ["supaoauth.admin.application-mutation-locks.v1"],
  });

  let application = $state(null);
  let displayedAuthMethods = $derived(
    application?.client_type === "public" ? ["none"] : confidentialAuthMethods,
  );
  let roles = $state([]);
  let logs = $state([]);
  let organizations = $state([]);
  let bindings = $state([]);
  let resources = $state([]);
  let applicationForm = $state({
    client_name: "",
    redirect_uris: "",
    grant_types: [],
    token_endpoint_auth_method: "client_secret_basic",
  });
  let branding = $state({
    enabled: false,
    page_title: "",
    primary_color: "",
    logo_url: "",
    favicon_url: "",
    background_url: "",
    button_label: "",
    custom_css: "",
  });
  let consent = $state({
    user_scopes: "",
    organization_scopes: "",
    allowed_organization_ids: "",
    require_explicit_consent: true,
  });
  let accessControl = $state({
    enabled: false,
    organization_required: false,
    allowed_organization_ids: [],
  });
  let newBinding = $state({ resource_id: "", scope_id: "" });
  let revealedSecret = $state("");
  let applicationMutationLocks = $state({});
  let mutationStorageReady = $state(false);
  let mutationStorageError = $state(null);
  let loading = $state(true);
  let saving = $state(false);
  const mutationTracker = createOperationTracker((pending) => {
    saving = pending;
  });
  let error = $state(null);
  let appId = $derived(page.params.appId);
  let requestedTab = $derived(page.params.tab || "settings");
  let loadGeneration = 0;
  let loadedApplicationContext = $state(null);
  let tabs = $derived(applicationTabs());
  let activeTab = $derived(
    tabFromRoute(
      requestedTab,
      tabs.map((tab) => tab.value),
      "settings",
    ),
  );
  let tabError = $derived(
    application && activeTab !== requestedTab
      ? new AdminApiError(t("state.notFoundDescription"), 404, "not_found")
      : null,
  );
  let rotationOutcomeUnknown = $derived(
    applicationMutationLocked("rotate", appId),
  );
  let deletionOutcomeUnknown = $derived(
    applicationMutationLocked("delete", appId),
  );
  let clearSignInOutcomeUnknown = $derived(
    applicationMutationLocked("clear-sign-in", appId),
  );

  function mutationStorageFailure() {
    mutationStorageReady = false;
    mutationStorageError = t(
      "Mutation reconciliation storage is unavailable. High-impact application actions are blocked.",
    );
  }

  function applicationMutationDescriptor(action, targetId) {
    return { action, ownerId: APPLICATION_LOCK_OWNER, targetId };
  }

  function updateApplicationMutationLocks(lockCommand) {
    try {
      applicationMutationLocks = lockCommand();
      mutationStorageReady = true;
      mutationStorageError = null;
      return true;
    } catch {
      mutationStorageFailure();
      return false;
    }
  }

  function restoreApplicationMutationLocks() {
    updateApplicationMutationLocks(() => applicationMutationLockStore.restore());
  }

  function stageApplicationMutation(action, targetId) {
    return updateApplicationMutationLocks(() =>
      applicationMutationLockStore.stage(
        applicationMutationLocks,
        applicationMutationDescriptor(action, targetId),
      ),
    );
  }

  function clearApplicationMutationLock(action, targetId) {
    return updateApplicationMutationLocks(() =>
      applicationMutationLockStore.clear(
        applicationMutationLocks,
        applicationMutationDescriptor(action, targetId),
      ),
    );
  }

  function recordApplicationMutationUnknown(action, targetId) {
    if (applicationMutationLocked(action, targetId)) return true;
    return stageApplicationMutation(action, targetId);
  }

  function applicationMutationLocked(action, targetId) {
    return applicationMutationLockStore.isLocked(
      applicationMutationLocks,
      applicationMutationDescriptor(action, targetId),
    );
  }

  function acknowledgeApplicationMutation(action, resourceId) {
    if (!confirm(t("I have verified the authoritative application state."))) return;
    if (!confirm(t("Allow this high-impact application action to run again?"))) return;
    clearApplicationMutationLock(action, resourceId);
  }

  function applicationIdentity(applicationResponse) {
    const identity = applicationResponse?.client_id || applicationResponse?.id;
    return typeof identity === "string" ? identity : "";
  }

  function completeApplicationList(response) {
    const listedApplications = completeCollectionItems(response);
    if (listedApplications.every((entry) => applicationIdentity(entry))) {
      return listedApplications;
    }
    throw new Error("Management API returned an application without an identity");
  }

  function bindingMutationResourceId(bindingId) {
    return `${appId}:${bindingId}`;
  }

  function completeBindingList(response) {
    const listedBindings = completeCollectionItems(response);
    if (listedBindings.every((binding) => typeof binding?.id === "string")) {
      return listedBindings;
    }
    throw new Error("Management API returned a binding without an identity");
  }

  function signInOverrideCleared(response, ownerId) {
    if (
      response?.application_id !== ownerId ||
      response?.enabled !== false ||
      response?._meta
    )
      return false;
    const brandingValues = Object.values(response.branding || {});
    return brandingValues.length >= 7 && brandingValues.every((entry) => entry == null);
  }

  function reconciliationError(message) {
    return new Error(t(message));
  }

  function applicationTabs() {
    if (!application) return allTabs.filter((tab) => tab.value === "settings");
    const availableTabs = new Set(applicationDetailTabValues(application));
    return allTabs.filter((tab) => availableTabs.has(tab.value));
  }

  function timestamp(value) {
    return value ? new Date(value).toLocaleString() : t("common.notAvailable");
  }

  function stringList(rawValues) {
    return rawValues
      .split(",")
      .map((entry) => entry.trim())
      .filter(Boolean);
  }

  function initializeApplicationForm(applicationResponse) {
    applicationForm = {
      client_name: applicationResponse.client_name || "",
      redirect_uris: (applicationResponse.redirect_uris || []).join(", "),
      grant_types: supportedOAuthGrantTypes(applicationResponse.grant_types),
      token_endpoint_auth_method:
        applicationResponse.token_endpoint_auth_method || "client_secret_basic",
    };
  }

  function initializeConsent(consentResponse) {
    consent = {
      user_scopes: (
        consentResponse.userScopes ||
        consentResponse.user_scopes ||
        []
      ).join(", "),
      organization_scopes: (
        consentResponse.organizationScopes ||
        consentResponse.organization_scopes ||
        []
      ).join(", "),
      allowed_organization_ids: (
        consentResponse.allowedOrganizationIds ||
        consentResponse.allowed_organization_ids ||
        []
      ).join(", "),
      require_explicit_consent:
        consentResponse.requireExplicitConsent ??
        consentResponse.require_explicit_consent ??
        true,
    };
  }

  function initializeBranding(brandingResponse) {
    branding = {
      ...branding,
      enabled: brandingResponse.enabled ?? false,
      ...(brandingResponse.branding || {}),
    };
  }

  function initializeAccessControl(accessControlResponse) {
    accessControl = { ...accessControl, ...accessControlResponse };
  }

  function resetRelatedData() {
    roles = [];
    logs = [];
    organizations = [];
    bindings = [];
    resources = [];
  }

  function currentLoadContext() {
    return { generation: loadGeneration, resourceId: appId, tab: requestedTab };
  }

  function isCurrentLoad(loadContext) {
    return isLatestResourceLoad(loadContext, currentLoadContext());
  }

  function currentMutationContext() {
    return loadedApplicationContext && isCurrentLoad(loadedApplicationContext)
      ? loadedApplicationContext
      : null;
  }

  function isCurrentMutation(operation) {
    return (
      mutationTracker.isCurrent(operation) &&
      isCurrentLoad(operation.ownerContext)
    );
  }

  async function loadActiveTab(loadContext, loadTab) {
    if (loadTab === "roles") {
      const roleResponse = await listApplicationRoles(loadContext.resourceId);
      if (isCurrentLoad(loadContext)) roles = collectionItems(roleResponse);
    } else if (loadTab === "logs") {
      const logResponse = await listApplicationLogs(loadContext.resourceId, {
        limit: 50,
      });
      if (isCurrentLoad(loadContext)) logs = collectionItems(logResponse);
    } else if (loadTab === "organizations") {
      const organizationResponse = await listApplicationOrganizations(
        loadContext.resourceId,
      );
      if (isCurrentLoad(loadContext)) {
        organizations = collectionItems(organizationResponse);
      }
    } else if (loadTab === "branding") {
      const brandingResponse = await getApplicationSignInExperience(
        loadContext.resourceId,
      );
      if (isCurrentLoad(loadContext)) initializeBranding(brandingResponse);
    } else if (loadTab === "rules") {
      const accessControlResponse = await getApplicationAccessControl(
        loadContext.resourceId,
      );
      if (isCurrentLoad(loadContext)) {
        initializeAccessControl(accessControlResponse);
      }
    } else if (loadTab === "permissions") {
      const [bindingResponse, resourceResponse, consentResponse] =
        await Promise.all([
          listApplicationBindings(loadContext.resourceId),
          listResources(),
          getApplicationConsent(loadContext.resourceId),
        ]);
      if (isCurrentLoad(loadContext)) {
        bindings = collectionItems(bindingResponse);
        resources = collectionItems(resourceResponse);
        initializeConsent(consentResponse);
      }
    }
  }

  async function loadApplication() {
    return loadApplicationData();
  }

  async function loadApplicationData() {
    const loadContext = {
      generation: loadGeneration + 1,
      resourceId: appId,
      tab: requestedTab,
    };
    loadGeneration = loadContext.generation;
    loadedApplicationContext = null;
    loading = true;
    error = null;
    application = null;
    revealedSecret = "";
    resetRelatedData();
    try {
      const applicationResponse = await getApplication(loadContext.resourceId);
      if (!isCurrentLoad(loadContext)) return;
      application = applicationResponse;
      initializeApplicationForm(applicationResponse);
      const loadTab = tabFromRoute(
        loadContext.tab,
        applicationDetailTabValues(applicationResponse),
        "settings",
      );
      await loadActiveTab(loadContext, loadTab);
      if (isCurrentLoad(loadContext)) loadedApplicationContext = loadContext;
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
      if (isCurrentMutation(operation)) await loadApplicationData();
    } catch (requestError) {
      if (isCurrentMutation(operation)) error = requestError;
    } finally {
      mutationTracker.finish(operation);
    }
  }

  function saveApplication() {
    return runMutation((ownerId) =>
      updateApplication(ownerId, {
        client_name: applicationForm.client_name,
        redirect_uris: stringList(applicationForm.redirect_uris),
        grant_types: applicationForm.grant_types,
        token_endpoint_auth_method:
          application.client_type === "public"
            ? "none"
            : applicationForm.token_endpoint_auth_method,
      }),
    );
  }

  function saveConsent() {
    return runMutation((ownerId) =>
      updateApplicationConsent(ownerId, {
        user_scopes: stringList(consent.user_scopes),
        organization_scopes: stringList(consent.organization_scopes),
        allowed_organization_ids: stringList(consent.allowed_organization_ids),
        require_explicit_consent: consent.require_explicit_consent,
      }),
    );
  }

  function saveBranding() {
    const { enabled, ...brandingValues } = branding;
    return runMutation((ownerId) =>
      updateApplicationSignInExperience(ownerId, {
        enabled,
        branding: brandingValues,
      }),
    );
  }

  async function rotateSecret() {
    if (saving) return;
    if (!mutationStorageReady || rotationOutcomeUnknown) return;
    const mutationContext = currentMutationContext();
    if (!mutationContext) return;
    if (
      !confirm(
        t("Rotate client secret? The old secret will be invalidated immediately."),
      )
    )
      return;
    const operation = mutationTracker.begin(mutationContext);
    if (!stageApplicationMutation("rotate", operation.ownerContext.resourceId)) {
      mutationTracker.finish(operation);
      return;
    }
    revealedSecret = "";
    error = null;
    let rotationAccepted = false;
    try {
      let response;
      try {
        response = await rotateApplicationSecret(operation.ownerContext.resourceId);
        rotationAccepted = true;
      } catch (requestError) {
        if (!mutationOutcomeUnknown(requestError)) throw requestError;
        recordApplicationMutationUnknown(
          "rotate",
          operation.ownerContext.resourceId,
        );
        if (isCurrentMutation(operation)) {
          error = reconciliationError(
            "Secret rotation outcome is unknown. Reconcile the credential before allowing another rotation.",
          );
        }
        return;
      }
      const readBack = await getApplication(operation.ownerContext.resourceId);
      const returnedSecret = response?.client_secret || response?.secret;
      const verified =
        applicationIdentity(readBack) === operation.ownerContext.resourceId &&
        typeof returnedSecret === "string" &&
        returnedSecret.length > 0 &&
        isCurrentMutation(operation);
      if (!verified) {
        recordApplicationMutationUnknown(
          "rotate",
          operation.ownerContext.resourceId,
        );
        if (isCurrentMutation(operation)) {
          error = reconciliationError(
            "Secret rotation could not be verified. Reconcile the credential before unlocking another rotation.",
          );
        }
        return;
      }
      if (!clearApplicationMutationLock("rotate", operation.ownerContext.resourceId)) {
        if (isCurrentMutation(operation)) {
          error = reconciliationError(
            "Secret rotation was verified but the reconciliation lock could not be cleared. Reconcile storage before trying again.",
          );
        }
        return;
      }
      revealedSecret = returnedSecret;
    } catch (requestError) {
      if (rotationAccepted) {
        recordApplicationMutationUnknown(
          "rotate",
          operation.ownerContext.resourceId,
        );
      } else {
        clearApplicationMutationLock("rotate", operation.ownerContext.resourceId);
      }
      if (isCurrentMutation(operation)) {
        error = rotationAccepted
          ? reconciliationError(
              "Secret rotation read-back failed. Reconcile the credential before unlocking another rotation.",
            )
          : requestError;
      }
    } finally {
      mutationTracker.finish(operation);
    }
  }

  async function removeApplication() {
    if (saving) return;
    if (!mutationStorageReady || deletionOutcomeUnknown) return;
    const mutationContext = currentMutationContext();
    if (!mutationContext) return;
    if (!confirm(t("Delete this application permanently?"))) return;
    const operation = mutationTracker.begin(mutationContext);
    if (!stageApplicationMutation("delete", operation.ownerContext.resourceId)) {
      mutationTracker.finish(operation);
      return;
    }
    error = null;
    let deletionMayHaveCommitted = false;
    try {
      try {
        await deleteApplication(operation.ownerContext.resourceId);
        deletionMayHaveCommitted = true;
      } catch (requestError) {
        if (!mutationOutcomeUnknown(requestError)) throw requestError;
        deletionMayHaveCommitted = true;
      }
      const response = await listApplications();
      const listedApplications = completeApplicationList(response);
      const stillPresent = listedApplications.some(
        (entry) =>
          applicationIdentity(entry) === operation.ownerContext.resourceId,
      );
      if (stillPresent) {
        recordApplicationMutationUnknown(
          "delete",
          operation.ownerContext.resourceId,
        );
        if (isCurrentMutation(operation)) {
          error = reconciliationError(
            "Application deletion could not be verified. Reconcile the authoritative list before deleting again.",
          );
        }
        return;
      }
      if (!clearApplicationMutationLock("delete", operation.ownerContext.resourceId)) {
        if (isCurrentMutation(operation)) {
          error = reconciliationError(
            "Application deletion was verified but the reconciliation lock could not be cleared. Reconcile storage before trying again.",
          );
        }
        return;
      }
      if (isCurrentMutation(operation)) await goto(resolve("/applications"));
    } catch (requestError) {
      if (deletionMayHaveCommitted) {
        recordApplicationMutationUnknown(
          "delete",
          operation.ownerContext.resourceId,
        );
      } else {
        clearApplicationMutationLock("delete", operation.ownerContext.resourceId);
      }
      if (isCurrentMutation(operation)) {
        error = deletionMayHaveCommitted
          ? reconciliationError(
              "Application deletion read-back failed. Reconcile the authoritative list before deleting again.",
            )
          : requestError;
      }
    } finally {
      mutationTracker.finish(operation);
    }
  }

  async function clearSignInOverride() {
    if (saving || !mutationStorageReady || clearSignInOutcomeUnknown) return;
    const mutationContext = currentMutationContext();
    if (!mutationContext) return;
    if (!confirm(t("Clear this application's sign-in experience override?"))) return;
    const operation = mutationTracker.begin(mutationContext);
    if (!stageApplicationMutation("clear-sign-in", operation.ownerContext.resourceId)) {
      mutationTracker.finish(operation);
      return;
    }
    error = null;
    let clearingMayHaveCommitted = false;
    try {
      try {
        await deleteApplicationSignInExperience(operation.ownerContext.resourceId);
        clearingMayHaveCommitted = true;
      } catch (requestError) {
        if (!mutationOutcomeUnknown(requestError)) throw requestError;
        clearingMayHaveCommitted = true;
      }
      const readBack = await getApplicationSignInExperience(
        operation.ownerContext.resourceId,
      );
      if (!signInOverrideCleared(readBack, operation.ownerContext.resourceId)) {
        recordApplicationMutationUnknown(
          "clear-sign-in",
          operation.ownerContext.resourceId,
        );
        if (isCurrentMutation(operation)) {
          error = reconciliationError(
            "Sign-in override clearing could not be verified. Reconcile the authoritative state before clearing again.",
          );
        }
        return;
      }
      if (!clearApplicationMutationLock(
        "clear-sign-in",
        operation.ownerContext.resourceId,
      )) {
        if (isCurrentMutation(operation)) {
          error = reconciliationError(
            "Sign-in override clearing was verified but the reconciliation lock could not be cleared. Reconcile storage before trying again.",
          );
        }
        return;
      }
      if (isCurrentMutation(operation)) initializeBranding(readBack);
    } catch (requestError) {
      if (clearingMayHaveCommitted) {
        recordApplicationMutationUnknown(
          "clear-sign-in",
          operation.ownerContext.resourceId,
        );
      } else {
        clearApplicationMutationLock(
          "clear-sign-in",
          operation.ownerContext.resourceId,
        );
      }
      if (isCurrentMutation(operation)) {
        error = clearingMayHaveCommitted
          ? reconciliationError(
              "Sign-in override read-back failed. Reconcile the authoritative state before clearing again.",
            )
          : requestError;
      }
    } finally {
      mutationTracker.finish(operation);
    }
  }

  async function unbindApplication(bindingId) {
    const mutationResourceId = bindingMutationResourceId(bindingId);
    if (
      saving ||
      !mutationStorageReady ||
      applicationMutationLocked("unbind", mutationResourceId)
    )
      return;
    const mutationContext = currentMutationContext();
    if (!mutationContext) return;
    if (!confirm(t("Unbind this API resource from the application?"))) return;
    const operation = mutationTracker.begin(mutationContext);
    if (!stageApplicationMutation("unbind", mutationResourceId)) {
      mutationTracker.finish(operation);
      return;
    }
    error = null;
    let unbindMayHaveCommitted = false;
    try {
      try {
        await deleteApplicationBinding(
          operation.ownerContext.resourceId,
          bindingId,
        );
        unbindMayHaveCommitted = true;
      } catch (requestError) {
        if (!mutationOutcomeUnknown(requestError)) throw requestError;
        unbindMayHaveCommitted = true;
      }
      const response = await listApplicationBindings(
        operation.ownerContext.resourceId,
      );
      const listedBindings = completeBindingList(response);
      if (listedBindings.some((binding) => binding.id === bindingId)) {
        recordApplicationMutationUnknown("unbind", mutationResourceId);
        if (isCurrentMutation(operation)) {
          error = reconciliationError(
            "Application unbind could not be verified. Reconcile the binding list before unbinding again.",
          );
        }
        return;
      }
      if (!clearApplicationMutationLock("unbind", mutationResourceId)) {
        if (isCurrentMutation(operation)) {
          error = reconciliationError(
            "Application unbind was verified but the reconciliation lock could not be cleared. Reconcile storage before trying again.",
          );
        }
        return;
      }
      if (isCurrentMutation(operation)) bindings = listedBindings;
    } catch (requestError) {
      if (unbindMayHaveCommitted) {
        recordApplicationMutationUnknown("unbind", mutationResourceId);
      } else {
        clearApplicationMutationLock("unbind", mutationResourceId);
      }
      if (isCurrentMutation(operation)) {
        error = unbindMayHaveCommitted
          ? reconciliationError(
              "Application binding read-back failed. Reconcile the binding list before unbinding again.",
            )
          : requestError;
      }
    } finally {
      mutationTracker.finish(operation);
    }
  }

  let lastLoadKey = "";
  $effect(() => {
    const loadKey = `${appId}:${requestedTab}`;
    if (!appId || loadKey === lastLoadKey) return;
    lastLoadKey = loadKey;
    void loadApplication();
  });

  onMount(restoreApplicationMutationLocks);
</script>

<div class="mb-5">
  <a
    href={resolve("/applications")}
    class="text-sm font-medium text-brand-700 hover:text-brand-900"
    >← {t("Back to Applications")}</a
  >
  <div class="mt-4 flex flex-wrap items-start justify-between gap-4">
    <div>
      <h2 class="text-3xl font-bold text-surface-950">
        {application?.client_name || appId}
      </h2>
      <p class="mt-1 font-mono text-xs text-surface-500">{appId}</p>
    </div>
    <button
      disabled={saving || !mutationStorageReady || deletionOutcomeUnknown}
      onclick={removeApplication}
      class="rounded-lg border border-red-200 px-3 py-2 text-sm font-semibold text-red-600 hover:bg-red-50 disabled:opacity-50"
      >{t("Delete")}</button
    >
  </div>
</div>

{#if mutationStorageError}
  <div
    class="mb-4 rounded-lg border border-red-200 bg-red-50 p-4 text-red-700"
    role="alert"
  >
    {mutationStorageError}
  </div>
{/if}

{#if deletionOutcomeUnknown}
  <div
    class="mb-4 rounded-lg border border-amber-300 bg-amber-50 p-4 text-sm text-amber-900"
    role="alert"
  >
    <p>
      {t(
        "Application deletion outcome is unknown. Reconcile the authoritative list before deleting again.",
      )}
    </p>
    <button
      onclick={() => acknowledgeApplicationMutation("delete", appId)}
      class="mt-3 font-semibold text-amber-950 underline"
      >{t("I verified the list; allow delete again")}</button
    >
  </div>
{/if}

<DetailTabs
  {tabs}
  {activeTab}
  basePath={`/applications/${encodeURIComponent(appId)}`}
/>

<RequestState {loading} error={error || tabError} onRetry={loadApplication}>
  {#if activeTab === "settings"}
    <div class="space-y-5">
      <section class="console-card p-6">
        <h3 class="text-lg font-semibold text-surface-900">
          {t("detail.settings")}
        </h3>
        <div class="mt-4 grid gap-4 md:grid-cols-2">
          <div>
            <label
              for="app-name"
              class="mb-1 block text-sm font-medium text-surface-700"
              >{t("Name")}</label
            ><input
              id="app-name"
              bind:value={applicationForm.client_name}
              class="w-full"
            />
          </div>
          <div>
            <label
              for="app-auth"
              class="mb-1 block text-sm font-medium text-surface-700"
              >{t("application.authMethod")}</label
            ><select
              id="app-auth"
              disabled={application.client_type === "public"}
              bind:value={applicationForm.token_endpoint_auth_method}
              class="w-full"
              >{#each displayedAuthMethods as authMethod (authMethod)}<option
                  value={authMethod}>{t(`application.authMethod.${authMethod}`)} ({authMethod})</option
                >{/each}</select
            >
          </div>
          <div>
            <label
              for="app-redirects"
              class="mb-1 block text-sm font-medium text-surface-700"
              >{t("Redirect URIs (comma-separated)")}</label
            ><input
              id="app-redirects"
              bind:value={applicationForm.redirect_uris}
              class="w-full"
            />
          </div>
          <div>
            <span class="mb-1 block text-sm font-medium text-surface-700"
              >{t("application.grantTypes")}</span
            >
            <div class="space-y-2 rounded-lg border border-surface-200 p-3">
              {#each GOTRUE_OAUTH_GRANT_TYPES as grantType (grantType)}
                <label class="flex items-center gap-2 text-sm text-surface-700">
                  <input
                    type="checkbox"
                    value={grantType}
                    bind:group={applicationForm.grant_types}
                  />
                  <span>{t(`application.grantType.${grantType}`)}</span>
                  <code class="text-xs text-surface-500">{grantType}</code>
                </label>
              {/each}
            </div>
          </div>
        </div>
        <button
          disabled={
            saving ||
            !applicationForm.client_name.trim() ||
            applicationForm.grant_types.length === 0
          }
          onclick={saveApplication}
          class="mt-5 rounded-lg bg-brand-600 px-4 py-2 text-sm font-medium text-white disabled:opacity-50"
          >{saving ? t("Saving...") : t("Save")}</button
        >
      </section>
      <section class="console-card p-6">
        <div class="flex items-start justify-between gap-3">
          <div>
            <h3 class="font-semibold text-surface-900">
              {t("application.secret.title")}
            </h3>
            <p class="mt-1 text-sm text-surface-500">
              {application.client_type === "public"
                ? t("application.secret.publicClient")
                : t("application.secret.confidentialClient")}
            </p>
          </div>
          {#if application.client_type !== "public"}
            <button
              disabled={saving || !mutationStorageReady || rotationOutcomeUnknown}
              onclick={rotateSecret}
              class="text-sm font-semibold text-brand-700 disabled:opacity-50"
              >{t("application.secret.rotate")}</button
            >
          {/if}
        </div>
        {#if revealedSecret}
          <OneTimeSecret secret={revealedSecret} />
        {/if}
        {#if rotationOutcomeUnknown}
          <div
            class="mt-4 rounded-lg border border-amber-300 bg-amber-50 p-4 text-sm text-amber-900"
            role="alert"
          >
            <p>
              {t(
                "Secret rotation outcome is unknown. Verify the client credential before allowing another rotation; this block survives reload.",
              )}
            </p>
            <button
              onclick={() => acknowledgeApplicationMutation("rotate", appId)}
              class="mt-3 font-semibold text-amber-950 underline"
              >{t("I verified the credential; allow rotation again")}</button
            >
          </div>
        {/if}
      </section>
    </div>
  {:else if activeTab === "roles"}
    <RequestState empty={roles.length === 0} emptyTitle="users.noRoles"
      ><div class="space-y-3">
        {#each roles as role (role.id || role.role_id)}<a
            href={resolve(
              `/roles/${encodeURIComponent(role.id || role.role_id)}/general`,
            )}
            class="console-card console-card-hover block p-4"
            ><p class="font-semibold text-surface-900">
              {role.name || role.role_name || role.role_id}
            </p>
            <p class="mt-1 text-sm text-surface-500">
              {role.description || ""}
            </p></a
          >{/each}
      </div></RequestState
    >
  {:else if activeTab === "logs"}
    <RequestState empty={logs.length === 0} emptyTitle="No audit log entries"
      ><div class="console-card overflow-hidden">
        <table>
          <thead
            ><tr
              ><th>{t("Time")}</th><th>{t("Event")}</th><th>{t("Actor")}</th
              ></tr
            ></thead
          ><tbody
            >{#each logs as log (log.id)}<tr
                ><td>{timestamp(log.created_at || log.createdAt)}</td><td
                  >{log.event_type || log.eventType}</td
                ><td>{log.actor_id || log.actorId || "-"}</td></tr
              >{/each}</tbody
          >
        </table>
      </div></RequestState
    >
  {:else if activeTab === "branding"}
    <section class="console-card p-6">
      <div class="flex items-center justify-between">
        <h3 class="text-lg font-semibold text-surface-900">
          {t("Application Login Experience")}
        </h3>
        <input type="checkbox" bind:checked={branding.enabled} />
      </div>
      <div class="mt-4 grid gap-4 md:grid-cols-2">
        <div>
          <label
            for="branding-title"
            class="mb-1 block text-sm font-medium text-surface-700"
            >{t("Page Title")}</label
          ><input
            id="branding-title"
            bind:value={branding.page_title}
            class="w-full"
          />
        </div>
        <div>
          <label
            for="branding-color"
            class="mb-1 block text-sm font-medium text-surface-700"
            >{t("Primary Color")}</label
          ><input
            id="branding-color"
            bind:value={branding.primary_color}
            class="w-full"
          />
        </div>
        <div>
          <label
            for="branding-logo"
            class="mb-1 block text-sm font-medium text-surface-700"
            >{t("Logo URL")}</label
          ><input
            id="branding-logo"
            bind:value={branding.logo_url}
            class="w-full"
          />
        </div>
        <div>
          <label
            for="branding-background"
            class="mb-1 block text-sm font-medium text-surface-700"
            >{t("Background URL")}</label
          ><input
            id="branding-background"
            bind:value={branding.background_url}
            class="w-full"
          />
        </div>
      </div>
      <button
        disabled={saving}
        onclick={saveBranding}
        class="mt-5 rounded-lg bg-brand-600 px-4 py-2 text-sm font-medium text-white disabled:opacity-50"
        >{saving ? t("Saving...") : t("Save")}</button
      ><button
        disabled={saving ||
          !mutationStorageReady ||
          clearSignInOutcomeUnknown}
        onclick={clearSignInOverride}
        class="ml-3 text-sm font-medium text-surface-600 disabled:opacity-50"
        >{t("Clear Override")}</button
      >
      {#if clearSignInOutcomeUnknown}
        <div
          class="mt-4 rounded-lg border border-amber-300 bg-amber-50 p-4 text-sm text-amber-900"
          role="alert"
        >
          <p>
            {t(
              "Sign-in override clearing has an unknown outcome. Reconcile the authoritative state before clearing again.",
            )}
          </p>
          <button
            onclick={() =>
              acknowledgeApplicationMutation("clear-sign-in", appId)}
            class="mt-3 font-semibold text-amber-950 underline"
            >{t("I verified the override; allow clearing again")}</button
          >
        </div>
      {/if}
    </section>
  {:else if activeTab === "permissions"}
    <div class="space-y-5">
      <section class="console-card p-6">
        <h3 class="font-semibold text-surface-900">{t("Consent Policy")}</h3>
        <div class="mt-4 grid gap-3">
          <input
            bind:value={consent.user_scopes}
            placeholder={t("User scopes, comma-separated")}
          /><input
            bind:value={consent.organization_scopes}
            placeholder={t("Organization scopes, comma-separated")}
          /><input
            bind:value={consent.allowed_organization_ids}
            placeholder={t("Allowed organization IDs, comma-separated")}
          /><label class="flex items-center gap-2 text-sm text-surface-700"
            ><input
              type="checkbox"
              bind:checked={consent.require_explicit_consent}
            />{t("Require explicit consent")}</label
          >
        </div>
        <button
          disabled={saving}
          onclick={saveConsent}
          class="mt-4 rounded-lg bg-brand-600 px-4 py-2 text-sm font-medium text-white disabled:opacity-50"
          >{t("Save")}</button
        >
      </section>
      <section class="console-card p-6">
        <h3 class="font-semibold text-surface-900">{t("Resource Bindings")}</h3>
        <div class="mt-4 flex gap-3">
          <select bind:value={newBinding.resource_id} class="min-w-0 flex-1"
            ><option value="">{t("Select resource...")}</option
            >{#each resources as resource (resource.id)}<option
                value={resource.id}>{resource.name}</option
              >{/each}</select
          ><button
            disabled={saving || !newBinding.resource_id}
            onclick={() =>
              runMutation((ownerId) => createApplicationBinding(ownerId, newBinding))}
            class="rounded-lg border border-brand-300 px-3 py-2 text-sm text-brand-700 disabled:opacity-50"
            >{t("Bind")}</button
          >
        </div>
        <div class="mt-4 space-y-2">
          {#each bindings as binding (binding.id)}<div
              class="flex items-center justify-between rounded-lg bg-surface-50 px-3 py-2"
            >
              <span class="text-sm text-surface-700"
                >{binding.resourceId || binding.resource_id}
                {binding.scopeId || binding.scope_id || ""}</span
              ><button
                disabled={saving ||
                  !mutationStorageReady ||
                  applicationMutationLocked(
                    "unbind",
                    bindingMutationResourceId(binding.id),
                  )}
                onclick={() => unbindApplication(binding.id)}
                class="text-xs text-red-600 disabled:opacity-50"
                >{t("Unbind")}</button
              >
            </div>
            {#if applicationMutationLocked(
              "unbind",
              bindingMutationResourceId(binding.id),
            )}
              <div
                class="rounded-lg border border-amber-300 bg-amber-50 p-3 text-xs text-amber-900"
                role="alert"
              >
                <p>
                  {t(
                    "Application unbind outcome is unknown. Reconcile the binding list before unbinding again.",
                  )}
                </p>
                <button
                  onclick={() =>
                    acknowledgeApplicationMutation(
                      "unbind",
                      bindingMutationResourceId(binding.id),
                    )}
                  class="mt-2 font-semibold underline"
                  >{t("I verified the binding; allow unbind again")}</button
                >
              </div>
            {/if}
          {/each}
        </div>
      </section>
    </div>
  {:else if activeTab === "rules"}
    <section class="console-card p-6">
      <h3 class="text-lg font-semibold text-surface-900">
        {t("detail.rules")}
      </h3>
      <p class="mt-1 text-sm text-surface-500">
        {t(
          "Restrict this application to approved business organizations without changing GoTrue token ownership.",
        )}
      </p>
      <label
        class="mt-4 flex items-center justify-between rounded-lg border border-surface-200 p-4"
        ><span class="font-medium text-surface-900"
          >{t("Organization required")}</span
        ><input
          type="checkbox"
          bind:checked={accessControl.organization_required}
        /></label
      ><button
        disabled={saving}
        onclick={() =>
          runMutation((ownerId) =>
            updateApplicationAccessControl(ownerId, accessControl),
          )}
        class="mt-5 rounded-lg bg-brand-600 px-4 py-2 text-sm font-medium text-white disabled:opacity-50"
        >{saving ? t("Saving...") : t("Save")}</button
      >
    </section>
  {:else}
    <RequestState
      empty={organizations.length === 0}
      emptyTitle="organizations.noData"
      ><div class="space-y-3">
        {#each organizations as organization (organization.id || organization.organization_id)}<a
            href={resolve(
              `/organizations/${encodeURIComponent(organization.id || organization.organization_id)}/settings`,
            )}
            class="console-card console-card-hover block p-4"
            ><p class="font-semibold text-surface-900">
              {organization.name ||
                organization.organization_name ||
                organization.organization_id}
            </p>
            <p class="mt-1 text-sm text-surface-500">
              {organization.role || ""}
            </p></a
          >{/each}
      </div></RequestState
    >
  {/if}
</RequestState>
