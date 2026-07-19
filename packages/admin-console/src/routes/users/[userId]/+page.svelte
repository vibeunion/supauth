<script>
  import { page } from "$app/state";
  import { resolve } from "$app/paths";
  import DetailTabs from "$lib/components/DetailTabs.svelte";
  import RequestState from "$lib/components/RequestState.svelte";
  import { t } from "$lib/i18n.js";
  import { collectionItems, tabFromRoute } from "$lib/resource-page.js";
  import {
    getUser,
    getUserRoles,
    listUserGrants,
    listUserLogs,
    listUserOrganizations,
    suspendUser,
    unsuspendUser,
  } from "$lib/api/client.js";

  const tabs = [
    { value: "settings", labelKey: "detail.settings" },
    { value: "roles", labelKey: "detail.roles" },
    { value: "logs", labelKey: "detail.logs" },
    { value: "organizations", labelKey: "detail.organizations" },
    { value: "grants", labelKey: "detail.grants" },
  ];
  const tabValues = tabs.map((tab) => tab.value);

  let user = $state(null);
  let roles = $state([]);
  let logs = $state([]);
  let organizations = $state([]);
  let grants = $state([]);
  let loading = $state(true);
  let error = $state(null);
  let saving = $state(false);
  let activeTab = $derived(
    tabFromRoute(page.params.tab, tabValues, "settings"),
  );
  let userId = $derived(page.params.userId);

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

  async function loadUser() {
    loading = true;
    error = null;
    try {
      user = await getUser(userId);
      if (activeTab === "roles") {
        roles = collectionItems(await getUserRoles(userId));
      } else if (activeTab === "logs") {
        logs = collectionItems(await listUserLogs(userId, { limit: 50 }));
      } else if (activeTab === "organizations") {
        organizations = collectionItems(await listUserOrganizations(userId));
      } else if (activeTab === "grants") {
        grants = collectionItems(await listUserGrants(userId));
      }
    } catch (requestError) {
      error = requestError;
    }
    loading = false;
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
    const loadKey = `${userId}:${activeTab}`;
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
        onclick={toggleSuspension}
        class="rounded-lg border border-surface-300 px-3 py-2 text-sm font-semibold text-surface-700 hover:bg-surface-50 disabled:opacity-50"
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
    </div>
  {:else if activeTab === "roles"}
    <RequestState empty={roles.length === 0} emptyTitle="users.noRoles">
      <div class="space-y-3">
        {#each roles as role (role.id || role.role_id)}<div
            class="console-card p-4"
          >
            <p class="font-semibold text-surface-900">
              {role.name || role.role_name || role.role_id}
            </p>
            <p class="mt-1 text-sm text-surface-500">
              {role.description || ""}
            </p>
          </div>{/each}
      </div>
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
                <p>{t("users.grantSource")}</p>
                <p class="mt-1 font-medium text-surface-700">
                  {grant.source === "gotrue" ? "GoTrue" : grant.source}
                </p>
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
