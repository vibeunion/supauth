import {
  configurationEndpoints, serverConfigurationContracts, tenantConfigurationValues,
  ConfigurationRedirectHeadersSchema,
  type ConfigurationEndpointName, type ConfigurationEndpointInput,
} from '../../../shared/src/server-configuration.js';
import { decodeSchema, type Static, type TSchema } from '../../../shared/src/schema.js';
import {
  serverContract, jsonWireValue, SERVER_CONTRACT_METADATA,
  type ServerContractMetadata,
} from './server-contract.js';
import { ApiContractError } from './api-contract.js';

export function decodeConfigurationInput<K extends ConfigurationEndpointName>(
  name: K, input: unknown,
): ConfigurationEndpointInput<K> {
  return decodeConfigurationSchema(configurationEndpoints[name].input, input);
}

export function decodeConfigurationSchema<S extends TSchema>(schema: S, input: unknown): Static<S> {
  try {
    return decodeSchema(schema, input);
  } catch {
    throw new ApiContractError(400, 'invalid_request_body', 'Request does not match the declared contract');
  }
}

export function decodeConfigurationResponse<S extends TSchema>(schema: S, value: unknown): Static<S> {
  try {
    return decodeSchema(schema, jsonWireValue(value));
  } catch {
    throw new ApiContractError(502, 'invalid_upstream_response', 'Response does not match the declared contract');
  }
}

export function decodeTenantConfiguration(type: string, value: unknown) {
  for (const [name, schema] of Object.entries(tenantConfigurationValues)) {
    if (name === type) return decodeConfigurationSchema(schema, value);
  }
  throw new ApiContractError(400, 'invalid_request_body', 'Unknown tenant configuration type');
}

export function configurationContract<O extends { detail?: Record<string, unknown> }>(
  name: ConfigurationEndpointName, options: O,
) {
  const endpoint = configurationEndpoints[name];
  const entry = serverConfigurationContracts[`${endpoint.method} ${endpoint.path}`];
  if (!entry) throw new Error(`Missing configuration contract: ${name}`);
  const { beforeHandle: _beforeHandle, ...checked } = serverContract(entry.source, {
    ...options, contract: entry.contract,
  });
  const afterResponse = async (context: {
    responseValue: unknown;
    set: { status?: number | string | undefined; headers?: unknown };
  }) => {
    const response = context.responseValue;
    const status = response instanceof Response ? response.status : Number(context.set.status || 200);
    if (name === 'authorizePublicConnector' && status === 302) {
      const headers = decodeConfigurationResponse(ConfigurationRedirectHeadersSchema,
        response instanceof Response ? Object.fromEntries(response.headers) : context.set.headers);
      const body = decodeConfigurationResponse(configurationEndpoints.authorizePublicConnector.result,
        response instanceof Response ? await response.clone().json() : response);
      if (headers.location !== body.redirect) {
        throw new ApiContractError(502, 'invalid_upstream_response', 'Response does not match the declared contract');
      }
    }
    await checked.afterHandle(context);
  };
  // 输入仍在 handler 原校验点解码；metadata 与兼容钩子共用最终响应校验。
  const metadata: ServerContractMetadata = {
    source: checked[SERVER_CONTRACT_METADATA].source,
    contract: entry.contract,
    afterResponse,
  };
  return {
    ...checked,
    [SERVER_CONTRACT_METADATA]: metadata,
    afterHandle: afterResponse,
  };
}
