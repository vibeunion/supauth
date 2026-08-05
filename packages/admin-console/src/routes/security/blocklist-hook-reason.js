const BLOCKLIST_HOOK_REASON_KEYS = Object.freeze({
  gotrue_before_user_created_hook_authority_project_unavailable:
    "security.blocklistReasonAuthorityUnavailable",
  gotrue_before_user_created_hook_process_unavailable:
    "security.blocklistReasonProcessUnavailable",
  gotrue_before_user_created_hook_not_enabled:
    "security.blocklistReasonNotEnabled",
  gotrue_hook_not_enabled: "security.blocklistReasonNotEnabled",
  gotrue_before_user_created_hook_uri_missing:
    "security.blocklistReasonUriMissing",
  gotrue_before_user_created_hook_target_mismatch:
    "security.blocklistReasonTargetMismatch",
  gotrue_before_user_created_hook_secret_missing:
    "security.blocklistReasonSecretMissing",
  gotrue_before_user_created_hook_secret_invalid:
    "security.blocklistReasonSecretInvalid",
  gotrue_before_user_created_hook_probe_unreachable:
    "security.blocklistReasonProbeUnreachable",
  gotrue_before_user_created_hook_probe_rejected:
    "security.blocklistReasonProbeRejected",
  gotrue_before_user_created_hook_probe_response_invalid:
    "security.blocklistReasonProbeResponseInvalid",
});

export function blocklistHookReasonKey(reasonCode) {
  if (
    typeof reasonCode === "string" &&
    Object.hasOwn(BLOCKLIST_HOOK_REASON_KEYS, reasonCode)
  ) {
    return BLOCKLIST_HOOK_REASON_KEYS[reasonCode];
  }
  return "security.blocklistReasonUnavailable";
}
