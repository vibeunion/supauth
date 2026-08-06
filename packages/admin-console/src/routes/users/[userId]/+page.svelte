<script>
  import { page } from "$app/state";
  import { resolve } from "$app/paths";
  import DetailTabs from "$lib/components/DetailTabs.svelte";
  import CapabilityStatus from "$lib/components/CapabilityStatus.svelte";
  import RequestState from "$lib/components/RequestState.svelte";
  import { t } from "$lib/i18n.js";
  import { collectionItems, tabFromRoute } from "$lib/resource-page.js";
  import {
    getUser,
    getUserPermissions,
    getUserRoles,
    getCapabilities,
    listApplications,
    listUserGrants,
    listUserLogs,
    listUserOrganizations,
    suspendUser,
    unsuspendUser,
  } from "$lib/api/client.js";
  import {
    permissionDescription,
    permissionLabel,
  } from "$lib/permission-catalog.js";

  const tabs = [
    { value: "settings", labelKey: "detail.settings" },
    { value: "roles", labelKey: "detail.roles" },
    { value: "logs", labelKey: "detail.logs" },
    { value: "organizations", labelKey: "detail.organizations" },
    { value: "grants", labelKey: "detail.grants" },
  ];
  const tabValues = tabs.map((tab) => tab.value);
  const userCapabilityNames = [
    "gotrue_admin_user_sessions",
    "gotrue_admin_identity_unlink",
    "gotrue_admin_oauth_grants",
  ];

  let user = $state(null);
  let roles = $state([]);
  let permissions = $state([]);
  let applications = $state([]);
  let selectedApplicationId = $state("");
  let logs = $state([]);
  let organizations = $state([]);
  let grants = $state([]);
  let capabilities = $state({});
  let capabilitiesLoading = $state(false);
  let capabilitiesError = $state(null);
  let loading = $state(true);
  let error = $state(null);
  let saving = $state(false);
  let activeTab = $derived(
    tabFromRoute(page.params.tab, tabValues, "settings"),
  );
  let userId = $derived(page.params.userId);
  let applicationContextUserId = "";
  let loadGeneration = 0;

  function timestamp(value) {
    return value ? new Date(value).toLocaleString() : t("common.notAvailable");
  }

  function userName() {
    return (
      user?.user_metadata?.full_name ||
      user?.user_metadata?.name ||
      user?.email ||
      userId
    );
  }

  function isSuspended() {
    return Boolean(
      user?.banned_until && new Date(user.banned_until) > new Date(),
    );
  }

  function applicationId(application) {
    return (
      application?.client_id ||
      application?.clientId ||
      application?.application_id ||
      application?.id ||
      ""
    );
  }

  function applicationLabel(application) {
    const id = applicationId(application);
    return [application?.name || application?.client_name || application?.clientName, id]
      .filter(Boolean)
      .join(" · ");
  }

  function roleFromAssignment(assignment) {
    return assignment?.role || assignment;
  }

  function roleKey(assignment) {
    const role = roleFromAssignment(assignment);
    return assignment?.id || assignment?.assignment_id || role?.id || role?.role_id;
  }

  function normalizedPermission(permission) {
    if (typeof permission === "string") return { name: permission };
    return {
      ...permission,
      name: permission?.name || permission?.permission || permission?.id || "-",
    };
  }

  function permissionKey(permission) {
    const normalized = normalizedPermission(permission);
    return normalized.id || normalized.name;
  }

  function isCurrentLoad(loadContext) {
    const applicationContext =
      activeTab === "roles" ? selectedApplicationId : "";
    return (
      loadContext.generation === loadGeneration &&
      loadContext.userId === userId &&
      loadContext.tab === activeTab &&
      loadContext.applicationId === applicationContext
    );
  }

  async function loadUserCapabilities(loadContext) {
    capabilitiesLoading = true;
    capabilitiesError = null;
    capabilities = {};
    try {
      const capabilityResponse = await getCapabilities();
      if (isCurrentLoad(loadContext)) {
        capabilities = capabilityResponse?.capabilities || {};
      }
    } catch (requestError) {
      if (isCurrentLoad(loadContext)) capabilitiesError = requestError;
    } finally {
      if (isCurrentLoad(loadContext)) capabilitiesLoading = false;
    }
  }

  function retryUserCapabilities() {
    return loadUserCapabilities({
      generation: loadGeneration,
      userId,
      tab: activeTab,
      applicationId: "",
    });
  }

  async function loadUser() {
    const loadContext = {
      generation: loadGeneration + 1,
      userId,
      tab: activeTab,
      applicationId: activeTab === "roles" ? selectedApplicationId : "",
    };
    loadGeneration = loadContext.generation;
    loading = true;
    error = null;
    if (loadContext.tab === "roles") {
      roles = [];
      permissions = [];
    }
    try {
      const userResponse = await getUser(loadContext.userId);
      if (!isCurrentLoad(loadContext)) return;
      user = userResponse;
      if (loadContext.tab === "settings") {
        void loadUserCapabilities(loadContext);
      } else if (loadContext.tab === "roles") {
        const [applicationResponse, roleResponse, permissionResponse] =
          await Promise.all([
            listApplications(),
            getUserRoles(
              loadContext.userId,
              loadContext.applicationId || undefined,
            ),
            getUserPermissions(
              loadContext.userId,
              undefined,
              loadContext.applicationId || undefined,
            ),
          ]);
        if (!isCurrentLoad(loadContext)) return;
        applications = collectionItems(applicationResponse);
        roles = collectionItems(roleResponse);
        permissions =
          permissionResponse?.permissions || collectionItems(permissionResponse);
      } else if (loadContext.tab === "logs") {
        const logResponse = await listUserLogs(loadContext.userId, { limit: 50 });
        if (isCurrentLoad(loadContext)) logs = collectionItems(logResponse);
      } else if (loadContext.tab === "organizations") {
        const organizationResponse = await listUserOrganizations(loadContext.userId);
        if (isCurrentLoad(loadContext)) organizations = collectionItems(organizationResponse);
      } else if (loadContext.tab === "grants") {
        const grantResponse = await listUserGrants(loadContext.userId);
        if (isCurrentLoad(loadContext)) grants = collectionItems(grantResponse);
      }
    } catch (requestError) {
      if (isCurrentLoad(loadContext)) error = requestError;
    } finally {
      if (isCurrentLoad(loadContext)) loading = false;
    }
  }

  async function toggleSuspension() {
    saving = true;
    error = null;
    try {
      if (isSuspended()) await unsuspendUser(userId);
      else await suspendUser(userId, { reason: "admin_console" });
      await loadUser();
    } catch (requestError) {
      error = requestError;
    }
    saving = false;
  }

  let lastLoadKey = "";
  $effect(() => {
    if (userId !== applicationContextUserId) {
      selectedApplicationId = "";
      applicationContextUserId = userId;
    }
    const applicationContext = activeTab === "roles" ? selectedApplicationId : "";
    const loadKey = `${userId}:${activeTab}:${applicationContext}`;
    if (!userId || loadKey === lastLoadKey) return;
    lastLoadKey = loadKey;
    void loadUser();
  });
</script>

<div class="mb-5">
  <a
    href={resolve("/users")}
    class="text-sm font-medium text-brand-700 hover:text-brand-900"
    >← {t("Users")}</a
  >
  <div class="mt-4 flex flex-wrap items-start justify-between gap-4">
    <div>
      <h2 class="text-3xl font-bold text-surface-950">{userName()}</h2>
      <p class="mt-1 font-mono text-xs text-surface-500">{userId}</p>
    </div>
    {#if user}
      <button
        disabled={saving}
        onclick={() => {
          if (!isSuspended() && !confirm(t("users.suspendConfirm"))) return;
          void toggleSuspension();
        }}
        class="rounded-lg border border-red-300 px-3 py-2 text-sm font-semibold text-red-700 hover:bg-red-50 disabled:opacity-50"
      >
        {isSuspended() ? t("users.restore") : t("Suspend")}
      </button>
    {/if}
  </div>
</div>

<DetailTabs
  {tabs}
  {activeTab}
  basePath={`/users/${encodeURIComponent(userId)}`}
/>

<RequestState {loading} {error} onRetry={loadUser}>
  {#if activeTab === "settings"}
    <div class="grid gap-5 lg:grid-cols-2">
      <section class="console-card p-6">
        <h3 class="text-lg font-semibold text-surface-900">{t("Details")}</h3>
        <dl class="mt-4 space-y-3 text-sm">
          <div>
            <dt class="text-surface-500">{t("Email")}</dt>
            <dd class="mt-1 font-medium text-surface-900">
              {user?.email || "-"}
            </dd>
          </div>
          <div>
            <dt class="text-surface-500">{t("Phone")}</dt>
            <dd class="mt-1 font-medium text-surface-900">
              {user?.phone || "-"}
            </dd>
          </div>
          <div>
            <dt class="text-surface-500">{t("users.createdAt")}</dt>
            <dd class="mt-1 font-medium text-surface-900">
              {timestamp(user?.created_at)}
            </dd>
          </div>
          <div>
            <dt class="text-surface-500">{t("users.lastSignIn")}</dt>
            <dd class="mt-1 font-medium text-surface-900">
              {timestamp(user?.last_sign_in_at)}
            </dd>
          </div>
        </dl>
      </section>
      <section class="console-card p-6">
        <h3 class="text-lg font-semibold text-surface-900">
          {t("users.mfaFactors")}
        </h3>
        <p class="mt-1 text-xs text-surface-500">{t("mfa.supabaseBoundary")}</p>
        <div class="mt-4 space-y-2">
          {#each (user?.factors || []).filter((factor) => factor.factor_type === "totp") as factor (factor.id)}
            <div class="rounded-lg border border-surface-200 px-3 py-2">
              <p class="text-sm font-medium text-surface-900">
                TOTP · {factor.friendly_name || factor.id}
              </p>
              <p class="mt-1 text-xs text-surface-500">
                {factor.status || "-"}
              </p>
            </div>
          {:else}
            <p class="rounded-lg bg-surface-50 p-4 text-sm text-surface-500">
              {t("users.noMfaFactors")}
            </p>
          {/each}
        </div>
        <p class="mt-3 text-xs text-surface-500">
          {t("mfa.aalCapabilityHint")}
        </p>
      </section>
      <section class="console-card p-6">
        <h3 class="text-lg font-semibold text-surface-900">
          {t("users.linkedIdentities")}
        </h3>
        <p class="mt-1 text-xs leading-5 text-surface-500">
          {t("users.linkedIdentitiesDescription")}
        </p>
        <div class="mt-4 space-y-2">
          {#each user?.identities || [] as identity (identity.id || identity.identity_id || identity.provider)}
            <div class="rounded-lg border border-surface-200 px-3 py-2">
              <p class="text-sm font-medium text-surface-900">
                {identity.provider || t("common.notAvailable")}
              </p>
              <p class="mt-1 break-all font-mono text-xs text-surface-500">
                {identity.identity_id || identity.id || t("common.notAvailable")}
              </p>
            </div>
          {:else}
            <p class="rounded-lg bg-surface-50 p-4 text-sm text-surface-500">
              {t("users.noLinkedIdentities")}
            </p>
          {/each}
        </div>
      </section>
      <section class="lg:col-span-2">
        <h3 class="text-lg font-semibold text-surface-900">
          {t("users.adminSecurityCapabilities")}
        </h3>
        <p class="mt-1 text-sm leading-6 text-surface-500">
          {t("users.adminSecurityCapabilitiesDescription")}
        </p>
        <div class="mt-4">
          <RequestState
            loading={capabilitiesLoading}
            error={capabilitiesError}
            onRetry={retryUserCapabilities}
          >
            <div class="grid gap-4 lg:grid-cols-2">
              {#each userCapabilityNames as capabilityName (capabilityName)}
                <CapabilityStatus
                  name={capabilityName}
                  capability={capabilities[capabilityName]}
                />
              {/each}
            </div>
          </RequestState>
        </div>
      </section>
    </div>
  {:else if activeTab === "roles"}
    <RequestState>
      <section class="console-card p-4">
        <label
          for="user-application-context"
          class="mb-1 block text-sm font-medium text-surface-700"
          >{t("users.applicationContext")}</label
        >
        <select
          id="user-application-context"
          bind:value={selectedApplicationId}
          class="w-full max-w-lg rounded-lg border border-surface-300 bg-white px-3 py-2 text-sm"
        >
          <option value="">{t("users.projectWide")}</option>
          {#each applications as application (applicationId(application))}
            <option value={applicationId(application)}>
              {applicationLabel(application)}
            </option>
          {/each}
        </select>
      </section>
      {#if roles.length}
        <div class="space-y-3">
          {#each roles as assignment (roleKey(assignment))}
            {@const role = roleFromAssignment(assignment)}
            <div class="console-card p-4">
              <p class="font-semibold text-surface-900">
                {role.name || role.role_name || role.role_id}
              </p>
              <p class="mt-1 text-sm text-surface-500">
                {role.description || ""}
              </p>
            </div>
          {/each}
        </div>
      {:else}
        <p class="console-card p-4 text-sm text-surface-500">{t("users.noRoles")}</p>
      {/if}
      <section class="console-card p-4">
        <h3 class="font-semibold text-surface-900">{t("users.permissions")}</h3>
        <div class="mt-3 space-y-2">
          {#each permissions as permission (permissionKey(permission))}
            {@const item = normalizedPermission(permission)}
            <div class="rounded-lg border border-surface-200 px-3 py-2">
              <p class="text-sm font-medium text-surface-900">{permissionLabel(item, t)}</p>
              <code class="text-xs text-surface-400">{item.name}</code>
              {#if permissionDescription(item, t)}
                <p class="mt-1 text-xs text-surface-500">{permissionDescription(item, t)}</p>
              {/if}
            </div>
          {:else}
            <p class="text-sm text-surface-500">{t("users.noPermissions")}</p>
          {/each}
        </div>
      </section>
    </RequestState>
  {:else if activeTab === "logs"}
    <RequestState empty={logs.length === 0} emptyTitle="No audit log entries">
      <div class="console-card overflow-hidden">
        <table>
          <thead
            ><tr
              ><th>{t("Time")}</th><th>{t("Event")}</th><th>{t("Resource")}</th
              ></tr
            ></thead
          ><tbody
            >{#each logs as log (log.id)}<tr
                ><td>{timestamp(log.created_at || log.createdAt)}</td><td
                  >{log.event_type || log.eventType}</td
                ><td>{log.resource_type || log.resourceType || "-"}</td></tr
              >{/each}</tbody
          >
        </table>
      </div>
    </RequestState>
  {:else if activeTab === "organizations"}
    <RequestState
      empty={organizations.length === 0}
      emptyTitle="organizations.noData"
    >
      <div class="space-y-3">
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
              {organization.role || organization.role_name || ""}
            </p></a
          >{/each}
      </div>
    </RequestState>
  {:else if activeTab === "grants"}
    <RequestState empty={grants.length === 0} emptyTitle="users.noGrants">
      <div class="space-y-3">
        {#each grants as grant (grant.id || grant.client_id)}
          <section class="console-card p-4">
            <div class="flex flex-wrap items-start justify-between gap-4">
              <div>
                <p class="font-semibold text-surface-900">
                  {grant.client_name || grant.client_id}
                </p>
                <p class="mt-1 font-mono text-xs text-surface-500">
                  {grant.client_id}
                </p>
              </div>
              <div class="text-right text-xs text-surface-500">
                <p title={t("users.grantReadonlyHint")}>{t("users.grantSource")}</p>
                <p class="mt-1 font-medium text-surface-700">
                  {grant.source === "gotrue" ? "GoTrue" : grant.source}
                </p>
                <button
                  type="button"
                  disabled
                  title={t("users.revokeUnavailable")}
                  class="mt-2 rounded-lg border border-surface-300 px-2.5 py-1 text-xs font-medium text-surface-400 disabled:cursor-not-allowed"
                >
                  {t("users.revokeGrant")}
                </button>
              </div>
            </div>
            <div class="mt-4">
              <p class="text-xs text-surface-500">{t("users.grantScopes")}</p>
              <div class="mt-2 flex flex-wrap gap-2">
                {#each grant.scopes || [] as scope (scope)}
                  <span
                    class="rounded-full bg-surface-100 px-2.5 py-1 font-mono text-xs text-surface-700"
                    >{scope}</span
                  >
                {:else}
                  <span class="text-sm text-surface-500">
                    {t("common.notAvailable")}
                  </span>
                {/each}
              </div>
            </div>
            <p class="mt-4 text-xs text-surface-500">
              {t("users.grantedAt")}: {timestamp(grant.granted_at)}
            </p>
          </section>
        {/each}
      </div>
    </RequestState>
  {/if}
</RequestState>
