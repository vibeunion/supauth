import { decodeSchema, Type, type Static } from "@supauth/shared";

const optionalBoolean = Type.Optional(Type.Boolean());
const optionalString = Type.Optional(Type.String());
const optionalNullableString = Type.Optional(Type.Union([Type.String(), Type.Null()]));
const optionalStrings = Type.Optional(Type.Array(Type.String()));
const enabledSection = Type.Object({ enabled: optionalBoolean });

const accountCenterValueSchema = Type.Object({
  enabled: optionalBoolean,
  profile: Type.Optional(Type.Object({ edit_mode: optionalString, fields: optionalStrings })),
  security: Type.Optional(Type.Object({
    password_change: optionalBoolean, mfa: optionalBoolean,
    email_change: optionalBoolean, phone_change: optionalBoolean,
  })),
  grants: Type.Optional(enabledSection),
  identities: Type.Optional(enabledSection),
  delete_account: Type.Optional(Type.Object({ enabled: optionalBoolean, url: optionalNullableString })),
  delete_account_url: optionalNullableString,
});
const captchaValueSchema = Type.Object({
  provider: optionalString, secret: optionalString, secret_configured: optionalBoolean,
});
const blocklistValueSchema = Type.Object({
  allowed_email_domains: optionalStrings, blocked_email_domains: optionalStrings,
  blocked_oauth_providers: optionalStrings, allowed_oauth_providers: optionalStrings,
  invite_only: optionalBoolean,
});

export type AccountCenterValue = Static<typeof accountCenterValueSchema>;
export type CaptchaValue = Static<typeof captchaValueSchema>;
export type BlocklistValue = Static<typeof blocklistValueSchema>;

// tenant-config 的通用 JSON 契约不等同于业务表单；先校验所管理的字段再填充默认值。
export function accountCenterValue(value: unknown): AccountCenterValue {
  return decodeSchema(accountCenterValueSchema, value ?? {});
}
export function captchaValue(value: unknown): CaptchaValue {
  return decodeSchema(captchaValueSchema, value ?? {});
}
export function blocklistValue(value: unknown): BlocklistValue {
  return decodeSchema(blocklistValueSchema, value ?? {});
}
