import { Type, decodeSchema } from './schema.js';

const label = '[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?';
const domainPattern = `^${label}(?:\\.${label})+(?![\\s\\S])`;
const domain = new RegExp(domainPattern);

export const LoginEmailDomainSchema = Type.String({ pattern: domainPattern, maxLength: 253 });
export const LoginEmailDomainConfigSchema = Type.Object({
  domain: Type.Union([LoginEmailDomainSchema, Type.Null()]),
});
export const LOGIN_EMAIL_DOMAIN_CONFIG = { type: 'sign_in', key: 'default_email_domain' } as const;

export function parseLoginEmailDomainInput(input: string): string | null | undefined {
  const trimmed = input.trim();
  if (!trimmed) return null;
  const normalized = trimmed.replace(/^@/, '').toLowerCase();
  return normalized.length <= 253 && domain.test(normalized) ? normalized : undefined;
}

export function readLoginEmailDomain(config: { enabled: boolean; value: unknown } | null | undefined) {
  if (!config?.enabled) return null;
  try {
    return decodeSchema(LoginEmailDomainConfigSchema, config.value).domain;
  } catch {
    return null;
  }
}
