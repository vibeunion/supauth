import { decodeSchema, Type, type Static, type TSchema } from '../../../shared/src/schema.js';
import {
  accountEndpoints, accountRouteContract, AccountNormalizationSchemas,
  type AccountEndpointName, type AccountInput, type AccountOutput,
} from '../../../shared/src/server-account.js';
import { ApiContractError } from './api-contract.js';
import { serverContract, jsonWireValue } from './server-contract.js';

const receipts = new WeakMap<Request, Set<AccountEndpointName>>();
const AuthorizationLocationSchema = Type.Object({ location: Type.String({ minLength: 1 }) });

export function accountProtocolVerified(name: AccountEndpointName, request: Request): void {
  const verified = receipts.get(request) || new Set<AccountEndpointName>();
  verified.add(name);
  receipts.set(request, verified);
}

export function decodeAccountSchema<S extends TSchema>(schema: S, input: unknown): Static<S> {
  try {
    return decodeSchema(schema, input);
  } catch {
    throw new ApiContractError(400, 'invalid_request_body', 'Request does not match the declared account contract');
  }
}

export function readAccountInput<K extends AccountEndpointName>(name: K, request: Request, input: unknown): AccountInput<K> {
  const result = decodeAccountSchema(accountEndpoints[name].input, input);
  accountProtocolVerified(name, request);
  return result;
}

export function readAccountNormalization<K extends keyof typeof AccountNormalizationSchemas>(
  name: K, request: Request, value: unknown,
): Static<(typeof AccountNormalizationSchemas)[K]> {
  const result = decodeAccountSchema(AccountNormalizationSchemas[name], value);
  accountProtocolVerified(name === 'enrollment' ? 'enroll' : name, request);
  return result;
}

export function accountOutput<K extends AccountEndpointName>(name: K, value: unknown): AccountOutput<K> {
  try {
    return decodeSchema(accountEndpoints[name].result, jsonWireValue(value));
  } catch {
    throw new ApiContractError(502, 'invalid_upstream_response', 'Response does not match the declared account contract');
  }
}

export function accountContract<O extends { detail?: Record<string, unknown> }>(name: AccountEndpointName, options: O) {
  const contract = accountRouteContract(name);
  const normalizationName = name === 'profile' || name === 'password' || name === 'claim' ? name
    : name === 'enroll' ? 'enrollment' : undefined;
  const assertVerified = ({ request }: { request: Request }) => {
    if (!receipts.get(request)?.has(name)) {
      throw new ApiContractError(502, 'unvalidated_account_request', 'Account request verification did not complete');
    }
  };
  const { beforeHandle: _beforeHandle, afterHandle, ...hooks } = serverContract(`server-account:${name}`, {
    ...options, contract,
    ...(contract.request === 'raw-signed' || contract.request === 'protocol' ? { beforeValidate: assertVerified } : {}),
  });
  return {
    ...hooks,
    detail: {
      ...hooks.detail,
      ...(normalizationName ? {
        'x-supauth-normalized-input': AccountNormalizationSchemas[normalizationName],
        'x-supauth-normalizer': `routes:${name}:existing-validation`,
      } : {}),
    },
    afterHandle: async (context: { request: Request; responseValue: unknown; set: { status?: number | string | undefined; headers?: unknown } }) => {
      const status = context.responseValue instanceof Response ? context.responseValue.status : Number(context.set.status || 200);
      if (status >= 200 && status < 400 && contract.request !== 'none') assertVerified(context);
      if (name === 'authorize' && status === 302) {
        const headers = context.responseValue instanceof Response ? context.responseValue.headers : context.set.headers;
        try {
          decodeSchema(AuthorizationLocationSchema, headers instanceof Headers ? Object.fromEntries(headers) : headers);
        } catch {
          throw new ApiContractError(502, 'invalid_upstream_response', 'Missing authorization redirect');
        }
      }
      await afterHandle(context);
    },
  };
}
