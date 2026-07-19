<script>
  import { onMount } from "svelte";
  import { resolve } from "$app/paths";
  import { t } from "$lib/i18n.js";
  import {
    listResources,
    createResource,
    deleteResource,
  } from "$lib/api/client.js";

  let resources = $state([]);
  let loading = $state(true);
  let error = $state(null);
  let showCreate = $state(false);
  let newResource = $state({ name: "", indicator: "", scopes: "" });

  async function load() {
    loading = true;
    try {
      const res = await listResources();
      resources = res.items || res.data || (Array.isArray(res) ? res : []);
    } catch (e) {
      error = e.message;
    }
    loading = false;
  }

  async function handleCreate() {
    try {
      await createResource({
        name: newResource.name,
        indicator: newResource.indicator,
        scopes: newResource.scopes
          .split(",")
          .map((s) => s.trim())
          .filter(Boolean)
          .map((s) => ({ name: s })),
      });
      showCreate = false;
      newResource = { name: "", indicator: "", scopes: "" };
      await load();
    } catch (e) {
      error = e.message;
    }
  }

  async function handleDelete(id) {
    if (!confirm(t("Delete this resource?"))) return;
    try {
      await deleteResource(id);
      await load();
    } catch (e) {
      error = e.message;
    }
  }

  onMount(load);
</script>

<div class="flex items-center justify-between mb-6">
  <h2 class="text-2xl font-bold text-surface-900">{t("API Resources")}</h2>
  <button
    onclick={() => (showCreate = !showCreate)}
    class="px-4 py-2 bg-brand-600 text-white rounded-lg text-sm font-medium hover:bg-brand-700"
  >
    {showCreate ? t("Cancel") : `+ ${t("New Resource")}`}
  </button>
</div>

{#if error}
  <div class="bg-red-50 border border-red-200 rounded-lg p-4 text-red-700 mb-4">
    {error}
  </div>
{/if}

{#if showCreate}
  <div class="bg-white rounded-xl border border-surface-200 p-6 mb-6">
    <h3 class="text-lg font-semibold text-surface-800 mb-4">
      {t("New API Resource")}
    </h3>
    <div class="space-y-4">
      <div>
        <label
          for="res-name"
          class="block text-sm font-medium text-surface-700 mb-1"
          >{t("Name")}</label
        >
        <input
          id="res-name"
          bind:value={newResource.name}
          class="w-full px-3 py-2 border border-surface-300 rounded-lg text-sm"
          placeholder={t("My API")}
        />
      </div>
      <div>
        <label
          for="res-indicator"
          class="block text-sm font-medium text-surface-700 mb-1"
          >{t("Indicator (audience URL)")}</label
        >
        <input
          id="res-indicator"
          bind:value={newResource.indicator}
          class="w-full px-3 py-2 border border-surface-300 rounded-lg text-sm"
          placeholder="https://api.example.com"
        />
      </div>
      <div>
        <label
          for="res-scopes"
          class="block text-sm font-medium text-surface-700 mb-1"
          >{t("Scopes (comma-separated)")}</label
        >
        <input
          id="res-scopes"
          bind:value={newResource.scopes}
          class="w-full px-3 py-2 border border-surface-300 rounded-lg text-sm"
          placeholder="read, write, admin"
        />
      </div>
      <button
        onclick={handleCreate}
        class="px-4 py-2 bg-brand-600 text-white rounded-lg text-sm font-medium hover:bg-brand-700"
        >{t("Create")}</button
      >
    </div>
  </div>
{/if}

{#if loading}
  <p class="text-surface-400">{t("Loading...")}</p>
{:else if resources.length === 0}
  <div
    class="bg-surface-50 rounded-xl border border-surface-200 p-8 text-center"
  >
    <p class="text-surface-500">{t("No API resources defined")}</p>
    <p class="text-sm text-surface-400 mt-2">
      {t("Define resources and scopes to control API access")}
    </p>
  </div>
{:else}
  <div class="space-y-3">
    {#each resources as resource (resource.id)}
      <div class="bg-white rounded-xl border border-surface-200 p-5">
        <div class="flex items-start justify-between">
          <div>
            <a
              href={resolve(
                `/api-resources/${encodeURIComponent(resource.id)}/general`,
              )}
              class="font-semibold text-surface-900 hover:text-brand-700"
              >{resource.name}</a
            >
            <code class="text-sm font-mono text-brand-700"
              >{resource.indicator}</code
            >
          </div>
          <button
            onclick={() => handleDelete(resource.id)}
            class="text-sm text-red-500 hover:text-red-700"
            >{t("Delete")}</button
          >
        </div>
        {#if resource.scopes?.length}
          <div class="mt-3 flex flex-wrap gap-2">
            {#each resource.scopes as scope (scope.id)}
              <span
                class="px-3 py-1 bg-brand-50 text-brand-700 rounded-full text-sm font-medium"
                >{scope.name}</span
              >
            {/each}
          </div>
        {/if}
      </div>
    {/each}
  </div>
{/if}
