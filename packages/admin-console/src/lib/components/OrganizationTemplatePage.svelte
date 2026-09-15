<script lang="ts">
  import type { AdminEndpointResult } from "@supauth/shared";
  import { errorMessage } from "$lib/resource-page.js";
  import { onMount } from "svelte";
  import { t } from "$lib/i18n.js";
  import RequestState from "$lib/components/RequestState.svelte";
  import {
    listOrgTemplates,
    createOrgTemplate,
    deleteOrgTemplate,
  } from "$lib/api/client.js";

  type Template = AdminEndpointResult<"listOrgTemplates">["items"][number];
  type TemplateRole = NonNullable<Template["templateRoles"]>[number];
  type TemplateScope = NonNullable<Template["templateScopes"]>[number];
  let templates = $state<Template[]>([]);
  let loading = $state(true);
  let error = $state<string | null>(null);
  let showCreate = $state(false);
  let deletingTemplateId = $state<string | null>(null);
  let expandedTemplateId = $state<string | null>(null);
  let form = $state({
    name: "",
    description: "",
    template_roles:
      '[{"name":"owner","permissions":["organizations.manage","resource.read","resource.write"]},{"name":"member","permissions":["resource.read"]}]',
    template_scopes:
      '[{"name":"resource.read","description":"Read resources"},{"name":"resource.write","description":"Write resources"}]',
    is_default: false,
  });

  const DEFAULT_TEMPLATE_NAME = "Default Organization";
  const DEFAULT_TEMPLATE_DESCRIPTION =
    "Standard organization with owner/admin/member roles";
  const ORGANIZATION_TEMPLATE_NAME_MAX_LENGTH = 255;

  function organizationTemplateItems(response: AdminEndpointResult<"listOrgTemplates">) {
    if (
      !response ||
      typeof response !== "object" ||
      !Array.isArray(response.items) ||
      !response.items.every(validOrganizationTemplate)
    ) {
      throw new Error(t("orgTemplates.invalidResponse"));
    }
    return response.items;
  }

  function validOrganizationTemplate(template: Template) {
    const roles = template?.templateRoles ?? template?.template_roles;
    const scopes = template?.templateScopes ?? template?.template_scopes;
    const defaultFlag = template?.isDefault ?? template?.is_default;
    return typeof template?.id === "string" &&
      typeof template?.name === "string" &&
      (template.description === null || typeof template.description === "string") &&
      Array.isArray(roles) &&
      roles.every(validTemplateRole) &&
      Array.isArray(scopes) &&
      scopes.every(validTemplateScope) &&
      typeof defaultFlag === "boolean";
  }

  function validTemplateRole(role: unknown): role is TemplateRole {
    return !!(role &&
      typeof role === "object" &&
      !Array.isArray(role) &&
      Object.keys(role).every((field) =>
        field === "name" || field === "permissions"
      ) &&
      "name" in role &&
      typeof role.name === "string" &&
      role.name.trim().length > 0 &&
      "permissions" in role && Array.isArray(role.permissions) &&
      role.permissions.every((permission) =>
        typeof permission === "string" && permission.trim().length > 0
      ));
  }

  function validTemplateScope(scope: unknown): scope is TemplateScope {
    return !!(scope &&
      typeof scope === "object" &&
      !Array.isArray(scope) &&
      Object.keys(scope).every((field) =>
        field === "name" || field === "description"
      ) &&
      "name" in scope && typeof scope.name === "string" &&
      scope.name.trim().length > 0 &&
      (!("description" in scope) || scope.description === undefined || typeof scope.description === "string"));
  }

  function templateRoles(template: Template) {
    return template.templateRoles ?? template.template_roles ?? [];
  }

  function templateScopes(template: Template) {
    return template.templateScopes ?? template.template_scopes ?? [];
  }

  function isDefaultTemplate(template: Template) {
    return template.isDefault ?? template.is_default;
  }

  function templateName(template: Template) {
    return isDefaultTemplate(template) && template.name === DEFAULT_TEMPLATE_NAME
      ? t("orgTemplates.defaultName")
      : template.name;
  }

  function templateDescription(template: Template) {
    return isDefaultTemplate(template) &&
      template.description === DEFAULT_TEMPLATE_DESCRIPTION
      ? t("orgTemplates.defaultDescription")
      : template.description;
  }

  const BUILT_IN_ROLE_KEYS: Record<string, string> = {
    owner: "tenant.role.owner",
    admin: "tenant.role.admin",
    member: "tenant.role.member",
  };
  const BUILT_IN_PERMISSION_KEYS: Record<string, string> = {
    "organization.manage": "perm.organization.manage.label",
    "organization.members.manage": "perm.organization.members.manage.label",
    "organization.settings.manage": "perm.organization.settings.manage.label",
    "resource.read": "perm.resource.read.label",
    "resource.write": "perm.resource.write.label",
  };

  function localizedBuiltIn(value: string, keys: Readonly<Record<string, string>>) {
    const key = keys[value];
    return key ? t(key) : value;
  }

  function localizedScopeDescription(scope: TemplateScope) {
    const key = BUILT_IN_PERMISSION_KEYS[scope.name];
    return key ? t(key.replace(/\.label$/, ".desc")) : scope.description;
  }

  function organizationTemplateDraft() {
    const name = form.name.trim();
    const templateRoles: unknown = JSON.parse(form.template_roles || "[]");
    const templateScopes: unknown = JSON.parse(form.template_scopes || "[]");
    if (!name ||
      name.length > ORGANIZATION_TEMPLATE_NAME_MAX_LENGTH ||
      !Array.isArray(templateRoles) ||
      !templateRoles.every(validTemplateRole) ||
      !Array.isArray(templateScopes) ||
      !templateScopes.every(validTemplateScope)) {
      throw new SyntaxError("Invalid organization template input");
    }
    return {
      name,
      description: form.description,
      template_roles: templateRoles,
      template_scopes: templateScopes,
      is_default: form.is_default,
    };
  }

  async function loadTemplates() {
    loading = true;
    error = null;
    try {
      const response = await listOrgTemplates();
      templates = organizationTemplateItems(response);
    } catch (requestError) {
      error = errorMessage(requestError);
    } finally {
      loading = false;
    }
  }

  async function createOrganizationTemplate() {
    let templatePayload;
    try {
      templatePayload = organizationTemplateDraft();
    } catch (parseError) {
      if (!(parseError instanceof SyntaxError)) throw parseError;
      error = t("orgTemplates.invalidInput");
      return;
    }
    error = null;
    try {
      await createOrgTemplate(templatePayload);
      showCreate = false;
      await loadTemplates();
    } catch (requestError) {
      error = errorMessage(requestError);
    }
  }

  async function deleteOrganizationTemplate(template: Template) {
    if (isDefaultTemplate(template)) {
      error = t("orgTemplates.deleteProtected");
      return;
    }
    if (!confirm(t("Delete this template?"))) return;
    deletingTemplateId = template.id;
    error = null;
    try {
      await deleteOrgTemplate(template.id);
      await loadTemplates();
    } catch (requestError) {
      error = requestError && typeof requestError === "object" && "code" in requestError && requestError.code === "default_organization_template_protected"
        ? t("orgTemplates.deleteProtected")
        : errorMessage(requestError);
    } finally {
      deletingTemplateId = null;
    }
  }

  function toggleDetails(templateId: string) {
    expandedTemplateId = expandedTemplateId === templateId ? null : templateId;
  }

  onMount(loadTemplates);
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
        required
        maxlength={ORGANIZATION_TEMPLATE_NAME_MAX_LENGTH}
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
      onclick={createOrganizationTemplate}
      disabled={!form.name.trim()}
      class="px-4 py-2 bg-brand-600 text-white rounded-lg text-sm font-medium hover:bg-brand-700 disabled:cursor-not-allowed disabled:opacity-50"
      >{t("Create")}</button
    >
  </section>
{/if}

<RequestState
  {loading}
  {error}
  empty={templates.length === 0}
  emptyTitle="No templates configured"
  onRetry={loadTemplates}
>
  <div class="space-y-3">
    {#each templates as template (template.id)}
      {@const defaultTemplate = isDefaultTemplate(template)}
      {@const roles = templateRoles(template)}
      {@const scopes = templateScopes(template)}
      <article class="bg-white rounded-xl border border-surface-200 p-5">
        <div class="flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
          <div class="min-w-0">
            <div class="flex items-center gap-2">
              <h4 class="font-semibold text-surface-900">
                {templateName(template)}
              </h4>
              {#if defaultTemplate}
                <span
                  class="px-2 py-0.5 bg-green-100 text-green-700 rounded text-xs"
                  >{t("Default")}</span
                >
              {/if}
            </div>
            <p class="text-sm text-surface-500 mt-1">
              {templateDescription(template) || ""}
            </p>
            <p class="text-xs text-surface-400 mt-2">
              {t("orgTemplates.roles")}: {roles.length}
              · {t("orgTemplates.scopes")}: {scopes.length}
            </p>
          </div>
          <div class="flex shrink-0 flex-wrap items-center gap-3 sm:justify-end">
            <button
              type="button"
              onclick={() => toggleDetails(template.id)}
              class="text-sm font-medium text-brand-700 hover:text-brand-900"
              >{expandedTemplateId === template.id
                ? t("orgTemplates.hideDetails")
                : t("orgTemplates.viewDetails")}</button
            >
            {#if defaultTemplate}
              <span
                class="text-xs font-medium text-surface-400"
                title={t("orgTemplates.deleteProtected")}
                >{t("orgTemplates.deleteProtected")}</span
              >
            {:else}
              <button
                type="button"
                disabled={deletingTemplateId === template.id}
                onclick={() => deleteOrganizationTemplate(template)}
                class="text-sm text-red-500 hover:text-red-700 disabled:cursor-wait disabled:opacity-50"
                >{t("Delete")}</button
              >
            {/if}
          </div>
        </div>
        {#if expandedTemplateId === template.id}
          <div class="mt-4 grid gap-4 border-t border-surface-200 pt-4 lg:grid-cols-2">
            <section>
              <h5 class="text-sm font-semibold text-surface-800">
                {t("orgTemplates.roles")}
              </h5>
              {#if roles.length === 0}
                <p class="mt-2 text-sm text-surface-500">
                  {t("orgTemplates.noRoles")}
                </p>
              {:else}
                <div class="mt-2 space-y-2">
                  {#each roles as role}
                    <div class="rounded-lg bg-surface-50 p-3">
                      <p class="text-sm font-medium text-surface-800">
                        {localizedBuiltIn(role.name, BUILT_IN_ROLE_KEYS)}
                      </p>
                      <p class="mt-1 break-words text-xs text-surface-500">
                        {role.permissions.map((permission) =>
                          localizedBuiltIn(permission, BUILT_IN_PERMISSION_KEYS)
                        ).join(", ")}
                      </p>
                    </div>
                  {/each}
                </div>
              {/if}
            </section>
            <section>
              <h5 class="text-sm font-semibold text-surface-800">
                {t("orgTemplates.scopes")}
              </h5>
              {#if scopes.length === 0}
                <p class="mt-2 text-sm text-surface-500">
                  {t("orgTemplates.noScopes")}
                </p>
              {:else}
                <div class="mt-2 space-y-2">
                  {#each scopes as scope}
                    <div class="rounded-lg bg-surface-50 p-3">
                      <p class="text-sm font-medium text-surface-800">
                        {localizedBuiltIn(scope.name, BUILT_IN_PERMISSION_KEYS)}
                      </p>
                      {#if scope.description}
                        <p class="mt-1 text-xs text-surface-500">
                          {localizedScopeDescription(scope)}
                        </p>
                      {/if}
                    </div>
                  {/each}
                </div>
              {/if}
            </section>
          </div>
        {/if}
      </article>
    {/each}
  </div>
</RequestState>
