<script>
  import { onMount } from "svelte";
  import { t } from "$lib/i18n.js";
  import { resolve } from "$app/paths";
  import OneTimeSecret from "$lib/components/OneTimeSecret.svelte";
  import { GOTRUE_OAUTH_GRANT_TYPES } from "$lib/oauth-grant-types.js";
  import {
    createDurableMutationLockStore,
    reconciledCreatedApplication,
  } from "$lib/mutation-reconciliation.js";
  import {
    completeCollectionItems,
    createKeyedSingleFlightTracker,
    createLatestRequestTracker,
    mutationOutcomeUnknown,
  } from "$lib/resource-page.js";
  import {
    listApplications,
    createApplication,
    deleteApplication,
    getApplication,
    rotateApplicationSecret,
  } from "$lib/api/client.js";

  const CONFIDENTIAL_AUTH_METHODS = [
    "client_secret_basic",
    "client_secret_post",
  ];
  const APPLICATION_LOCK_OWNER = "applications";
  const applicationMutationLockStore = createDurableMutationLockStore({
    storageKey: "supaoauth.admin.application-mutation-locks.v2",
    allowedActions: ["clear-sign-in", "create", "delete", "rotate", "unbind"],
    storageProvider: () => globalThis.localStorage,
    legacyStorageKeys: ["supaoauth.admin.application-mutation-locks.v1"],
  });

  let applications = $state([]);
  let loading = $state(true);
  let error = $state(null);
  let showCreate = $state(false);
  let newApp = $state({
    name: "",
    redirect_uris: "",
    type: "web",
    token_endpoint_auth_method: "client_secret_basic",
  });
  let revealedSecrets = $state({});
  let secretRotations = $state({});
  let applicationMutationLocks = $state({});
  let mutationStorageReady = $state(false);
  let mutationStorageError = $state(null);
  let creating = $state(false);
  const secretRotationTracker = createKeyedSingleFlightTracker();
  const applicationCreateTracker = createKeyedSingleFlightTracker();
  const applicationListRequests = createLatestRequestTracker();

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

  function applicationRowBlocked(appId) {
    return (
      !mutationStorageReady ||
      applicationMutationLocked("rotate", appId) ||
      applicationMutationLocked("delete", appId)
    );
  }

  function acknowledgeApplicationMutation(action, appId) {
    if (!confirm(t("I have verified the authoritative application state."))) return;
    if (!confirm(t("Allow this high-impact application action to run again?"))) return;
    if (!clearApplicationMutationLock(action, appId)) return;
    if (action === "rotate") {
      updateSecretRotation(appId, { outcomeUnknown: false });
    }
  }

  function secretRotationState(appId) {
    const currentState =
      secretRotations[appId] || { pending: false, outcomeUnknown: false };
    return {
      ...currentState,
      outcomeUnknown:
        currentState.outcomeUnknown || applicationMutationLocked("rotate", appId),
    };
  }

  function updateSecretRotation(appId, rotationUpdate) {
    secretRotations[appId] = {
      ...secretRotationState(appId),
      ...rotationUpdate,
    };
  }

  function formatClientType(type) {
    if (type === "public") return t("Public client");
    if (type === "confidential") return t("Confidential client");
    return type || t("Confidential client");
  }

  function authMethodLabel(method) {
    const protocol = method || "client_secret_basic";
    const translationKey = `application.authMethod.${protocol}`;
    const translated = t(translationKey);
    const label = translated === translationKey
      ? t("application.authMethod.unknown")
      : translated;
    return `${label} (${protocol})`;
  }

  function handleTypeChange(event) {
    const type = event.currentTarget.value;
    const authMethod =
      type === "spa"
        ? "none"
        : newApp.token_endpoint_auth_method === "none"
          ? "client_secret_basic"
          : newApp.token_endpoint_auth_method;

    newApp = {
      ...newApp,
      type,
      token_endpoint_auth_method: authMethod,
    };
  }

  function applicationIdentity(application) {
    const identity = application?.client_id || application?.id;
    return typeof identity === "string" ? identity : "";
  }

  function completeApplicationList(response) {
    const listedApplications = completeCollectionItems(response);
    if (listedApplications.every((application) => applicationIdentity(application))) {
      return listedApplications;
    }
    throw new Error("Management API returned an application without an identity");
  }

  async function readApplicationList() {
    const request = applicationListRequests.begin("applications");
    try {
      const response = await listApplications();
      return {
        request,
        applications: completeApplicationList(response),
        requestError: null,
      };
    } catch (requestError) {
      return { request, applications: [], requestError };
    }
  }

  function applyApplicationList(readBack) {
    if (!applicationListRequests.isCurrent(readBack.request)) return false;
    if (readBack.requestError) throw readBack.requestError;
    applications = readBack.applications;
    return true;
  }

  async function load() {
    loading = true;
    error = null;
    try {
      const readBack = await readApplicationList();
      if (applyApplicationList(readBack)) loading = false;
    } catch (requestError) {
      error = requestError.message;
      loading = false;
    }
  }

  function applicationCreateDraft() {
    return {
      client_name: newApp.name,
      redirect_uris: newApp.redirect_uris
        .split(",")
        .map((redirectUri) => redirectUri.trim())
        .filter(Boolean),
      client_type: newApp.type === "spa" ? "public" : "confidential",
      grant_types: [...GOTRUE_OAUTH_GRANT_TYPES],
      token_endpoint_auth_method:
        newApp.type === "spa" ? "none" : newApp.token_endpoint_auth_method,
    };
  }

  function resetApplicationDraft() {
    showCreate = false;
    newApp = {
      name: "",
      redirect_uris: "",
      type: "web",
      token_endpoint_auth_method: "client_secret_basic",
    };
  }

  async function handleCreate() {
    if (
      creating ||
      !mutationStorageReady ||
      applicationMutationLocked("create", "new")
    )
      return;
    const operation = applicationCreateTracker.begin("create");
    if (!operation) return;
    creating = true;
    error = null;
    const draft = applicationCreateDraft();
    let creationMayHaveCommitted = false;
    let creationStaged = false;
    try {
      const beforeReadBack = await readApplicationList();
      if (!applicationCreateTracker.isCurrent(operation)) return;
      if (!applicationListRequests.isCurrent(beforeReadBack.request)) return;
      if (beforeReadBack.requestError) throw beforeReadBack.requestError;
      const beforeIds = new Set(
        beforeReadBack.applications.map(applicationIdentity).filter(Boolean),
      );
      if (beforeIds.size !== beforeReadBack.applications.length) {
        throw new Error("Management API returned duplicate application identities");
      }
      if (!stageApplicationMutation("create", "new")) return;
      creationStaged = true;
      let createResponse = null;
      let createError = null;
      try {
        createResponse = await createApplication(draft);
        creationMayHaveCommitted = true;
      } catch (requestError) {
        if (!mutationOutcomeUnknown(requestError)) throw requestError;
        creationMayHaveCommitted = true;
        createError = requestError;
      }
      if (!applicationCreateTracker.isCurrent(operation)) return;
      const readBack = await readApplicationList();
      if (!applicationCreateTracker.isCurrent(operation)) return;
      if (readBack.requestError) throw readBack.requestError;
      const created = reconciledCreatedApplication({
        beforeApplications: beforeReadBack.applications,
        afterApplications: readBack.applications,
        createResponse,
        draft,
      });
      if (!created || !applyApplicationList(readBack)) {
        recordApplicationMutationUnknown("create", "new");
        error = t(
          "Application creation could not be reconciled. Verify the authoritative list before allowing another create.",
        );
        return;
      }
      const createdId = applicationIdentity(created);
      if (draft.client_type === "confidential" && createResponse?.client_secret && createdId) {
        revealedSecrets[createdId] = createResponse.client_secret;
      } else if (createError) {
        error = t(
          "The application was created, but its one-time secret was not returned. Review the application before rotating its secret.",
        );
      }
      if (!clearApplicationMutationLock("create", "new")) {
        error = t(
          "Application creation was verified but the reconciliation lock could not be cleared. Reconcile storage before trying again.",
        );
        return;
      }
      resetApplicationDraft();
    } catch (requestError) {
      if (!applicationCreateTracker.isCurrent(operation)) return;
      if (creationMayHaveCommitted) {
        recordApplicationMutationUnknown("create", "new");
        error = t(
          "Application creation outcome is unknown. Verify the authoritative list before trying again.",
        );
      } else if (creationStaged) {
        clearApplicationMutationLock("create", "new");
        error = requestError.message;
      } else {
        error = requestError.message;
      }
    } finally {
      if (applicationCreateTracker.finish(operation)) creating = false;
    }
  }

  async function handleRotateSecret(appId) {
    if (applications.find((application) => applicationIdentity(application) === appId)?.client_type === "public") return;
    const currentState = secretRotationState(appId);
    if (
      currentState.pending ||
      currentState.outcomeUnknown ||
      !mutationStorageReady
    )
      return;
    if (
      !confirm(
        t(
          "Rotate client secret? The old secret will be invalidated immediately.",
        ),
      )
    )
      return;
    const operation = secretRotationTracker.begin(appId);
    if (!operation) return;
    if (!stageApplicationMutation("rotate", appId)) {
      secretRotationTracker.finish(operation);
      return;
    }
    delete revealedSecrets[appId];
    updateSecretRotation(appId, { pending: true, outcomeUnknown: false });
    error = null;
    let rotationMayHaveCommitted = false;
    try {
      const response = await rotateApplicationSecret(appId);
      rotationMayHaveCommitted = true;
      if (!secretRotationTracker.isCurrent(operation)) return;
      const applicationReadBack = await getApplication(appId);
      if (!secretRotationTracker.isCurrent(operation)) return;
      if (
        applicationIdentity(applicationReadBack) !== appId ||
        typeof response?.client_secret !== "string" ||
        !response.client_secret
      ) {
        recordApplicationMutationUnknown("rotate", appId);
        updateSecretRotation(appId, { outcomeUnknown: true });
        error = t(
          "Secret rotation could not be verified. Reconcile the credential before unlocking another rotation.",
        );
        return;
      }
      revealedSecrets[appId] = response.client_secret;
      if (!clearApplicationMutationLock("rotate", appId)) {
        updateSecretRotation(appId, { outcomeUnknown: true });
        error = t(
          "Secret rotation was verified but the reconciliation lock could not be cleared. Reconcile storage before trying again.",
        );
        return;
      }
    } catch (requestError) {
      if (!secretRotationTracker.isCurrent(operation)) return;
      if (rotationMayHaveCommitted || mutationOutcomeUnknown(requestError)) {
        recordApplicationMutationUnknown("rotate", appId);
        updateSecretRotation(appId, { outcomeUnknown: true });
        error = t(
          "Secret rotation outcome is unknown. Do not rotate again until an operator reconciles the credential.",
        );
      } else {
        clearApplicationMutationLock("rotate", appId);
        error = requestError.message;
      }
    } finally {
      if (secretRotationTracker.finish(operation)) {
        updateSecretRotation(appId, { pending: false });
      }
    }
  }

  async function handleDelete(id) {
    if (
      secretRotationTracker.isPending(id) ||
      applicationMutationLocked("delete", id) ||
      !mutationStorageReady
    )
      return;
    if (!confirm(t("Delete this application?"))) return;
    const operation = secretRotationTracker.begin(id, { action: "delete" });
    if (!operation) return;
    if (!stageApplicationMutation("delete", id)) {
      secretRotationTracker.finish(operation);
      return;
    }
    updateSecretRotation(id, { pending: true });
    error = null;
    let deletionMayHaveCommitted = false;
    try {
      try {
        await deleteApplication(id);
        deletionMayHaveCommitted = true;
      } catch (requestError) {
        if (!mutationOutcomeUnknown(requestError)) throw requestError;
        deletionMayHaveCommitted = true;
      }
      if (!secretRotationTracker.isCurrent(operation)) return;
      const readBack = await readApplicationList();
      if (!secretRotationTracker.isCurrent(operation)) return;
      if (readBack.requestError) throw readBack.requestError;
      const stillPresent = readBack.applications.some(
        (application) => applicationIdentity(application) === id,
      );
      if (stillPresent || !applyApplicationList(readBack)) {
        recordApplicationMutationUnknown("delete", id);
        error = t(
          "Application deletion could not be verified. Reconcile the authoritative list before deleting again.",
        );
        return;
      }
      if (!clearApplicationMutationLock("delete", id)) {
        error = t(
          "Application deletion was verified but the reconciliation lock could not be cleared. Reconcile storage before trying again.",
        );
        return;
      }
      delete revealedSecrets[id];
      delete secretRotations[id];
    } catch (requestError) {
      if (!secretRotationTracker.isCurrent(operation)) return;
      if (deletionMayHaveCommitted || mutationOutcomeUnknown(requestError)) {
        recordApplicationMutationUnknown("delete", id);
      } else {
        clearApplicationMutationLock("delete", id);
      }
      error = requestError.message;
    } finally {
      if (secretRotationTracker.finish(operation)) {
        updateSecretRotation(id, { pending: false });
      }
    }
  }

  onMount(() => {
    restoreApplicationMutationLocks();
    void load();
  });
</script>

<div class="flex items-center justify-between mb-6">
  <h2 class="text-2xl font-bold text-surface-900">{t("Applications")}</h2>
  <button
    onclick={() => (showCreate = !showCreate)}
    class="px-4 py-2 bg-brand-600 text-white rounded-lg text-sm font-medium hover:bg-brand-700"
  >
    {showCreate ? t("Cancel") : `+ ${t("New Application")}`}
  </button>
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

{#if applicationMutationLocked("create", "new")}
  <div
    class="mb-4 rounded-lg border border-amber-300 bg-amber-50 p-4 text-sm text-amber-900"
    role="alert"
  >
    <p>
      {t(
        "A previous application creation has an unknown outcome. Reconcile the authoritative application list before creating again.",
      )}
    </p>
    <button
      onclick={() => acknowledgeApplicationMutation("create", "new")}
      class="mt-3 font-semibold text-amber-950 underline"
      >{t("I verified the list; allow another create")}</button
    >
  </div>
{/if}

{#if showCreate}
  <div class="bg-white rounded-xl border border-surface-200 p-6 mb-6">
    <h3 class="text-lg font-semibold text-surface-800 mb-4">
      {t("New Application")}
    </h3>
    <fieldset class="space-y-4" disabled={creating}>
      <div>
        <label
          for="app-name"
          class="block text-sm font-medium text-surface-700 mb-1"
          >{t("Name")}</label
        >
        <input
          id="app-name"
          bind:value={newApp.name}
          class="w-full px-3 py-2 border border-surface-300 rounded-lg text-sm"
          placeholder={t("My App")}
        />
      </div>
      <div>
        <label
          for="app-type"
          class="block text-sm font-medium text-surface-700 mb-1"
          >{t("Type")}</label
        >
        <select
          id="app-type"
          value={newApp.type}
          onchange={handleTypeChange}
          class="px-3 py-2 border border-surface-300 rounded-lg text-sm"
        >
          <option value="web">{t("Web (Confidential)")}</option>
          <option value="spa">{t("SPA / Native (Public)")}</option>
        </select>
      </div>
      {#if newApp.type !== "spa"}
        <div>
          <label
            for="app-auth-method"
            class="block text-sm font-medium text-surface-700 mb-1"
            >{t("Token Endpoint Auth Method")}</label
          >
          <select
            id="app-auth-method"
            bind:value={newApp.token_endpoint_auth_method}
            class="px-3 py-2 border border-surface-300 rounded-lg text-sm"
          >
            {#each CONFIDENTIAL_AUTH_METHODS as method (method)}
              <option value={method}>{authMethodLabel(method)}</option>
            {/each}
          </select>
          <p class="mt-2 text-xs text-surface-500">
            {t("Use")} <code>client_secret_post</code>
            {t(
              "for clients like Better Auth that send client credentials in the token request body.",
            )}
          </p>
        </div>
      {/if}
      <div>
        <label
          for="app-redirects"
          class="block text-sm font-medium text-surface-700 mb-1"
          >{t("Redirect URIs (comma-separated)")}</label
        >
        <input
          id="app-redirects"
          bind:value={newApp.redirect_uris}
          class="w-full px-3 py-2 border border-surface-300 rounded-lg text-sm"
          placeholder="http://localhost:3000/auth/callback"
        />
      </div>
      <button
        disabled={creating ||
          !mutationStorageReady ||
          applicationMutationLocked("create", "new") ||
          !newApp.name.trim()}
        onclick={handleCreate}
        class="px-4 py-2 bg-brand-600 text-white rounded-lg text-sm font-medium hover:bg-brand-700 disabled:cursor-not-allowed disabled:opacity-50"
        >{creating ? t("Loading...") : t("Create")}</button
      >
    </fieldset>
  </div>
{/if}

{#if loading}
  <p class="text-surface-400">{t("Loading...")}</p>
{:else if applications.length === 0}
  <div
    class="bg-surface-50 rounded-xl border border-surface-200 p-8 text-center"
  >
    <p class="text-surface-500">{t("No applications yet")}</p>
    <p class="text-sm text-surface-400 mt-2">
      {t('Click "New Application" to register your first app')}
    </p>
  </div>
{:else}
  <div class="space-y-3">
    {#each applications as app (app.client_id)}
      <div class="bg-white rounded-xl border border-surface-200 p-5">
        <div class="flex items-start justify-between">
          <div>
            <a
              href={resolve(
                `/applications/${encodeURIComponent(app.client_id)}/settings`,
              )}
              class="font-semibold text-surface-900 hover:text-brand-600 transition-colors"
              >{app.client_name || app.client_id}</a
            >
            <p class="text-sm font-mono text-surface-500 mt-1">
              {t("Client ID")}: {app.client_id}
            </p>
          </div>
          <div class="flex gap-2">
            <a
              href={resolve(
                `/applications/${encodeURIComponent(app.client_id)}/settings`,
              )}
              class="text-sm text-brand-600 hover:text-brand-800">{t("View")}</a
            >
            {#if app.client_type !== "public"}
              <button
                onclick={() => handleRotateSecret(app.client_id)}
                disabled={secretRotationState(app.client_id).pending ||
                  applicationRowBlocked(app.client_id)}
                class="text-sm text-brand-600 hover:text-brand-800 disabled:cursor-not-allowed disabled:text-surface-400"
                >{secretRotationState(app.client_id).pending
                  ? t("Loading...")
                  : t("application.secret.rotate")}</button
              >
            {/if}
            <button
              onclick={() => handleDelete(app.client_id)}
              disabled={secretRotationState(app.client_id).pending ||
                applicationRowBlocked(app.client_id)}
              class="text-sm text-red-500 hover:text-red-700 disabled:cursor-not-allowed disabled:text-surface-400"
              >{t("Delete")}</button
            >
          </div>
        </div>
        {#if revealedSecrets[app.client_id]}
          <OneTimeSecret secret={revealedSecrets[app.client_id]} />
        {/if}
        {#if secretRotationState(app.client_id).outcomeUnknown}
          <div
            class="mt-3 rounded-lg border border-amber-300 bg-amber-50 p-3 text-sm text-amber-900"
            role="alert"
          >
            {t(
              "Secret rotation outcome is unknown. Do not rotate again. Verify the client credential with the token endpoint or contact an operator; this block survives reload.",
            )}
            <button
              onclick={() =>
                acknowledgeApplicationMutation("rotate", app.client_id)}
              class="mt-2 block font-semibold underline"
              >{t("I verified the credential; allow another rotation")}</button
            >
          </div>
        {/if}
        {#if applicationMutationLocked("delete", app.client_id)}
          <div
            class="mt-3 rounded-lg border border-amber-300 bg-amber-50 p-3 text-sm text-amber-900"
            role="alert"
          >
            <p>
              {t(
                "Application deletion outcome is unknown. Reconcile the authoritative list before deleting again.",
              )}
            </p>
            <button
              onclick={() =>
                acknowledgeApplicationMutation("delete", app.client_id)}
              class="mt-2 font-semibold underline"
              >{t("I verified the application; allow another delete")}</button
            >
          </div>
        {/if}
        <div class="mt-3 space-y-1">
          <p class="text-sm text-surface-600">
            {t("Type:")}
            <span class="font-medium">{formatClientType(app.client_type)}</span>
          </p>
          <p class="text-sm text-surface-600">
            {t("Auth Method:")}
            <span class="font-medium"
              >{authMethodLabel(app.token_endpoint_auth_method)}</span
            >
          </p>
          {#if app.redirect_uris?.length}
            <p class="text-sm text-surface-600">{t("Redirect URIs:")}</p>
            {#each app.redirect_uris as uri (uri)}
              <code
                class="text-xs font-mono text-brand-700 bg-surface-50 px-2 py-0.5 rounded ml-4"
                >{uri}</code
              >
            {/each}
          {/if}
        </div>
      </div>
    {/each}
  </div>
{/if}
