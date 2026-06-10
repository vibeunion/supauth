// Organizations repository compatibility facade.
//
// SupaCloud owns organization source-of-truth. Keep these exports for older
// internal callers/tests, but never write legacy supaoauth organization tables.

import { getSupaCloudAdapter } from '../supacloud/adapter.js';

export async function listOrganizations() {
  return getSupaCloudAdapter().listOrganizations();
}

export async function getOrganization(id: string) {
  return getSupaCloudAdapter().getOrganization(id);
}

export async function createOrganization(data: { name: string; description?: string }) {
  return getSupaCloudAdapter().createOrganization(data);
}

export async function updateOrganization(id: string, data: { name?: string; description?: string }) {
  return getSupaCloudAdapter().updateOrganization(id, data);
}

export async function deleteOrganization(id: string) {
  return getSupaCloudAdapter().deleteOrganization(id);
}

export async function addMember(orgId: string, userId: string, role: string = 'member') {
  return getSupaCloudAdapter().addOrganizationMember(orgId, {
    userId,
    role,
  });
}

export async function removeMember(orgId: string, userId: string) {
  return getSupaCloudAdapter().removeOrganizationMember(orgId, userId);
}

export async function updateMemberRole(orgId: string, userId: string, role: string) {
  return getSupaCloudAdapter().updateOrganizationMember(orgId, userId, { role });
}
