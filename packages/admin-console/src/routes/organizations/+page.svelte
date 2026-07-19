<script>
  import { onMount } from "svelte";
  import { resolve } from "$app/paths";
  import RequestState from "$lib/components/RequestState.svelte";
  import {
    createOrganization,
    deleteOrganization,
    listOrganizations,
  } from "$lib/api/client.js";
  import { t } from "$lib/i18n.js";
  import { collectionItems } from "$lib/resource-page.js";

  let organizations = $state([]);
  let loading = $state(true);
  let error = $state(null);
  let showCreate = $state(false);
  let newOrganization = $state({ name: "", description: "" });

  async function loadOrganizations() {
    loading = true;
    error = null;
    try {
      organizations = collectionItems(await listOrganizations());
    } catch (requestError) {
      error = requestError;
    }
    loading = false;
  }

  async function createNewOrganization() {
    try {
      await createOrganization(newOrganization);
      newOrganization = { name: "", description: "" };
      showCreate = false;
      await loadOrganizations();
    } catch (requestError) {
      error = requestError;
    }
  }

  async function removeOrganization(organizationId) {
    if (!confirm(t("organizations.deleteConfirm"))) return;
    try {
      await deleteOrganization(organizationId);
      await loadOrganizations();
    } catch (requestError) {
      error = requestError;
    }
  }

  onMount(loadOrganizations);
</script>

<div class="mb-6 flex items-start justify-between gap-4">
  <div>
    <h2 class="text-3xl font-bold text-surface-950">
      {t("organizations.title")}
    </h2>
    <p class="mt-2 text-sm text-surface-500">{t("organizations.noDataHint")}</p>
  </div>
  <button
    onclick={() => (showCreate = !showCreate)}
    class="rounded-lg bg-brand-600 px-4 py-2 text-sm font-medium text-white hover:bg-brand-700"
    >{showCreate ? t("common.cancel") : `+ ${t("organizations.new")}`}</button
  >
</div>

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
      disabled={!newOrganization.name.trim()}
      onclick={createNewOrganization}
      class="mt-4 rounded-lg bg-brand-600 px-4 py-2 text-sm font-medium text-white hover:bg-brand-700 disabled:opacity-50"
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
            onclick={() => removeOrganization(organization.id)}
            class="text-sm font-medium text-red-600 hover:text-red-800"
            >{t("organizations.delete")}</button
          >
        </div>
      </article>
    {/each}
  </div>
</RequestState>
