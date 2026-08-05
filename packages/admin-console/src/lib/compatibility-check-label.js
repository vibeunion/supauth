const CHECK_LABELS = {
  "sc-1-discovery": "discovery",
  "sc-2-jwks": "jwks",
  "sc-3-auth-endpoints": "authEndpoints",
  "sc-4-issuer": "issuer",
  "sc-6-supacloud-reachable": "managementApi",
  "sc-7-scopes": "scopes",
  "rb-4-gotrue-jwt-role-safe": "runtimeRole",
  "rb-4-jwt-role-check": "runtimeRole",
  "rb-5-app-metadata-namespace": "metadataNamespace",
  "rb-6-schema-isolation": "schemaIsolation",
};

export function compatibilityCheckLabel(compatibilityCheck, translate) {
  const checkId = compatibilityCheck?.check_id;
  const checkLabel = typeof checkId === "string" && Object.hasOwn(CHECK_LABELS, checkId)
    ? CHECK_LABELS[checkId]
    : null;
  if (!checkLabel) {
    return translate("jwt.compatibility.unknown", {
      checkId: checkId || translate("common.notAvailable"),
    });
  }
  const outcome = compatibilityCheck.status === "pass" ? "pass" : "attention";
  return translate(`jwt.compatibility.${checkLabel}.${outcome}`);
}
