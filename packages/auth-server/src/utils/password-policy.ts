export interface PublicPasswordPolicy {
  min_length: number;
  require_uppercase: boolean;
  require_lowercase: boolean;
  require_numbers: boolean;
  require_symbols: boolean;
}

export type PasswordPolicyViolation =
  | 'password_too_short'
  | 'password_requires_uppercase'
  | 'password_requires_lowercase'
  | 'password_requires_number'
  | 'password_requires_symbol';

export const GOTRUE_PASSWORD_CHARACTER_POLICIES = {
  none: '',
  standard: 'abcdefghijklmnopqrstuvwxyz:ABCDEFGHIJKLMNOPQRSTUVWXYZ:0123456789',
  strong:
    "abcdefghijklmnopqrstuvwxyz:ABCDEFGHIJKLMNOPQRSTUVWXYZ:0123456789:!@#$%^&*()_+-=[]{};'\\\\:\"|<>?,./`~",
} as const;

export const GOTRUE_PASSWORD_SYMBOLS = "!@#$%^&*()_+-=[]{};'\\\\:\"|<>?,./`~";

const DEFAULT_GOTRUE_PASSWORD_MIN_LENGTH = 6;
const SUPPORTED_GOTRUE_CHARACTER_POLICIES = new Set<string>(
  Object.values(GOTRUE_PASSWORD_CHARACTER_POLICIES),
);

function isRecord(input: unknown): input is Record<string, unknown> {
  return typeof input === 'object' && input !== null && !Array.isArray(input);
}

function runtimeMinimumLength(input: unknown): number {
  const parsed = typeof input === 'number' ? input : Number(input);
  if (input === undefined || input === null || input === '' || !Number.isInteger(parsed) || parsed < 6 || parsed > 128) {
    throw new Error('GoTrue returned an invalid password_min_length');
  }
  return parsed;
}

/** 未知字符策略无法被领取页精确表达，必须失败关闭以免放行弱密码。 */
export function passwordPolicyFromAuthConfig(authConfig: unknown): PublicPasswordPolicy {
  if (!isRecord(authConfig)) throw new Error('GoTrue returned an invalid auth configuration');
  const requiredCharacters = authConfig.password_required_characters;
  if (typeof requiredCharacters !== 'string') {
    throw new Error('GoTrue returned an invalid password_required_characters policy');
  }

  if (!SUPPORTED_GOTRUE_CHARACTER_POLICIES.has(requiredCharacters)) {
    throw new Error('GoTrue returned an unsupported password_required_characters policy');
  }

  const requireStandard = requiredCharacters === GOTRUE_PASSWORD_CHARACTER_POLICIES.standard
    || requiredCharacters === GOTRUE_PASSWORD_CHARACTER_POLICIES.strong;
  return {
    min_length: runtimeMinimumLength(authConfig.password_min_length),
    require_uppercase: requireStandard,
    require_lowercase: requireStandard,
    require_numbers: requireStandard,
    require_symbols: requiredCharacters === GOTRUE_PASSWORD_CHARACTER_POLICIES.strong,
  };
}

export function mergePasswordPolicies(...policies: PublicPasswordPolicy[]): PublicPasswordPolicy {
  return policies.reduce<PublicPasswordPolicy>((merged, policy) => ({
    min_length: Math.max(merged.min_length, policy.min_length),
    require_uppercase: merged.require_uppercase || policy.require_uppercase,
    require_lowercase: merged.require_lowercase || policy.require_lowercase,
    require_numbers: merged.require_numbers || policy.require_numbers,
    require_symbols: merged.require_symbols || policy.require_symbols,
  }), {
    min_length: DEFAULT_GOTRUE_PASSWORD_MIN_LENGTH,
    require_uppercase: false,
    require_lowercase: false,
    require_numbers: false,
    require_symbols: false,
  });
}

export function passwordPolicyViolation(
  password: string,
  policy: PublicPasswordPolicy,
): PasswordPolicyViolation | null {
  if (password.length < policy.min_length) return 'password_too_short';
  if (policy.require_uppercase && !/[A-Z]/.test(password)) return 'password_requires_uppercase';
  if (policy.require_lowercase && !/[a-z]/.test(password)) return 'password_requires_lowercase';
  if (policy.require_numbers && !/[0-9]/.test(password)) return 'password_requires_number';
  if (policy.require_symbols && !Array.from(password).some(character => GOTRUE_PASSWORD_SYMBOLS.includes(character))) {
    return 'password_requires_symbol';
  }
  return null;
}
