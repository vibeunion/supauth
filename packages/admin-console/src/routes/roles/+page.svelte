<script>
  import { onMount } from 'svelte';
  import { t } from '$lib/i18n.js';
  import { PERMISSION_CATALOG, PERMISSION_GROUPS, permissionDescription, permissionLabel, permissionMeta } from '$lib/permission-catalog.js';
  import { listApplications, listOrganizations, listRoles, listUsers, createRole, updateRole, deleteRole, createRolePermission, deleteRolePermission, assignRole, listRoleAssignments, revokeRole } from '$lib/api/client.js';

  let roles = $state([]);
  let loading = $state(true);
  let saving = $state(false);
  let error = $state(null);
  let showCreate = $state(false);
  let newRole = $state({ name: '', description: '' });
  let selectedRoleId = $state(null);
  let search = $state('');
  let selectedGroup = $state('all');
  let permissionQuery = $state('');
  let customPermission = $state({ name: '', description: '' });
  let cloneRole = $state({ name: '', description: '' });
  let showClone = $state(false);
  let assignmentForm = $state({ targetType: 'user', targetId: '', organizationId: '', assignmentId: '' });
  let assignments = $state([]);
  let assignmentsLoading = $state(false);
  let assignmentMessage = $state(null);
  let assignmentError = $state(null);
  let users = $state([]);
  let applications = $state([]);
  let organizations = $state([]);
  let targetSearch = $state('');
  let organizationSearch = $state('');
  let templateBusy = $state({});
  let editingRoleId = $state(null);
  let editRole = $state({ name: '', description: '' });
  let busyPermissions = $state({});
  let busyGroups = $state({});

  const riskPatterns = [
    { pattern: /^security\.manage$/, weight: 4 },
    { pattern: /^tenant_config\.manage$/, weight: 4 },
    { pattern: /^operations\.manage$/, weight: 4 },
    { pattern: /^organization\.manage$/, weight: 3 },
    { pattern: /\.manage$/, weight: 2 },
    { pattern: /\.write$/, weight: 1 },
    { pattern: /admin/i, weight: 3 },
  ];

  const roleTemplates = [
    {
      id: 'admin',
      name: 'admin',
      titleKey: 'roles.templateAdmin',
      descKey: 'roles.templateAdminDesc',
      permissions: PERMISSION_CATALOG.map((permission) => permission.name),
    },
    {
      id: 'auditor',
      name: 'auditor',
      titleKey: 'roles.templateAuditor',
      descKey: 'roles.templateAuditorDesc',
      permissions: ['users.read', 'applications.read', 'api_resources.read', 'webhooks.read', 'audit.read', 'security.read', 'operations.read'],
    },
    {
      id: 'operator',
      name: 'operator',
      titleKey: 'roles.templateOperator',
      descKey: 'roles.templateOperatorDesc',
      permissions: ['resource.read', 'resource.write', 'users.read', 'applications.read', 'operations.read'],
    },
    {
      id: 'service_account',
      name: 'service_account',
      titleKey: 'roles.templateServiceAccount',
      descKey: 'roles.templateServiceAccountDesc',
      permissions: ['resource.read', 'resource.write', 'api_resources.read'],
    },
  ];

  function permissionsOf(role) {
    return Array.isArray(role?.permissions) ? role.permissions : [];
  }

  function permissionNames(role) {
    return new Set(permissionsOf(role).map((p) => p.name));
  }

  function findPermission(role, name) {
    return permissionsOf(role).find((p) => p.name === name);
  }

  function normalizeText(value) {
    return String(value || '').trim().toLowerCase();
  }

  function roleMatches(role, term) {
    if (!term) return true;
    const haystack = [
      role.name,
      role.description,
      ...permissionsOf(role).flatMap((p) => [p.name, p.description]),
    ].map(normalizeText).join(' ');
    return haystack.includes(term);
  }

  function formatCount(template, count) {
    return t(template).replace('{count}', String(count));
  }

  function formatText(template, values) {
    return Object.entries(values).reduce(
      (text, [key, value]) => text.replaceAll(`{${key}}`, String(value)),
      t(template),
    );
  }

  function riskScore(role) {
    return permissionsOf(role).reduce((score, permission) => {
      const name = permission.name || '';
      const matched = riskPatterns.find((rule) => rule.pattern.test(name));
      const customPenalty = permissionMeta(name)?.labelKey ? 0 : 1;
      return score + (matched?.weight || 0) + customPenalty;
    }, 0);
  }

  function roleRisk(role) {
    const score = riskScore(role);
    if (score >= 8) return { level: 'high', label: t('roles.riskHigh'), tone: 'bg-red-50 text-red-700 border-red-200' };
    if (score >= 3) return { level: 'medium', label: t('roles.riskMedium'), tone: 'bg-amber-50 text-amber-700 border-amber-200' };
    return { level: 'low', label: t('roles.riskLow'), tone: 'bg-emerald-50 text-emerald-700 border-emerald-200' };
  }

  function riskyPermissionNames(names) {
    return names.filter((name) => {
      if (!name) return false;
      if (!permissionMeta(name)?.labelKey) return true;
      return riskPatterns.some((rule) => rule.weight >= 3 && rule.pattern.test(name));
    });
  }

  function confirmPermissionChange(action, names) {
    const risky = riskyPermissionNames(names);
    if (names.length <= 1 && risky.length === 0) return true;
    const message = risky.length > 0
      ? formatText('roles.confirmRiskyChange', { action, count: names.length, permissions: risky.join(', ') })
      : formatText('roles.confirmBulkChange', { action, count: names.length });
    return confirm(message);
  }

  function groupCoverage(role, group) {
    const owned = permissionNames(role);
    const items = PERMISSION_CATALOG.filter((permission) => permission.group === group);
    const ownedCount = items.filter((permission) => owned.has(permission.name)).length;
    return { group, items, ownedCount, total: items.length };
  }

  function customPermissions(role) {
    return permissionsOf(role).filter((permission) => !permissionMeta(permission.name)?.labelKey);
  }

  function roleByName(name) {
    return roles.find((role) => normalizeText(role.name) === normalizeText(name));
  }

  function userId(user) {
    return user?.id || user?.user_id || user?.userId || '';
  }

  function userLabel(user) {
    const id = userId(user);
    const name = user?.name || user?.full_name || user?.user_metadata?.name || user?.raw_user_meta_data?.name;
    const email = user?.email || user?.phone || id;
    return [name, email].filter(Boolean).join(' · ');
  }

  function applicationId(application) {
    return application?.id || application?.client_id || application?.clientId || application?.application_id || '';
  }

  function applicationLabel(application) {
    const id = applicationId(application);
    return [application?.name || application?.client_name || application?.clientName, id].filter(Boolean).join(' · ');
  }

  function organizationId(organization) {
    return organization?.id || organization?.organization_id || organization?.organizationId || '';
  }

  function organizationLabel(organization) {
    const id = organizationId(organization);
    return [organization?.name || organization?.slug, id].filter(Boolean).join(' · ');
  }

  function chooseTarget(id) {
    assignmentForm = { ...assignmentForm, targetId: id };
    targetSearch = '';
  }

  function chooseOrganization(id) {
    assignmentForm = { ...assignmentForm, organizationId: id };
    organizationSearch = '';
  }

  function assignmentIdOf(assignment) {
    return assignment?.id || assignment?.assignment_id || '';
  }

  function assignmentKey(assignment) {
    const target = assignmentTarget(assignment);
    return assignmentIdOf(assignment) || `${target.type}:${target.id}:${assignmentOrganization(assignment)}`;
  }

  function assignmentTarget(assignment) {
    const userId = assignment?.user_id || assignment?.userId;
    const applicationId = assignment?.application_id || assignment?.applicationId;
    if (userId) return { type: t('roles.targetUser'), id: userId };
    if (applicationId) return { type: t('roles.targetApplication'), id: applicationId };
    return { type: t('roles.targetUnknown'), id: t('common.notAvailable') };
  }

  function assignmentOrganization(assignment) {
    return assignment?.organization_id || assignment?.organizationId || '-';
  }

  function assignmentCreatedAt(assignment) {
    const value = assignment?.created_at || assignment?.createdAt;
    return value ? new Date(value).toLocaleString() : '-';
  }

  function assignmentAuditHref(roleId) {
    const params = new URLSearchParams({ resource_type: 'role', resource_id: roleId });
    return `/audit?${params.toString()}`;
  }

  async function load() {
    loading = true;
    try {
      const [res] = await Promise.all([listRoles(), loadAssignmentTargets()]);
      roles = res.items || res.data || (Array.isArray(res) ? res : []);
      if (!selectedRoleId || !roles.some((role) => role.id === selectedRoleId)) {
        selectedRoleId = roles[0]?.id || null;
      }
      await loadRoleAssignments(selectedRoleId);
      error = null;
    } catch (e) {
      error = e.message;
    }
    loading = false;
  }

  async function loadAssignmentTargets() {
    try {
      const [userRes, applicationRes, organizationRes] = await Promise.all([listUsers(), listApplications(), listOrganizations()]);
      users = userRes.items || userRes.data || (Array.isArray(userRes) ? userRes : []);
      applications = applicationRes.items || applicationRes.data || (Array.isArray(applicationRes) ? applicationRes : []);
      organizations = organizationRes.items || organizationRes.data || (Array.isArray(organizationRes) ? organizationRes : []);
    } catch {
      users = [];
      applications = [];
      organizations = [];
    }
  }

  async function loadRoleAssignments(roleId) {
    if (!roleId) {
      assignments = [];
      return;
    }
    assignmentsLoading = true;
    assignmentError = null;
    try {
      const res = await listRoleAssignments(roleId);
      assignments = res.items || res.data || (Array.isArray(res) ? res : []);
    } catch (e) {
      assignments = [];
      assignmentError = e.message;
    }
    assignmentsLoading = false;
  }

  async function selectRole(roleId) {
    selectedRoleId = roleId;
    showClone = false;
    assignmentMessage = null;
    assignmentError = null;
    await loadRoleAssignments(roleId);
  }

  async function handleCreate() {
    if (!newRole.name.trim()) return;
    const roleName = newRole.name.trim();
    saving = true;
    try {
      const created = await createRole({ name: roleName, description: newRole.description.trim() });
      if (created?.id) selectedRoleId = created.id;
      showCreate = false;
      newRole = { name: '', description: '' };
      await load();
      if (!created?.id) {
        selectedRoleId = roles.find((role) => role.name === roleName)?.id || selectedRoleId;
        await loadRoleAssignments(selectedRoleId);
      }
    } catch (e) {
      error = e.message;
    }
    saving = false;
  }

  async function handleCreateTemplate(template) {
    const existing = roleByName(template.name);
    if (existing) {
      selectedRoleId = existing.id;
      assignmentMessage = formatText('roles.templateAlreadyExists', { role: existing.name });
      await loadRoleAssignments(existing.id);
      return;
    }

    templateBusy[template.id] = true;
    try {
      const created = await createRole({ name: template.name, description: t(template.descKey) });
      const roleId = created?.id;
      if (!roleId) throw new Error(t('roles.cloneMissingRoleId'));
      for (const permissionName of template.permissions) {
        const permission = PERMISSION_CATALOG.find((item) => item.name === permissionName);
        await createRolePermission(roleId, {
          name: permissionName,
          description: permission?.descKey ? t(permission.descKey) : '',
        });
      }
      selectedRoleId = roleId;
      assignmentMessage = formatText('roles.templateCreated', { role: template.name });
      await load();
    } catch (e) {
      error = e.message;
    }
    delete templateBusy[template.id];
  }

  function startEdit(role) {
    editingRoleId = role.id;
    editRole = { name: role.name || '', description: role.description || '' };
  }

  function startClone(role) {
    showClone = true;
    cloneRole = {
      name: `${role.name || 'role'}_copy`,
      description: role.description || '',
    };
  }

  async function handleUpdateRole(role) {
    if (!editRole.name.trim()) return;
    saving = true;
    try {
      await updateRole(role.id, { name: editRole.name.trim(), description: editRole.description.trim() });
      editingRoleId = null;
      await load();
    } catch (e) {
      error = e.message;
    }
    saving = false;
  }

  async function handleDelete(role) {
    if (!confirm(t('Delete this role? All permissions and assignments will be removed.'))) return;
    try {
      await deleteRole(role.id);
      if (selectedRoleId === role.id) selectedRoleId = null;
      await load();
    } catch (e) {
      error = e.message;
    }
  }

  async function handleCloneRole(role) {
    if (!cloneRole.name.trim()) return;
    saving = true;
    try {
      let created = await createRole({ name: cloneRole.name.trim(), description: cloneRole.description.trim() });
      if (!created?.id) {
        await load();
        created = roles.find((candidate) => candidate.name === cloneRole.name.trim());
      }
      if (!created?.id) throw new Error(t('roles.cloneMissingRoleId'));
      for (const permission of permissionsOf(role)) {
        await createRolePermission(created.id, { name: permission.name, description: permission.description || permissionDescription(permission, t) });
      }
      showClone = false;
      selectedRoleId = created.id;
      await load();
    } catch (e) {
      error = e.message;
    }
    saving = false;
  }

  function permissionBusyKey(roleId, name) {
    return `${roleId}:${name}`;
  }

  async function addPermission(role, permission) {
    const owned = permissionNames(role);
    if (owned.has(permission.name)) return;
    const meta = permissionMeta(permission.name);
    const description = permission.description || (meta?.descKey ? t(meta.descKey) : '');
    await createRolePermission(role.id, { name: permission.name, description });
  }

  async function removePermission(role, permissionName) {
    const permission = findPermission(role, permissionName);
    if (!permission) return;
    await deleteRolePermission(role.id, permission.id);
  }

  async function toggleCatalogPermission(role, permission) {
    const key = permissionBusyKey(role.id, permission.name);
    if (busyPermissions[key]) return;
    busyPermissions[key] = true;
    try {
      if (permissionNames(role).has(permission.name)) {
        if (!confirmPermissionChange(t('roles.revokeAction'), [permission.name])) return;
        await removePermission(role, permission.name);
      } else {
        if (!confirmPermissionChange(t('roles.grantAction'), [permission.name])) return;
        await addPermission(role, permission);
      }
      await load();
      error = null;
    } catch (e) {
      error = e.message;
    } finally {
      delete busyPermissions[key];
    }
  }

  async function applyGroup(role, group, action) {
    const key = `${role.id}:${group}:${action}`;
    if (busyGroups[key]) return;
    busyGroups[key] = true;
    try {
      const items = PERMISSION_CATALOG.filter((permission) => permission.group === group);
      const owned = permissionNames(role);
      if (action === 'grant') {
        const targets = items.filter((permission) => !owned.has(permission.name));
        if (!confirmPermissionChange(t('roles.grantAction'), targets.map((permission) => permission.name))) return;
        for (const item of targets) {
          await addPermission(role, item);
        }
      } else {
        const targets = items.filter((permission) => owned.has(permission.name));
        if (!confirmPermissionChange(t('roles.revokeAction'), targets.map((permission) => permission.name))) return;
        for (const item of targets) {
          await removePermission(role, item.name);
        }
      }
      await load();
      error = null;
    } catch (e) {
      error = e.message;
    } finally {
      delete busyGroups[key];
    }
  }

  async function handleAddCustomPermission(role) {
    const name = customPermission.name.trim();
    if (!name) return;
    if (permissionNames(role).has(name)) {
      error = t('roles.alreadyExists');
      return;
    }
    try {
      if (!confirmPermissionChange(t('roles.grantAction'), [name])) return;
      await createRolePermission(role.id, { name, description: customPermission.description.trim() });
      customPermission = { name: '', description: '' };
      await load();
      error = null;
    } catch (e) {
      error = e.message;
    }
  }

  async function handleDeletePermission(role, permission) {
    try {
      if (!confirmPermissionChange(t('roles.revokeAction'), [permission.name])) return;
      await deleteRolePermission(role.id, permission.id);
      await load();
    } catch (e) {
      error = e.message;
    }
  }

  async function handleAssignRole(role) {
    const targetId = assignmentForm.targetId.trim();
    if (!targetId) return;
    const payload = {
      ...(assignmentForm.targetType === 'user' ? { user_id: targetId } : { application_id: targetId }),
      ...(assignmentForm.organizationId.trim() ? { organization_id: assignmentForm.organizationId.trim() } : {}),
    };
    if (!confirm(formatText('roles.confirmAssign', { role: role.name, target: targetId }))) return;
    saving = true;
    try {
      const assignment = await assignRole(role.id, payload);
      assignmentForm = { ...assignmentForm, targetId: '' };
      assignmentMessage = formatText('roles.assignmentCreated', { id: assignmentIdOf(assignment) || t('common.notAvailable') });
      await loadRoleAssignments(role.id);
      error = null;
    } catch (e) {
      error = e.message;
    }
    saving = false;
  }

  async function handleRevokeAssignment(role) {
    const assignmentId = assignmentForm.assignmentId.trim();
    if (!assignmentId) return;
    await revokeAssignmentById(role, assignmentId);
  }

  async function revokeAssignmentById(role, assignmentId) {
    if (!confirm(formatText('roles.confirmRevokeAssignment', { role: role.name, assignment: assignmentId }))) return;
    saving = true;
    try {
      await revokeRole(role.id, assignmentId);
      assignmentForm = { ...assignmentForm, assignmentId: assignmentForm.assignmentId === assignmentId ? '' : assignmentForm.assignmentId };
      assignmentMessage = t('roles.assignmentRevoked');
      await loadRoleAssignments(role.id);
      error = null;
    } catch (e) {
      error = e.message;
    }
    saving = false;
  }

  const filteredRoles = $derived.by(() => {
    const term = normalizeText(search);
    return roles.filter((role) => roleMatches(role, term));
  });

  const selectedRole = $derived(roles.find((role) => role.id === selectedRoleId) || filteredRoles[0] || null);

  const totals = $derived.by(() => {
    const uniquePermissions = new Set(roles.flatMap((role) => permissionsOf(role).map((permission) => permission.name)));
    const highRisk = roles.filter((role) => roleRisk(role).level === 'high').length;
    const customCount = roles.reduce((sum, role) => sum + customPermissions(role).length, 0);
    return { roles: roles.length, permissions: uniquePermissions.size, highRisk, customCount };
  });

  const catalogByGroup = $derived.by(() => PERMISSION_GROUPS
    .map((group) => ({
      group,
      label: t(`perm.group.${group}`),
      items: PERMISSION_CATALOG.filter((permission) => permission.group === group),
    }))
    .filter((entry) => entry.items.length > 0));

  const visibleCatalogGroups = $derived.by(() => {
    const term = normalizeText(permissionQuery);
    return catalogByGroup
      .filter((entry) => selectedGroup === 'all' || entry.group === selectedGroup)
      .map((entry) => ({
        ...entry,
        items: entry.items.filter((item) => {
          if (!term) return true;
          return [item.name, t(item.labelKey), t(item.descKey)].map(normalizeText).join(' ').includes(term);
        }),
      }))
      .filter((entry) => entry.items.length > 0);
  });

  const selectedCoverage = $derived.by(() => selectedRole
    ? catalogByGroup.map((entry) => groupCoverage(selectedRole, entry.group))
    : []);

  const targetOptions = $derived.by(() => {
    const source = assignmentForm.targetType === 'user'
      ? users.map((user) => ({ id: userId(user), label: userLabel(user) }))
      : applications.map((application) => ({ id: applicationId(application), label: applicationLabel(application) }));
    const term = normalizeText(targetSearch);
    return source
      .filter((item) => item.id)
      .filter((item) => !term || normalizeText(`${item.label} ${item.id}`).includes(term))
      .slice(0, 8);
  });

  const organizationOptions = $derived.by(() => {
    const term = normalizeText(organizationSearch);
    return organizations
      .map((organization) => ({ id: organizationId(organization), label: organizationLabel(organization) }))
      .filter((item) => item.id)
      .filter((item) => !term || normalizeText(`${item.label} ${item.id}`).includes(term))
      .slice(0, 8);
  });

  onMount(load);
</script>

<div class="space-y-6">
  <div class="flex flex-col gap-4 lg:flex-row lg:items-start lg:justify-between">
    <div>
      <p class="text-sm font-semibold uppercase tracking-[0.18em] text-brand-600">{t('roles.consoleEyebrow')}</p>
      <h2 class="mt-1 text-3xl font-bold text-surface-950">{t('Roles & Permissions')}</h2>
      <p class="mt-2 max-w-3xl text-sm text-surface-500">{t('roles.matureIntro')}</p>
    </div>
    <button onclick={() => showCreate = !showCreate} class="inline-flex items-center justify-center rounded-xl bg-brand-600 px-4 py-2.5 text-sm font-semibold text-white shadow-sm hover:bg-brand-700">
      {showCreate ? t('Cancel') : `+ ${t('New Role')}`}
    </button>
  </div>

  {#if error}
    <div class="rounded-xl border border-red-200 bg-red-50 p-4 text-sm text-red-700">{error}</div>
  {/if}

  <div class="grid gap-3 md:grid-cols-4">
    <div class="rounded-2xl border border-surface-200 bg-white p-4 shadow-sm">
      <p class="text-xs font-medium uppercase tracking-wide text-surface-400">{t('roles.totalRoles')}</p>
      <p class="mt-2 text-2xl font-bold text-surface-950">{totals.roles}</p>
    </div>
    <div class="rounded-2xl border border-surface-200 bg-white p-4 shadow-sm">
      <p class="text-xs font-medium uppercase tracking-wide text-surface-400">{t('roles.uniquePermissions')}</p>
      <p class="mt-2 text-2xl font-bold text-surface-950">{totals.permissions}</p>
    </div>
    <div class="rounded-2xl border border-surface-200 bg-white p-4 shadow-sm">
      <p class="text-xs font-medium uppercase tracking-wide text-surface-400">{t('roles.highRiskRoles')}</p>
      <p class="mt-2 text-2xl font-bold text-red-600">{totals.highRisk}</p>
    </div>
    <div class="rounded-2xl border border-surface-200 bg-white p-4 shadow-sm">
      <p class="text-xs font-medium uppercase tracking-wide text-surface-400">{t('roles.customPermissions')}</p>
      <p class="mt-2 text-2xl font-bold text-surface-950">{totals.customCount}</p>
    </div>
  </div>

  <div class="rounded-2xl border border-surface-200 bg-white p-5 shadow-sm">
    <div class="flex flex-col gap-3 lg:flex-row lg:items-start lg:justify-between">
      <div>
        <h3 class="text-lg font-semibold text-surface-950">{t('roles.roleTemplates')}</h3>
        <p class="mt-1 text-sm text-surface-500">{t('roles.roleTemplatesHint')}</p>
      </div>
    </div>
    <div class="mt-4 grid gap-3 md:grid-cols-2 xl:grid-cols-4">
      {#each roleTemplates as template (template.id)}
        {@const exists = Boolean(roleByName(template.name))}
        <div class="rounded-xl border border-surface-200 p-4">
          <div class="flex items-start justify-between gap-3">
            <div>
              <p class="font-semibold text-surface-950">{t(template.titleKey)}</p>
              <p class="mt-1 text-xs leading-5 text-surface-500">{t(template.descKey)}</p>
            </div>
            <span class="shrink-0 rounded-full bg-surface-100 px-2 py-0.5 text-[11px] text-surface-500">{template.permissions.length}</span>
          </div>
          <button onclick={() => handleCreateTemplate(template)} disabled={templateBusy[template.id]} class="mt-4 w-full rounded-lg border border-brand-200 px-3 py-1.5 text-sm font-semibold text-brand-700 hover:bg-brand-50 disabled:cursor-wait disabled:opacity-50">
            {exists ? t('roles.viewTemplateRole') : templateBusy[template.id] ? t('Saving...') : t('roles.createFromTemplate')}
          </button>
        </div>
      {/each}
    </div>
  </div>

  {#if showCreate}
    <div class="rounded-2xl border border-brand-100 bg-brand-50/60 p-5 shadow-sm">
      <h3 class="text-lg font-semibold text-surface-900">{t('New Role')}</h3>
      <div class="mt-4 grid gap-3 md:grid-cols-[1fr_2fr_auto] md:items-end">
        <div>
          <label for="new-role-name" class="mb-1 block text-sm font-medium text-surface-700">{t('Name')}</label>
          <input id="new-role-name" bind:value={newRole.name} class="w-full rounded-xl border border-surface-300 bg-white px-3 py-2 text-sm" placeholder={t('roles.placeholderName')}>
        </div>
        <div>
          <label for="new-role-description" class="mb-1 block text-sm font-medium text-surface-700">{t('Description')}</label>
          <input id="new-role-description" bind:value={newRole.description} class="w-full rounded-xl border border-surface-300 bg-white px-3 py-2 text-sm" placeholder={t('roles.descriptionPlaceholder')}>
        </div>
        <button onclick={handleCreate} disabled={!newRole.name.trim() || saving} class="rounded-xl bg-brand-600 px-4 py-2 text-sm font-semibold text-white hover:bg-brand-700 disabled:cursor-not-allowed disabled:opacity-40">{saving ? t('Saving...') : t('Create')}</button>
      </div>
    </div>
  {/if}

  {#if loading}
    <p class="text-surface-400">{t('Loading...')}</p>
  {:else if roles.length === 0}
    <div class="rounded-2xl border border-dashed border-surface-300 bg-surface-50 p-10 text-center">
      <p class="text-lg font-semibold text-surface-700">{t('No roles defined')}</p>
      <p class="mt-2 text-sm text-surface-500">{t('Create roles to control access with fine-grained permissions')}</p>
    </div>
  {:else}
    <div class="grid gap-5 xl:grid-cols-[360px_1fr]">
      <aside class="space-y-3">
        <div class="rounded-2xl border border-surface-200 bg-white p-4 shadow-sm">
          <label for="role-search" class="mb-2 block text-xs font-semibold uppercase tracking-wide text-surface-400">{t('roles.searchRoles')}</label>
          <input id="role-search" bind:value={search} class="w-full rounded-xl border border-surface-300 px-3 py-2 text-sm" placeholder={t('roles.searchPlaceholder')}>
        </div>

        <div class="max-h-[68vh] space-y-2 overflow-auto pr-1">
          {#each filteredRoles as role (role.id)}
            {@const risk = roleRisk(role)}
            <button
              class="w-full rounded-2xl border p-4 text-left transition {selectedRole?.id === role.id ? 'border-brand-300 bg-brand-50 shadow-sm' : 'border-surface-200 bg-white hover:border-brand-200'}"
              onclick={() => selectRole(role.id)}
            >
              <div class="flex items-start justify-between gap-3">
                <div class="min-w-0">
                  <p class="truncate font-semibold text-surface-950">{role.name}</p>
                  <p class="mt-1 line-clamp-2 text-xs text-surface-500">{role.description || t('roles.noDescription')}</p>
                </div>
                <span class="shrink-0 rounded-full border px-2 py-0.5 text-[11px] font-semibold {risk.tone}">{risk.label}</span>
              </div>
              <div class="mt-3 flex items-center gap-3 text-xs text-surface-500">
                <span>{formatCount('roles.permissionCount', permissionsOf(role).length)}</span>
                <span>{formatCount('roles.customCount', customPermissions(role).length)}</span>
              </div>
            </button>
          {/each}
          {#if filteredRoles.length === 0}
            <div class="rounded-2xl border border-dashed border-surface-300 bg-surface-50 p-6 text-center text-sm text-surface-500">{t('roles.noSearchResults')}</div>
          {/if}
        </div>
      </aside>

      {#if selectedRole}
        {@const risk = roleRisk(selectedRole)}
        {@const owned = permissionNames(selectedRole)}
        <section class="space-y-5">
          <div class="rounded-2xl border border-surface-200 bg-white p-5 shadow-sm">
            <div class="flex flex-col gap-4 lg:flex-row lg:items-start lg:justify-between">
              <div class="min-w-0 flex-1">
                {#if editingRoleId === selectedRole.id}
                  <div class="grid gap-3 md:grid-cols-[1fr_2fr]">
                    <input bind:value={editRole.name} class="rounded-xl border border-surface-300 px-3 py-2 text-sm font-semibold" aria-label={t('Name')}>
                    <input bind:value={editRole.description} class="rounded-xl border border-surface-300 px-3 py-2 text-sm" aria-label={t('Description')}>
                  </div>
                  <div class="mt-3 flex gap-2">
                    <button onclick={() => handleUpdateRole(selectedRole)} disabled={!editRole.name.trim() || saving} class="rounded-lg bg-brand-600 px-3 py-1.5 text-sm font-semibold text-white disabled:opacity-40">{t('Save')}</button>
                    <button onclick={() => editingRoleId = null} class="rounded-lg border border-surface-300 px-3 py-1.5 text-sm font-semibold text-surface-700">{t('Cancel')}</button>
                  </div>
                {:else}
                  <div class="flex flex-wrap items-center gap-3">
                    <h3 class="text-2xl font-bold text-surface-950">{selectedRole.name}</h3>
                    <span class="rounded-full border px-2.5 py-1 text-xs font-semibold {risk.tone}">{risk.label}</span>
                  </div>
                  <p class="mt-2 text-sm text-surface-500">{selectedRole.description || t('roles.noDescription')}</p>
                {/if}
              </div>
              <div class="flex shrink-0 gap-2">
                <button onclick={() => startClone(selectedRole)} class="rounded-lg border border-brand-200 px-3 py-2 text-sm font-semibold text-brand-700 hover:bg-brand-50">{t('roles.cloneRole')}</button>
                <button onclick={() => startEdit(selectedRole)} class="rounded-lg border border-surface-300 px-3 py-2 text-sm font-semibold text-surface-700 hover:bg-surface-50">{t('Edit')}</button>
                <button onclick={() => handleDelete(selectedRole)} class="rounded-lg border border-red-200 px-3 py-2 text-sm font-semibold text-red-600 hover:bg-red-50">{t('Delete')}</button>
              </div>
            </div>

            <div class="mt-5 grid gap-3 md:grid-cols-3">
              <div class="rounded-xl bg-surface-50 p-3">
                <p class="text-xs font-medium text-surface-400">{t('roles.grantedPermissions')}</p>
                <p class="mt-1 text-xl font-bold text-surface-950">{permissionsOf(selectedRole).length}</p>
              </div>
              <div class="rounded-xl bg-surface-50 p-3">
                <p class="text-xs font-medium text-surface-400">{t('roles.catalogCoverage')}</p>
                <p class="mt-1 text-xl font-bold text-surface-950">{selectedCoverage.reduce((sum, entry) => sum + entry.ownedCount, 0)} / {PERMISSION_CATALOG.length}</p>
              </div>
              <div class="rounded-xl bg-surface-50 p-3">
                <p class="text-xs font-medium text-surface-400">{t('roles.customPermissions')}</p>
                <p class="mt-1 text-xl font-bold text-surface-950">{customPermissions(selectedRole).length}</p>
              </div>
            </div>
          </div>

          {#if showClone}
            <div class="rounded-2xl border border-brand-100 bg-brand-50/60 p-5 shadow-sm">
              <div class="flex flex-col gap-3 lg:flex-row lg:items-start lg:justify-between">
                <div>
                  <h4 class="text-lg font-semibold text-surface-950">{t('roles.cloneRole')}</h4>
                  <p class="mt-1 text-sm text-surface-500">
                    {formatText('roles.cloneRoleHint', { role: selectedRole.name, count: permissionsOf(selectedRole).length })}
                  </p>
                </div>
                <button onclick={() => showClone = false} class="rounded-lg border border-surface-300 px-3 py-1.5 text-sm font-semibold text-surface-600 hover:bg-white">{t('Cancel')}</button>
              </div>

              <div class="mt-4 grid gap-3 md:grid-cols-[1fr_2fr_auto] md:items-end">
                <div>
                  <label for="clone-role-name" class="mb-1 block text-sm font-medium text-surface-700">{t('roles.cloneName')}</label>
                  <input id="clone-role-name" bind:value={cloneRole.name} class="w-full rounded-xl border border-surface-300 bg-white px-3 py-2 text-sm" placeholder={t('roles.placeholderName')}>
                </div>
                <div>
                  <label for="clone-role-description" class="mb-1 block text-sm font-medium text-surface-700">{t('roles.cloneDescription')}</label>
                  <input id="clone-role-description" bind:value={cloneRole.description} class="w-full rounded-xl border border-surface-300 bg-white px-3 py-2 text-sm" placeholder={t('roles.descriptionPlaceholder')}>
                </div>
                <button onclick={() => handleCloneRole(selectedRole)} disabled={!cloneRole.name.trim() || saving} class="rounded-xl bg-brand-600 px-4 py-2 text-sm font-semibold text-white hover:bg-brand-700 disabled:cursor-not-allowed disabled:opacity-40">{saving ? t('Saving...') : t('roles.createTemplate')}</button>
              </div>
            </div>
          {/if}

          <div class="rounded-2xl border border-surface-200 bg-white p-5 shadow-sm">
            <div class="flex flex-col gap-3 lg:flex-row lg:items-center lg:justify-between">
              <div>
                <h4 class="text-lg font-semibold text-surface-950">{t('roles.coverageMap')}</h4>
                <p class="text-sm text-surface-500">{t('roles.coverageHint')}</p>
              </div>
              <div class="flex flex-col gap-2 sm:flex-row">
                <select bind:value={selectedGroup} class="rounded-xl border border-surface-300 bg-white px-3 py-2 text-sm">
                  <option value="all">{t('roles.allGroups')}</option>
                  {#each catalogByGroup as entry (entry.group)}
                    <option value={entry.group}>{entry.label}</option>
                  {/each}
                </select>
                <input bind:value={permissionQuery} class="rounded-xl border border-surface-300 px-3 py-2 text-sm" placeholder={t('roles.searchPermissions')}>
              </div>
            </div>

            <div class="mt-4 grid gap-3 md:grid-cols-2 xl:grid-cols-3">
              {#each selectedCoverage as coverage (coverage.group)}
                <div class="rounded-xl border border-surface-200 p-3">
                  <div class="flex items-center justify-between gap-3">
                    <span class="text-sm font-semibold text-surface-800">{t(`perm.group.${coverage.group}`)}</span>
                    <span class="text-xs text-surface-500">{coverage.ownedCount}/{coverage.total}</span>
                  </div>
                  <div class="mt-2 h-2 overflow-hidden rounded-full bg-surface-100">
                    <div class="h-full rounded-full bg-brand-500" style:width={`${coverage.total ? Math.round((coverage.ownedCount / coverage.total) * 100) : 0}%`}></div>
                  </div>
                </div>
              {/each}
            </div>
          </div>

          <div class="space-y-4">
            {#each visibleCatalogGroups as group (group.group)}
              {@const coverage = groupCoverage(selectedRole, group.group)}
              <div class="rounded-2xl border border-surface-200 bg-white p-5 shadow-sm">
                <div class="flex flex-col gap-3 md:flex-row md:items-center md:justify-between">
                  <div>
                    <h4 class="text-base font-semibold text-surface-950">{group.label}</h4>
                    <p class="text-sm text-surface-500">{coverage.ownedCount}/{coverage.total} {t('roles.permissionsGranted')}</p>
                  </div>
                  <div class="flex gap-2">
                    <button onclick={() => applyGroup(selectedRole, group.group, 'grant')} disabled={coverage.ownedCount === coverage.total || busyGroups[`${selectedRole.id}:${group.group}:grant`]} class="rounded-lg border border-brand-200 px-3 py-1.5 text-xs font-semibold text-brand-700 hover:bg-brand-50 disabled:cursor-not-allowed disabled:opacity-40">{t('roles.grantGroup')}</button>
                    <button onclick={() => applyGroup(selectedRole, group.group, 'revoke')} disabled={coverage.ownedCount === 0 || busyGroups[`${selectedRole.id}:${group.group}:revoke`]} class="rounded-lg border border-surface-300 px-3 py-1.5 text-xs font-semibold text-surface-600 hover:bg-surface-50 disabled:cursor-not-allowed disabled:opacity-40">{t('roles.clearGroup')}</button>
                  </div>
                </div>

                <div class="mt-4 grid gap-3 lg:grid-cols-2">
                  {#each group.items as item (item.name)}
                    {@const checked = owned.has(item.name)}
                    {@const key = permissionBusyKey(selectedRole.id, item.name)}
                    <button onclick={() => toggleCatalogPermission(selectedRole, item)} disabled={busyPermissions[key]} class="rounded-xl border p-3 text-left transition {checked ? 'border-brand-300 bg-brand-50' : 'border-surface-200 bg-white hover:border-brand-200'} disabled:cursor-wait disabled:opacity-60">
                      <div class="flex items-start gap-3">
                        <span class="mt-0.5 flex h-5 w-5 shrink-0 items-center justify-center rounded border {checked ? 'border-brand-600 bg-brand-600 text-white' : 'border-surface-300 bg-white text-transparent'}">✓</span>
                        <span class="min-w-0">
                          <span class="block font-semibold text-surface-900">{t(item.labelKey)}</span>
                          <code class="mt-1 inline-block rounded bg-surface-100 px-1.5 py-0.5 text-[11px] text-surface-500">{item.name}</code>
                          <span class="mt-2 block text-xs leading-5 text-surface-500">{t(item.descKey)}</span>
                        </span>
                      </div>
                    </button>
                  {/each}
                </div>
              </div>
            {/each}
          </div>

          <div class="grid gap-5 lg:grid-cols-[1.2fr_0.8fr]">
            <div class="rounded-2xl border border-surface-200 bg-white p-5 shadow-sm">
              <div class="flex flex-col gap-3 lg:flex-row lg:items-start lg:justify-between">
                <div>
                  <h4 class="text-lg font-semibold text-surface-950">{t('roles.roleAssignments')}</h4>
                  <p class="mt-1 text-sm text-surface-500">{t('roles.assignmentHint')}</p>
                </div>
                <a href={assignmentAuditHref(selectedRole.id)} class="rounded-lg border border-surface-300 px-3 py-1.5 text-sm font-semibold text-surface-700 hover:bg-surface-50">{t('roles.viewAudit')}</a>
              </div>

              <div class="mt-4 grid gap-3 md:grid-cols-[160px_1fr_1fr_auto] md:items-end">
                <div>
                  <label for="assignment-target-type" class="mb-1 block text-sm font-medium text-surface-700">{t('roles.targetType')}</label>
                  <select
                    id="assignment-target-type"
                    bind:value={assignmentForm.targetType}
                    onchange={() => {
                      assignmentForm = { ...assignmentForm, targetId: '' };
                      targetSearch = '';
                    }}
                    class="w-full rounded-xl border border-surface-300 bg-white px-3 py-2 text-sm"
                  >
                    <option value="user">{t('roles.targetUser')}</option>
                    <option value="application">{t('roles.targetApplication')}</option>
                  </select>
                </div>
                <div>
                  <label for="assignment-target-id" class="mb-1 block text-sm font-medium text-surface-700">{t('roles.targetId')}</label>
                  <input id="assignment-target-id" bind:value={assignmentForm.targetId} class="w-full rounded-xl border border-surface-300 px-3 py-2 text-sm" placeholder={assignmentForm.targetType === 'user' ? 'user uuid' : 'application id'}>
                  <input bind:value={targetSearch} class="mt-2 w-full rounded-xl border border-surface-200 px-3 py-2 text-xs" placeholder={assignmentForm.targetType === 'user' ? t('roles.searchUsers') : t('roles.searchApplications')}>
                  {#if targetOptions.length > 0}
                    <div class="mt-2 max-h-36 overflow-auto rounded-xl border border-surface-200 bg-white">
                      {#each targetOptions as option (option.id)}
                        <button onclick={() => chooseTarget(option.id)} class="block w-full border-b border-surface-100 px-3 py-2 text-left text-xs last:border-b-0 hover:bg-brand-50">
                          <span class="block truncate font-medium text-surface-700">{option.label}</span>
                          <code class="text-[11px] text-surface-400">{option.id}</code>
                        </button>
                      {/each}
                    </div>
                  {/if}
                </div>
                <div>
                  <label for="assignment-org-id" class="mb-1 block text-sm font-medium text-surface-700">{t('roles.organizationOptional')}</label>
                  <input id="assignment-org-id" bind:value={assignmentForm.organizationId} class="w-full rounded-xl border border-surface-300 px-3 py-2 text-sm" placeholder="organization uuid">
                  <div class="mt-2 flex gap-2">
                    <input bind:value={organizationSearch} class="min-w-0 flex-1 rounded-xl border border-surface-200 px-3 py-2 text-xs" placeholder={t('roles.searchOrganizations')}>
                    <button onclick={() => assignmentForm = { ...assignmentForm, organizationId: '' }} class="rounded-xl border border-surface-200 px-3 py-2 text-xs font-semibold text-surface-500 hover:bg-surface-50">{t('roles.clearOrganization')}</button>
                  </div>
                  {#if organizationOptions.length > 0}
                    <div class="mt-2 max-h-36 overflow-auto rounded-xl border border-surface-200 bg-white">
                      {#each organizationOptions as option (option.id)}
                        <button onclick={() => chooseOrganization(option.id)} class="block w-full border-b border-surface-100 px-3 py-2 text-left text-xs last:border-b-0 hover:bg-brand-50">
                          <span class="block truncate font-medium text-surface-700">{option.label}</span>
                          <code class="text-[11px] text-surface-400">{option.id}</code>
                        </button>
                      {/each}
                    </div>
                  {/if}
                </div>
                <button onclick={() => handleAssignRole(selectedRole)} disabled={!assignmentForm.targetId.trim() || saving} class="rounded-xl bg-brand-600 px-4 py-2 text-sm font-semibold text-white hover:bg-brand-700 disabled:cursor-not-allowed disabled:opacity-40">{t('roles.assignRole')}</button>
              </div>

              <div class="mt-4 rounded-xl border border-amber-200 bg-amber-50 p-3 text-sm text-amber-800">
                {t('roles.auditHint')}
              </div>

              {#if assignmentMessage}
                <div class="mt-4 rounded-xl border border-emerald-200 bg-emerald-50 p-3 text-sm text-emerald-700">{assignmentMessage}</div>
              {/if}
              {#if assignmentError}
                <div class="mt-4 rounded-xl border border-red-200 bg-red-50 p-3 text-sm text-red-700">{assignmentError}</div>
              {/if}

              <div class="mt-5 flex items-center justify-between gap-3">
                <h5 class="text-sm font-semibold text-surface-900">{t('roles.currentAssignments')}</h5>
                <button onclick={() => loadRoleAssignments(selectedRole.id)} disabled={assignmentsLoading} class="rounded-lg border border-surface-300 px-3 py-1.5 text-xs font-semibold text-surface-600 hover:bg-surface-50 disabled:cursor-wait disabled:opacity-50">{t('Refresh')}</button>
              </div>

              {#if assignmentsLoading}
                <p class="mt-3 text-sm text-surface-400">{t('roles.loadingAssignments')}</p>
              {:else if assignments.length === 0}
                <div class="mt-3 rounded-xl border border-dashed border-surface-300 bg-surface-50 p-4 text-sm text-surface-500">{t('roles.noAssignments')}</div>
              {:else}
                <div class="mt-3 overflow-hidden rounded-xl border border-surface-200">
                  <table class="w-full text-sm">
                    <thead class="bg-surface-50 text-xs font-semibold uppercase tracking-wide text-surface-500">
                      <tr>
                        <th class="px-3 py-2 text-left">{t('roles.targetType')}</th>
                        <th class="px-3 py-2 text-left">{t('roles.targetId')}</th>
                        <th class="px-3 py-2 text-left">{t('roles.organizationOptional')}</th>
                        <th class="px-3 py-2 text-left">{t('Created')}</th>
                        <th class="px-3 py-2 text-right">{t('roles.assignmentAction')}</th>
                      </tr>
                    </thead>
                    <tbody>
                      {#each assignments as assignment (assignmentKey(assignment))}
                        {@const target = assignmentTarget(assignment)}
                        {@const assignmentId = assignmentIdOf(assignment)}
                        <tr class="border-t border-surface-100">
                          <td class="px-3 py-2 text-surface-700">{target.type}</td>
                          <td class="px-3 py-2"><code class="rounded bg-surface-100 px-1.5 py-0.5 text-xs text-surface-600">{target.id}</code></td>
                          <td class="px-3 py-2 text-surface-500">{assignmentOrganization(assignment)}</td>
                          <td class="px-3 py-2 text-xs text-surface-500">{assignmentCreatedAt(assignment)}</td>
                          <td class="px-3 py-2 text-right">
                            <button onclick={() => revokeAssignmentById(selectedRole, assignmentId)} disabled={saving || !assignmentId} class="rounded-lg border border-red-200 px-2.5 py-1 text-xs font-semibold text-red-600 hover:bg-red-50 disabled:cursor-not-allowed disabled:opacity-40">{t('Revoke')}</button>
                          </td>
                        </tr>
                      {/each}
                    </tbody>
                  </table>
                </div>
              {/if}
            </div>

            <div class="rounded-2xl border border-surface-200 bg-white p-5 shadow-sm">
              <h4 class="text-lg font-semibold text-surface-950">{t('roles.revokeAssignment')}</h4>
              <p class="mt-1 text-sm text-surface-500">{t('roles.revokeAssignmentHint')}</p>
              <div class="mt-4 space-y-3">
                <div>
                  <label for="assignment-id" class="mb-1 block text-sm font-medium text-surface-700">{t('roles.assignmentId')}</label>
                  <input id="assignment-id" bind:value={assignmentForm.assignmentId} class="w-full rounded-xl border border-surface-300 px-3 py-2 text-sm" placeholder="role assignment id">
                </div>
                <button onclick={() => handleRevokeAssignment(selectedRole)} disabled={!assignmentForm.assignmentId.trim() || saving} class="w-full rounded-xl border border-red-200 px-4 py-2 text-sm font-semibold text-red-600 hover:bg-red-50 disabled:cursor-not-allowed disabled:opacity-40">{t('roles.revokeAssignment')}</button>
              </div>
            </div>
          </div>

          <div class="rounded-2xl border border-surface-200 bg-white p-5 shadow-sm">
            <h4 class="text-lg font-semibold text-surface-950">{t('roles.customPermission')}</h4>
            <p class="mt-1 text-sm text-surface-500">{t('roles.customHint')}</p>
            <div class="mt-4 grid gap-3 md:grid-cols-[1fr_2fr_auto] md:items-end">
              <div>
                <label for="custom-permission-name" class="mb-1 block text-sm font-medium text-surface-700">{t('roles.permissionName')}</label>
                <input id="custom-permission-name" bind:value={customPermission.name} class="w-full rounded-xl border border-surface-300 px-3 py-2 text-sm" placeholder="billing.read">
              </div>
              <div>
                <label for="custom-permission-description" class="mb-1 block text-sm font-medium text-surface-700">{t('roles.permissionDescription')}</label>
                <input id="custom-permission-description" bind:value={customPermission.description} class="w-full rounded-xl border border-surface-300 px-3 py-2 text-sm" placeholder={t('roles.permissionDescription')}>
              </div>
              <button onclick={() => handleAddCustomPermission(selectedRole)} disabled={!customPermission.name.trim()} class="rounded-xl bg-brand-600 px-4 py-2 text-sm font-semibold text-white hover:bg-brand-700 disabled:cursor-not-allowed disabled:opacity-40">{t('Add')}</button>
            </div>

            {#if customPermissions(selectedRole).length > 0}
              <div class="mt-4 flex flex-wrap gap-2">
                {#each customPermissions(selectedRole) as permission (permission.id)}
                  <span class="inline-flex items-center gap-2 rounded-full bg-surface-100 px-3 py-1 text-sm text-surface-700" title={permissionDescription(permission, t) || permission.name}>
                    {permissionLabel(permission, t)}
                    <code class="rounded bg-white px-1 text-[11px] text-surface-400">{permission.name}</code>
                    <button onclick={() => handleDeletePermission(selectedRole, permission)} class="text-surface-400 hover:text-red-500" aria-label={t('Delete')}>×</button>
                  </span>
                {/each}
              </div>
            {/if}
          </div>
        </section>
      {/if}
    </div>
  {/if}
</div>
