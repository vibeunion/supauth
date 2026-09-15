// @ts-check
/** @type {Readonly<Record<string, string>>} */
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

/** @param {unknown} compatibilityCheck @param {(key: string, params?: {checkId: string}) => string} translate */
export function compatibilityCheckLabel(compatibilityCheck, translate) {
  const checkId = compatibilityCheck && typeof compatibilityCheck === "object" && "check_id" in compatibilityCheck
    ? compatibilityCheck.check_id : undefined;
  const checkLabel = typeof checkId === "string" && Object.hasOwn(CHECK_LABELS, checkId)
    ? CHECK_LABELS[checkId]
    : null;
  if (!checkLabel) {
    return translate("jwt.compatibility.unknown", {
      checkId: typeof checkId === "string" && checkId ? checkId : translate("common.notAvailable"),
    });
  }
  const outcome = compatibilityCheck && typeof compatibilityCheck === "object" && "status" in compatibilityCheck && compatibilityCheck.status === "pass" ? "pass" : "attention";
  return translate(`jwt.compatibility.${checkLabel}.${outcome}`);
}
