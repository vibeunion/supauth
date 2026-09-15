import { decodeSchema, Type } from '../../../shared/src/schema.js';
import { operationEndpoints, type OperationEndpointName, type OperationInput, type OperationResult } from '../../../shared/src/server-operations.js';
import { commonServerErrors, type ServerResponseContract, type ServerRouteContract } from '../../../shared/src/server-contracts.js';
import { ApiContractError } from './api-contract.js';
import { serverContract, type ServerContractContext } from './server-contract.js';

const empty: ServerResponseContract = { kind: 'empty' };

export function operationInput<K extends OperationEndpointName>(name: K, input: unknown): OperationInput<K> {
  try {
    return decodeSchema(operationEndpoints[name].input, input);
  } catch {
    throw new ApiContractError(400, 'invalid_request_body', 'Request does not match the declared contract');
  }
}

export function operationOutput<K extends OperationEndpointName>(name: K, output: unknown): OperationResult<K> {
  try {
    const wireValue: unknown = output === undefined ? undefined : JSON.parse(JSON.stringify(output));
    return decodeSchema(operationEndpoints[name].result, wireValue);
  } catch {
    throw new ApiContractError(502, 'invalid_upstream_response', 'Response does not match the declared contract');
  }
}

export function operationContract(
  name: OperationEndpointName,
  options: { detail: Record<string, unknown> },
  beforeValidate?: (context: ServerContractContext) => unknown | Promise<unknown>,
) {
  const endpoint = operationEndpoints[name];
  const response: ServerResponseContract = endpoint.responseKind === 'void' ? empty
    : endpoint.responseKind === 'blob'
      ? { kind: 'binary', contentTypes: ['text/csv', 'application/x-ndjson', 'application/json', 'application/octet-stream'] }
      : { kind: 'validated', schema: endpoint.result, contentTypes: ['application/json'] };
  const accepted = name === 'testWebhook' || name === 'replayWebhookDelivery';
  const responses: Record<number, ServerResponseContract> = {
    ...commonServerErrors,
    [accepted ? 202 : 200]: response,
    ...(endpoint.responseKind === 'void' ? { 204: empty } : {}),
  };
  if (name === 'createWebhook' || name === 'updateWebhook') {
    const badRequest = commonServerErrors[400];
    if (!badRequest) throw new Error('Missing common bad request contract');
    responses[400] = {
      kind: 'protocol',
      alternatives: [
        badRequest,
        { kind: 'protocol', schema: Type.String({ pattern: '^(events must be an array|Invalid event types:)' }), contentTypes: ['text/plain'] },
      ],
    };
  }
  return serverContract(`operations:${name}`, {
    ...options,
    contract: {
      input: endpoint.input,
      request: Object.keys(endpoint.input.properties).length ? 'validated' : 'none',
      responses,
    },
    ...(beforeValidate ? { beforeValidate } : {}),
  });
}

export function retiredOperationContract(source: string) {
  const contract: ServerRouteContract = {
    input: operationEndpoints.health.input, request: 'none', responses: commonServerErrors, hidden: true, retired: true,
  };
  return serverContract(source, { contract, detail: { hide: true } });
}
