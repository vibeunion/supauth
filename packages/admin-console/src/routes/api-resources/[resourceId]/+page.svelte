<script>
  import { page } from "$app/state";
  import { resolve } from "$app/paths";
  import DetailTabs from "$lib/components/DetailTabs.svelte";
  import RequestState from "$lib/components/RequestState.svelte";
  import { t } from "$lib/i18n.js";
  import { collectionItems, tabFromRoute } from "$lib/resource-page.js";
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
  let error = $state(null);
  let resourceId = $derived(page.params.resourceId);
  let activeTab = $derived(tabFromRoute(page.params.tab, tabValues, "general"));

  async function loadResource() {
    loading = true;
    error = null;
    try {
      resource = await getResource(resourceId);
      applications =
        activeTab === "permissions"
          ? collectionItems(await listResourceApplications(resourceId))
          : [];
      resourceForm = {
        name: resource.name || "",
        indicator: resource.indicator || "",
      };
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
      await loadResource();
    } catch (requestError) {
      error = requestError;
    }
    saving = false;
  }

  function addScope() {
    return runMutation(async () => {
      await createResourceScope(resourceId, newScope);
      newScope = { name: "", description: "" };
    });
  }

  let lastLoadKey = "";
  $effect(() => {
    const loadKey = `${resourceId}:${activeTab}`;
    if (!resourceId || loadKey === lastLoadKey) return;
    lastLoadKey = loadKey;
    void loadResource();
  });
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
          runMutation(() => updateResource(resourceId, resourceForm))}
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
                  disabled={saving}
                  onclick={() =>
                    runMutation(() =>
                      updateResourceScope(resourceId, scope.id, {
                        name: scope.name,
                        description: scope.description,
                      }),
                    )}
                  class="text-sm text-brand-700">{t("Save")}</button
                ><button
                  disabled={saving}
                  onclick={() =>
                    runMutation(() =>
                      deleteResourceScope(resourceId, scope.id),
                    )}
                  class="text-sm text-red-600">{t("Delete")}</button
                >
              </div>
            </div>{/each}
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
