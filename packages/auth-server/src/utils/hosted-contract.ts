import { decodeSchema, type Static, type TSchema } from '../../../shared/src/schema.js';
import { hostedServerContracts, type HostedServerContractName } from '../../../shared/src/server-hosted.js';
import { ApiContractError } from './api-contract.js';
import { serverContract, type ServerContractContext } from './server-contract.js';

export function hostedInput<S extends TSchema>(schema: S, value: unknown): Static<S> {
  try { return decodeSchema(schema, value); } catch {
    throw new ApiContractError(400, 'invalid_request_body', 'Request does not match the declared contract');
  }
}

export function hostedContract(name: HostedServerContractName, detail: Record<string, unknown> = {}) {
  const contract = hostedServerContracts[name];
  const raw = contract.request === 'protocol';
  const hooks = serverContract(`hosted:${name}`, {
    contract,
    detail,
    ...(raw ? {
      beforeValidate(context: ServerContractContext) {
        // 二进制请求只校验元数据；原始字节由 handler 的 Blob 边界读取一次。
        hostedInput(contract.input, {
          params: context.params,
          headers: Object.fromEntries(context.request.headers),
        });
      },
    } : {}),
  });
  return { ...hooks, ...(raw ? { parse: 'none' as const } : {}) };
}
