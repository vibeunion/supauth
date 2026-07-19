<script>
  import { goto } from "$app/navigation";
  import { resolve } from "$app/paths";
  import { page } from "$app/state";
  import DetailTabs from "$lib/components/DetailTabs.svelte";
  import RequestState from "$lib/components/RequestState.svelte";
  import { AdminApiError } from "$lib/admin-api.js";
  import { t } from "$lib/i18n.js";
  import {
    GOTRUE_OAUTH_GRANT_TYPES,
    supportedOAuthGrantTypes,
  } from "$lib/oauth-grant-types.js";
  import {
    applicationDetailTabValues,
    collectionItems,
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

  let application = $state(null);
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
  let loading = $state(true);
  let saving = $state(false);
  let error = $state(null);
  let appId = $derived(page.params.appId);
  let requestedTab = $derived(page.params.tab || "settings");
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

  function initializeApplicationForm() {
    applicationForm = {
      client_name: application.client_name || "",
      redirect_uris: (application.redirect_uris || []).join(", "),
      grant_types: supportedOAuthGrantTypes(application.grant_types),
      token_endpoint_auth_method:
        application.token_endpoint_auth_method || "client_secret_basic",
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

  async function loadActiveTab() {
    if (activeTab === "roles") {
      roles = collectionItems(await listApplicationRoles(appId));
    } else if (activeTab === "logs") {
      logs = collectionItems(await listApplicationLogs(appId, { limit: 50 }));
    } else if (activeTab === "organizations") {
      organizations = collectionItems(
        await listApplicationOrganizations(appId),
      );
    } else if (activeTab === "branding") {
      initializeBranding(await getApplicationSignInExperience(appId));
    } else if (activeTab === "rules") {
      initializeAccessControl(await getApplicationAccessControl(appId));
    } else if (activeTab === "permissions") {
      const [bindingResponse, resourceResponse, consentResponse] =
        await Promise.all([
          listApplicationBindings(appId),
          listResources(),
          getApplicationConsent(appId),
        ]);
      bindings = collectionItems(bindingResponse);
      resources = collectionItems(resourceResponse);
      initializeConsent(consentResponse);
    }
  }

  async function loadApplication() {
    loading = true;
    error = null;
    try {
      application = await getApplication(appId);
      initializeApplicationForm();
      resetRelatedData();
      await loadActiveTab();
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
      await loadApplication();
    } catch (requestError) {
      error = requestError;
    }
    saving = false;
  }

  function saveApplication() {
    return runMutation(() =>
      updateApplication(appId, {
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
    return runMutation(() =>
      updateApplicationConsent(appId, {
        user_scopes: stringList(consent.user_scopes),
        organization_scopes: stringList(consent.organization_scopes),
        allowed_organization_ids: stringList(consent.allowed_organization_ids),
        require_explicit_consent: consent.require_explicit_consent,
      }),
    );
  }

  function saveBranding() {
    const { enabled, ...brandingValues } = branding;
    return runMutation(() =>
      updateApplicationSignInExperience(appId, {
        enabled,
        branding: brandingValues,
      }),
    );
  }

  async function rotateSecret() {
    saving = true;
    error = null;
    try {
      const response = await rotateApplicationSecret(appId);
      revealedSecret = response.client_secret || response.secret || "";
    } catch (requestError) {
      error = requestError;
    }
    saving = false;
  }

  async function removeApplication() {
    if (!confirm(t("Delete this application permanently?"))) return;
    try {
      await deleteApplication(appId);
      await goto(resolve("/applications"));
    } catch (requestError) {
      error = requestError;
    }
  }

  let lastLoadKey = "";
  $effect(() => {
    const loadKey = `${appId}:${activeTab}`;
    if (!appId || loadKey === lastLoadKey) return;
    lastLoadKey = loadKey;
    void loadApplication();
  });
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
      disabled={saving}
      onclick={removeApplication}
      class="rounded-lg border border-red-200 px-3 py-2 text-sm font-semibold text-red-600 hover:bg-red-50 disabled:opacity-50"
      >{t("Delete")}</button
    >
  </div>
</div>

<DetailTabs
  {tabs}
  {activeTab}
  basePath={`/applications/${encodeURIComponent(appId)}`}
/>

<RequestState {loading} error={error || tabError} onRetry={loadApplication}>
  {#if revealedSecret}<div
      class="mb-5 rounded-lg border border-amber-200 bg-amber-50 p-4"
    >
      <p class="text-xs font-semibold text-amber-800">
        {t("Client Secret (shown only once)")}
      </p>
      <code class="mt-2 block break-all text-sm text-amber-950"
        >{revealedSecret}</code
      >
    </div>{/if}
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
              >{t("Token Endpoint Auth Method")}</label
            ><select
              id="app-auth"
              disabled={application.client_type === "public"}
              bind:value={applicationForm.token_endpoint_auth_method}
              class="w-full"
              >{#each confidentialAuthMethods as authMethod (authMethod)}<option
                  value={authMethod}>{authMethod}</option
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
              >{t("Grant Types")}</span
            >
            <div class="space-y-2 rounded-lg border border-surface-200 p-3">
              {#each GOTRUE_OAUTH_GRANT_TYPES as grantType (grantType)}
                <label class="flex items-center gap-2 text-sm text-surface-700">
                  <input
                    type="checkbox"
                    value={grantType}
                    bind:group={applicationForm.grant_types}
                  />
                  <code>{grantType}</code>
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
              {t("Client Secret")}
            </h3>
            <p class="mt-1 text-sm text-surface-500">
              {t(
                "GoTrue exposes one current client secret and supports atomic rotation. SupaOAuth does not create a second secret store.",
              )}
            </p>
          </div>
          <button
            disabled={saving}
            onclick={rotateSecret}
            class="text-sm font-semibold text-brand-700 disabled:opacity-50"
            >{t("Rotate Secret")}</button
          >
        </div>
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
        disabled={saving}
        onclick={() =>
          runMutation(() => deleteApplicationSignInExperience(appId))}
        class="ml-3 text-sm font-medium text-surface-600 disabled:opacity-50"
        >{t("Clear Override")}</button
      >
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
              runMutation(() => createApplicationBinding(appId, newBinding))}
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
                disabled={saving}
                onclick={() =>
                  runMutation(() =>
                    deleteApplicationBinding(appId, binding.id),
                  )}
                class="text-xs text-red-600">{t("Unbind")}</button
              >
            </div>{/each}
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
          runMutation(() =>
            updateApplicationAccessControl(appId, accessControl),
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
