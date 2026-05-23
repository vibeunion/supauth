// Application-Resource/Scope bindings repository

import { eq, and } from 'drizzle-orm';
import { getDb } from '../db/index.js';
import { applicationBindings, scopes } from '../db/schema.js';

/** List all bindings for an application */
export async function listApplicationBindings(applicationId: string) {
  const db = getDb();
  const bindings = await db.select().from(applicationBindings)
    .where(eq(applicationBindings.applicationId, applicationId))
    .orderBy(applicationBindings.createdAt);
  return bindings;
}

/** List all scopes available to an application (through bindings) */
export async function listApplicationScopes(applicationId: string) {
  const db = getDb();
  const bindings = await db.select({
    binding: applicationBindings,
    scope: scopes,
  }).from(applicationBindings)
    .leftJoin(scopes, eq(applicationBindings.scopeId, scopes.id))
    .where(eq(applicationBindings.applicationId, applicationId));

  return bindings.map(b => ({
    bindingId: b.binding.id,
    resourceId: b.binding.resourceId,
    scope: b.scope || null,
  }));
}

/** Bind an application to a resource (optionally with a specific scope) */
export async function createBinding(data: {
  applicationId: string;
  resourceId: string;
  scopeId?: string;
}) {
  const db = getDb();
  const [binding] = await db.insert(applicationBindings).values({
    applicationId: data.applicationId,
    resourceId: data.resourceId,
    scopeId: data.scopeId || null,
  }).returning();
  return binding;
}

/** Remove a binding */
export async function deleteBinding(bindingId: string) {
  const db = getDb();
  await db.delete(applicationBindings).where(eq(applicationBindings.id, bindingId));
}

/** Remove all bindings for an application */
export async function deleteApplicationBindings(applicationId: string) {
  const db = getDb();
  await db.delete(applicationBindings).where(eq(applicationBindings.applicationId, applicationId));
}
