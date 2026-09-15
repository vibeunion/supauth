import { adminEndpoints, decodeSchema, Type, type AdminEndpointResult } from "@supauth/shared";
import { AdminApiError } from "./admin-api.js";
import { executeAuthoritativeCommand, type AuthoritativeCommandOutcome } from "./authoritative-command.js";
import {
  customUiActionAllowed,
  customUiMutationTarget,
  customUiReadBackConfirms,
  customUiStatusReady,
} from "./custom-ui-reconciliation.js";

type Status = AdminEndpointResult<"getCustomUiStatus">;
type Acknowledgement = AdminEndpointResult<"deleteCustomUiAssets">;
export type CustomUiDeleteOutcome = AuthoritativeCommandOutcome<Status, Acknowledgement, AdminApiError>;

const inputSchema = Type.Object({
  targetId: Type.String({ minLength: 1 }),
  status: adminEndpoints.getCustomUiStatus.result,
});

function decodeInput(value: unknown) {
  const input = decodeSchema(inputSchema, value);
  if (!customUiActionAllowed("delete", input.status)
    || customUiMutationTarget(input.status) !== input.targetId) {
    throw new Error("Invalid custom UI deletion target");
  }
  return { targetId: input.targetId, status: input.status };
}

function decodeAuthority(value: unknown) {
  const status = decodeSchema(adminEndpoints.getCustomUiStatus.result, value);
  if (!customUiStatusReady(status)) throw new Error("Invalid custom UI authority");
  return status;
}

export function deleteCustomUiCommand(
  value: unknown,
  transport: {
    deleteAssets(): Promise<unknown>;
    readStatus(): Promise<unknown>;
  },
): Promise<CustomUiDeleteOutcome> {
  return executeAuthoritativeCommand(value, {
    input: decodeInput,
    acknowledgement: (result) => decodeSchema(adminEndpoints.deleteCustomUiAssets.result, result),
    authority: decodeAuthority,
    matches: (original, status) => customUiReadBackConfirms("delete", original.targetId, status),
    // 此端点的授权拒绝位于写入之前；该规则不作为其他业务流程的默认策略。
    isDefinitiveWriteFailure: (error): error is AdminApiError =>
      error instanceof AdminApiError && [401, 403].includes(error.statusCode),
  }, {
    write: () => transport.deleteAssets(),
    read: () => transport.readStatus(),
  });
}
