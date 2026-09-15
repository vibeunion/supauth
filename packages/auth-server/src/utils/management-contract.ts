import { serverManagementContracts, serverManagementBodySchemas, serverManagementResultSchemas, serverManagementQuerySchemas } from '../../../shared/src/server-management.js';
import { sdkEndpoints, type SdkEndpointName } from '../../../shared/src/sdk-endpoints.js';
import { decodeSchema, type Static, type TSchema } from '../../../shared/src/schema.js';
import { serverContract, jsonWireValue, type ServerContractContext } from './server-contract.js';
import { ApiContractError } from './api-contract.js';

type Endpoints = typeof sdkEndpoints;
type BodyName = {
  [K in SdkEndpointName]: Endpoints[K]['input'] extends { properties: { body: TSchema } } ? K : never;
}[SdkEndpointName];
type BodySchema<K extends BodyName> = Endpoints[K]['input'] extends { properties: { body: infer S extends TSchema } } ? S : never;

export function decodeEndpointInput<K extends SdkEndpointName>(name: K, value: unknown): Static<Endpoints[K]['input']> {
  return decodeInput(sdkEndpoints[name].input, value);
}

export function decodeEndpointBody<K extends BodyName>(name: K, value: unknown): Static<BodySchema<K>> {
  return decodeInput(sdkEndpoints[name].input.properties.body, value);
}

export function decodeManagementBody<K extends keyof typeof serverManagementBodySchemas>(
  name: K,
  value: unknown,
): Static<(typeof serverManagementBodySchemas)[K]> {
  return decodeInput(serverManagementBodySchemas[name], value);
}

function decodeInput<S extends TSchema>(schema: S, value: unknown): Static<S> {
  try {
    return decodeSchema(schema, value);
  } catch {
    throw new ApiContractError(400, 'invalid_request_body', 'Request does not match the declared contract');
  }
}

export function decodeManagementQuery<K extends keyof typeof serverManagementQuerySchemas>(
  name: K,
  value: unknown,
): Static<(typeof serverManagementQuerySchemas)[K]> {
  return decodeInput(serverManagementQuerySchemas[name], value);
}

export function decodeResponseValue<S extends TSchema>(schema: S, value: unknown): Static<S> {
  try {
    return decodeSchema(schema, jsonWireValue(value));
  } catch {
    throw new ApiContractError(502, 'invalid_upstream_response', 'Response does not match the declared contract');
  }
}

type WireSchema<K extends SdkEndpointName> = Endpoints[K] extends { wireResult: infer S extends TSchema }
  ? S : Endpoints[K]['result'];

export function decodeEndpointResponse<K extends SdkEndpointName>(name: K, value: unknown): Static<WireSchema<K>> {
  const endpoint = sdkEndpoints[name];
  return decodeResponseValue('wireResult' in endpoint ? endpoint.wireResult : endpoint.result, value);
}

export function decodeManagementResponse<K extends keyof typeof serverManagementResultSchemas>(
  name: K,
  value: unknown,
): Static<(typeof serverManagementResultSchemas)[K]> {
  return decodeResponseValue(serverManagementResultSchemas[name], value);
}

export function managementContract<O extends { detail?: Record<string, unknown> }>(
  method: string,
  path: string,
  options: O,
  beforeValidate?: (context: ServerContractContext) => unknown | Promise<unknown>,
) {
  const entry = serverManagementContracts[`${method} ${path.replace(/\/$/, '')}`];
  if (!entry) throw new Error(`Missing management route contract: ${method} ${path}`);
  if (entry.gap) throw new Error(`Unresolved management route contract: ${method} ${path}`);
  return serverContract(entry.source, {
    ...options,
    contract: entry.contract,
    ...(beforeValidate ? { beforeValidate } : {}),
  });
}
