<script>
  import { onMount } from "svelte";
  import RequestState from "$lib/components/RequestState.svelte";
  import { AdminApiError } from "$lib/admin-api.js";
  import {
    createTenantInvitation,
    getCapabilities,
    listTenantInvitations,
    listTenantMembers,
    removeTenantMember,
    updateTenantMember,
  } from "$lib/api/client.js";
  import { t } from "$lib/i18n.js";
  import { capabilityAvailable, collectionItems } from "$lib/resource-page.js";
  import {
    invitationStatusLabelKey,
    tenantRoleLabelKey,
  } from "$lib/tenant-settings.js";

  let members = $state([]);
  let invitations = $state([]);
  let invite = $state({ email: "", role: "viewer" });
  let loading = $state(true);
  let saving = $state(false);
  let error = $state(null);

  async function loadMembers() {
    loading = true;
    error = null;
    try {
      const capabilities = await getCapabilities();
      if (!capabilityAvailable(capabilities, "tenant_collaborators_v1")) {
        throw new AdminApiError(
          t("state.unsupportedDescription"),
          501,
          "capability_unavailable",
        );
      }
      const [memberResponse, invitationResponse] = await Promise.all([
        listTenantMembers(),
        listTenantInvitations(),
      ]);
      members = collectionItems(memberResponse);
      invitations = collectionItems(invitationResponse);
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
      await loadMembers();
    } catch (requestError) {
      error = requestError;
    }
    saving = false;
  }

  function sendInvitation() {
    return runMutation(async () => {
      await createTenantInvitation(invite);
      invite = { email: "", role: "viewer" };
    });
  }

  onMount(loadMembers);
</script>

<div class="mb-6">
  <h2 class="text-2xl font-bold text-surface-950">{t("tenant.members.title")}</h2>
  <p class="mt-2 text-sm text-surface-500">
    {t("tenant.members.description")}
  </p>
</div>

<RequestState {loading} {error} onRetry={loadMembers}>
  <div class="space-y-5">
    <section class="console-card p-5">
      <h3 class="font-semibold text-surface-900">{t("tenant.members.invite")}</h3>
      <div class="mt-4 grid gap-3 md:grid-cols-[1fr_10rem_auto]">
        <input
          type="email"
          bind:value={invite.email}
          placeholder="admin@example.com"
        /><select bind:value={invite.role}
          ><option value="viewer">{t("tenant.role.viewer")}</option><option value="developer"
            >{t("tenant.role.developer")}</option
          ><option value="admin">{t("tenant.role.admin")}</option><option value="owner"
            >{t("tenant.role.owner")}</option
          ></select
        ><button
          disabled={saving || !invite.email.trim()}
          onclick={sendInvitation}
          class="rounded-lg bg-brand-600 px-4 py-2 text-sm font-medium text-white disabled:opacity-50"
          >{t("organizations.invite")}</button
        >
      </div>
    </section>
    <RequestState empty={members.length === 0} emptyTitle={t("tenant.members.empty")}
      ><div class="console-card overflow-hidden">
        <table>
          <thead
            ><tr><th>{t("Email")}</th><th>{t("tenant.members.role")}</th><th></th></tr></thead
          ><tbody
            >{#each members as member (member.id)}<tr
                ><td>{member.email || member.user_id}</td><td
                  ><select
                    value={member.role}
                    onchange={(event) =>
                      runMutation(() =>
                        updateTenantMember(member.id, {
                          role: event.currentTarget.value,
                        }),
                      )}
                    ><option value="viewer">{t("tenant.role.viewer")}</option><option
                      value="developer">{t("tenant.role.developer")}</option
                    ><option value="admin">{t("tenant.role.admin")}</option><option value="owner"
                      >{t("tenant.role.owner")}</option
                    ></select
                  ></td
                ><td class="text-right"
                  ><button
                    disabled={saving}
                    onclick={() =>
                      runMutation(() => removeTenantMember(member.id))}
                    class="text-sm text-red-600 disabled:opacity-50"
                    >{t("Delete")}</button
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
      <div class="mt-4 space-y-2">
        {#each invitations as invitation (invitation.id)}<p
            class="rounded-lg bg-surface-50 px-3 py-2 text-sm text-surface-600"
          >
            {invitation.email} · {t(tenantRoleLabelKey(invitation.role))} ·
            {t(invitationStatusLabelKey(invitation.status))}
          </p>{/each}
      </div>
    </section>
  </div>
</RequestState>
