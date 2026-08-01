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
    completeCollectionItems,
    createOperationTracker,
    isLatestResourceLoad,
    mutationOutcomeUnknown,
    tabFromRoute,
  } from "$lib/resource-page.js";
  import {
    createRolePermission,
    deleteRolePermission,
    getRole,
    listRoleAssignments,
    listRolePermissions,
    revokeRole,
    updateRole,
  } from "$lib/api/client.js";

  const tabs = [
    { value: "general", labelKey: "detail.general" },
    { value: "permissions", labelKey: "detail.permissions" },
    { value: "users", labelKey: "Users" },
    { value: "m2m", labelKey: "detail.machineToMachine" },
  ];
  const tabValues = tabs.map((tab) => tab.value);

  let role = $state(null);
  let permissions = $state([]);
  let assignments = $state([]);
  let roleForm = $state({ name: "", description: "" });
  let newPermission = $state({ name: "", description: "" });
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
    storageKey: "supaoauth.admin.role-mutation-locks.v1",
    allowedActions: ["delete-permission", "revoke-assignment"],
    storageProvider: () => globalThis.localStorage,
  });
  let roleId = $derived(page.params.roleId);
  let activeTab = $derived(tabFromRoute(page.params.tab, tabValues, "general"));
  let loadGeneration = 0;
  let loadedRoleContext = $state(null);
  let userAssignments = $derived(
    assignments.filter((assignment) => assignment.user_id || assignment.userId),
  );
  let applicationAssignments = $derived(
    assignments.filter(
      (assignment) => assignment.application_id || assignment.applicationId,
    ),
  );

  function currentLoadContext() {
    return { generation: loadGeneration, resourceId: roleId, tab: activeTab };
  }

  function isCurrentLoad(loadContext) {
    return isLatestResourceLoad(loadContext, currentLoadContext());
  }

  function currentMutationContext() {
    return loadedRoleContext && isCurrentLoad(loadedRoleContext)
      ? loadedRoleContext
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
      resource: t("Roles & Permissions"),
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

  function revocationLock(action, targetId, ownerId = roleId) {
    return { action, ownerId, targetId };
  }

  function revocationUnknown(action, targetId) {
    return Boolean(
      roleId &&
        targetId &&
        mutationLockStore.isLocked(
          mutationLocks,
          revocationLock(action, targetId),
        ),
    );
  }

  function stageRevocation(action, targetId, ownerId) {
    return updateMutationLocks(() =>
      mutationLockStore.stage(
        mutationLocks,
        revocationLock(action, targetId, ownerId),
      ),
    );
  }

  function clearRevocation(action, targetId, ownerId) {
    return updateMutationLocks(() =>
      mutationLockStore.clear(
        mutationLocks,
        revocationLock(action, targetId, ownerId),
      ),
    );
  }

  function acknowledgeRevocation(action, targetId) {
    if (!confirm(t("I have reconciled the authoritative role state."))) return;
    if (!confirm(t("Allow this role revocation to run again?"))) return;
    clearRevocation(action, targetId);
  }

  function completePermissionList(response) {
    const listedPermissions = completeCollectionItems(response);
    if (listedPermissions.every((permission) => typeof permission?.id === "string")) {
      return listedPermissions;
    }
    throw new Error("Management API returned a permission without an identity");
  }

  function completeAssignmentList(response) {
    const listedAssignments = completeCollectionItems(response);
    if (listedAssignments.every((assignment) => assignmentId(assignment))) {
      return listedAssignments;
    }
    throw new Error("Management API returned a role assignment without an identity");
  }

  async function loadRole() {
    return loadRoleData();
  }

  async function loadRoleData() {
    const loadContext = {
      generation: loadGeneration + 1,
      resourceId: roleId,
      tab: activeTab,
    };
    loadGeneration = loadContext.generation;
    loadedRoleContext = null;
    loading = true;
    error = null;
    role = null;
    permissions = [];
    assignments = [];
    try {
      const roleResponse = await getRole(loadContext.resourceId);
      if (!isCurrentLoad(loadContext)) return;
      role = roleResponse;
      if (loadContext.tab === "permissions") {
        const permissionResponse = await listRolePermissions(
          loadContext.resourceId,
        );
        if (!isCurrentLoad(loadContext)) return;
        permissions = collectionItems(permissionResponse);
      } else if (loadContext.tab === "users" || loadContext.tab === "m2m") {
        const assignmentResponse = await listRoleAssignments(
          loadContext.resourceId,
        );
        if (!isCurrentLoad(loadContext)) return;
        assignments = collectionItems(assignmentResponse);
      }
      if (!isCurrentLoad(loadContext)) return;
      roleForm = {
        name: roleResponse.name || "",
        description: roleResponse.description || "",
      };
      loadedRoleContext = loadContext;
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
      if (isCurrentMutation(operation)) await loadRoleData();
    } catch (requestError) {
      if (isCurrentMutation(operation)) error = requestError;
    } finally {
      mutationTracker.finish(operation);
    }
  }

  function addPermission() {
    return runMutation(async (mutationContext, operation) => {
      await createRolePermission(mutationContext.resourceId, newPermission);
      if (isCurrentMutation(operation)) {
        newPermission = { name: "", description: "" };
      }
    });
  }

  function assignmentId(assignment) {
    const identity = assignment?.id || assignment?.assignment_id;
    return typeof identity === "string" ? identity : "";
  }

  async function deletePermission(permissionId) {
    if (saving || !mutationStorageReady) return;
    if (revocationUnknown("delete-permission", permissionId)) return;
    const mutationContext = currentMutationContext();
    if (!mutationContext) return;
    if (!confirm(t("Delete this role permission?"))) return;
    const operation = mutationTracker.begin(mutationContext);
    error = null;
    let deletionMayHaveCommitted = false;
    try {
      if (!stageRevocation(
        "delete-permission",
        permissionId,
        operation.ownerContext.resourceId,
      )) return;
      try {
        await deleteRolePermission(
          operation.ownerContext.resourceId,
          permissionId,
        );
        deletionMayHaveCommitted = true;
      } catch (requestError) {
        if (!mutationOutcomeUnknown(requestError)) throw requestError;
        deletionMayHaveCommitted = true;
      }
      const response = await listRolePermissions(operation.ownerContext.resourceId);
      const listedPermissions = completePermissionList(response);
      if (listedPermissions.some((permission) => permission.id === permissionId)) {
        if (isCurrentMutation(operation)) {
          error = new Error(
            t(
              "Role permission deletion could not be verified. Reconcile permissions before deleting again.",
            ),
          );
        }
        return;
      }
      if (!clearRevocation(
        "delete-permission",
        permissionId,
        operation.ownerContext.resourceId,
      )) return;
      if (isCurrentMutation(operation)) permissions = listedPermissions;
    } catch (requestError) {
      if (isCurrentMutation(operation)) {
        error = deletionMayHaveCommitted
          ? new Error(
              t(
                "Role permission read-back failed. Reconcile permissions before deleting again.",
              ),
            )
          : requestError;
      }
      if (!deletionMayHaveCommitted) {
        clearRevocation(
          "delete-permission",
          permissionId,
          operation.ownerContext.resourceId,
        );
      }
    } finally {
      mutationTracker.finish(operation);
    }
  }

  async function revokeAssignment(assignment) {
    const targetId = assignmentId(assignment);
    if (saving || !mutationStorageReady || !targetId) return;
    if (revocationUnknown("revoke-assignment", targetId)) return;
    const mutationContext = currentMutationContext();
    if (!mutationContext) return;
    if (!confirm(t("Revoke this role assignment?"))) return;
    const operation = mutationTracker.begin(mutationContext);
    error = null;
    let revocationMayHaveCommitted = false;
    try {
      if (!stageRevocation(
        "revoke-assignment",
        targetId,
        operation.ownerContext.resourceId,
      )) return;
      try {
        await revokeRole(operation.ownerContext.resourceId, targetId);
        revocationMayHaveCommitted = true;
      } catch (requestError) {
        if (!mutationOutcomeUnknown(requestError)) throw requestError;
        revocationMayHaveCommitted = true;
      }
      const response = await listRoleAssignments(operation.ownerContext.resourceId);
      const listedAssignments = completeAssignmentList(response);
      if (listedAssignments.some((entry) => assignmentId(entry) === targetId)) {
        if (isCurrentMutation(operation)) {
          error = new Error(
            t(
              "Role revocation could not be verified. Reconcile assignments before revoking again.",
            ),
          );
        }
        return;
      }
      if (!clearRevocation(
        "revoke-assignment",
        targetId,
        operation.ownerContext.resourceId,
      )) return;
      if (isCurrentMutation(operation)) assignments = listedAssignments;
    } catch (requestError) {
      if (isCurrentMutation(operation)) {
        error = revocationMayHaveCommitted
          ? new Error(
              t(
                "Role assignment read-back failed. Reconcile assignments before revoking again.",
              ),
            )
          : requestError;
      }
      if (!revocationMayHaveCommitted) {
        clearRevocation(
          "revoke-assignment",
          targetId,
          operation.ownerContext.resourceId,
        );
      }
    } finally {
      mutationTracker.finish(operation);
    }
  }

  let lastLoadKey = "";
  $effect(() => {
    const loadKey = `${roleId}:${activeTab}`;
    if (!roleId || loadKey === lastLoadKey) return;
    lastLoadKey = loadKey;
    void loadRole();
  });
  onMount(restoreMutationLocks);
</script>

<div class="mb-5">
  <a
    href={resolve("/roles")}
    class="text-sm font-medium text-brand-700 hover:text-brand-900"
    >← {t("Roles & Permissions")}</a
  >
  <h2 class="mt-4 text-3xl font-bold text-surface-950">
    {role?.name || roleId}
  </h2>
  <p class="mt-1 font-mono text-xs text-surface-500">{roleId}</p>
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
  basePath={`/roles/${encodeURIComponent(roleId)}`}
/>

<RequestState {loading} {error} onRetry={loadRole}>
  {#if activeTab === "general"}
    <section class="console-card p-6">
      <h3 class="text-lg font-semibold text-surface-900">
        {t("detail.general")}
      </h3>
      <div class="mt-4 grid gap-4 md:grid-cols-2">
        <div>
          <label
            for="role-name"
            class="mb-1 block text-sm font-medium text-surface-700"
            >{t("Name")}</label
          ><input id="role-name" bind:value={roleForm.name} class="w-full" />
        </div>
        <div>
          <label
            for="role-description"
            class="mb-1 block text-sm font-medium text-surface-700"
            >{t("Description")}</label
          ><input
            id="role-description"
            bind:value={roleForm.description}
            class="w-full"
          />
        </div>
      </div>
      <button
        disabled={saving || !roleForm.name.trim()}
        onclick={() =>
          runMutation((mutationContext) =>
            updateRole(mutationContext.resourceId, roleForm),
          )}
        class="mt-5 rounded-lg bg-brand-600 px-4 py-2 text-sm font-medium text-white disabled:opacity-50"
        >{saving ? t("Saving...") : t("Save")}</button
      >
    </section>
  {:else if activeTab === "permissions"}
    <div class="space-y-5">
      <section class="console-card p-5">
        <h3 class="font-semibold text-surface-900">
          {t("roles.addPermission")}
        </h3>
        <div class="mt-4 grid gap-3 md:grid-cols-[1fr_1fr_auto]">
          <input
            bind:value={newPermission.name}
            placeholder="users.read"
          /><input
            bind:value={newPermission.description}
            placeholder={t("Description")}
          /><button
            disabled={saving || !newPermission.name.trim()}
            onclick={addPermission}
            class="rounded-lg bg-brand-600 px-4 py-2 text-sm font-medium text-white disabled:opacity-50"
            >{t("Add")}</button
          >
        </div>
      </section>
      <RequestState
        empty={permissions.length === 0}
        emptyTitle="users.noPermissions"
        ><div class="space-y-3">
          {#each permissions as permission (permission.id)}<div
              class="console-card flex items-start justify-between gap-4 p-4"
            >
              <div>
                <p class="font-mono text-sm font-semibold text-surface-900">
                  {permission.name}
                </p>
                <p class="mt-1 text-sm text-surface-500">
                  {permission.description || ""}
                </p>
              </div>
              <button
                disabled={saving ||
                  !mutationStorageReady ||
                  revocationUnknown("delete-permission", permission.id)}
                onclick={() => deletePermission(permission.id)}
                class="text-sm text-red-600 disabled:opacity-50"
                >{t("Delete")}</button
              >
            </div>
            {#if revocationUnknown("delete-permission", permission.id)}
              <button
                onclick={() => acknowledgeRevocation("delete-permission", permission.id)}
                class="text-xs font-semibold text-amber-900 underline"
                >{t("I verified permissions; allow delete again")}</button
              >
            {/if}
          {/each}
        </div></RequestState
      >
    </div>
  {:else if activeTab === "users"}
    <RequestState
      empty={userAssignments.length === 0}
      emptyTitle="No assignments"
      ><div class="console-card overflow-hidden">
        <table>
          <thead
            ><tr
              ><th>{t("Users")}</th><th>{t("organizations.title")}</th><th
              ></th></tr
            ></thead
          ><tbody
            >{#each userAssignments as assignment (assignmentId(assignment))}<tr
                ><td
                  >{assignment.user_email ||
                    assignment.user_id ||
                    assignment.userId}</td
                ><td
                  >{assignment.organization_id ||
                    assignment.organizationId ||
                    "-"}</td
                ><td class="text-right"
                  ><button
                    disabled={saving ||
                      !mutationStorageReady ||
                      revocationUnknown(
                        "revoke-assignment",
                        assignmentId(assignment),
                      )}
                    onclick={() => revokeAssignment(assignment)}
                    class="text-sm text-red-600 disabled:opacity-50"
                    >{t("Revoke")}</button
                  >{#if revocationUnknown(
                    "revoke-assignment",
                    assignmentId(assignment),
                  )}<button
                      onclick={() =>
                        acknowledgeRevocation(
                          "revoke-assignment",
                          assignmentId(assignment),
                        )}
                      class="ml-2 text-xs font-semibold text-amber-900 underline"
                      >{t("Reconciled; unlock")}</button
                    >{/if}</td
                ></tr
              >{/each}</tbody
          >
        </table>
      </div></RequestState
    >
  {:else}
    <RequestState
      empty={applicationAssignments.length === 0}
      emptyTitle="No assignments"
      ><div class="console-card overflow-hidden">
        <table>
          <thead
            ><tr
              ><th>{t("Applications")}</th><th>{t("organizations.title")}</th
              ><th></th></tr
            ></thead
          ><tbody
            >{#each applicationAssignments as assignment (assignmentId(assignment))}<tr
                ><td
                  >{assignment.application_name ||
                    assignment.application_id ||
                    assignment.applicationId}</td
                ><td
                  >{assignment.organization_id ||
                    assignment.organizationId ||
                    "-"}</td
                ><td class="text-right"
                  ><button
                    disabled={saving ||
                      !mutationStorageReady ||
                      revocationUnknown(
                        "revoke-assignment",
                        assignmentId(assignment),
                      )}
                    onclick={() => revokeAssignment(assignment)}
                    class="text-sm text-red-600 disabled:opacity-50"
                    >{t("Revoke")}</button
                  >{#if revocationUnknown(
                    "revoke-assignment",
                    assignmentId(assignment),
                  )}<button
                      onclick={() =>
                        acknowledgeRevocation(
                          "revoke-assignment",
                          assignmentId(assignment),
                        )}
                      class="ml-2 text-xs font-semibold text-amber-900 underline"
                      >{t("Reconciled; unlock")}</button
                    >{/if}</td
                ></tr
              >{/each}</tbody
          >
        </table>
      </div></RequestState
    >
  {/if}
</RequestState>
