import type { AdminEndpointResult } from "@supauth/shared";

export type AuditEntry = AdminEndpointResult<"getAuditLog">;

// 兼容既有审计记录别名，但不把未经检查的扩展字段当成 DTO。
export function auditText(value: object | null | undefined, ...keys: string[]): string {
  for (const key of keys) {
    if (!value) break;
    const field: unknown = Reflect.get(value, key);
    if (typeof field === "string" && field) return field;
  }
  return "";
}

export function auditDetails(entry: AuditEntry | null | undefined): unknown {
  if (!entry) return entry;
  return entry.details || ("metadata" in entry && entry.metadata) || entry;
}
