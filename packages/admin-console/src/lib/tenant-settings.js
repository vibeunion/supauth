// @ts-check
import { decodeSchema, JsonObjectSchema, SchemaDecodeError } from "@supauth/shared";

const SECURITY_WARNING_KEYS = {
  admin_token_enabled: "tenant.warning.adminTokenEnabled",
  security_config_missing: "tenant.warning.securityConfigMissing",
};

const ADMIN_AUTH_MODE_KEYS = {
  auto: "tenant.adminAuthMode.auto",
  sso: "tenant.adminAuthMode.sso",
  token: "tenant.adminAuthMode.token",
};

const TENANT_ROLE_KEYS = {
  viewer: "tenant.role.viewer",
  developer: "tenant.role.developer",
  member: "tenant.role.member",
  admin: "tenant.role.admin",
  owner: "tenant.role.owner",
};

const INVITATION_STATUS_KEYS = {
  pending: "tenant.invitationStatus.pending",
  accepted: "tenant.invitationStatus.accepted",
  expired: "tenant.invitationStatus.expired",
  revoked: "tenant.invitationStatus.revoked",
  cancelled: "tenant.invitationStatus.cancelled",
};

/** @param {unknown} code @param {Readonly<Record<string, string>>} labelKeys @param {string} fallbackKey */
function controlledLabelKey(code, labelKeys, fallbackKey) {
  return typeof code === "string" && Object.hasOwn(labelKeys, code)
    ? labelKeys[code] ?? fallbackKey
    : fallbackKey;
}

/** @param {unknown} adminAuthMode */
export function adminAuthModeLabelKey(adminAuthMode) {
  return controlledLabelKey(
    adminAuthMode,
    ADMIN_AUTH_MODE_KEYS,
    "tenant.adminAuthMode.unknown",
  );
}

/** @param {unknown} warningCode */
export function securityWarningLabelKey(warningCode) {
  return controlledLabelKey(
    warningCode,
    SECURITY_WARNING_KEYS,
    "tenant.warning.unknown",
  );
}

/** @param {unknown} role */
export function tenantRoleLabelKey(role) {
  return controlledLabelKey(role, TENANT_ROLE_KEYS, "tenant.role.unknown");
}

/** @param {unknown} status */
export function invitationStatusLabelKey(status) {
  return controlledLabelKey(
    status,
    INVITATION_STATUS_KEYS,
    "tenant.invitationStatus.unknown",
  );
}

/** @param {unknown} configSource @returns {{valid: true, config: import("@supauth/shared").JsonObject} | {valid: false, config: null}} */
export function parseTenantConfigValue(configSource) {
  if (typeof configSource !== "string" || !configSource.trim()) {
    return { valid: false, config: null };
  }
  try {
    /** @type {unknown} */
    const parsedConfig = JSON.parse(configSource);
    if (!parsedConfig || typeof parsedConfig !== "object" || Array.isArray(parsedConfig)) {
      return { valid: false, config: null };
    }
    return { valid: true, config: decodeSchema(JsonObjectSchema, parsedConfig) };
  } catch (parseError) {
    if (parseError instanceof SyntaxError || parseError instanceof SchemaDecodeError) return { valid: false, config: null };
    throw parseError;
  }
}
