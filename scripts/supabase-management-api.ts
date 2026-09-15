import { isUnknownArray, requireDefined } from "./tooling-values.js";
import { Type, decodeSchema } from '../packages/shared/src/schema.js';
type ManagementApiRequestMethod = 'POST' | 'DELETE';
const UserSchema = Type.Object({
  id: Type.String({ minLength: 1 }),
  email: Type.Optional(Type.String()),
});
const UsersEnvelopeSchema = Type.Object({
  items: Type.Optional(Type.Array(UserSchema)),
  users: Type.Optional(Type.Array(UserSchema)),
  data: Type.Optional(Type.Array(UserSchema)),
});

export function decodeCompatibilityUsers(value: unknown) {
  const payload = decodeSchema(UsersEnvelopeSchema, value);
  if (payload.items === undefined && payload.users === undefined && payload.data === undefined) {
    throw new Error('Compatibility user response is missing a user list');
  }
  return [...(payload.items ?? []), ...(payload.users ?? []), ...(payload.data ?? [])];
}

export async function requestProjectAuthUser(
  managementApiBases: string[],
  tenantRef: string,
  adminKey: string,
  method: ManagementApiRequestMethod,
  body?: Record<string, unknown>,
  fetchImpl: typeof fetch = fetch,
): Promise<Response> {
  if (managementApiBases.length === 0) {
    throw new Error('Missing management API base candidates');
  }

  let lastResponse: Response | null = null;
  for (const managementApiBase of managementApiBases) {
    const response = await fetchImpl(`${managementApiBase}/v1/projects/${encodeURIComponent(tenantRef)}/auth/users`, {
      method,
      headers: {
        accept: 'application/json',
        'content-type': 'application/json',
        apikey: adminKey,
        authorization: `Bearer ${adminKey}`,
        'x-project-ref': tenantRef,
      },
      ...(body ? { body: JSON.stringify(body) } : {}),
    });
    lastResponse = response;
    if (response.status !== 404) return response;
  }
  return requireDefined(lastResponse);
}

export async function lookupCompatibilityUserId(
  managementApiBases: string[],
  tenantRef: string,
  adminKey: string,
  email: string,
  fetchImpl: typeof fetch = fetch,
): Promise<string | null> {
  if (managementApiBases.length === 0) {
    throw new Error('Missing management API base candidates');
  }

  for (let attempt = 0; attempt < 6; attempt += 1) {
    for (const managementApiBase of managementApiBases) {
      const response = await fetchImpl(`${managementApiBase}/v1/projects/${encodeURIComponent(tenantRef)}/auth/users?email=${encodeURIComponent(email)}&limit=1&page=1`, {
        headers: {
          accept: 'application/json',
          apikey: adminKey,
          authorization: `Bearer ${adminKey}`,
          'x-project-ref': tenantRef,
        },
      });
      if (response.status === 404) continue;
      if (!response.ok) {
        throw new Error(`Unable to look up compatibility user: status=${response.status} for ${managementApiBase}`);
      }

      const candidates = decodeCompatibilityUsers(await response.json());
      const match = candidates.find((item) => typeof item?.["id"] === 'string' && typeof item?.["email"] === 'string' && item["email"].toLowerCase() === email.toLowerCase());
      if (typeof match?.["id"] === 'string') return match["id"];
    }
    if (attempt < 5) await delay(250);
  }
  return null;
}

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
