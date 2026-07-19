<script>
  import { page } from "$app/state";
  import { resolve } from "$app/paths";
  import DetailTabs from "$lib/components/DetailTabs.svelte";
  import RequestState from "$lib/components/RequestState.svelte";
  import { t } from "$lib/i18n.js";
  import {
    capabilityAvailable,
    collectionItems,
    tabFromRoute,
  } from "$lib/resource-page.js";
  import {
    addOrganizationMember,
    createOrganizationInvitation,
    deleteOrganizationApplication,
    getCapabilities,
    getOrganization,
    getOrganizationBranding,
    getOrganizationJit,
    listOrganizationApplications,
    listOrganizationInvitations,
    listOrganizationMembers,
    removeOrganizationMember,
    updateOrganization,
    updateOrganizationBranding,
    updateOrganizationJit,
    upsertOrganizationApplication,
  } from "$lib/api/client.js";

  const tabs = [
    { value: "settings", labelKey: "detail.settings" },
    { value: "members", labelKey: "detail.members" },
    { value: "m2m", labelKey: "detail.machineToMachine" },
    { value: "branding", labelKey: "detail.branding" },
  ];
  const tabValues = tabs.map((tab) => tab.value);

  let organization = $state(null);
  let members = $state([]);
  let invitations = $state([]);
  let applications = $state([]);
  let jit = $state({ enabled: false, domains: [] });
  let jitDomains = $state("");
  let jitAvailable = $state(false);
  let branding = $state({ logo_url: "", primary_color: "" });
  let organizationForm = $state({ name: "", description: "" });
  let inviteEmail = $state("");
  let newMember = $state({ user_id: "", role: "member" });
  let newApplication = $state({ app_id: "" });
  let loading = $state(true);
  let saving = $state(false);
  let error = $state(null);
  let orgId = $derived(page.params.orgId);
  let activeTab = $derived(
    tabFromRoute(page.params.tab, tabValues, "settings"),
  );

  async function loadOrganization() {
    loading = true;
    error = null;
    try {
      organization = await getOrganization(orgId);
      organizationForm = {
        name: organization.name || "",
        description: organization.description || "",
      };
      if (activeTab === "settings") {
        const capabilities = await getCapabilities();
        jitAvailable = capabilityAvailable(
          capabilities,
          "business_organization_jit_v1",
        );
        if (jitAvailable) {
          jit = await getOrganizationJit(orgId);
          jitDomains = (
            jit.domains ||
            jit.emailDomains ||
            jit.email_domains ||
            []
          ).join(", ");
        } else {
          jit = { enabled: false, domains: [] };
          jitDomains = "";
        }
      } else if (activeTab === "members") {
        const [memberResponse, invitationResponse] = await Promise.all([
          listOrganizationMembers(orgId),
          listOrganizationInvitations(orgId),
        ]);
        members = collectionItems(memberResponse);
        invitations = collectionItems(invitationResponse);
      } else if (activeTab === "m2m") {
        applications = collectionItems(
          await listOrganizationApplications(orgId),
        );
      } else if (activeTab === "branding") {
        branding = await getOrganizationBranding(orgId);
      }
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
      await loadOrganization();
    } catch (requestError) {
      error = requestError;
    }
    saving = false;
  }

  function saveSettings() {
    return runMutation(() => {
      const updates = [updateOrganization(orgId, organizationForm)];
      if (jitAvailable) {
        updates.push(updateOrganizationJit(orgId, {
          enabled: jit.enabled ?? false,
          domains: jitDomains
            .split(",")
            .map((domain) => domain.trim())
            .filter(Boolean),
        }));
      }
      return Promise.all(updates);
    });
  }

  function inviteMember() {
    return runMutation(async () => {
      await createOrganizationInvitation(orgId, { email: inviteEmail.trim() });
      inviteEmail = "";
    });
  }

  function addMember() {
    return runMutation(async () => {
      await addOrganizationMember(orgId, newMember);
      newMember = { user_id: "", role: "member" };
    });
  }

  function grantApplication() {
    return runMutation(async () => {
      await upsertOrganizationApplication(orgId, newApplication.app_id);
      newApplication = { app_id: "" };
    });
  }

  let lastLoadKey = "";
  $effect(() => {
    const loadKey = `${orgId}:${activeTab}`;
    if (!orgId || loadKey === lastLoadKey) return;
    lastLoadKey = loadKey;
    void loadOrganization();
  });
</script>

<div class="mb-5">
  <a
    href={resolve("/organizations")}
    class="text-sm font-medium text-brand-700 hover:text-brand-900"
    >← {t("organizations.title")}</a
  >
  <h2 class="mt-4 text-3xl font-bold text-surface-950">
    {organization?.name || orgId}
  </h2>
  <p class="mt-1 font-mono text-xs text-surface-500">{orgId}</p>
</div>

<DetailTabs
  {tabs}
  {activeTab}
  basePath={`/organizations/${encodeURIComponent(orgId)}`}
/>

<RequestState {loading} {error} onRetry={loadOrganization}>
  {#if activeTab === "settings"}
    <section class="console-card p-6">
      <h3 class="text-lg font-semibold text-surface-900">
        {t("detail.general")}
      </h3>
      <div class="mt-4 grid gap-4 md:grid-cols-2">
        <div>
          <label
            for="detail-org-name"
            class="mb-1 block text-sm font-medium text-surface-700"
            >{t("Name")}</label
          ><input
            id="detail-org-name"
            bind:value={organizationForm.name}
            class="w-full"
          />
        </div>
        <div>
          <label
            for="detail-org-description"
            class="mb-1 block text-sm font-medium text-surface-700"
            >{t("Description")}</label
          ><input
            id="detail-org-description"
            bind:value={organizationForm.description}
            class="w-full"
          />
        </div>
      </div>
      {#if jitAvailable}
        <div class="mt-5 rounded-lg border border-surface-200 p-4">
          <label class="flex items-center justify-between"
            ><span class="font-medium text-surface-900"
              >{t("organizations.jitProvisioning")}</span
            ><input type="checkbox" bind:checked={jit.enabled} /></label
          ><label for="jit-domains" class="mt-4 block text-sm text-surface-600"
            >{t("Domains")}</label
          ><input
            id="jit-domains"
            bind:value={jitDomains}
            placeholder="example.com"
            class="mt-1 w-full"
          />
        </div>
      {:else}
        <div class="mt-5 rounded-lg border border-amber-200 bg-amber-50 p-4">
          <p class="font-medium text-amber-900">{t("state.unsupported")}</p>
          <p class="mt-1 text-sm text-amber-800">
            {t("state.unsupportedDescription")}
          </p>
        </div>
      {/if}
      <button
        disabled={saving || !organizationForm.name.trim()}
        onclick={saveSettings}
        class="mt-5 rounded-lg bg-brand-600 px-4 py-2 text-sm font-medium text-white hover:bg-brand-700 disabled:opacity-50"
        >{saving ? t("Saving...") : t("Save")}</button
      >
    </section>
  {:else if activeTab === "members"}
    <div class="space-y-5">
      <section class="console-card p-5">
        <h3 class="font-semibold text-surface-900">{t("detail.members")}</h3>
        <div class="mt-4 grid gap-3 md:grid-cols-[1fr_10rem_auto]">
          <input bind:value={newMember.user_id} placeholder="user uuid" /><input
            bind:value={newMember.role}
            placeholder="member"
          /><button
            disabled={saving || !newMember.user_id.trim()}
            onclick={addMember}
            class="rounded-lg bg-brand-600 px-4 py-2 text-sm font-medium text-white disabled:opacity-50"
            >{t("Add")}</button
          >
        </div>
      </section>
      <RequestState empty={members.length === 0} emptyTitle="No members"
        ><div class="console-card overflow-hidden">
          <table>
            <thead
              ><tr><th>{t("Users")}</th><th>{t("Roles")}</th><th></th></tr
              ></thead
            ><tbody
              >{#each members as member (member.id)}{@const memberUserId =
                  member.user_id}<tr
                  ><td>{member.email || memberUserId}</td><td
                    >{member.role || member.role_name || "-"}</td
                  ><td class="text-right"
                    ><button
                      disabled={saving || !memberUserId}
                      onclick={() =>
                        runMutation(() =>
                          removeOrganizationMember(orgId, memberUserId),
                        )}
                      class="text-sm text-red-600">{t("Delete")}</button
                    ></td
                  ></tr
                >{/each}</tbody
            >
          </table>
        </div></RequestState
      >
      <section class="console-card p-5">
        <h3 class="font-semibold text-surface-900">
          {t("organizations.invitations")}
        </h3>
        <div class="mt-4 flex gap-3">
          <input
            type="email"
            bind:value={inviteEmail}
            placeholder="user@example.com"
            class="min-w-0 flex-1"
          /><button
            disabled={saving || !inviteEmail.trim()}
            onclick={inviteMember}
            class="rounded-lg bg-brand-600 px-4 py-2 text-sm font-medium text-white disabled:opacity-50"
            >{t("organizations.invite")}</button
          >
        </div>
        <div class="mt-4 space-y-2">
          {#each invitations as invitation (invitation.id)}<p
              class="rounded-lg bg-surface-50 px-3 py-2 text-sm text-surface-600"
            >
              {invitation.email} · {invitation.status}
            </p>{/each}
        </div>
      </section>
    </div>
  {:else if activeTab === "m2m"}
    <div class="space-y-5">
      <section class="console-card p-5">
        <h3 class="font-semibold text-surface-900">
          {t("organizations.applicationAccess")}
        </h3>
        <div class="mt-4 grid gap-3 md:grid-cols-[1fr_auto]">
          <input
            bind:value={newApplication.app_id}
            placeholder="client_id"
          /><button
            disabled={saving || !newApplication.app_id.trim()}
            onclick={grantApplication}
            class="rounded-lg bg-brand-600 px-4 py-2 text-sm font-medium text-white disabled:opacity-50"
            >{t("organizations.grant")}</button
          >
        </div>
      </section>
      <RequestState
        empty={applications.length === 0}
        emptyTitle="No applications yet"
        ><div class="space-y-3">
          {#each applications as application (application.application_id || application.applicationId)}{@const appId =
              application.application_id || application.applicationId}
            <div
              class="console-card flex items-center justify-between gap-4 p-4"
            >
              <span class="font-mono text-sm text-surface-800">{appId}</span
              ><button
                disabled={saving}
                onclick={() =>
                  runMutation(() =>
                    deleteOrganizationApplication(orgId, appId),
                  )}
                class="text-sm text-red-600">{t("Delete")}</button
              >
            </div>{/each}
        </div></RequestState
      >
    </div>
  {:else if activeTab === "branding"}
    <section class="console-card p-6">
      <h3 class="text-lg font-semibold text-surface-900">
        {t("detail.branding")}
      </h3>
      <div class="mt-4 grid gap-4 md:grid-cols-2">
        <div>
          <label
            for="org-logo"
            class="mb-1 block text-sm font-medium text-surface-700"
            >{t("Logo URL")}</label
          ><input id="org-logo" bind:value={branding.logo_url} class="w-full" />
        </div>
        <div>
          <label
            for="org-color"
            class="mb-1 block text-sm font-medium text-surface-700"
            >{t("Primary Color")}</label
          ><input
            id="org-color"
            bind:value={branding.primary_color}
            class="w-full"
          />
        </div>
      </div>
      <button
        disabled={saving}
        onclick={() =>
          runMutation(() => updateOrganizationBranding(orgId, branding))}
        class="mt-5 rounded-lg bg-brand-600 px-4 py-2 text-sm font-medium text-white disabled:opacity-50"
        >{saving ? t("Saving...") : t("Save")}</button
      >
    </section>
  {/if}
</RequestState>
