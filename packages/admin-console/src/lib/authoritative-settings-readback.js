// @ts-check
import { settleWritesThenReadBack } from "./mutation-reconciliation.js";

/**
 * @typedef {ReadonlyArray<FrozenSettingsValue>} FrozenSettingsArray
 * @typedef {{readonly [key: string]: FrozenSettingsValue}} FrozenSettingsRecord
 * @typedef {null | string | boolean | number | FrozenSettingsArray | FrozenSettingsRecord} FrozenSettingsValue
 */
/**
 * @template T
 * @typedef {T extends object ? {readonly [Key in keyof T]: DeepReadonly<T[Key]>} : T} DeepReadonly
 */
/**
 * @template T
 * @typedef {T extends null | string | boolean | number ? T : T extends (...args: never[]) => unknown ? never : T extends object ? {[Key in keyof T]: SettingsDraftInput<T[Key]>} : never} SettingsDraftInput
 */
/**
 * @template T
 * @template {string} Key
 * @typedef {unknown extends T ? unknown : T extends readonly unknown[] | ((...args: never[]) => unknown) ? undefined : T extends object ? Key extends keyof T ? string extends keyof T ? T[Key] | undefined : T[Key] : undefined : undefined} SettingsField
 */
/**
 * @template T
 * @template {string} Key
 * @typedef {unknown extends T ? unknown : T extends readonly unknown[] | ((...args: never[]) => unknown) ? undefined : T extends object ? Extract<Key, keyof T> extends never ? undefined : string extends keyof T ? T[Extract<Key, keyof T>] | undefined : T[Extract<Key, keyof T>] : undefined} CompatibleSettingsField
 */
/**
 * @template T
 * @typedef {unknown extends T ? unknown : T extends readonly unknown[] | ((...args: never[]) => unknown) ? T : T extends {organization: infer Organization} ? Organization : T extends {organization?: infer Organization} ? T | Organization : T} OrganizationRecord
 */
/**
 * @template T
 * @typedef {T extends string ? string | null : T} BlankStringAsNull
 */
/**
 * @template T
 * @typedef {T extends string ? string : T} TrimmedString
 */
/**
 * @template Command, Authority
 * @typedef {{command: Command & SettingsDraftInput<Command>, authority: Authority & SettingsDraftInput<Authority>}} SettingsMutationDraft
 */
/**
 * @template Command, Authority, Snapshot
 * @typedef {{draft: SettingsMutationDraft<Command, Authority>, writeCommands: (command: DeepReadonly<Command>) => readonly import("./mutation-reconciliation.js").WriteCommand[], readSnapshot: () => Snapshot | PromiseLike<Snapshot>, authorityFromSnapshot: (snapshot: Snapshot) => unknown}} SettingsMutationOptions
 */

const READ_BACK_MISMATCH_CODE = "authoritative_readback_mismatch";

/** @param {unknown} candidate @returns {candidate is Record<string, unknown>} */
function isRecord(candidate) {
  return (
    candidate !== null &&
    typeof candidate === "object" &&
    !Array.isArray(candidate)
  );
}

export class AuthoritativeSettingsReadBackError extends Error {
  /** @param {readonly string[]} fields */
  constructor(fields) {
    super(`Authoritative settings read-back did not match: ${fields.join(", ")}`);
    this.name = "AuthoritativeSettingsReadBackError";
    this.code = READ_BACK_MISMATCH_CODE;
    this.fields = Object.freeze([...fields]);
  }
}

/** @param {string} path @returns {never} */
function unsupportedDraft(path) {
  throw new TypeError(`Settings draft contains an unsupported value at ${path}`);
}

/** @param {readonly unknown[]} entries @param {string} path @param {WeakSet<object>} ancestors @returns {readonly FrozenSettingsValue[]} */
function frozenDraftArray(entries, path, ancestors) {
  if (Object.getPrototypeOf(entries) !== Array.prototype) unsupportedDraft(path);
  /** @type {FrozenSettingsValue[]} */
  const frozen = [];
  for (let index = 0; index < entries.length; index += 1) {
    const entryPath = `${path}[${index}]`;
    const descriptor = Object.getOwnPropertyDescriptor(entries, index);
    if (!descriptor || !descriptor.enumerable || !Object.hasOwn(descriptor, "value")) {
      unsupportedDraft(entryPath);
    }
    /** @type {unknown} */
    const entry = descriptor.value;
    frozen.push(frozenDraftValue(entry, entryPath, ancestors));
  }
  if (Reflect.ownKeys(entries).length !== entries.length + 1) unsupportedDraft(path);
  return Object.freeze(frozen);
}

/** @param {object} record @param {string} path @param {WeakSet<object>} ancestors @returns {{readonly [key: string]: FrozenSettingsValue}} */
function frozenDraftRecord(record, path, ancestors) {
  /** @type {unknown} */
  const prototype = Object.getPrototypeOf(record);
  if (prototype !== Object.prototype && prototype !== null) unsupportedDraft(path);
  /** @type {[string, FrozenSettingsValue][]} */
  const frozen = [];
  for (const key of Reflect.ownKeys(record)) {
    if (typeof key !== "string") unsupportedDraft(path);
    const entryPath = `${path}.${key}`;
    const descriptor = Object.getOwnPropertyDescriptor(record, key);
    // 只接收自有、可枚举的数据字段，不能静默丢掉类型承诺的属性或执行 getter。
    if (!descriptor || !descriptor.enumerable || !Object.hasOwn(descriptor, "value")) {
      unsupportedDraft(entryPath);
    }
    /** @type {unknown} */
    const entry = descriptor.value;
    frozen.push([key, frozenDraftValue(entry, entryPath, ancestors)]);
  }
  return Object.freeze(Object.fromEntries(frozen));
}

/** @param {unknown} candidate @param {string} path @param {WeakSet<object>} ancestors @returns {FrozenSettingsValue} */
function frozenDraftValue(candidate, path, ancestors) {
  if (candidate !== null && typeof candidate === "object") {
    if (ancestors.has(candidate)) unsupportedDraft(path);
    ancestors.add(candidate);
    try {
      return Array.isArray(candidate)
        ? frozenDraftArray(candidate, path, ancestors)
        : frozenDraftRecord(candidate, path, ancestors);
    } finally {
      ancestors.delete(candidate);
    }
  }
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

/** @template Command, Authority @overload @param {SettingsMutationDraft<Command, Authority>} draft @returns {DeepReadonly<{command: Command, authority: Authority}>} */
/** @template T @overload @param {T & SettingsDraftInput<T>} draft @returns {DeepReadonly<T>} */
/** @overload @param {unknown} draft @returns {FrozenSettingsValue} */
/** @param {unknown} draft @returns {FrozenSettingsValue} */
export function freezeSettingsDraft(draft) {
  return frozenDraftValue(draft, "draft", new WeakSet());
}

/** @param {readonly unknown[]} expected @param {unknown} observed @param {string} path @param {string[]} fields */
function collectArrayMismatch(expected, observed, path, fields) {
  /** @type {string[]} */
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

/** @param {Record<string, unknown>} expected @param {unknown} observed @param {string} path @param {string[]} fields */
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

/** @param {unknown} expected @param {unknown} observed @param {string} path @param {string[]} fields */
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

/** @param {unknown} expected @param {unknown} observed */
export function assertAuthoritativeSettingsReadBack(expected, observed) {
  /** @type {string[]} */
  const fields = [];
  collectMismatchFields(expected, observed, "", fields);
  if (fields.length > 0) {
    throw new AuthoritativeSettingsReadBackError([...new Set(fields)]);
  }
}

/** @param {unknown} value @returns {value is unknown[]} */
function unknownArray(value) {
  return Array.isArray(value);
}

/** @param {unknown} stringEntries @param {string} fieldPath @returns {string[]} */
function stringArray(stringEntries, fieldPath) {
  if (!unknownArray(stringEntries)) {
    throw new AuthoritativeSettingsReadBackError([fieldPath]);
  }
  /** @type {string[]} */
  const strings = [];
  for (let index = 0; index < stringEntries.length; index += 1) {
    const descriptor = Object.getOwnPropertyDescriptor(stringEntries, index);
    /** @type {unknown} */
    const entry = descriptor && Object.hasOwn(descriptor, "value")
      ? descriptor.value
      : undefined;
    if (typeof entry !== "string") {
      throw new AuthoritativeSettingsReadBackError([fieldPath]);
    }
    strings.push(entry);
  }
  return strings;
}

/** @param {unknown} stringEntries @param {string} fieldPath @returns {string[]} */
export function canonicalOrderedStrings(stringEntries, fieldPath) {
  return stringArray(stringEntries, fieldPath)
    .map((entry) => entry.trim())
    .filter(Boolean);
}

/** @param {unknown} stringEntries @param {string} fieldPath @returns {string[]} */
export function canonicalStringSet(stringEntries, fieldPath) {
  return [...new Set(stringArray(stringEntries, fieldPath))].sort();
}

/** @param {unknown} stringEntries @param {string} fieldPath @returns {string[]} */
export function canonicalTrimmedStringSet(stringEntries, fieldPath) {
  return canonicalStringSet(
    canonicalOrderedStrings(stringEntries, fieldPath),
    fieldPath,
  );
}

/** @template T @template {string} Key @overload @param {T} record @param {Key} fieldName @returns {SettingsField<T, Key>} */
/** @param {unknown} record @param {string} fieldName @returns {unknown} */
function field(record, fieldName) {
  return isRecord(record) ? record[fieldName] : undefined;
}

/** @template T @overload @param {T} candidate @returns {BlankStringAsNull<T>} */
/** @param {unknown} candidate @returns {unknown} */
function blankStringAsNull(candidate) {
  return typeof candidate === "string" && candidate.trim() === ""
    ? null
    : candidate;
}

/** @template T @overload @param {T} candidate @returns {TrimmedString<T>} */
/** @param {unknown} candidate @returns {unknown} */
function trimmedString(candidate) {
  return typeof candidate === "string" ? candidate.trim() : candidate;
}

/** @param {unknown} candidate @param {string} fieldPath @returns {string | null} */
function nullableTrimmedString(candidate, fieldPath) {
  if (candidate !== null && typeof candidate !== "string") {
    throw new AuthoritativeSettingsReadBackError([fieldPath]);
  }
  return blankStringAsNull(trimmedString(candidate));
}

/** @template T @template {string} Key @overload @param {T} record @param {readonly Key[]} fieldNames @param {string} mismatchPath @returns {CompatibleSettingsField<T, Key>} */
/** @param {unknown} record @param {readonly string[]} fieldNames @param {string} mismatchPath @returns {unknown} */
function compatibleField(record, fieldNames, mismatchPath) {
  if (!isRecord(record)) return undefined;
  const presentFields = fieldNames.filter((fieldName) =>
    Object.hasOwn(record, fieldName),
  );
  const firstField = presentFields[0];
  if (firstField === undefined) return undefined;
  const authoritativeValue = record[firstField];
  if (
    presentFields.some(
      (fieldName) => !Object.is(record[fieldName], authoritativeValue),
    )
  ) {
    throw new AuthoritativeSettingsReadBackError([mismatchPath]);
  }
  return authoritativeValue;
}

/** @template Config @param {Config} configValue */
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

/** @template Config @param {Config} configValue */
function accountCenterSecurityAuthority(configValue) {
  const security = field(configValue, "security");
  return {
    password_change: field(security, "password_change"),
    mfa: field(security, "mfa"),
    email_change: field(security, "email_change"),
    phone_change: field(security, "phone_change"),
  };
}

/** @template Config @param {Config} configValue */
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

/** @template Config @param {Config} config */
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

/** @template Snapshot @param {Snapshot} snapshot */
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

/** @param {unknown} signInExperience */
export function brandingSettingsAuthority(signInExperience) {
  const branding = field(signInExperience, "branding");
  return {
    branding: {
      page_title: nullableTrimmedString(
        field(branding, "page_title"),
        "branding.page_title",
      ),
      primary_color: nullableTrimmedString(
        field(branding, "primary_color"),
        "branding.primary_color",
      ),
      background_url: nullableTrimmedString(
        field(branding, "background_url"),
        "branding.background_url",
      ),
    },
  };
}

/** @template Snapshot @param {Snapshot} snapshot */
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

/** @template Config @param {Config} captchaConfig */
export function captchaSettingsAuthority(captchaConfig) {
  const captchaValue = field(captchaConfig, "value");
  return {
    enabled: field(captchaConfig, "enabled"),
    provider: field(captchaValue, "provider"),
    secret_configured: field(captchaValue, "secret_configured"),
  };
}

/** @param {unknown} authHookValue @param {string} fieldName */
function blocklistStringSet(authHookValue, fieldName) {
  return canonicalTrimmedStringSet(
    field(authHookValue, fieldName),
    `blocklist.${fieldName}`,
  );
}

/** @template Config @param {Config} authHookConfig */
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

/** @template Config @param {Config} authConfig */
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

/** @template Config @param {Config} securityConfig */
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
    lockout_duration_sec: compatibleField(
      securityConfig,
      ["lockout_duration_sec", "lockoutDurationSec"],
      "security.lockout_duration_sec",
    ),
  };
}

/** @template Snapshot @param {Snapshot} snapshot */
export function generalSecuritySettingsAuthority(snapshot) {
  const authConfig = field(snapshot, "authConfig");
  const securityConfig = field(snapshot, "securityConfig");
  return {
    ...generalAuthAuthority(authConfig),
    ...generalRuntimeSecurityAuthority(securityConfig),
  };
}

/** @template Response @overload @param {Response} response @returns {OrganizationRecord<Response>} */
/** @param {unknown} response @returns {unknown} */
function organizationRecord(response) {
  if (isRecord(response) && Object.hasOwn(response, "organization")) {
    return field(response, "organization");
  }
  return response;
}

/** @template Settings @param {Settings} settings */
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

/** @template Settings @param {Settings} settings */
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

/** @template Settings @param {Settings} settings */
export function organizationSettingsAuthority(settings) {
  const jitEnabled = field(settings, "jitEnabled");
  const authority = {
    ...organizationIdentityAuthority(settings),
    jit_capability: jitEnabled,
  };
  if (jitEnabled === true) {
    return { ...authority, jit_capability: true, jit: organizationJitAuthority(settings) };
  }
  return authority;
}

/**
 * @template Command, Authority, Snapshot
 * @param {SettingsMutationOptions<Command, Authority, Snapshot>} options
 * @returns {Promise<import("./mutation-reconciliation.js").MutationReconciliation<Snapshot>>}
 */
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
