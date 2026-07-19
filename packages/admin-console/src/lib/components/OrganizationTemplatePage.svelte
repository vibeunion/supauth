<script>
  import { onMount } from "svelte";
  import { t } from "$lib/i18n.js";
  import {
    listOrgTemplates,
    createOrgTemplate,
    deleteOrgTemplate,
  } from "$lib/api/client.js";

  let templates = $state([]);
  let loading = $state(true);
  let error = $state(null);
  let showCreate = $state(false);
  let form = $state({
    name: "",
    description: "",
    template_roles:
      '[{"name":"owner","permissions":["organizations.manage","resource.read","resource.write"]},{"name":"member","permissions":["resource.read"]}]',
    template_scopes:
      '[{"name":"resource.read","description":"Read resources"},{"name":"resource.write","description":"Write resources"}]',
    is_default: false,
  });

  async function load() {
    loading = true;
    error = null;
    try {
      const res = await listOrgTemplates();
      templates = res.items || [];
    } catch (e) {
      error = e.message;
    }
    loading = false;
  }

  async function handleCreate() {
    try {
      await createOrgTemplate({
        name: form.name,
        description: form.description,
        template_roles: JSON.parse(form.template_roles || "[]"),
        template_scopes: JSON.parse(form.template_scopes || "[]"),
        is_default: form.is_default,
      });
      showCreate = false;
      await load();
    } catch (e) {
      error = e.message;
    }
  }

  async function handleDelete(id) {
    if (!confirm(t("Delete this template?"))) return;
    await deleteOrgTemplate(id);
    await load();
  }

  onMount(load);
</script>

<div class="flex items-center justify-between mb-6">
  <h2 class="text-2xl font-bold text-surface-900">
    {t("Organization Templates")}
  </h2>
  <button
    onclick={() => (showCreate = !showCreate)}
    class="px-4 py-2 bg-brand-600 text-white rounded-lg text-sm font-medium hover:bg-brand-700"
  >
    {showCreate ? t("Cancel") : `+ ${t("New Template")}`}
  </button>
</div>

{#if error}
  <div class="bg-red-50 border border-red-200 rounded-lg p-4 text-red-700 mb-4">
    {error}
  </div>
{/if}

{#if showCreate}
  <section
    class="bg-white rounded-xl border border-surface-200 p-6 mb-6 space-y-4"
  >
    <div>
      <label
        for="template-name"
        class="block text-sm font-medium text-surface-700 mb-1"
        >{t("Name")}</label
      >
      <input
        id="template-name"
        bind:value={form.name}
        class="w-full px-3 py-2 border border-surface-300 rounded-lg text-sm"
      />
    </div>
    <div>
      <label
        for="template-desc"
        class="block text-sm font-medium text-surface-700 mb-1"
        >{t("Description")}</label
      >
      <input
        id="template-desc"
        bind:value={form.description}
        class="w-full px-3 py-2 border border-surface-300 rounded-lg text-sm"
      />
    </div>
    <div>
      <label
        for="template-roles"
        class="block text-sm font-medium text-surface-700 mb-1"
        >{t("Roles JSON")}</label
      >
      <textarea
        id="template-roles"
        bind:value={form.template_roles}
        class="w-full h-28 px-3 py-2 border border-surface-300 rounded-lg text-sm font-mono"
      ></textarea>
    </div>
    <div>
      <label
        for="template-scopes"
        class="block text-sm font-medium text-surface-700 mb-1"
        >{t("Scopes JSON")}</label
      >
      <textarea
        id="template-scopes"
        bind:value={form.template_scopes}
        class="w-full h-24 px-3 py-2 border border-surface-300 rounded-lg text-sm font-mono"
      ></textarea>
    </div>
    <label class="flex items-center gap-2 text-sm text-surface-700">
      <input type="checkbox" bind:checked={form.is_default} />
      {t("Set as default template")}
    </label>
    <button
      onclick={handleCreate}
      class="px-4 py-2 bg-brand-600 text-white rounded-lg text-sm font-medium hover:bg-brand-700"
      >{t("Create")}</button
    >
  </section>
{/if}

{#if loading}
  <p class="text-surface-400">{t("Loading...")}</p>
{:else if templates.length === 0}
  <div
    class="bg-surface-50 rounded-xl border border-surface-200 p-8 text-center"
  >
    <p class="text-surface-500">{t("No templates configured")}</p>
  </div>
{:else}
  <div class="space-y-3">
    {#each templates as template (template.id)}
      <div class="bg-white rounded-xl border border-surface-200 p-5">
        <div class="flex items-start justify-between gap-4">
          <div>
            <div class="flex items-center gap-2">
              <h4 class="font-semibold text-surface-900">{template.name}</h4>
              {#if template.isDefault || template.is_default}
                <span
                  class="px-2 py-0.5 bg-green-100 text-green-700 rounded text-xs"
                  >{t("Default")}</span
                >
              {/if}
            </div>
            <p class="text-sm text-surface-500 mt-1">{template.description}</p>
            <p class="text-xs text-surface-400 mt-2">
              {t("Roles:")}
              {(template.templateRoles || template.template_roles || []).length}
              · {t("Scopes:")}
              {(template.templateScopes || template.template_scopes || [])
                .length}
            </p>
          </div>
          <button
            onclick={() => handleDelete(template.id)}
            class="text-sm text-red-500 hover:text-red-700"
            >{t("Delete")}</button
          >
        </div>
      </div>
    {/each}
  </div>
{/if}
