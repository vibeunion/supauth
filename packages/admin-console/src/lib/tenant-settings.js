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

function controlledLabelKey(code, labelKeys, fallbackKey) {
  return typeof code === "string" && Object.hasOwn(labelKeys, code)
    ? labelKeys[code]
    : fallbackKey;
}

export function adminAuthModeLabelKey(adminAuthMode) {
  return controlledLabelKey(
    adminAuthMode,
    ADMIN_AUTH_MODE_KEYS,
    "tenant.adminAuthMode.unknown",
  );
}

export function securityWarningLabelKey(warningCode) {
  return controlledLabelKey(
    warningCode,
    SECURITY_WARNING_KEYS,
    "tenant.warning.unknown",
  );
}

export function tenantRoleLabelKey(role) {
  return controlledLabelKey(role, TENANT_ROLE_KEYS, "tenant.role.unknown");
}

export function invitationStatusLabelKey(status) {
  return controlledLabelKey(
    status,
    INVITATION_STATUS_KEYS,
    "tenant.invitationStatus.unknown",
  );
}

export function parseTenantConfigValue(configSource) {
  if (typeof configSource !== "string" || !configSource.trim()) {
    return { valid: false, config: null };
  }
  try {
    const parsedConfig = JSON.parse(configSource);
    if (!parsedConfig || typeof parsedConfig !== "object" || Array.isArray(parsedConfig)) {
      return { valid: false, config: null };
    }
    return { valid: true, config: parsedConfig };
  } catch (parseError) {
    if (parseError instanceof SyntaxError) return { valid: false, config: null };
    throw parseError;
  }
}
