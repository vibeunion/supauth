<script>
  import { onMount } from "svelte";
  import { resolve } from "$app/paths";
  import { t } from "$lib/i18n.js";
  import {
    collectionItems,
    collectionPage,
    createKeyedSingleFlightTracker,
    createLatestRequestTracker,
    mutationOutcomeUnknown,
  } from "$lib/resource-page.js";
  import {
    listUsers,
    createUser,
    getUser,
    suspendUser,
    unsuspendUser,
    deleteUser,
    resetUserMfa,
    getUserRoles,
    getUserPermissions,
    listApplications,
  } from "$lib/api/client.js";
  import {
    permissionDescription,
    permissionLabel,
  } from "$lib/permission-catalog.js";

  const USER_MUTATION_LOCKS_KEY =
    "supaoauth.admin.user-mutation-locks.v1";
  const USER_MUTATION_ACTIONS = new Set([
    "create",
    "delete",
    "reset-factor",
    "restore",
    "suspend",
  ]);
  const USER_MUTATION_LOCK_FIELDS = new Set([
    "action",
    "ownerId",
    "recordedAt",
    "resourceId",
  ]);

  let users = $state([]);
  let loading = $state(true);
  let error = $state(null);
  let search = $state("");
  let searchDraft = $state("");
  let currentPage = $state(1);
  let pageSize = 25;
  let totalUsers = $state(0);
  let showCreate = $state(false);
  let newUser = $state({ email: "", password: "" });
  let userMutationLocks = $state({});
  let userMutationPending = $state({});
  let mutationStorageReady = $state(false);
  let mutationStorageError = $state(null);
  const userUnverifiedMutations = $derived(
    Object.entries(userMutationLocks).filter(
      ([mutationKey]) => !userMutationPending[mutationKey],
    ),
  );

  // 行内溢出菜单：记录当前展开的行
  let openMenuId = $state(null);

  // 详情抽屉
  let selectedUser = $state(null);
  let drawerLoading = $state(false);
  let activeTab = $state("profile");
  let roles = $state([]);
  let permissions = $state([]);
  let rolesPermissionsLoaded = $state(false);
  let rolesPermissionsLoading = $state(false);
  let applications = $state([]);
  let applicationsLoaded = $state(false);
  let applicationLoadError = $state(null);
  let selectedApplicationId = $state("");
  let rolesPermissionsGeneration = 0;
  const userListRequests = createLatestRequestTracker();
  const userMutationTracker = createKeyedSingleFlightTracker();

  function userMutationKey(action, resourceId) {
    return `${action}:${resourceId}`;
  }

  function validUserMutationLock(mutationKey, lock) {
    if (!lock || typeof lock !== "object" || Array.isArray(lock)) return false;
    const lockFields = Object.keys(lock);
    return (
      lockFields.length === USER_MUTATION_LOCK_FIELDS.size &&
      lockFields.every((field) => USER_MUTATION_LOCK_FIELDS.has(field)) &&
      USER_MUTATION_ACTIONS.has(lock.action) &&
      typeof lock.resourceId === "string" &&
      Boolean(lock.resourceId) &&
      typeof lock.ownerId === "string" &&
      Boolean(lock.ownerId) &&
      Number.isSafeInteger(lock.recordedAt) &&
      lock.recordedAt > 0 &&
      userMutationOwnerMatches(lock) &&
      mutationKey === userMutationKey(lock.action, lock.resourceId)
    );
  }

  function userMutationOwnerMatches(lock) {
    if (lock.action === "create") {
      return lock.ownerId === "new" && lock.resourceId === "new";
    }
    if (lock.action === "reset-factor") {
      const factorPrefix = `${lock.ownerId}:`;
      return (
        lock.resourceId.startsWith(factorPrefix) &&
        lock.resourceId.length > factorPrefix.length
      );
    }
    return lock.resourceId === lock.ownerId;
  }

  function parseUserMutationLocks(serializedLocks) {
    if (serializedLocks === null) return {};
    let storedLocks;
    try {
      storedLocks = JSON.parse(serializedLocks);
    } catch (parseError) {
      if (parseError instanceof SyntaxError) return null;
      throw parseError;
    }
    if (!storedLocks || typeof storedLocks !== "object" || Array.isArray(storedLocks)) {
      return null;
    }
    return Object.entries(storedLocks).every(([key, lock]) =>
      validUserMutationLock(key, lock),
    )
      ? storedLocks
      : null;
  }

  function mutationStorageFailure() {
    mutationStorageReady = false;
    mutationStorageError = t("mutation.storageUnavailable", {
      resource: t("Users"),
    });
  }

  function restoreUserMutationLocks() {
    try {
      const storedLocks = parseUserMutationLocks(
        globalThis.localStorage.getItem(USER_MUTATION_LOCKS_KEY),
      );
      if (!storedLocks) return mutationStorageFailure();
      userMutationLocks = storedLocks;
      mutationStorageReady = true;
      mutationStorageError = null;
    } catch {
      mutationStorageFailure();
    }
  }

  function persistUserMutationLocks(nextLocks) {
    try {
      globalThis.localStorage.setItem(
        USER_MUTATION_LOCKS_KEY,
        JSON.stringify(nextLocks),
      );
      return true;
    } catch {
      mutationStorageFailure();
      return false;
    }
  }

  function stageUserMutation(operation) {
    const context = operation.ownerContext;
    const nextLocks = {
      ...userMutationLocks,
      [operation.key]: { ...context, recordedAt: Date.now() },
    };
    if (!persistUserMutationLocks(nextLocks)) return false;
    userMutationLocks = nextLocks;
    return true;
  }

  function clearUserMutationLock(context) {
    const nextLocks = { ...userMutationLocks };
    delete nextLocks[userMutationKey(context.action, context.resourceId)];
    if (!persistUserMutationLocks(nextLocks)) return false;
    userMutationLocks = nextLocks;
    return true;
  }

  function userResourcePending(ownerId) {
    const ownedByUser = (entry) => entry.ownerId === ownerId;
    return Object.values(userMutationPending).some(ownedByUser);
  }

  function userResourceBusy(ownerId) {
    const ownedByUser = (entry) => entry.ownerId === ownerId;
    return (
      userResourcePending(ownerId) ||
      Object.values(userMutationLocks).some(ownedByUser)
    );
  }

  function beginUserMutation(ownerContext) {
    if (!mutationStorageReady || userResourceBusy(ownerContext.ownerId)) {
      return null;
    }
    const mutationKey = userMutationKey(
      ownerContext.action,
      ownerContext.resourceId,
    );
    const operation = userMutationTracker.begin(mutationKey, ownerContext);
    if (!operation) return null;
    userMutationPending = {
      ...userMutationPending,
      [mutationKey]: {
        ...ownerContext,
        operationGeneration: operation.generation,
      },
    };
    return operation;
  }

  function finishUserMutation(operation) {
    userMutationTracker.finish(operation);
    if (
      userMutationPending[operation.key]?.operationGeneration !==
      operation.generation
    )
      return;
    const nextPending = { ...userMutationPending };
    delete nextPending[operation.key];
    userMutationPending = nextPending;
  }

  function acknowledgeUserMutation(lock) {
    if (!mutationStorageReady) return;
    if (!confirm(t("mutation.verifyAuthoritative", { resource: t("Users") })))
      return;
    if (!confirm(t("mutation.allowRetry"))) return;
    clearUserMutationLock(lock);
  }

  function userMutationUnknown() {
    error = t("mutation.outcomeUnknown");
  }

  async function submitUserMutation(operation, writeCommand) {
    try {
      return await writeCommand();
    } catch (requestError) {
      if (mutationOutcomeUnknown(requestError)) {
        // 写入响应丢失时必须继续权威读回，不能把传输失败当作业务失败。
        return null;
      }
      clearUserMutationLock(operation.ownerContext);
      throw requestError;
    }
  }

  function reportUserMutationFailure(operation, requestError) {
    if (!userMutationTracker.isCurrent(operation)) return;
    if (userMutationLocks[operation.key]) userMutationUnknown();
    else error = requestError;
  }

  function userIdentity(payload) {
    const candidate = payload?.user || payload;
    return typeof candidate?.id === "string" ? candidate.id : "";
  }

  function validatedUser(payload, expectedId) {
    const candidate = payload?.user || payload;
    if (
      !candidate ||
      typeof candidate !== "object" ||
      Array.isArray(candidate) ||
      userIdentity(candidate) !== expectedId
    ) {
      throw new Error("Management API returned an invalid user read-back");
    }
    return candidate;
  }

  function completeUserSearch(response) {
    const page = collectionPage(response);
    if (!page.complete || !page.items.every((user) => userIdentity(user))) {
      throw new Error("Management API returned an incomplete user search");
    }
    return page.items;
  }

  async function readCompleteUserSearch(email) {
    return completeUserSearch(
      await listUsers({ page: 1, limit: 100, search: email }),
    );
  }

  function normalizedEmail(user) {
    return typeof user?.email === "string" ? user.email.trim().toLowerCase() : "";
  }

  function createdUserFromReadBack(usersReadBack, beforeUserIds, response, email) {
    const expectedEmail = email.toLowerCase();
    const responseId = userIdentity(response);
    const newMatches = usersReadBack.filter(
      (user) =>
        !beforeUserIds.has(userIdentity(user)) &&
        normalizedEmail(user) === expectedEmail,
    );
    if (responseId) {
      return newMatches.find((user) => userIdentity(user) === responseId) || null;
    }
    return newMatches.length === 1 ? newMatches[0] : null;
  }

  async function readUserDetail(userId) {
    return validatedUser(await getUser(userId), userId);
  }

  function factorStillPresent(user, factorId) {
    if (!Array.isArray(user.factors)) {
      throw new Error("Management API returned an invalid MFA factor read-back");
    }
    return user.factors.some((factor) => factor?.id === factorId);
  }

  function userNotFound(requestError) {
    return (
      Number(requestError?.statusCode) === 404 ||
      requestError?.code === "not_found"
    );
  }

  async function userDeletedFromReadBack(userId) {
    try {
      await readUserDetail(userId);
      return false;
    } catch (requestError) {
      if (userNotFound(requestError)) return true;
      throw requestError;
    }
  }

  function isSuspended(user) {
    const until = user?.banned_until;
    return Boolean(until && until !== "none");
  }

  function displayName(user) {
    const meta = user?.user_metadata || {};
    return (
      meta.full_name || meta.name || user?.email || user?.id?.slice(0, 8) || "-"
    );
  }

  function avatarUrl(user) {
    const meta = user?.user_metadata || {};
    if (meta.avatar_url) return meta.avatar_url;
    const first = (user?.identities || [])[0];
    return first?.identity_data?.avatar_url || null;
  }

  function initials(user) {
    const name = displayName(user);
    const parts = String(name)
      .trim()
      .split(/[\s@._-]+/)
      .filter(Boolean);
    if (parts.length === 0) return "?";
    if (parts.length === 1) return parts[0].slice(0, 2).toUpperCase();
    return (parts[0][0] + parts[1][0]).toUpperCase();
  }

  function providers(user) {
    const fromMeta = user?.app_metadata?.provider;
    const fromList = user?.app_metadata?.providers;
    const set = new Set([fromMeta, ...(fromList || [])].filter(Boolean));
    if (set.size === 0 && user?.identities?.length)
      user.identities.forEach((i) => i.provider && set.add(i.provider));
    return [...set];
  }

  function providerLabel(p) {
    const map = {
      email: "Email",
      google: "Google",
      github: "GitHub",
      azure: "Microsoft",
      apple: "Apple",
      phone: "Phone",
    };
    return map[p] || (p ? p[0].toUpperCase() + p.slice(1) : "-");
  }

  function normalizePermission(permission) {
    if (typeof permission === "string") return { name: permission };
    const name =
      permission?.name || permission?.permission || permission?.id || "-";
    return { ...permission, name };
  }

  function permissionKey(permission) {
    const normalized = normalizePermission(permission);
    return normalized.id || normalized.name;
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

  function resetRolesPermissions() {
    rolesPermissionsGeneration += 1;
    rolesPermissionsLoaded = false;
    rolesPermissionsLoading = false;
    roles = [];
    permissions = [];
  }

  function isCurrentRolesPermissionsLoad(loadContext) {
    return (
      loadContext.generation === rolesPermissionsGeneration &&
      selectedUser?.id === loadContext.userId &&
      selectedApplicationId === loadContext.applicationId &&
      activeTab === "rolesPermissions"
    );
  }

  function factorTypeLabel(type) {
    const map = { totp: "Authenticator app" };
    return map[type] || type || "-";
  }

  function formatDate(value) {
    if (!value) return null;
    const d = new Date(value);
    if (Number.isNaN(d.getTime())) return null;
    return d.toLocaleString(undefined, {
      year: "numeric",
      month: "short",
      day: "numeric",
      hour: "2-digit",
      minute: "2-digit",
    });
  }

  function formatDay(value) {
    if (!value) return null;
    const d = new Date(value);
    if (Number.isNaN(d.getTime())) return null;
    return d.toLocaleDateString(undefined, {
      year: "numeric",
      month: "short",
      day: "numeric",
    });
  }

  const filteredUsers = $derived(users);

  async function load() {
    const request = userListRequests.begin("users", {
      page: currentPage,
      limit: pageSize,
      search,
    });
    loading = true;
    error = null;
    try {
      const res = await listUsers(request.ownerContext);
      if (!userListRequests.isCurrent(request)) return;
      users = Array.isArray(res)
        ? res
        : res.users || res.items || res.data || [];
      totalUsers = typeof res.total === "number" ? res.total : users.length;
    } catch (requestError) {
      if (userListRequests.isCurrent(request)) error = requestError;
    } finally {
      if (userListRequests.isCurrent(request)) loading = false;
    }
  }

  onMount(() => {
    restoreUserMutationLocks();
    void load();
  });

  function applySearch(event) {
    event.preventDefault();
    search = searchDraft.trim();
    currentPage = 1;
    load();
  }

  function changePage(nextPage) {
    currentPage = nextPage;
    load();
  }

  async function openDrawer(user) {
    openMenuId = null;
    selectedUser = user;
    activeTab = "profile";
    resetRolesPermissions();
    selectedApplicationId = "";
    applicationsLoaded = false;
    applicationLoadError = null;
    drawerLoading = true;
    try {
      // 拉取最新详情，确保 identities / factors 为实时数据
      const detail = await getUser(user.id);
      if (detail && typeof detail === "object")
        selectedUser = { ...user, ...detail };
    } catch (e) {
      error = e;
    }
    void loadApplications();
    drawerLoading = false;
  }

  async function loadApplications() {
    applicationLoadError = null;
    applicationsLoaded = false;
    try {
      applications = collectionItems(await listApplications());
      applicationsLoaded = true;
      if (activeTab === "rolesPermissions") await ensureRolesPermissions();
    } catch (requestError) {
      applications = [];
      applicationLoadError = requestError;
    }
  }

  async function ensureRolesPermissions() {
    if (rolesPermissionsLoaded || !selectedUser || !applicationsLoaded || applicationLoadError) return;
    const loadContext = {
      generation: rolesPermissionsGeneration + 1,
      userId: selectedUser.id,
      applicationId: selectedApplicationId,
    };
    rolesPermissionsGeneration = loadContext.generation;
    rolesPermissionsLoading = true;
    error = null;
    try {
      const [roleResponse, permissionResponse] = await Promise.all([
        getUserRoles(loadContext.userId, loadContext.applicationId || undefined),
        getUserPermissions(
          loadContext.userId,
          undefined,
          loadContext.applicationId || undefined,
        ),
      ]);
      if (!isCurrentRolesPermissionsLoad(loadContext)) return;
      roles =
        roleResponse.items ||
        roleResponse.data ||
        (Array.isArray(roleResponse) ? roleResponse : []);
      permissions =
        permissionResponse.items ||
        permissionResponse.permissions ||
        permissionResponse.data ||
        (Array.isArray(permissionResponse) ? permissionResponse : []);
      rolesPermissionsLoaded = true;
    } catch (requestError) {
      if (isCurrentRolesPermissionsLoad(loadContext)) error = requestError;
    } finally {
      if (isCurrentRolesPermissionsLoad(loadContext)) rolesPermissionsLoading = false;
    }
  }

  async function changeApplication(event) {
    selectedApplicationId = event.currentTarget.value;
    resetRolesPermissions();
    await ensureRolesPermissions();
  }

  function switchTab(tab) {
    activeTab = tab;
    if (tab === "rolesPermissions") void ensureRolesPermissions();
    else resetRolesPermissions();
  }

  async function handleCreateUser() {
    const draft = {
      email: newUser.email.trim(),
      password: newUser.password,
      email_confirm: true,
    };
    if (!draft.email || !draft.password) return;
    const operation = beginUserMutation({
      action: "create",
      resourceId: "new",
      ownerId: "new",
    });
    if (!operation) return;
    error = null;
    try {
      const beforeUsers = await readCompleteUserSearch(draft.email);
      if (!userMutationTracker.isCurrent(operation)) return;
      const beforeUserIds = new Set(beforeUsers.map(userIdentity));
      if (!stageUserMutation(operation)) return;
      const createResponse = await submitUserMutation(operation, () =>
        createUser(draft),
      );
      if (!userMutationTracker.isCurrent(operation)) return;
      const usersReadBack = await readCompleteUserSearch(draft.email);
      if (!userMutationTracker.isCurrent(operation)) return;
      const createdUser = createdUserFromReadBack(
        usersReadBack,
        beforeUserIds,
        createResponse,
        draft.email,
      );
      if (!createdUser) return userMutationUnknown();
      if (!clearUserMutationLock(operation.ownerContext)) return;
      newUser = { email: "", password: "" };
      showCreate = false;
      await load();
    } catch (requestError) {
      reportUserMutationFailure(operation, requestError);
    } finally {
      finishUserMutation(operation);
    }
  }

  async function handleToggleSuspend(user) {
    openMenuId = null;
    const wasSuspended = isSuspended(user);
    const shouldSuspend = !wasSuspended;
    const ok = confirm(
      wasSuspended ? t("users.restoreConfirm") : t("Suspend this user?"),
    );
    if (!ok) return;
    const action = shouldSuspend ? "suspend" : "restore";
    const operation = beginUserMutation({
      action,
      resourceId: user.id,
      ownerId: user.id,
    });
    if (!operation) return;
    error = null;
    try {
      const beforeUser = await readUserDetail(user.id);
      if (!userMutationTracker.isCurrent(operation)) return;
      if (isSuspended(beforeUser) !== wasSuspended) {
        if (selectedUser?.id === user.id) selectedUser = beforeUser;
        error = t("mutation.stateChanged");
        return;
      }
      if (!stageUserMutation(operation)) return;
      await submitUserMutation(operation, () =>
        shouldSuspend
          ? suspendUser(user.id, { reason: "admin_console" })
          : unsuspendUser(user.id),
      );
      if (!userMutationTracker.isCurrent(operation)) return;
      const readBackUser = await readUserDetail(user.id);
      if (!userMutationTracker.isCurrent(operation)) return;
      if (isSuspended(readBackUser) !== shouldSuspend) {
        return userMutationUnknown();
      }
      if (!clearUserMutationLock(operation.ownerContext)) return;
      if (selectedUser?.id === user.id) selectedUser = readBackUser;
      await load();
    } catch (requestError) {
      reportUserMutationFailure(operation, requestError);
    } finally {
      finishUserMutation(operation);
    }
  }

  async function handleDelete(user) {
    openMenuId = null;
    if (!confirm(t("users.deleteConfirm"))) return;
    const operation = beginUserMutation({
      action: "delete",
      resourceId: user.id,
      ownerId: user.id,
    });
    if (!operation) return;
    error = null;
    try {
      if (!stageUserMutation(operation)) return;
      await submitUserMutation(operation, () => deleteUser(user.id));
      if (!userMutationTracker.isCurrent(operation)) return;
      const deletionConfirmed = await userDeletedFromReadBack(user.id);
      if (!userMutationTracker.isCurrent(operation)) return;
      if (!deletionConfirmed) return userMutationUnknown();
      if (!clearUserMutationLock(operation.ownerContext)) return;
      if (selectedUser?.id === user.id) selectedUser = null;
      await load();
    } catch (requestError) {
      reportUserMutationFailure(operation, requestError);
    } finally {
      finishUserMutation(operation);
    }
  }

  async function handleResetFactor(factorId) {
    const userId = selectedUser?.id;
    if (!userId) return;
    if (!confirm(t("users.resetFactorConfirm"))) return;
    const operation = beginUserMutation({
      action: "reset-factor",
      resourceId: `${userId}:${factorId}`,
      ownerId: userId,
    });
    if (!operation) return;
    error = null;
    try {
      const beforeUser = await readUserDetail(userId);
      if (!userMutationTracker.isCurrent(operation)) return;
      if (!factorStillPresent(beforeUser, factorId)) {
        if (selectedUser?.id === userId) selectedUser = beforeUser;
        error = t("mutation.stateChanged");
        return;
      }
      if (!stageUserMutation(operation)) return;
      await submitUserMutation(operation, () =>
        resetUserMfa(userId, factorId),
      );
      if (!userMutationTracker.isCurrent(operation)) return;
      const readBackUser = await readUserDetail(userId);
      if (!userMutationTracker.isCurrent(operation)) return;
      if (factorStillPresent(readBackUser, factorId)) {
        return userMutationUnknown();
      }
      if (!clearUserMutationLock(operation.ownerContext)) return;
      if (selectedUser?.id === userId) selectedUser = readBackUser;
    } catch (requestError) {
      reportUserMutationFailure(operation, requestError);
    } finally {
      finishUserMutation(operation);
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
    <h2 class="text-2xl font-bold text-surface-900">{t("Users")}</h2>
    {#if !loading}
      <p class="text-sm text-surface-400 mt-1">
        {t("users.userCount", { count: totalUsers })}
      </p>
    {/if}
  </div>
  <div class="flex items-center gap-2">
    <form onsubmit={applySearch} class="flex items-center gap-2">
      <div class="relative w-64 max-w-full">
        <span
          class="absolute left-3 top-1/2 -translate-y-1/2 text-surface-400 text-sm"
          >⌕</span
        ><input
          bind:value={searchDraft}
          placeholder={t("users.searchPlaceholder")}
          class="w-full pl-8 pr-3 py-2 border border-surface-300 rounded-lg text-sm bg-white focus:outline-none focus:ring-2 focus:ring-brand-500/30 focus:border-brand-500"
        />
      </div>
      <button
        type="submit"
        class="rounded-lg border border-surface-300 px-3 py-2 text-sm font-medium text-surface-700"
        >{t("Apply")}</button
      >
    </form>
    <button
      type="button"
      disabled={!showCreate &&
        (!mutationStorageReady || userResourceBusy("new"))}
      onclick={() => (showCreate = !showCreate)}
      class="rounded-lg bg-brand-600 px-4 py-2 text-sm font-medium text-white hover:bg-brand-700 disabled:cursor-not-allowed disabled:opacity-50"
      >{showCreate ? t("Cancel") : `+ ${t("New User")}`}</button
    >
  </div>
</div>

{#if mutationStorageError}
  <div
    class="mb-4 rounded-lg border border-red-200 bg-red-50 p-4 text-sm text-red-800"
    role="alert"
  >
    {mutationStorageError}
  </div>
{/if}

{#if userUnverifiedMutations.length}
  <section class="console-card mb-4 border-amber-200 bg-amber-50 p-4">
    <h3 class="font-semibold text-amber-900">{t("mutation.reconcile")}</h3>
    <p class="mt-1 text-sm text-amber-800">{t("mutation.outcomeUnknown")}</p>
    <div class="mt-3 grid gap-2">
      {#each userUnverifiedMutations as [mutationKey, lock] (mutationKey)}
        <div
          class="flex flex-wrap items-center justify-between gap-3 rounded-lg border border-amber-200 bg-white px-3 py-2"
        >
          <code class="break-all text-xs text-surface-700">
            {t("mutation.pending", {
              action: lock.action,
              resourceId: lock.resourceId,
            })}
          </code>
          <button
            type="button"
            disabled={!mutationStorageReady || userResourcePending(lock.ownerId)}
            onclick={() => acknowledgeUserMutation(lock)}
            class="shrink-0 rounded-lg border border-amber-300 px-3 py-1.5 text-xs font-semibold text-amber-900 hover:bg-amber-100 disabled:cursor-not-allowed disabled:opacity-50"
            >{t("mutation.allowRetry")}</button
          >
        </div>
      {/each}
    </div>
  </section>
{/if}

{#if error}
  <div
    class="bg-red-50 border border-red-200 rounded-lg p-4 text-red-700 mb-4 flex items-start justify-between gap-3"
  >
    <span>{error.message || error}</span>
    <button
      onclick={() => (error = null)}
      class="text-red-400 hover:text-red-600 shrink-0">&times;</button
    >
  </div>
{/if}

{#if showCreate}
  <section class="console-card mb-6 p-6">
    <h3 class="text-lg font-semibold text-surface-900">{t("New User")}</h3>
    <div class="mt-4 grid gap-4 md:grid-cols-2">
      <div>
        <label
          for="new-user-email"
          class="mb-1 block text-sm font-medium text-surface-700"
          >{t("Email")}</label
        ><input
          id="new-user-email"
          type="email"
          bind:value={newUser.email}
          class="w-full"
        />
      </div>
      <div>
        <label
          for="new-user-password"
          class="mb-1 block text-sm font-medium text-surface-700"
          >{t("Password")}</label
        ><input
          id="new-user-password"
          type="password"
          bind:value={newUser.password}
          class="w-full"
        />
      </div>
    </div>
    <button
      disabled={!newUser.email.trim() ||
        !newUser.password ||
        !mutationStorageReady ||
        userResourceBusy("new")}
      onclick={handleCreateUser}
      class="mt-4 rounded-lg bg-brand-600 px-4 py-2 text-sm font-medium text-white hover:bg-brand-700 disabled:cursor-not-allowed disabled:opacity-50"
      >{t("Create")}</button
    >
  </section>
{/if}

{#if loading}
  <p class="text-surface-400">{t("Loading...")}</p>
{:else if filteredUsers.length === 0}
  <div
    class="bg-surface-50 rounded-xl border border-surface-200 p-8 text-center"
  >
    <p class="text-surface-500">
      {search ? t("users.searchPlaceholder") : t("No users found")}
    </p>
  </div>
{:else}
  <div class="bg-white rounded-xl border border-surface-200 overflow-hidden">
    <table class="w-full text-sm">
      <thead class="bg-surface-50 border-b border-surface-200">
        <tr>
          <th class="text-left px-4 py-3 font-medium text-surface-600"
            >{t("Users")}</th
          >
          <th class="text-left px-4 py-3 font-medium text-surface-600"
            >{t("users.active")}</th
          >
          <th class="text-left px-4 py-3 font-medium text-surface-600"
            >{t("users.lastSignIn")}</th
          >
          <th class="text-left px-4 py-3 font-medium text-surface-600"
            >{t("users.createdAt")}</th
          >
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
                  <img
                    src={avatarUrl(user)}
                    alt=""
                    class="w-9 h-9 rounded-full object-cover bg-surface-100"
                  />
                {:else}
                  <div
                    class="w-9 h-9 rounded-full bg-brand-100 text-brand-700 grid place-items-center text-xs font-semibold"
                  >
                    {initials(user)}
                  </div>
                {/if}
                <div class="min-w-0">
                  <div class="font-medium text-surface-900 truncate">
                    {displayName(user)}
                  </div>
                  <div class="text-xs text-surface-400 truncate">
                    {user.email || user.id}
                  </div>
                </div>
              </div>
            </td>
            <td class="px-4 py-3">
              {#if suspended}
                <span
                  class="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-xs font-medium bg-red-50 text-red-700"
                >
                  <span class="w-1.5 h-1.5 rounded-full bg-red-500"></span>{t(
                    "users.suspended",
                  )}
                </span>
              {:else}
                <span
                  class="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-xs font-medium bg-emerald-50 text-emerald-700"
                >
                  <span class="w-1.5 h-1.5 rounded-full bg-emerald-500"
                  ></span>{t("users.active")}
                </span>
              {/if}
            </td>
            <td class="px-4 py-3 text-surface-500"
              >{formatDate(user.last_sign_in_at) || t("users.never")}</td
            >
            <td class="px-4 py-3 text-surface-500"
              >{formatDay(user.created_at) || "-"}</td
            >
            <td class="px-4 py-3 text-right relative">
              <button
                onclick={(e) => toggleMenu(user.id, e)}
                class="inline-flex items-center justify-center w-8 h-8 rounded-lg text-surface-500 hover:bg-surface-100 hover:text-surface-700"
                aria-label={t("users.moreActions")}>⋯</button
              >
              {#if openMenuId === user.id}
                <!-- 点击遮罩关闭菜单，位于菜单之下、表格之上 -->
                <button
                  type="button"
                  tabindex="-1"
                  aria-hidden="true"
                  class="fixed inset-0 z-20 cursor-default"
                  onclick={(e) => {
                    e.stopPropagation();
                    closeMenu();
                  }}
                ></button>
                <div
                  class="absolute right-4 top-12 z-30 w-44 bg-white rounded-lg border border-surface-200 shadow-lg py-1 text-left"
                >
                  <a
                    href={resolve(
                      `/users/${encodeURIComponent(user.id)}/settings`,
                    )}
                    onclick={(e) => e.stopPropagation()}
                    class="block w-full px-3 py-2 text-sm text-surface-700 hover:bg-surface-50 text-left"
                  >
                    {t("users.viewDetails")}
                  </a>
                  <button
                    type="button"
                    disabled={!mutationStorageReady || userResourceBusy(user.id)}
                    onclick={(e) => {
                      e.stopPropagation();
                      handleToggleSuspend(user);
                    }}
                    class="w-full px-3 py-2 text-left text-sm text-surface-700 hover:bg-surface-50 disabled:cursor-not-allowed disabled:opacity-50"
                  >
                    {suspended ? t("users.restore") : t("Suspend")}
                  </button>
                  <div class="my-1 border-t border-surface-100"></div>
                  <button
                    type="button"
                    disabled={!mutationStorageReady || userResourceBusy(user.id)}
                    onclick={(e) => {
                      e.stopPropagation();
                      handleDelete(user);
                    }}
                    class="w-full px-3 py-2 text-left text-sm text-red-600 hover:bg-red-50 disabled:cursor-not-allowed disabled:opacity-50"
                  >
                    {t("users.delete")}
                  </button>
                </div>
              {/if}
            </td>
          </tr>
        {/each}
      </tbody>
    </table>
  </div>
  <div class="mt-4 flex items-center justify-between text-sm text-surface-500">
    <span>{t("Page")} {currentPage}</span>
    <div class="flex gap-2">
      <button
        disabled={loading || currentPage <= 1}
        onclick={() => changePage(currentPage - 1)}
        class="rounded-lg border border-surface-300 px-3 py-1.5 disabled:opacity-40"
        >{t("Previous")}</button
      ><button
        disabled={loading || currentPage * pageSize >= totalUsers}
        onclick={() => changePage(currentPage + 1)}
        class="rounded-lg border border-surface-300 px-3 py-1.5 disabled:opacity-40"
        >{t("Next")}</button
      >
    </div>
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
      aria-label={t("users.close")}
    ></button>
    <!-- 抽屉 -->
    <aside
      class="relative w-full max-w-xl h-full bg-surface-50 shadow-2xl flex flex-col"
    >
      <header
        class="bg-white border-b border-surface-200 px-6 py-5 flex items-start justify-between gap-4"
      >
        <div class="flex items-center gap-3 min-w-0">
          {#if avatarUrl(detail)}
            <img
              src={avatarUrl(detail)}
              alt=""
              class="w-11 h-11 rounded-full object-cover bg-surface-100"
            />
          {:else}
            <div
              class="w-11 h-11 rounded-full bg-brand-100 text-brand-700 grid place-items-center text-sm font-semibold"
            >
              {initials(detail)}
            </div>
          {/if}
          <div class="min-w-0">
            <div class="flex items-center gap-2">
              <h3 class="text-lg font-semibold text-surface-900 truncate">
                {displayName(detail)}
              </h3>
              {#if suspended}
                <span
                  class="shrink-0 inline-flex items-center gap-1.5 px-2 py-0.5 rounded-full text-[11px] font-medium bg-red-50 text-red-700"
                  >{t("users.suspended")}</span
                >
              {:else}
                <span
                  class="shrink-0 inline-flex items-center gap-1.5 px-2 py-0.5 rounded-full text-[11px] font-medium bg-emerald-50 text-emerald-700"
                  >{t("users.active")}</span
                >
              {/if}
            </div>
            <p class="text-sm text-surface-400 truncate">
              {detail.email || detail.id}
            </p>
          </div>
        </div>
        <button
          onclick={() => (selectedUser = null)}
          class="shrink-0 w-8 h-8 grid place-items-center rounded-lg text-surface-400 hover:bg-surface-100 hover:text-surface-600"
          aria-label={t("users.close")}>&times;</button
        >
      </header>

      <!-- 页签 -->
      <nav class="bg-white border-b border-surface-200 px-6 flex gap-1">
        {#each [["profile", t("users.profile")], ["security", t("users.security")], ["connectedAccounts", t("users.connectedAccounts")], ["rolesPermissions", t("users.rolesPermissions")]] as [key, label] (key)}
          <button
            onclick={() => switchTab(key)}
            class="px-3 py-3 text-sm font-medium border-b-2 -mb-px transition-colors {activeTab ===
            key
              ? 'border-brand-600 text-brand-600'
              : 'border-transparent text-surface-500 hover:text-surface-700'}"
            >{label}</button
          >
        {/each}
      </nav>

      <div class="flex-1 overflow-y-auto px-6 py-5 space-y-5">
        {#if drawerLoading}
          <p class="text-surface-400 text-sm">{t("Loading...")}</p>
        {:else if activeTab === "profile"}
          <dl
            class="bg-white rounded-xl border border-surface-200 divide-y divide-surface-100"
          >
            {#each [["users.userId", detail.id], ["Email", detail.email || "-"], ["Phone", detail.phone || "-"], ["users.provider", providers(detail)
                  .map((p) => providerLabel(p))
                  .join(" · ") || "-"], ["users.lastSignIn", formatDate(detail.last_sign_in_at) || t("users.never")], ["users.createdAt", formatDay(detail.created_at) || "-"], ["users.suspendedUntil", suspended ? formatDay(detail.banned_until) || detail.banned_until : null]] as [labelKey, value] (labelKey)}
              {#if value}
                <div class="px-4 py-3 flex items-center justify-between gap-4">
                  <dt class="text-sm text-surface-500">{t(labelKey)}</dt>
                  <dd
                    class="text-sm text-surface-900 font-medium text-right break-all"
                  >
                    {value}
                  </dd>
                </div>
              {/if}
            {/each}
          </dl>
        {:else if activeTab === "security"}
          <!-- MFA 因子：真实列表，点击重置，无需手填 ID -->
          <section>
            <h4 class="text-sm font-semibold text-surface-700 mb-2">
              {t("users.mfaFactors")}
            </h4>
            <div
              class="bg-white rounded-xl border border-surface-200 divide-y divide-surface-100"
            >
              {#each (detail.factors || []).filter((factor) => factor.factor_type === "totp") as factor (factor.id)}
                <div class="px-4 py-3 flex items-center justify-between gap-3">
                  <div class="min-w-0">
                    <div class="text-sm font-medium text-surface-900">
                      {factorTypeLabel(factor.factor_type)}
                    </div>
                    <div class="text-xs text-surface-400">
                      {factor.friendly_name || factor.id}
                    </div>
                  </div>
                  <button
                    type="button"
                    disabled={!mutationStorageReady || userResourceBusy(detail.id)}
                    onclick={() => handleResetFactor(factor.id)}
                    class="shrink-0 rounded-md border border-red-200 px-2.5 py-1 text-xs text-red-600 hover:bg-red-50 disabled:cursor-not-allowed disabled:opacity-50"
                    >{t("Reset Factor")}</button
                  >
                </div>
              {:else}
                <div class="px-4 py-6 text-center text-sm text-surface-400">
                  {t("users.noMfaFactors")}
                </div>
              {/each}
            </div>
          </section>

        {:else if activeTab === "connectedAccounts"}
          <div
            class="bg-white rounded-xl border border-surface-200 divide-y divide-surface-100"
          >
            {#each detail.identities || [] as identity (identity.id)}
              <div class="px-4 py-3 flex items-center justify-between gap-3">
                <div class="min-w-0 flex items-center gap-3">
                  <span
                    class="shrink-0 inline-flex items-center px-2 py-0.5 rounded-md bg-surface-100 text-surface-700 text-xs font-medium"
                    >{providerLabel(identity.provider)}</span
                  >
                  <div class="min-w-0">
                    <div class="text-sm font-medium text-surface-900 truncate">
                      {identity.identity_data?.email ||
                        identity.identity_data?.name ||
                        identity.identity_id ||
                        identity.id}
                    </div>
                    <div class="text-xs text-surface-400">
                      {formatDate(identity.last_sign_in_at) ||
                        formatDate(identity.created_at) ||
                        ""}
                    </div>
                  </div>
                </div>
              </div>
            {:else}
              <div class="px-4 py-6 text-center text-sm text-surface-400">
                {t("users.noIdentities")}
              </div>
            {/each}
          </div>
        {:else if activeTab === "rolesPermissions"}
          <section>
            <div class="mb-4 rounded-xl border border-surface-200 bg-white p-4">
              <label
                for="drawer-application-context"
                class="mb-1 block text-sm font-medium text-surface-700"
                >{t("users.applicationContext")}</label
              >
              {#if applicationLoadError}
                <div class="flex items-center justify-between gap-3 text-sm text-red-700">
                  <span>{t("users.applicationLoadFailed")}</span>
                  <button
                    onclick={loadApplications}
                    class="shrink-0 rounded-lg border border-red-200 px-2.5 py-1 text-xs font-semibold hover:bg-red-50"
                    >{t("users.retryApplications")}</button
                  >
                </div>
              {:else if !applicationsLoaded}
                <p class="text-sm text-surface-400">{t("Loading...")}</p>
              {:else}
                <select
                  id="drawer-application-context"
                  value={selectedApplicationId}
                  onchange={changeApplication}
                  class="w-full rounded-lg border border-surface-300 bg-white px-3 py-2 text-sm"
                >
                  <option value="">{t("users.projectWide")}</option>
                  {#each applications as application (applicationId(application))}
                    <option value={applicationId(application)}>
                      {applicationLabel(application)}
                    </option>
                  {/each}
                </select>
              {/if}
            </div>
            <h4 class="text-sm font-semibold text-surface-700 mb-2">
              {t("users.assignedRoles")}
            </h4>
            <div
              class="bg-white rounded-xl border border-surface-200 divide-y divide-surface-100"
            >
              {#if rolesPermissionsLoading}
                <div class="px-4 py-6 text-center text-sm text-surface-400">
                  {t("Loading...")}
                </div>
              {:else}
                {#each roles as assignment (roleKey(assignment))}
                  {@const role = roleFromAssignment(assignment)}
                  <div class="px-4 py-3 flex items-center justify-between gap-3">
                    <div class="min-w-0">
                      <div class="text-sm font-medium text-surface-900 truncate">
                        {role.name}
                      </div>
                      {#if role.description}<div
                          class="text-xs text-surface-400 truncate"
                        >
                          {role.description}
                        </div>{/if}
                    </div>
                  </div>
                {:else}
                  <div class="px-4 py-6 text-center text-sm text-surface-400">
                    {t("users.noRoles")}
                  </div>
                {/each}
              {/if}
            </div>
          </section>
          <section>
            <h4 class="text-sm font-semibold text-surface-700 mb-2">
              {t("users.permissions")}
            </h4>
            <p class="text-xs text-surface-400 mb-1">
              {t("users.permissionsHint")}
            </p>
            <p class="text-xs text-surface-500 mb-3">
              {t("users.permissionsSource")}
            </p>
            {#if rolesPermissionsLoading}
              <div
                class="bg-white rounded-xl border border-surface-200 px-4 py-6 text-center text-sm text-surface-400"
              >
                {t("Loading...")}
              </div>
            {:else if permissions.length}
              <div class="grid gap-2">
                {#each permissions as perm (permissionKey(perm))}
                  {@const item = normalizePermission(perm)}
                  {@const label = permissionLabel(item, t)}
                  {@const description = permissionDescription(item, t)}
                  <div
                    class="bg-white border border-surface-200 rounded-lg px-3 py-2"
                  >
                    <div class="flex items-center justify-between gap-3">
                      <span
                        class="text-sm font-medium text-surface-900 truncate"
                        title={item.name}>{label}</span
                      >
                      <code
                        class="shrink-0 inline-block max-w-[12rem] truncate text-[11px] text-surface-400 bg-surface-50 border border-surface-100 rounded px-1.5 py-0.5"
                        >{item.name}</code
                      >
                    </div>
                    {#if description}
                      <p class="text-xs text-surface-500 mt-1">{description}</p>
                    {/if}
                  </div>
                {/each}
              </div>
            {:else}
              <div
                class="bg-white rounded-xl border border-surface-200 px-4 py-6 text-center text-sm text-surface-400"
              >
                {t("users.noPermissions")}
              </div>
            {/if}
          </section>
        {/if}
      </div>
    </aside>
  </div>
{/if}
