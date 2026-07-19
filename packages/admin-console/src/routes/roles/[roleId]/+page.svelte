<script>
  import { page } from "$app/state";
  import { resolve } from "$app/paths";
  import DetailTabs from "$lib/components/DetailTabs.svelte";
  import RequestState from "$lib/components/RequestState.svelte";
  import { t } from "$lib/i18n.js";
  import { collectionItems, tabFromRoute } from "$lib/resource-page.js";
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
  let error = $state(null);
  let roleId = $derived(page.params.roleId);
  let activeTab = $derived(tabFromRoute(page.params.tab, tabValues, "general"));
  let userAssignments = $derived(
    assignments.filter((assignment) => assignment.user_id || assignment.userId),
  );
  let applicationAssignments = $derived(
    assignments.filter(
      (assignment) => assignment.application_id || assignment.applicationId,
    ),
  );

  async function loadRole() {
    loading = true;
    error = null;
    try {
      role = await getRole(roleId);
      if (activeTab === "permissions") {
        permissions = collectionItems(await listRolePermissions(roleId));
      } else if (activeTab === "users" || activeTab === "m2m") {
        assignments = collectionItems(await listRoleAssignments(roleId));
      }
      roleForm = { name: role.name || "", description: role.description || "" };
    } catch (requestError) {
      error = requestError;
    }
    loading = false;
  }

  async function runMutation(command) {
    saving = true;
    error = null;
    try {
      await command();
      await loadRole();
    } catch (requestError) {
      error = requestError;
    }
    saving = false;
  }

  function addPermission() {
    return runMutation(async () => {
      await createRolePermission(roleId, newPermission);
      newPermission = { name: "", description: "" };
    });
  }

  function assignmentId(assignment) {
    return assignment.id || assignment.assignment_id;
  }

  let lastLoadKey = "";
  $effect(() => {
    const loadKey = `${roleId}:${activeTab}`;
    if (!roleId || loadKey === lastLoadKey) return;
    lastLoadKey = loadKey;
    void loadRole();
  });
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
        onclick={() => runMutation(() => updateRole(roleId, roleForm))}
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
                disabled={saving}
                onclick={() =>
                  runMutation(() =>
                    deleteRolePermission(roleId, permission.id),
                  )}
                class="text-sm text-red-600 disabled:opacity-50"
                >{t("Delete")}</button
              >
            </div>{/each}
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
                    disabled={saving}
                    onclick={() =>
                      runMutation(() =>
                        revokeRole(roleId, assignmentId(assignment)),
                      )}
                    class="text-sm text-red-600 disabled:opacity-50"
                    >{t("Revoke")}</button
                  ></td
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
                    disabled={saving}
                    onclick={() =>
                      runMutation(() =>
                        revokeRole(roleId, assignmentId(assignment)),
                      )}
                    class="text-sm text-red-600 disabled:opacity-50"
                    >{t("Revoke")}</button
                  ></td
                ></tr
              >{/each}</tbody
          >
        </table>
      </div></RequestState
    >
  {/if}
</RequestState>
