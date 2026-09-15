import {
  Type, decodeSchema, sdkEndpoints, JsonObjectSchema, JsonValueSchema,
  type Static, type TSchema, type PublicEffectiveSignInExperience,
} from '@supauth/shared';

export { decodeSchema, sdkEndpoints };
export type Branding = PublicEffectiveSignInExperience['branding'];
export const PasswordPolicySchema = Type.Object({
  min_length: Type.Integer({ minimum: 6, maximum: 128 }),
  require_uppercase: Type.Boolean(),
  require_lowercase: Type.Boolean(),
  require_numbers: Type.Boolean(),
  require_symbols: Type.Boolean(),
});
export type PasswordPolicy = Static<typeof PasswordPolicySchema>;
export function parsePasswordPolicy(candidate: unknown): PasswordPolicy | null {
  try { return decodeSchema(PasswordPolicySchema, candidate); } catch { return null; }
}

export function phraseStrings(phrases: Record<string, unknown>): Record<string, string> {
  return Object.fromEntries(Object.entries(phrases).filter((entry): entry is [string, string] => typeof entry[1] === 'string'));
}

export const ClaimConfigSchema = Type.Object({
  enabled: Type.Boolean(),
  external_type: Type.String(),
  password: Type.Composite([
    PasswordPolicySchema,
    Type.Object({ mode: Type.Union([Type.Literal('set_on_claim'), Type.Literal('show_initial_password')]) }),
  ]),
  phrases: Type.Record(Type.String(), Type.Record(Type.String(), Type.String())),
});
export type ClaimConfig = Static<typeof ClaimConfigSchema>;
export const ClaimConfigResponseSchema = Type.Object({ success: Type.Literal(true), config: ClaimConfigSchema });
export const ClaimResultSchema = Type.Object({
  success: Type.Literal(true), status: Type.String(), email: Type.String(),
  password_set: Type.Optional(Type.Boolean()),
  initial_password: Type.Optional(Type.Union([Type.String(), Type.Null()])),
});
export type ClaimResult = Static<typeof ClaimResultSchema>;
export const ClaimInputSchema = Type.Object({
  external_id: Type.String({ minLength: 1 }), new_password: Type.Optional(Type.String()),
}, { additionalProperties: false });
export const ChangePasswordInputSchema = Type.Object({
  email: Type.String({ minLength: 1 }), current_password: Type.String({ minLength: 1 }),
  new_password: Type.String({ minLength: 1 }), confirm_password: Type.String({ minLength: 1 }),
}, { additionalProperties: false });
export const ChangePasswordResultSchema = Type.Object({
  success: Type.Literal(true), status: Type.Literal('password_changed'),
});

export const AccountConfigSchema = Type.Object({
  enabled: Type.Boolean(),
  profile: Type.Object({
    edit_mode: Type.Union([Type.Literal('disabled'), Type.Literal('editable'), Type.Literal('read_only')]),
    fields: Type.Array(Type.String()),
  }),
  security: Type.Object({
    password_change: Type.Boolean(), mfa: Type.Boolean(), email_change: Type.Boolean(), phone_change: Type.Boolean(),
  }),
  grants: Type.Object({ enabled: Type.Boolean() }),
  identities: Type.Object({ enabled: Type.Boolean() }),
  delete_account: Type.Object({ enabled: Type.Boolean(), url: Type.Union([Type.String(), Type.Null()]) }),
});
export type AccountConfig = Static<typeof AccountConfigSchema>;
export const ProviderLinkingSchema = Type.Object({
  available: Type.Boolean(), providers: Type.Array(Type.String()), redirect_to: Type.Union([Type.String(), Type.Null()]),
  source: Type.Optional(Type.String()), version: Type.Optional(Type.Union([Type.String(), Type.Null()])),
  reason_code: Type.Optional(Type.String()),
});
export type ProviderLinking = Static<typeof ProviderLinkingSchema>;
export const AccountConfigResponseSchema = Type.Object({
  success: Type.Literal(true), config: AccountConfigSchema,
  capabilities: Type.Object({ provider_linking: ProviderLinkingSchema }),
});
export const AccountUserSchema = Type.Object({
  id: Type.String({ minLength: 1 }), email: Type.Optional(Type.String()), phone: Type.Optional(Type.String()),
  user_metadata: Type.Optional(JsonObjectSchema),
});
export type AccountUser = Static<typeof AccountUserSchema>;
export const AccountItemSchema = Type.Object({
  id: Type.Optional(Type.String()), identity_id: Type.Optional(Type.String()),
  name: Type.Optional(Type.String()), display_name: Type.Optional(Type.String()),
  email: Type.Optional(Type.String()), provider: Type.Optional(Type.String()),
  client: Type.Optional(Type.Object({ id: Type.Optional(Type.String()), name: Type.Optional(Type.String()) })),
});
export type AccountItem = Static<typeof AccountItemSchema>;
export const EnrollmentSchema = Type.Object({
  id: Type.Optional(Type.String()), factor_id: Type.Optional(Type.String()),
  totp: Type.Object({ qr_code: Type.String(), uri: Type.String(), secret: Type.Optional(Type.String()) }),
});
export type Enrollment = Static<typeof EnrollmentSchema>;
export const accountResponses = {
  user: Type.Object({ success: Type.Literal(true), user: AccountUserSchema }),
  items: Type.Object({ success: Type.Literal(true), items: Type.Array(AccountItemSchema), total: Type.Number() }),
  mutation: Type.Object({ success: Type.Literal(true), result: Type.Optional(JsonValueSchema), status: Type.Optional(Type.String()) }),
  identity: Type.Object({ success: Type.Literal(true), authorization: Type.Object({ url: Type.String({ minLength: 1 }) }) }),
  enrollment: Type.Object({ success: Type.Literal(true), enrollment: EnrollmentSchema }),
  verification: Type.Object({
    success: Type.Literal(true),
    session: Type.Object({ access_token: Type.String({ minLength: 1 }), refresh_token: Type.String({ minLength: 1 }) }),
  }),
};

export const AuthorizationDetailsSchema = Type.Object({
  authorization_id: Type.String({ minLength: 1 }),
  redirect_uri: Type.Optional(Type.String({ minLength: 1 })),
  scope: Type.Optional(Type.String()),
  client: Type.Object({
    id: Type.String({ minLength: 1 }), name: Type.Optional(Type.String()),
    uri: Type.Optional(Type.String()), logo_uri: Type.Optional(Type.String()),
  }),
  user: Type.Object({ id: Type.String({ minLength: 1 }), email: Type.Optional(Type.String()) }),
});
export const AuthorizationSchema = Type.Union([
  Type.Object({ redirect_url: Type.String({ minLength: 1 }) }),
  AuthorizationDetailsSchema,
]);
export type Authorization = Static<typeof AuthorizationSchema>;
export type AuthorizationDetails = Static<typeof AuthorizationDetailsSchema>;
export const ConsentInputSchema = Type.Object({ action: Type.Union([Type.Literal('approve'), Type.Literal('deny')]) });
export const SignupInputSchema = Type.Object({ email: Type.String({ minLength: 1 }), password: Type.String({ minLength: 1 }) });
export const RecoverInputSchema = Type.Object({ email: Type.String({ minLength: 1 }) });
export const SignupResultSchema = Type.Union([
  sdkEndpoints.getUser.result,
  Type.Object({
    access_token: Type.String({ minLength: 1 }), refresh_token: Type.String({ minLength: 1 }),
    token_type: Type.String({ minLength: 1 }), expires_in: Type.Number(),
    user: sdkEndpoints.getUser.result,
  }),
]);
export const RecoverResultSchema = Type.Object({}, { additionalProperties: false });

export async function readContract<S extends TSchema>(response: Response, schema: S): Promise<Static<S>> {
  let value: unknown;
  try {
    value = JSON.parse(await response.text());
    return decodeSchema(schema, value);
  } catch {
    throw new Error('Hosted API response does not match its contract');
  }
}

const accountInputs = [
  { method: 'PATCH', path: /^\/account\/profile$/, schema: Type.Object({ data: Type.Object({ name: Type.String({ minLength: 1 }) }) }) },
  { method: 'PATCH', path: /^\/account\/email$/, schema: Type.Object({ email: Type.String({ minLength: 1 }) }) },
  { method: 'PATCH', path: /^\/account\/phone$/, schema: Type.Object({ phone: Type.String({ minLength: 1 }) }) },
  { method: 'POST', path: /^\/account\/identities\/authorize$/, schema: Type.Object({ provider: Type.String({ minLength: 1 }), redirect_to: Type.String({ minLength: 1 }) }) },
  { method: 'POST', path: /^\/account\/mfa\/totp\/enroll$/, schema: Type.Object({ friendly_name: Type.String(), issuer: Type.String() }) },
  { method: 'POST', path: /^\/account\/mfa\/[^/]+\/verify$/, schema: Type.Object({ code: Type.String({ minLength: 1 }) }) },
  { method: 'DELETE', path: /^\/account$/, schema: Type.Object({ confirmation: Type.Literal('DELETE') }) },
] as const;

export function validateAccountRequest(path: string, options: RequestInit): void {
  const method = options.method ?? 'GET';
  const contract = accountInputs.find((entry) => entry.method === method && entry.path.test(path));
  if (contract) {
    if (typeof options.body !== 'string') throw new Error('Hosted account request requires a JSON body');
    const body: unknown = JSON.parse(options.body);
    decodeSchema(contract.schema, body);
    return;
  }
  const noBody = method === 'GET' && /^\/account\/(?:me|grants|identities|mfa)$/.test(path)
    || method === 'DELETE' && /^\/account\/(?:grants|identities|mfa)\/[^/]+$/.test(path);
  if (!noBody || options.body !== undefined) throw new Error('Unknown hosted account request contract');
}
