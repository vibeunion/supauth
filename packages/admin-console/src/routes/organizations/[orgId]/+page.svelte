<script>
  import { onMount } from "svelte";
  import { page } from "$app/state";
  import { resolve } from "$app/paths";
  import DetailTabs from "$lib/components/DetailTabs.svelte";
  import RequestState from "$lib/components/RequestState.svelte";
  import { t } from "$lib/i18n.js";
  import {
    capabilityAvailable,
    collectionItems,
    completeCollectionItems,
    createOperationTracker,
    isLatestResourceLoad,
    mutationOutcomeUnknown,
    tabFromRoute,
  } from "$lib/resource-page.js";
  import {
    addOrganizationMember,
    createOrganizationInvitation,
    deleteOrganizationApplication,
    getCapabilities,
    getOrganization,
    getOrganizationBranding,
    getOrganizationJit,
    listOrganizationApplications,
    listOrganizationInvitations,
    listOrganizationMembers,
    removeOrganizationMember,
    updateOrganization,
    updateOrganizationBranding,
    updateOrganizationJit,
    upsertOrganizationApplication,
  } from "$lib/api/client.js";
  import {
    canonicalTrimmedStringSet,
    organizationSettingsAuthority,
    settleAuthoritativeSettingsMutation,
  } from "$lib/authoritative-settings-readback.js";
  import {
    createDurableMutationLockStore,
  } from "$lib/mutation-reconciliation.js";

  const tabs = [
    { value: "settings", labelKey: "detail.settings" },
    { value: "members", labelKey: "detail.members" },
    { value: "m2m", labelKey: "detail.machineToMachine" },
    { value: "branding", labelKey: "detail.branding" },
  ];
  const tabValues = tabs.map((tab) => tab.value);

  let organization = $state(null);
  let members = $state([]);
  let invitations = $state([]);
  let applications = $state([]);
  let jit = $state({ enabled: false, domains: [] });
  let jitDomains = $state("");
  let jitAvailable = $state(false);
  let branding = $state({ logo_url: "", primary_color: "" });
  let organizationForm = $state({ name: "", description: "" });
  let inviteEmail = $state("");
  let newMember = $state({ user_id: "", role: "member" });
  let newApplication = $state({ app_id: "" });
  let loading = $state(true);
  let saving = $state(false);
  let saved = $state(false);
  let reconciliationStatus = $state(null);
  const mutationTracker = createOperationTracker((pending) => {
    saving = pending;
  });
  let error = $state(null);
  let mutationLocks = $state({});
  let mutationStorageReady = $state(false);
  let mutationStorageError = $state(null);
  const mutationLockStore = createDurableMutationLockStore({
    storageKey: "supaoauth.admin.organization-detail-mutation-locks.v1",
    allowedActions: ["remove-member", "unlink-application"],
    storageProvider: () => globalThis.localStorage,
  });
  let orgId = $derived(page.params.orgId);
  let activeTab = $derived(
    tabFromRoute(page.params.tab, tabValues, "settings"),
  );
  let loadGeneration = 0;
  let loadedOrganizationContext = $state(null);

  function currentLoadContext() {
    return { generation: loadGeneration, resourceId: orgId, tab: activeTab };
  }

  function isCurrentLoad(loadContext) {
    return isLatestResourceLoad(loadContext, currentLoadContext());
  }

  function currentMutationContext() {
    return loadedOrganizationContext && isCurrentLoad(loadedOrganizationContext)
      ? loadedOrganizationContext
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
      resource: t("organizations.title"),
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

  function removalLock(action, targetId, ownerId = orgId) {
    return { action, ownerId, targetId };
  }

  function removalUnknown(action, targetId) {
    return Boolean(
      orgId &&
        targetId &&
        mutationLockStore.isLocked(
          mutationLocks,
          removalLock(action, targetId),
        ),
    );
  }

  function stageRemoval(action, targetId, ownerId) {
    return updateMutationLocks(() =>
      mutationLockStore.stage(
        mutationLocks,
        removalLock(action, targetId, ownerId),
      ),
    );
  }

  function clearRemoval(action, targetId, ownerId) {
    return updateMutationLocks(() =>
      mutationLockStore.clear(
        mutationLocks,
        removalLock(action, targetId, ownerId),
      ),
    );
  }

  function acknowledgeRemoval(action, targetId) {
    if (!confirm(t("I have reconciled the authoritative organization state."))) {
      return;
    }
    if (!confirm(t("Allow this organization removal to run again?"))) return;
    clearRemoval(action, targetId);
  }

  function memberIdentity(member) {
    const identity = member?.user_id || member?.userId;
    return typeof identity === "string" ? identity : "";
  }

  function applicationIdentity(application) {
    const identity = application?.application_id || application?.applicationId;
    return typeof identity === "string" ? identity : "";
  }

  function completeMemberList(response) {
    const listedMembers = completeCollectionItems(response);
    if (listedMembers.every((member) => memberIdentity(member))) return listedMembers;
    throw new Error("Management API returned an organization member without an identity");
  }

  function completeApplicationList(response) {
    const listedApplications = completeCollectionItems(response);
    if (listedApplications.every((entry) => applicationIdentity(entry))) {
      return listedApplications;
    }
    throw new Error("Management API returned an organization application without an identity");
  }

  async function readOrganizationSettings(resourceId) {
    const [organizationResponse, capabilities] = await Promise.all([
      getOrganization(resourceId),
      getCapabilities(),
    ]);
    const jitEnabled = capabilityAvailable(
      capabilities,
      "business_organization_jit_v1",
    );
    const jitResponse = jitEnabled
      ? await getOrganizationJit(resourceId)
      : { enabled: false, domains: [] };
    return {
      organizationResponse,
      jitEnabled,
      jitResponse,
      jitDomainValues: organizationJitDomains(jitResponse),
    };
  }

  function organizationJitDomains(jitResponse) {
    return (
      jitResponse?.domains ||
      jitResponse?.emailDomains ||
      jitResponse?.email_domains ||
      []
    );
  }

  function applyOrganizationSettings(settings) {
    applyOrganizationIdentity(settings.organizationResponse);
    jitAvailable = settings.jitEnabled;
    jit = settings.jitResponse;
    jitDomains = settings.jitDomainValues.join(", ");
  }

  function applyOrganizationIdentity(organizationResponse) {
    organization = organizationResponse;
    organizationForm = {
      name: organizationResponse.name || "",
      description: organizationResponse.description || "",
    };
  }

  async function loadOrganization() {
    saved = false;
    reconciliationStatus = null;
    return loadOrganizationData();
  }

  async function loadOrganizationData() {
    const loadContext = {
      generation: loadGeneration + 1,
      resourceId: orgId,
      tab: activeTab,
    };
    loadGeneration = loadContext.generation;
    loadedOrganizationContext = null;
    loading = true;
    error = null;
    organization = null;
    members = [];
    invitations = [];
    applications = [];
    jitAvailable = false;
    try {
      if (loadContext.tab === "settings") {
        const settings = await readOrganizationSettings(loadContext.resourceId);
        if (!isCurrentLoad(loadContext)) return;
        applyOrganizationSettings(settings);
      } else if (loadContext.tab === "members") {
        const organizationResponse = await getOrganization(loadContext.resourceId);
        if (!isCurrentLoad(loadContext)) return;
        applyOrganizationIdentity(organizationResponse);
        const [memberResponse, invitationResponse] = await Promise.all([
          listOrganizationMembers(loadContext.resourceId),
          listOrganizationInvitations(loadContext.resourceId),
        ]);
        if (!isCurrentLoad(loadContext)) return;
        members = collectionItems(memberResponse);
        invitations = collectionItems(invitationResponse);
      } else if (loadContext.tab === "m2m") {
        const organizationResponse = await getOrganization(loadContext.resourceId);
        if (!isCurrentLoad(loadContext)) return;
        applyOrganizationIdentity(organizationResponse);
        const applicationResponse = await listOrganizationApplications(
          loadContext.resourceId,
        );
        if (!isCurrentLoad(loadContext)) return;
        applications = collectionItems(applicationResponse);
      } else if (loadContext.tab === "branding") {
        const organizationResponse = await getOrganization(loadContext.resourceId);
        if (!isCurrentLoad(loadContext)) return;
        applyOrganizationIdentity(organizationResponse);
        const brandingResponse = await getOrganizationBranding(
          loadContext.resourceId,
        );
        if (!isCurrentLoad(loadContext)) return;
        branding = brandingResponse;
      }
      if (isCurrentLoad(loadContext)) loadedOrganizationContext = loadContext;
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
    saved = false;
    reconciliationStatus = null;
    error = null;
    try {
      await command(operation.ownerContext, operation);
      if (isCurrentMutation(operation)) await loadOrganizationData();
    } catch (requestError) {
      if (isCurrentMutation(operation)) error = requestError;
    } finally {
      mutationTracker.finish(operation);
    }
  }

  function organizationSettingsMutationDraft(operation) {
    const resourceId = operation.ownerContext.resourceId;
    const organizationResponse = {
      id: resourceId,
      name: organizationForm.name.trim(),
      description: organizationForm.description.trim(),
    };
    const jitEnabled = jitAvailable === true;
    const jitResponse = {
      enabled: jit.enabled === true,
      domains: canonicalTrimmedStringSet(
        jitDomains.split(","),
        "organization.jit.domains",
      ),
    };
    const command = {
      resourceId,
      organizationResponse,
      jitEnabled,
      jitResponse,
    };
    return { command, authority: organizationSettingsAuthority(command) };
  }

  function organizationSettingsWriteCommands(command) {
    const writeCommands = [
      () =>
        updateOrganization(command.resourceId, {
          name: command.organizationResponse.name,
          description: command.organizationResponse.description,
        }),
    ];
    if (command.jitEnabled) {
      writeCommands.push(() =>
        updateOrganizationJit(command.resourceId, command.jitResponse),
      );
    }
    return writeCommands;
  }

  function applySettingsSaveStatus(reconciliation) {
    saved = reconciliation.status === "success";
    reconciliationStatus = saved ? null : reconciliation.status;
  }

  async function saveSettings() {
    const mutationContext = currentMutationContext();
    if (!mutationContext || saving) return;
    const operation = mutationTracker.begin(mutationContext);
    saved = false;
    reconciliationStatus = null;
    error = null;
    const mutationDraft = organizationSettingsMutationDraft(operation);
    try {
      const reconciliation = await settleAuthoritativeSettingsMutation({
        draft: mutationDraft,
        writeCommands: organizationSettingsWriteCommands,
        readSnapshot: () =>
          readOrganizationSettings(operation.ownerContext.resourceId),
        authorityFromSnapshot: organizationSettingsAuthority,
      });
      if (!isCurrentMutation(operation)) return;
      if (reconciliation.status === "success") {
        applyOrganizationSettings(reconciliation.readBackValue);
      }
      applySettingsSaveStatus(reconciliation);
    } finally {
      mutationTracker.finish(operation);
    }
  }

  function inviteMember() {
    return runMutation(async (mutationContext, operation) => {
      await createOrganizationInvitation(mutationContext.resourceId, {
        email: inviteEmail.trim(),
      });
      if (isCurrentMutation(operation)) inviteEmail = "";
    });
  }

  function addMember() {
    return runMutation(async (mutationContext, operation) => {
      await addOrganizationMember(mutationContext.resourceId, newMember);
      if (isCurrentMutation(operation)) {
        newMember = { user_id: "", role: "member" };
      }
    });
  }

  function grantApplication() {
    return runMutation(async (mutationContext, operation) => {
      await upsertOrganizationApplication(
        mutationContext.resourceId,
        newApplication.app_id,
      );
      if (isCurrentMutation(operation)) newApplication = { app_id: "" };
    });
  }

  async function removeMember(userId) {
    if (saving || !mutationStorageReady || !userId) return;
    if (removalUnknown("remove-member", userId)) return;
    const mutationContext = currentMutationContext();
    if (!mutationContext) return;
    if (!confirm(t("Remove this member from the organization?"))) return;
    const operation = mutationTracker.begin(mutationContext);
    error = null;
    let removalMayHaveCommitted = false;
    try {
      if (!stageRemoval(
        "remove-member",
        userId,
        operation.ownerContext.resourceId,
      )) return;
      try {
        await removeOrganizationMember(operation.ownerContext.resourceId, userId);
        removalMayHaveCommitted = true;
      } catch (requestError) {
        if (!mutationOutcomeUnknown(requestError)) throw requestError;
        removalMayHaveCommitted = true;
      }
      const response = await listOrganizationMembers(
        operation.ownerContext.resourceId,
      );
      const listedMembers = completeMemberList(response);
      if (listedMembers.some((member) => memberIdentity(member) === userId)) {
        if (isCurrentMutation(operation)) {
          error = new Error(
            t(
              "Organization member removal could not be verified. Reconcile members before removing again.",
            ),
          );
        }
        return;
      }
      if (!clearRemoval(
        "remove-member",
        userId,
        operation.ownerContext.resourceId,
      )) return;
      if (isCurrentMutation(operation)) members = listedMembers;
    } catch (requestError) {
      if (isCurrentMutation(operation)) {
        error = removalMayHaveCommitted
          ? new Error(
              t(
                "Organization member read-back failed. Reconcile members before removing again.",
              ),
            )
          : requestError;
      }
      if (!removalMayHaveCommitted) {
        clearRemoval(
          "remove-member",
          userId,
          operation.ownerContext.resourceId,
        );
      }
    } finally {
      mutationTracker.finish(operation);
    }
  }

  async function unlinkApplication(appId) {
    if (saving || !mutationStorageReady || !appId) return;
    if (removalUnknown("unlink-application", appId)) return;
    const mutationContext = currentMutationContext();
    if (!mutationContext) return;
    if (!confirm(t("Remove this application's organization access?"))) return;
    const operation = mutationTracker.begin(mutationContext);
    error = null;
    let removalMayHaveCommitted = false;
    try {
      if (!stageRemoval(
        "unlink-application",
        appId,
        operation.ownerContext.resourceId,
      )) return;
      try {
        await deleteOrganizationApplication(
          operation.ownerContext.resourceId,
          appId,
        );
        removalMayHaveCommitted = true;
      } catch (requestError) {
        if (!mutationOutcomeUnknown(requestError)) throw requestError;
        removalMayHaveCommitted = true;
      }
      const response = await listOrganizationApplications(
        operation.ownerContext.resourceId,
      );
      const listedApplications = completeApplicationList(response);
      if (listedApplications.some((entry) => applicationIdentity(entry) === appId)) {
        if (isCurrentMutation(operation)) {
          error = new Error(
            t(
              "Organization application unlink could not be verified. Reconcile access before removing again.",
            ),
          );
        }
        return;
      }
      if (!clearRemoval(
        "unlink-application",
        appId,
        operation.ownerContext.resourceId,
      )) return;
      if (isCurrentMutation(operation)) applications = listedApplications;
    } catch (requestError) {
      if (isCurrentMutation(operation)) {
        error = removalMayHaveCommitted
          ? new Error(
              t(
                "Organization application read-back failed. Reconcile access before removing again.",
              ),
            )
          : requestError;
      }
      if (!removalMayHaveCommitted) {
        clearRemoval(
          "unlink-application",
          appId,
          operation.ownerContext.resourceId,
        );
      }
    } finally {
      mutationTracker.finish(operation);
    }
  }

  let lastLoadKey = "";
  $effect(() => {
    const loadKey = `${orgId}:${activeTab}`;
    if (!orgId || loadKey === lastLoadKey) return;
    lastLoadKey = loadKey;
    void loadOrganization();
  });
  onMount(restoreMutationLocks);
</script>

<div class="mb-5">
  <a
    href={resolve("/organizations")}
    class="text-sm font-medium text-brand-700 hover:text-brand-900"
    >← {t("organizations.title")}</a
  >
  <h2 class="mt-4 text-3xl font-bold text-surface-950">
    {organization?.name || orgId}
  </h2>
  <p class="mt-1 font-mono text-xs text-surface-500">{orgId}</p>
</div>

<DetailTabs
  {tabs}
  {activeTab}
  basePath={`/organizations/${encodeURIComponent(orgId)}`}
/>
{#if saved}<div
    class="mb-4 rounded-lg border border-emerald-200 bg-emerald-50 p-4 text-emerald-700"
  >
    {t("Saved")}
  </div>{/if}
{#if reconciliationStatus}<div
    class="mb-4 rounded-lg border border-amber-200 bg-amber-50 p-4 text-amber-900"
    role="alert"
  >
    <p class="font-semibold">
      {t(`save.${reconciliationStatus}.title`)}
    </p>
    <p class="mt-1 text-sm text-amber-800">
      {t(`save.${reconciliationStatus}.description`)}
    </p>
  </div>{/if}
{#if mutationStorageError}<div
    class="mb-4 rounded-lg border border-red-300 bg-red-50 p-4 text-sm text-red-800"
    role="alert"
  >
    {mutationStorageError}
  </div>{/if}

<RequestState {loading} {error} onRetry={loadOrganization}>
  {#if activeTab === "settings"}
    <section class="console-card p-6">
      <h3 class="text-lg font-semibold text-surface-900">
        {t("detail.general")}
      </h3>
      <div class="mt-4 grid gap-4 md:grid-cols-2">
        <div>
          <label
            for="detail-org-name"
            class="mb-1 block text-sm font-medium text-surface-700"
            >{t("Name")}</label
          ><input
            id="detail-org-name"
            bind:value={organizationForm.name}
            class="w-full"
          />
        </div>
        <div>
          <label
            for="detail-org-description"
            class="mb-1 block text-sm font-medium text-surface-700"
            >{t("Description")}</label
          ><input
            id="detail-org-description"
            bind:value={organizationForm.description}
            class="w-full"
          />
        </div>
      </div>
      {#if jitAvailable}
        <div class="mt-5 rounded-lg border border-surface-200 p-4">
          <label class="flex items-center justify-between"
            ><span class="font-medium text-surface-900"
              >{t("organizations.jitProvisioning")}</span
            ><input type="checkbox" bind:checked={jit.enabled} /></label
          ><label for="jit-domains" class="mt-4 block text-sm text-surface-600"
            >{t("Domains")}</label
          ><input
            id="jit-domains"
            bind:value={jitDomains}
            placeholder="example.com"
            class="mt-1 w-full"
          />
        </div>
      {:else}
        <div class="mt-5 rounded-lg border border-amber-200 bg-amber-50 p-4">
          <p class="font-medium text-amber-900">{t("state.unsupported")}</p>
          <p class="mt-1 text-sm text-amber-800">
            {t("state.unsupportedDescription")}
          </p>
        </div>
      {/if}
      <button
        disabled={saving || !organizationForm.name.trim()}
        onclick={saveSettings}
        class="mt-5 rounded-lg bg-brand-600 px-4 py-2 text-sm font-medium text-white hover:bg-brand-700 disabled:opacity-50"
        >{saving ? t("Saving...") : t("Save")}</button
      >
    </section>
  {:else if activeTab === "members"}
    <div class="space-y-5">
      <section class="console-card p-5">
        <h3 class="font-semibold text-surface-900">{t("detail.members")}</h3>
        <div class="mt-4 grid gap-3 md:grid-cols-[1fr_10rem_auto]">
          <input bind:value={newMember.user_id} placeholder="user uuid" /><input
            bind:value={newMember.role}
            placeholder="member"
          /><button
            disabled={saving || !newMember.user_id.trim()}
            onclick={addMember}
            class="rounded-lg bg-brand-600 px-4 py-2 text-sm font-medium text-white disabled:opacity-50"
            >{t("Add")}</button
          >
        </div>
      </section>
      <RequestState empty={members.length === 0} emptyTitle="No members"
        ><div class="console-card overflow-hidden">
          <table>
            <thead
              ><tr><th>{t("Users")}</th><th>{t("Roles")}</th><th></th></tr
              ></thead
            ><tbody
              >{#each members as member (member.id)}{@const memberUserId =
                  member.user_id}<tr
                  ><td>{member.email || memberUserId}</td><td
                    >{member.role || member.role_name || "-"}</td
                  ><td class="text-right"
                    ><button
                      disabled={saving ||
                        !mutationStorageReady ||
                        !memberUserId ||
                        removalUnknown("remove-member", memberUserId)}
                      onclick={() => removeMember(memberUserId)}
                      class="text-sm text-red-600 disabled:opacity-50"
                      >{t("Delete")}</button
                    >{#if removalUnknown("remove-member", memberUserId)}<button
                        onclick={() => acknowledgeRemoval("remove-member", memberUserId)}
                        class="ml-2 text-xs font-semibold text-amber-900 underline"
                        >{t("Reconciled; unlock")}</button
                      >{/if}</td
                  ></tr
                >{/each}</tbody
            >
          </table>
        </div></RequestState
      >
      <section class="console-card p-5">
        <h3 class="font-semibold text-surface-900">
          {t("organizations.invitations")}
        </h3>
        <div class="mt-4 flex gap-3">
          <input
            type="email"
            bind:value={inviteEmail}
            placeholder="user@example.com"
            class="min-w-0 flex-1"
          /><button
            disabled={saving || !inviteEmail.trim()}
            onclick={inviteMember}
            class="rounded-lg bg-brand-600 px-4 py-2 text-sm font-medium text-white disabled:opacity-50"
            >{t("organizations.invite")}</button
          >
        </div>
        <div class="mt-4 space-y-2">
          {#each invitations as invitation (invitation.id)}<p
              class="rounded-lg bg-surface-50 px-3 py-2 text-sm text-surface-600"
            >
              {invitation.email} · {invitation.status}
            </p>{/each}
        </div>
      </section>
    </div>
  {:else if activeTab === "m2m"}
    <div class="space-y-5">
      <section class="console-card p-5">
        <h3 class="font-semibold text-surface-900">
          {t("organizations.applicationAccess")}
        </h3>
        <div class="mt-4 grid gap-3 md:grid-cols-[1fr_auto]">
          <input
            bind:value={newApplication.app_id}
            placeholder="client_id"
          /><button
            disabled={saving || !newApplication.app_id.trim()}
            onclick={grantApplication}
            class="rounded-lg bg-brand-600 px-4 py-2 text-sm font-medium text-white disabled:opacity-50"
            >{t("organizations.grant")}</button
          >
        </div>
      </section>
      <RequestState
        empty={applications.length === 0}
        emptyTitle="No applications yet"
        ><div class="space-y-3">
          {#each applications as application (application.application_id || application.applicationId)}{@const appId =
              application.application_id || application.applicationId}
            <div
              class="console-card flex items-center justify-between gap-4 p-4"
            >
              <span class="font-mono text-sm text-surface-800">{appId}</span
              ><button
                disabled={saving ||
                  !mutationStorageReady ||
                  removalUnknown("unlink-application", appId)}
                onclick={() => unlinkApplication(appId)}
                class="text-sm text-red-600 disabled:opacity-50"
                >{t("Delete")}</button
              >
            </div>
            {#if removalUnknown("unlink-application", appId)}
              <button
                onclick={() => acknowledgeRemoval("unlink-application", appId)}
                class="text-xs font-semibold text-amber-900 underline"
                >{t("I verified access; allow unlink again")}</button
              >
            {/if}
          {/each}
        </div></RequestState
      >
    </div>
  {:else if activeTab === "branding"}
    <section class="console-card p-6">
      <h3 class="text-lg font-semibold text-surface-900">
        {t("detail.branding")}
      </h3>
      <div class="mt-4 grid gap-4 md:grid-cols-2">
        <div>
          <label
            for="org-logo"
            class="mb-1 block text-sm font-medium text-surface-700"
            >{t("Logo URL")}</label
          ><input id="org-logo" bind:value={branding.logo_url} class="w-full" />
        </div>
        <div>
          <label
            for="org-color"
            class="mb-1 block text-sm font-medium text-surface-700"
            >{t("Primary Color")}</label
          ><input
            id="org-color"
            bind:value={branding.primary_color}
            class="w-full"
          />
        </div>
      </div>
      <button
        disabled={saving}
        onclick={() =>
          runMutation((mutationContext) =>
            updateOrganizationBranding(mutationContext.resourceId, branding),
          )}
        class="mt-5 rounded-lg bg-brand-600 px-4 py-2 text-sm font-medium text-white disabled:opacity-50"
        >{saving ? t("Saving...") : t("Save")}</button
      >
    </section>
  {/if}
</RequestState>
