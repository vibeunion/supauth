import { settleWritesThenReadBack } from "./mutation-reconciliation.js";

const READ_BACK_MISMATCH_CODE = "authoritative_readback_mismatch";

function isRecord(candidate) {
  return (
    candidate !== null &&
    typeof candidate === "object" &&
    !Array.isArray(candidate)
  );
}

export class AuthoritativeSettingsReadBackError extends Error {
  constructor(fields) {
    super(`Authoritative settings read-back did not match: ${fields.join(", ")}`);
    this.name = "AuthoritativeSettingsReadBackError";
    this.code = READ_BACK_MISMATCH_CODE;
    this.fields = Object.freeze([...fields]);
  }
}

function unsupportedDraft(path) {
  throw new TypeError(`Settings draft contains an unsupported value at ${path}`);
}

function frozenDraftArray(entries, path) {
  return Object.freeze(
    entries.map((entry, index) => frozenDraftValue(entry, `${path}[${index}]`)),
  );
}

function frozenDraftRecord(record, path) {
  return Object.freeze(
    Object.fromEntries(
      Object.entries(record).map(([key, entry]) => [
        key,
        frozenDraftValue(entry, `${path}.${key}`),
      ]),
    ),
  );
}

function frozenDraftValue(candidate, path) {
  if (Array.isArray(candidate)) return frozenDraftArray(candidate, path);
  if (isRecord(candidate)) return frozenDraftRecord(candidate, path);
  if (
    candidate === null ||
    typeof candidate === "string" ||
    typeof candidate === "boolean" ||
    (typeof candidate === "number" && Number.isFinite(candidate))
  ) {
    return candidate;
  }
  return unsupportedDraft(path);
}

export function freezeSettingsDraft(draft) {
  return frozenDraftValue(draft, "draft");
}

function collectArrayMismatch(expected, observed, path, fields) {
  const entryMismatches = [];
  if (Array.isArray(observed) && expected.length === observed.length) {
    expected.forEach((entry, index) =>
      collectMismatchFields(entry, observed[index], path, entryMismatches),
    );
  } else {
    entryMismatches.push(path);
  }
  if (entryMismatches.length > 0) fields.push(path || "$root");
}

function collectRecordMismatch(expected, observed, path, fields) {
  if (!isRecord(observed)) {
    fields.push(path || "$root");
    return;
  }
  for (const [key, expectedEntry] of Object.entries(expected)) {
    const entryPath = path ? `${path}.${key}` : key;
    if (!Object.hasOwn(observed, key)) fields.push(entryPath);
    else collectMismatchFields(expectedEntry, observed[key], entryPath, fields);
  }
}

function collectMismatchFields(expected, observed, path, fields) {
  if (Array.isArray(expected)) {
    collectArrayMismatch(expected, observed, path, fields);
    return;
  }
  if (isRecord(expected)) {
    collectRecordMismatch(expected, observed, path, fields);
    return;
  }
  if (!Object.is(expected, observed)) fields.push(path || "$root");
}

export function assertAuthoritativeSettingsReadBack(expected, observed) {
  const fields = [];
  collectMismatchFields(expected, observed, "", fields);
  if (fields.length > 0) {
    throw new AuthoritativeSettingsReadBackError([...new Set(fields)]);
  }
}

function stringArray(stringEntries, fieldPath) {
  if (
    !Array.isArray(stringEntries) ||
    stringEntries.some((entry) => typeof entry !== "string")
  ) {
    throw new AuthoritativeSettingsReadBackError([fieldPath]);
  }
  return stringEntries;
}

export function canonicalOrderedStrings(stringEntries, fieldPath) {
  return stringArray(stringEntries, fieldPath)
    .map((entry) => entry.trim())
    .filter(Boolean);
}

export function canonicalStringSet(stringEntries, fieldPath) {
  return [...new Set(stringArray(stringEntries, fieldPath))].sort();
}

export function canonicalTrimmedStringSet(stringEntries, fieldPath) {
  return canonicalStringSet(
    canonicalOrderedStrings(stringEntries, fieldPath),
    fieldPath,
  );
}

function field(record, fieldName) {
  return isRecord(record) ? record[fieldName] : undefined;
}

function blankStringAsNull(candidate) {
  return typeof candidate === "string" && candidate.trim() === ""
    ? null
    : candidate;
}

function trimmedString(candidate) {
  return typeof candidate === "string" ? candidate.trim() : candidate;
}

function compatibleField(record, fieldNames, mismatchPath) {
  if (!isRecord(record)) return undefined;
  const presentFields = fieldNames.filter((fieldName) =>
    Object.hasOwn(record, fieldName),
  );
  if (presentFields.length === 0) return undefined;
  const authoritativeValue = record[presentFields[0]];
  if (
    presentFields.some(
      (fieldName) => !Object.is(record[fieldName], authoritativeValue),
    )
  ) {
    throw new AuthoritativeSettingsReadBackError([mismatchPath]);
  }
  return authoritativeValue;
}

function accountCenterProfileAuthority(configValue) {
  const profile = field(configValue, "profile");
  return {
    edit_mode: field(profile, "edit_mode"),
    fields: canonicalOrderedStrings(
      field(profile, "fields"),
      "account_center.profile.fields",
    ),
  };
}

function accountCenterSecurityAuthority(configValue) {
  const security = field(configValue, "security");
  return {
    password_change: field(security, "password_change"),
    mfa: field(security, "mfa"),
    email_change: field(security, "email_change"),
    phone_change: field(security, "phone_change"),
  };
}

function accountCenterDeletionAuthority(configValue) {
  const deleteAccount = field(configValue, "delete_account");
  return {
    delete_account: {
      enabled: field(deleteAccount, "enabled"),
      url: blankStringAsNull(field(deleteAccount, "url")),
    },
    delete_account_url: blankStringAsNull(
      field(configValue, "delete_account_url"),
    ),
  };
}

export function accountCenterSettingsAuthority(config) {
  const configValue = field(config, "value");
  return {
    enabled: field(config, "enabled"),
    profile: accountCenterProfileAuthority(configValue),
    security: accountCenterSecurityAuthority(configValue),
    grants: { enabled: field(field(configValue, "grants"), "enabled") },
    identities: { enabled: field(field(configValue, "identities"), "enabled") },
    ...accountCenterDeletionAuthority(configValue),
  };
}

export function signInMethodsSettingsAuthority(snapshot) {
  const experience = field(snapshot, "signInExperience");
  const authConfig = field(snapshot, "authConfig");
  return {
    sign_in_experience: {
      sign_in_methods: canonicalStringSet(
        field(experience, "sign_in_methods"),
        "sign_in_experience.sign_in_methods",
      ),
      sign_up_enabled: field(experience, "sign_up_enabled"),
    },
    gotrue: {
      enable_signup: field(authConfig, "enable_signup"),
      disable_signup: field(authConfig, "disable_signup"),
    },
  };
}

export function passwordPolicySettingsAuthority(snapshot) {
  const authConfig = field(snapshot, "authConfig");
  return {
    password_min_length: field(authConfig, "password_min_length"),
    password_required_characters: field(
      authConfig,
      "password_required_characters",
    ),
  };
}

export function captchaSettingsAuthority(captchaConfig) {
  const captchaValue = field(captchaConfig, "value");
  return {
    enabled: field(captchaConfig, "enabled"),
    provider: field(captchaValue, "provider"),
    secret_configured: field(captchaValue, "secret_configured"),
  };
}

function blocklistStringSet(authHookValue, fieldName) {
  return canonicalTrimmedStringSet(
    field(authHookValue, fieldName),
    `blocklist.${fieldName}`,
  );
}

export function blocklistSettingsAuthority(authHookConfig) {
  const authHookValue = field(authHookConfig, "value");
  return {
    allowed_email_domains: blocklistStringSet(
      authHookValue,
      "allowed_email_domains",
    ),
    blocked_email_domains: blocklistStringSet(
      authHookValue,
      "blocked_email_domains",
    ),
    blocked_oauth_providers: blocklistStringSet(
      authHookValue,
      "blocked_oauth_providers",
    ),
    allowed_oauth_providers: blocklistStringSet(
      authHookValue,
      "allowed_oauth_providers",
    ),
    invite_only: field(authHookValue, "invite_only"),
  };
}

function generalAuthAuthority(authConfig) {
  return {
    jwt_expiry: field(authConfig, "jwt_expiry"),
    enable_confirmations: field(authConfig, "enable_confirmations"),
    external_anonymous_users_enabled: field(
      authConfig,
      "external_anonymous_users_enabled",
    ),
  };
}

function generalRuntimeSecurityAuthority(securityConfig) {
  return {
    brute_force_protection: compatibleField(
      securityConfig,
      ["brute_force_protection", "bruteForceProtection"],
      "security.brute_force_protection",
    ),
    max_login_attempts: compatibleField(
      securityConfig,
      ["max_login_attempts", "maxLoginAttempts"],
      "security.max_login_attempts",
    ),
  };
}

export function generalSecuritySettingsAuthority(snapshot) {
  const authConfig = field(snapshot, "authConfig");
  const securityConfig = field(snapshot, "securityConfig");
  return {
    ...generalAuthAuthority(authConfig),
    ...generalRuntimeSecurityAuthority(securityConfig),
  };
}

function organizationRecord(response) {
  if (isRecord(response) && Object.hasOwn(response, "organization")) {
    return response.organization;
  }
  return response;
}

function organizationIdentityAuthority(settings) {
  const organization = organizationRecord(field(settings, "organizationResponse"));
  return {
    resource_id: field(organization, "id"),
    organization: {
      name: trimmedString(field(organization, "name")),
      description: trimmedString(field(organization, "description")),
    },
  };
}

function organizationJitAuthority(settings) {
  const jitResponse = field(settings, "jitResponse");
  return {
    enabled: field(jitResponse, "enabled"),
    domains: canonicalTrimmedStringSet(
      field(jitResponse, "domains"),
      "organization.jit.domains",
    ),
  };
}

export function organizationSettingsAuthority(settings) {
  const jitEnabled = field(settings, "jitEnabled");
  const authority = {
    ...organizationIdentityAuthority(settings),
    jit_capability: jitEnabled,
  };
  if (jitEnabled === true) authority.jit = organizationJitAuthority(settings);
  return authority;
}

export async function settleAuthoritativeSettingsMutation({
  draft,
  writeCommands,
  readSnapshot,
  authorityFromSnapshot,
}) {
  const frozenDraft = freezeSettingsDraft(draft);
  return settleWritesThenReadBack(
    writeCommands(frozenDraft.command),
    async () => {
      const snapshot = await readSnapshot();
      assertAuthoritativeSettingsReadBack(
        frozenDraft.authority,
        authorityFromSnapshot(snapshot),
      );
      return snapshot;
    },
  );
}
