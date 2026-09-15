import { decodeSchema, JsonObjectSchema, Type, type Static, type TSchema } from '../../../shared/src/schema.js';
import { ProviderSchema, AuthConfigResponseSchema } from '../../../shared/src/sdk-models.js';
import { BuiltinOAuthProviderSchema } from '../../../shared/src/server-configuration.js';
import { AccountUserSchema } from '../../../shared/src/server-account.js';
import { ApiContractError } from './api-contract.js';

const ProviderReadbackSchema = Type.Composite([
  Type.Partial(ProviderSchema),
  Type.Partial(BuiltinOAuthProviderSchema),
  Type.Object({ id: ProviderSchema.properties.id }),
]);
export type ProviderReadback = Static<typeof ProviderReadbackSchema> & Record<string, unknown>;
const AuthConfigReadbackSchema = Type.Partial(AuthConfigResponseSchema);

export function decodeAuthConfigReadback(value: unknown): Static<typeof AuthConfigReadbackSchema> & Record<string, unknown> {
  return decodeUpstream(AuthConfigReadbackSchema, value);
}

export function decodeUserReadback(value: unknown): Static<typeof AccountUserSchema> & Record<string, unknown> {
  const user = decodeUpstream(AccountUserSchema, value);
  if (!user.id.trim()) {
    throw new ApiContractError(502, 'invalid_upstream_response', 'Upstream user receipt has no valid ID');
  }
  return user;
}

export function decodeProviderReadback(value: unknown, requestedId: string): ProviderReadback {
  return decodeUpstream(ProviderReadbackSchema, { ...upstreamObject(value), id: requestedId });
}

export function decodeUpstream<S extends TSchema>(schema: S, value: unknown): Static<S> {
  try {
    return decodeSchema(schema, value);
  } catch {
    throw new ApiContractError(502, 'invalid_upstream_response', 'Upstream response does not match its contract');
  }
}

export function upstreamObject(value: unknown): Record<string, unknown> {
  return decodeUpstream(JsonObjectSchema, value);
}

export async function readUpstreamObject(response: Response): Promise<Record<string, unknown> | null> {
  const text = await response.text();
  if (!text.trim()) return null;
  let value: unknown;
  try {
    value = JSON.parse(text);
  } catch {
    throw new ApiContractError(502, 'invalid_upstream_response', 'Upstream response is not valid JSON');
  }
  return upstreamObject(value);
}
