<script>
  import { onMount } from 'svelte';
  import { t } from '$lib/i18n.js';
  import {
    listUsers,
    getUser,
    suspendUser,
    unsuspendUser,
    deleteUser,
    listUserSessions,
    revokeUserSession,
    resetUserMfa,
    unlinkUserIdentity,
    getUserRoles,
    getUserPermissions,
    listApplications,
  } from '$lib/api/client.js';
  import { permissionDescription, permissionLabel } from '$lib/permission-catalog.js';

  let users = $state([]);
  let loading = $state(true);
  let error = $state(null);
  let search = $state('');

  // 行内溢出菜单：记录当前展开的行
  let openMenuId = $state(null);

  // 详情抽屉
  let selectedUser = $state(null);
  let drawerLoading = $state(false);
  let activeTab = $state('profile');
  let sessions = $state([]);
  let roles = $state([]);
  let permissions = $state([]);
  let rolesPermissionsLoaded = $state(false);
  let applications = $state([]);
  let selectedApplicationId = $state('');

  function isSuspended(user) {
    const until = user?.banned_until;
    return until && until !== 'none';
  }

  function displayName(user) {
    const meta = user?.user_metadata || {};
    return meta.full_name || meta.name || user?.email || user?.id?.slice(0, 8) || '-';
  }

  function avatarUrl(user) {
    const meta = user?.user_metadata || {};
    if (meta.avatar_url) return meta.avatar_url;
    const first = (user?.identities || [])[0];
    return first?.identity_data?.avatar_url || null;
  }

  function initials(user) {
    const name = displayName(user);
    const parts = String(name).trim().split(/[\s@._-]+/).filter(Boolean);
    if (parts.length === 0) return '?';
    if (parts.length === 1) return parts[0].slice(0, 2).toUpperCase();
    return (parts[0][0] + parts[1][0]).toUpperCase();
  }

  function providers(user) {
    const fromMeta = user?.app_metadata?.provider;
    const fromList = user?.app_metadata?.providers;
    const set = new Set([fromMeta, ...(fromList || [])].filter(Boolean));
    if (set.size === 0 && user?.identities?.length) user.identities.forEach((i) => i.provider && set.add(i.provider));
    return [...set];
  }

  function providerLabel(p) {
    const map = { email: 'Email', google: 'Google', github: 'GitHub', azure: 'Microsoft', apple: 'Apple', phone: 'Phone' };
    return map[p] || (p ? p[0].toUpperCase() + p.slice(1) : '-');
  }

  function normalizePermission(permission) {
    if (typeof permission === 'string') return { name: permission };
    const name = permission?.name || permission?.permission || permission?.id || '-';
    return { ...permission, name };
  }

  function permissionKey(permission) {
    const normalized = normalizePermission(permission);
    return normalized.id || normalized.name;
  }

  function factorTypeLabel(type) {
    const map = { totp: 'Authenticator app', webauthn: 'Security key', phone: 'Phone (OTP)' };
    return map[type] || type || '-';
  }

  function formatDate(value) {
    if (!value) return null;
    const d = new Date(value);
    if (Number.isNaN(d.getTime())) return null;
    return d.toLocaleString(undefined, { year: 'numeric', month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' });
  }

  function formatDay(value) {
    if (!value) return null;
    const d = new Date(value);
    if (Number.isNaN(d.getTime())) return null;
    return d.toLocaleDateString(undefined, { year: 'numeric', month: 'short', day: 'numeric' });
  }

  const filteredUsers = $derived(
    users.filter((u) => {
      const q = search.trim().toLowerCase();
      if (!q) return true;
      const name = displayName(u).toLowerCase();
      return name.includes(q) || (u.email || '').toLowerCase().includes(q) || (u.id || '').toLowerCase().includes(q);
    }),
  );

  async function load() {
    loading = true;
    try {
      const [userRes, applicationRes] = await Promise.all([
        listUsers(),
        listApplications().catch(() => ({ items: [] })),
      ]);
      users = Array.isArray(userRes) ? userRes : (userRes.users || userRes.items || userRes.data || []);
      applications = Array.isArray(applicationRes) ? applicationRes : (applicationRes.items || applicationRes.data || []);
    } catch (e) {
      error = e.message;
    }
    loading = false;
  }

  onMount(load);

  async function openDrawer(user) {
    openMenuId = null;
    selectedUser = user;
    activeTab = 'profile';
    rolesPermissionsLoaded = false;
    roles = [];
    permissions = [];
    sessions = [];
    drawerLoading = true;
    try {
      // 拉取最新详情，确保 identities / factors 为实时数据
      const detail = await getUser(user.id);
      if (detail && typeof detail === 'object') selectedUser = { ...user, ...detail };
      const sessRes = await listUserSessions(user.id).catch(() => ({ items: [] }));
      sessions = sessRes.items || [];
    } catch (e) {
      error = e.message;
    }
    drawerLoading = false;
  }

  async function ensureRolesPermissions() {
    if (rolesPermissionsLoaded || !selectedUser) return;
    try {
      const [r, p] = await Promise.all([
        getUserRoles(selectedUser.id, selectedApplicationId).catch(() => ({ items: [] })),
        getUserPermissions(selectedUser.id, undefined, selectedApplicationId).catch(() => ({ items: [], permissions: [] })),
      ]);
      roles = (r.items || r.data || (Array.isArray(r) ? r : [])).map((item) => item.role || item);
      permissions = p.items || p.permissions || p.data || (Array.isArray(p) ? p : []);
    } catch (e) {
      error = e.message;
    }
    rolesPermissionsLoaded = true;
  }

  function switchTab(tab) {
    activeTab = tab;
    if (tab === 'rolesPermissions') ensureRolesPermissions();
  }

  async function changeApplicationScope() {
    rolesPermissionsLoaded = false;
    roles = [];
    permissions = [];
    await ensureRolesPermissions();
  }

  function applicationId(application) {
    return application?.id || application?.client_id || application?.clientId || application?.application_id || '';
  }

  function applicationLabel(application) {
    return application?.name || application?.client_name || application?.clientName || applicationId(application);
  }

  async function handleToggleSuspend(user, evt) {
    openMenuId = null;
    const suspended = isSuspended(user);
    const ok = confirm(suspended ? t('users.restoreConfirm') : t('Suspend this user?'));
    if (!ok) return;
    try {
      if (suspended) await unsuspendUser(user.id);
      else await suspendUser(user.id, { reason: 'admin_console' });
      await load();
      if (selectedUser?.id === user.id) selectedUser = users.find((u) => u.id === user.id) || null;
    } catch (e) {
      error = e.message;
    }
  }

  async function handleDelete(user, evt) {
    openMenuId = null;
    evt?.stopPropagation?.();
    if (!confirm(t('users.deleteConfirm'))) return;
    try {
      await deleteUser(user.id);
      if (selectedUser?.id === user.id) selectedUser = null;
      await load();
    } catch (e) {
      error = e.message;
    }
  }

  async function handleResetFactor(factorId) {
    if (!confirm(t('users.resetFactorConfirm'))) return;
    try {
      await resetUserMfa(selectedUser.id, factorId);
      selectedUser = { ...selectedUser, factors: (selectedUser.factors || []).filter((f) => f.id !== factorId) };
    } catch (e) {
      error = e.message;
    }
  }

  async function handleRevokeSession(sessionId) {
    try {
      await revokeUserSession(selectedUser.id, sessionId);
      sessions = sessions.filter((s) => (s.sessionId || s.session_id || s.id) !== sessionId);
    } catch (e) {
      error = e.message;
    }
  }

  async function handleUnlinkIdentity(identityId) {
    if (!confirm(t('users.unlinkConfirm'))) return;
    try {
      await unlinkUserIdentity(selectedUser.id, identityId);
      selectedUser = { ...selectedUser, identities: (selectedUser.identities || []).filter((i) => i.id !== identityId) };
    } catch (e) {
      error = e.message;
    }
  }

  function closeMenu() {
    openMenuId = null;
  }

  function toggleMenu(userId, evt) {
    evt?.stopPropagation?.();
    openMenuId = openMenuId === userId ? null : userId;
  }
</script>

<div class="flex items-center justify-between gap-4 mb-6">
  <div>
    <h2 class="text-2xl font-bold text-surface-900">{t('Users')}</h2>
    {#if !loading}
      <p class="text-sm text-surface-400 mt-1">{t('users.userCount', { count: users.length })}</p>
    {/if}
  </div>
  <div class="relative w-64 max-w-full">
    <span class="absolute left-3 top-1/2 -translate-y-1/2 text-surface-400 text-sm">⌕</span>
    <input
      bind:value={search}
      placeholder={t('users.searchPlaceholder')}
      class="w-full pl-8 pr-3 py-2 border border-surface-300 rounded-lg text-sm bg-white focus:outline-none focus:ring-2 focus:ring-brand-500/30 focus:border-brand-500"
    >
  </div>
</div>

{#if error}
  <div class="bg-red-50 border border-red-200 rounded-lg p-4 text-red-700 mb-4 flex items-start justify-between gap-3">
    <span>{error}</span>
    <button onclick={() => error = null} class="text-red-400 hover:text-red-600 shrink-0">&times;</button>
  </div>
{/if}

{#if loading}
  <p class="text-surface-400">{t('Loading...')}</p>
{:else if filteredUsers.length === 0}
  <div class="bg-surface-50 rounded-xl border border-surface-200 p-8 text-center">
    <p class="text-surface-500">{search ? t('users.searchPlaceholder') : t('No users found')}</p>
  </div>
{:else}
  <div class="bg-white rounded-xl border border-surface-200 overflow-hidden">
    <table class="w-full text-sm">
      <thead class="bg-surface-50 border-b border-surface-200">
        <tr>
          <th class="text-left px-4 py-3 font-medium text-surface-600">{t('Users')}</th>
          <th class="text-left px-4 py-3 font-medium text-surface-600">{t('users.active')}</th>
          <th class="text-left px-4 py-3 font-medium text-surface-600">{t('users.lastSignIn')}</th>
          <th class="text-left px-4 py-3 font-medium text-surface-600">{t('users.createdAt')}</th>
          <th class="text-right px-4 py-3 font-medium text-surface-600"></th>
        </tr>
      </thead>
      <tbody>
        {#each filteredUsers as user (user.id)}
          {@const suspended = isSuspended(user)}
          <tr
            class="border-b border-surface-100 hover:bg-surface-50/60 cursor-pointer transition-colors"
            onclick={() => openDrawer(user)}
          >
            <td class="px-4 py-3">
              <div class="flex items-center gap-3">
                {#if avatarUrl(user)}
                  <img src={avatarUrl(user)} alt="" class="w-9 h-9 rounded-full object-cover bg-surface-100">
                {:else}
                  <div class="w-9 h-9 rounded-full bg-brand-100 text-brand-700 grid place-items-center text-xs font-semibold">
                    {initials(user)}
                  </div>
                {/if}
                <div class="min-w-0">
                  <div class="font-medium text-surface-900 truncate">{displayName(user)}</div>
                  <div class="text-xs text-surface-400 truncate">{user.email || user.id}</div>
                </div>
              </div>
            </td>
            <td class="px-4 py-3">
              {#if suspended}
                <span class="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-xs font-medium bg-red-50 text-red-700">
                  <span class="w-1.5 h-1.5 rounded-full bg-red-500"></span>{t('users.suspended')}
                </span>
              {:else}
                <span class="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-xs font-medium bg-emerald-50 text-emerald-700">
                  <span class="w-1.5 h-1.5 rounded-full bg-emerald-500"></span>{t('users.active')}
                </span>
              {/if}
            </td>
            <td class="px-4 py-3 text-surface-500">{formatDate(user.last_sign_in_at) || t('users.never')}</td>
            <td class="px-4 py-3 text-surface-500">{formatDay(user.created_at) || '-'}</td>
            <td class="px-4 py-3 text-right relative">
              <button
                onclick={(e) => toggleMenu(user.id, e)}
                class="inline-flex items-center justify-center w-8 h-8 rounded-lg text-surface-500 hover:bg-surface-100 hover:text-surface-700"
                aria-label={t('users.moreActions')}
              >⋯</button>
              {#if openMenuId === user.id}
                <!-- 点击遮罩关闭菜单，位于菜单之下、表格之上 -->
                <button
                  type="button"
                  tabindex="-1"
                  aria-hidden="true"
                  class="fixed inset-0 z-20 cursor-default"
                  onclick={(e) => { e.stopPropagation(); closeMenu(); }}
                ></button>
                <div class="absolute right-4 top-12 z-30 w-44 bg-white rounded-lg border border-surface-200 shadow-lg py-1 text-left">
                  <button type="button" onclick={(e) => { e.stopPropagation(); openDrawer(user); }} class="w-full px-3 py-2 text-sm text-surface-700 hover:bg-surface-50 text-left">
                    {t('users.viewDetails')}
                  </button>
                  <button type="button" onclick={(e) => { e.stopPropagation(); handleToggleSuspend(user); }} class="w-full px-3 py-2 text-sm text-surface-700 hover:bg-surface-50 text-left">
                    {suspended ? t('users.restore') : t('Suspend')}
                  </button>
                  <div class="my-1 border-t border-surface-100"></div>
                  <button type="button" onclick={(e) => { e.stopPropagation(); handleDelete(user); }} class="w-full px-3 py-2 text-sm text-red-600 hover:bg-red-50 text-left">
                    {t('users.delete')}
                  </button>
                </div>
              {/if}
            </td>
          </tr>
        {/each}
      </tbody>
    </table>
  </div>
{/if}

{#if selectedUser}
  {@const detail = selectedUser}
  {@const suspended = isSuspended(detail)}
  <div class="fixed inset-0 z-40 flex justify-end">
    <!-- 遮罩 -->
    <button
      class="absolute inset-0 bg-surface-900/30 backdrop-blur-[1px]"
      onclick={() => (selectedUser = null)}
      aria-label={t('users.close')}
    ></button>
    <!-- 抽屉 -->
    <aside class="relative w-full max-w-xl h-full bg-surface-50 shadow-2xl flex flex-col">
      <header class="bg-white border-b border-surface-200 px-6 py-5 flex items-start justify-between gap-4">
        <div class="flex items-center gap-3 min-w-0">
          {#if avatarUrl(detail)}
            <img src={avatarUrl(detail)} alt="" class="w-11 h-11 rounded-full object-cover bg-surface-100">
          {:else}
            <div class="w-11 h-11 rounded-full bg-brand-100 text-brand-700 grid place-items-center text-sm font-semibold">
              {initials(detail)}
            </div>
          {/if}
          <div class="min-w-0">
            <div class="flex items-center gap-2">
              <h3 class="text-lg font-semibold text-surface-900 truncate">{displayName(detail)}</h3>
              {#if suspended}
                <span class="shrink-0 inline-flex items-center gap-1.5 px-2 py-0.5 rounded-full text-[11px] font-medium bg-red-50 text-red-700">{t('users.suspended')}</span>
              {:else}
                <span class="shrink-0 inline-flex items-center gap-1.5 px-2 py-0.5 rounded-full text-[11px] font-medium bg-emerald-50 text-emerald-700">{t('users.active')}</span>
              {/if}
            </div>
            <p class="text-sm text-surface-400 truncate">{detail.email || detail.id}</p>
          </div>
        </div>
        <button onclick={() => (selectedUser = null)} class="shrink-0 w-8 h-8 grid place-items-center rounded-lg text-surface-400 hover:bg-surface-100 hover:text-surface-600" aria-label={t('users.close')}>&times;</button>
      </header>

      <!-- 页签 -->
      <nav class="bg-white border-b border-surface-200 px-6 flex gap-1">
        {#each [['profile', t('users.profile')], ['security', t('users.security')], ['connectedAccounts', t('users.connectedAccounts')], ['rolesPermissions', t('users.rolesPermissions')]] as [key, label] (key)}
          <button
            onclick={() => switchTab(key)}
            class="px-3 py-3 text-sm font-medium border-b-2 -mb-px transition-colors {activeTab === key ? 'border-brand-600 text-brand-600' : 'border-transparent text-surface-500 hover:text-surface-700'}"
          >{label}</button>
        {/each}
      </nav>

      <div class="flex-1 overflow-y-auto px-6 py-5 space-y-5">
        {#if drawerLoading}
          <p class="text-surface-400 text-sm">{t('Loading...')}</p>
        {:else if activeTab === 'profile'}
          <dl class="bg-white rounded-xl border border-surface-200 divide-y divide-surface-100">
            {#each [['users.userId', detail.id], ['Email', detail.email || '-'], ['Phone', detail.phone || '-'], ['users.provider', providers(detail).map((p) => providerLabel(p)).join(' · ') || '-'], ['users.lastSignIn', formatDate(detail.last_sign_in_at) || t('users.never')], ['users.createdAt', formatDay(detail.created_at) || '-'], ['users.suspendedUntil', suspended ? formatDay(detail.banned_until) || detail.banned_until : null]] as [labelKey, value] (labelKey)}
              {#if value}
                <div class="px-4 py-3 flex items-center justify-between gap-4">
                  <dt class="text-sm text-surface-500">{t(labelKey)}</dt>
                  <dd class="text-sm text-surface-900 font-medium text-right break-all">{value}</dd>
                </div>
              {/if}
            {/each}
          </dl>
        {:else if activeTab === 'security'}
          <!-- MFA 因子：真实列表，点击重置，无需手填 ID -->
          <section>
            <h4 class="text-sm font-semibold text-surface-700 mb-2">{t('users.mfaFactors')}</h4>
            <div class="bg-white rounded-xl border border-surface-200 divide-y divide-surface-100">
              {#each (detail.factors || []) as factor (factor.id)}
                <div class="px-4 py-3 flex items-center justify-between gap-3">
                  <div class="min-w-0">
                    <div class="text-sm font-medium text-surface-900">{factorTypeLabel(factor.factor_type)}</div>
                    <div class="text-xs text-surface-400">{factor.friendly_name || factor.id}</div>
                  </div>
                  <button onclick={() => handleResetFactor(factor.id)} class="shrink-0 text-xs px-2.5 py-1 rounded-md text-red-600 hover:bg-red-50 border border-red-200">{t('Reset Factor')}</button>
                </div>
              {:else}
                <div class="px-4 py-6 text-center text-sm text-surface-400">{t('users.noMfaFactors')}</div>
              {/each}
            </div>
          </section>

          <!-- 会话 -->
          <section>
            <h4 class="text-sm font-semibold text-surface-700 mb-2">{t('Sessions')}</h4>
            <div class="bg-white rounded-xl border border-surface-200 divide-y divide-surface-100">
              {#each sessions as session (session.sessionId || session.session_id || session.id)}
                {@const sid = session.sessionId || session.session_id || session.id}
                <div class="px-4 py-3 flex items-center justify-between gap-3">
                  <div class="min-w-0">
                    <div class="text-sm font-mono text-surface-700 truncate">{sid}</div>
                    <div class="text-xs text-surface-400">{formatDate(session.created_at || session.created) || ''}</div>
                  </div>
                  <button onclick={() => handleRevokeSession(sid)} class="shrink-0 text-xs px-2.5 py-1 rounded-md text-red-600 hover:bg-red-50 border border-red-200">{t('Revoke')}</button>
                </div>
              {:else}
                <div class="px-4 py-6 text-center text-sm text-surface-400">{t('users.noSessions')}</div>
              {/each}
            </div>
          </section>
        {:else if activeTab === 'connectedAccounts'}
          <div class="bg-white rounded-xl border border-surface-200 divide-y divide-surface-100">
            {#each (detail.identities || []) as identity (identity.id)}
              <div class="px-4 py-3 flex items-center justify-between gap-3">
                <div class="min-w-0 flex items-center gap-3">
                  <span class="shrink-0 inline-flex items-center px-2 py-0.5 rounded-md bg-surface-100 text-surface-700 text-xs font-medium">{providerLabel(identity.provider)}</span>
                  <div class="min-w-0">
                    <div class="text-sm font-medium text-surface-900 truncate">{identity.identity_data?.email || identity.identity_data?.name || identity.identity_id || identity.id}</div>
                    <div class="text-xs text-surface-400">{formatDate(identity.last_sign_in_at) || formatDate(identity.created_at) || ''}</div>
                  </div>
                </div>
                <button onclick={() => handleUnlinkIdentity(identity.id)} class="shrink-0 text-xs px-2.5 py-1 rounded-md text-red-600 hover:bg-red-50 border border-red-200">{t('Unlink Identity')}</button>
              </div>
            {:else}
              <div class="px-4 py-6 text-center text-sm text-surface-400">{t('users.noIdentities')}</div>
            {/each}
          </div>
        {:else if activeTab === 'rolesPermissions'}
          <section>
            <label for="user-permission-application" class="mb-1 block text-sm font-semibold text-surface-700">{t('users.applicationContext')}</label>
            <select id="user-permission-application" bind:value={selectedApplicationId} onchange={changeApplicationScope} class="w-full rounded-xl border border-surface-300 bg-white px-3 py-2 text-sm">
              <option value="">{t('users.projectWideContext')}</option>
              {#each applications as application (applicationId(application))}
                <option value={applicationId(application)}>{applicationLabel(application)} · {applicationId(application)}</option>
              {/each}
            </select>
            <p class="mt-1 text-xs text-surface-500">{t('users.applicationContextHint')}</p>
          </section>
          <section>
            <h4 class="text-sm font-semibold text-surface-700 mb-2">{t('users.assignedRoles')}</h4>
            <div class="bg-white rounded-xl border border-surface-200 divide-y divide-surface-100">
              {#each roles as role (role.id)}
                <div class="px-4 py-3 flex items-center justify-between gap-3">
                  <div class="min-w-0">
                    <div class="text-sm font-medium text-surface-900 truncate">{role.name}</div>
                    {#if role.description}<div class="text-xs text-surface-400 truncate">{role.description}</div>{/if}
                  </div>
                </div>
              {:else}
                <div class="px-4 py-6 text-center text-sm text-surface-400">{t('users.noRoles')}</div>
              {/each}
            </div>
          </section>
          <section>
            <h4 class="text-sm font-semibold text-surface-700 mb-2">{t('users.permissions')}</h4>
            <p class="text-xs text-surface-400 mb-1">{t('users.permissionsHint')}</p>
            <p class="text-xs text-surface-500 mb-3">{t('users.permissionsSource')}</p>
            {#if permissions.length}
              <div class="grid gap-2">
                {#each permissions as perm (permissionKey(perm))}
                  {@const item = normalizePermission(perm)}
                  {@const label = permissionLabel(item, t)}
                  {@const description = permissionDescription(item, t)}
                  <div class="bg-white border border-surface-200 rounded-lg px-3 py-2">
                    <div class="flex items-center justify-between gap-3">
                      <span class="text-sm font-medium text-surface-900 truncate" title={item.name}>{label}</span>
                      <code class="shrink-0 inline-block max-w-[12rem] truncate text-[11px] text-surface-400 bg-surface-50 border border-surface-100 rounded px-1.5 py-0.5">{item.name}</code>
                    </div>
                    {#if description}
                      <p class="text-xs text-surface-500 mt-1">{description}</p>
                    {/if}
                  </div>
                {/each}
              </div>
            {:else}
              <div class="bg-white rounded-xl border border-surface-200 px-4 py-6 text-center text-sm text-surface-400">{t('users.noPermissions')}</div>
            {/if}
          </section>
        {/if}
      </div>
    </aside>
  </div>
{/if}
