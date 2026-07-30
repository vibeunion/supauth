#!/usr/bin/env bun

import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

type JsonObject = Record<string, unknown>;

export type SignInMethod = 'password' | 'magic_link' | 'phone_otp';

interface BrandingContentItem {
  icon?: string;
  title?: string;
  name?: string;
  desc?: string;
  description?: string;
}

interface BrandingContent {
  layout?: 'features';
  illustration?: 'security' | 'identity' | 'cloud';
  items?: BrandingContentItem[];
  features?: BrandingContentItem[];
}

export interface ApplySignInExperienceOptions {
  baseUrl: string;
  configPath: string;
  /** 已通过 /v1/auth/login 换取的管理 session token，或生产 SSO bearer。 */
  token?: string;
  /** token 的更明确别名；与 token 同时提供时值必须一致。 */
  bearerToken?: string;
  endpointPath?: string;
  authConfigEndpointPath?: string;
  dryRun?: boolean;
  fetchImpl?: typeof fetch;
}

export interface SignInExperiencePayload {
  branding?: {
    logo_url?: string | null;
    favicon_url?: string | null;
    primary_color?: string | null;
    page_title?: string | null;
    description?: string | null;
    background_url?: string | null;
    button_label?: string | null;
    custom_css?: string | null;
    content?: BrandingContent | null;
  };
  sign_in_methods?: SignInMethod[];
  sign_up_enabled?: boolean;
  password_policy?: {
    min_length?: number;
    require_uppercase?: boolean;
    require_lowercase?: boolean;
    require_numbers?: boolean;
    require_symbols?: boolean;
  };
}

const DEFAULT_ENDPOINT_PATH = '/api/v1/sign-in-experience';
const REQUEST_TIMEOUT_MS = 15_000;
const ALLOWED_SIGN_IN_METHODS = new Set<SignInMethod>([
  'password',
  'magic_link',
  'phone_otp',
]);
const GOTRUE_PASSWORD_CHARACTERS = {
  none: '',
  lowerUpperAndNumbers: 'abcdefghijklmnopqrstuvwxyz:ABCDEFGHIJKLMNOPQRSTUVWXYZ:0123456789',
  lowerUpperNumbersAndSymbols:
    "abcdefghijklmnopqrstuvwxyz:ABCDEFGHIJKLMNOPQRSTUVWXYZ:0123456789:!@#$%^&*()_+-=[]{};'\\\\:\"|<>?,./`~",
} as const;
const ALLOWED_ILLUSTRATIONS = new Set(['security', 'identity', 'cloud']);
const ALLOWED_CONTENT_ICONS = new Set([
  'shield',
  'users',
  'key',
  'audit',
  'lock',
  'globe',
  'cloud',
  'bolt',
  'fingerprint',
  'mail',
  'device',
  'database',
  'chart',
]);

function normalizeBaseUrl(value: string) {
  return value.replace(/\/+$/, '');
}

function normalizePath(value: string) {
  return value.startsWith('/') ? value : `/${value}`;
}

export function buildSignInExperienceEndpoint(baseUrl: string, endpointPath = DEFAULT_ENDPOINT_PATH) {
  return `${normalizeBaseUrl(baseUrl)}${normalizePath(endpointPath)}`;
}

function siblingEndpointPath(endpointPath: string, sibling: string) {
  const normalized = normalizePath(endpointPath).replace(/\/+$/, '');
  if (!normalized.endsWith('/sign-in-experience')) {
    throw new Error(
      `Cannot derive ${sibling} endpoint from ${normalized}; pass --auth-config-path explicitly.`,
    );
  }
  return `${normalized.slice(0, -'/sign-in-experience'.length)}/${sibling}`;
}

export function buildAuthConfigEndpoint(
  baseUrl: string,
  signInEndpointPath = DEFAULT_ENDPOINT_PATH,
  authConfigEndpointPath?: string,
) {
  const path = authConfigEndpointPath || siblingEndpointPath(signInEndpointPath, 'auth-config');
  return `${normalizeBaseUrl(baseUrl)}${normalizePath(path)}`;
}

function isRecord(value: unknown): value is JsonObject {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

function assertKnownKeys(value: JsonObject, allowed: readonly string[], path: string) {
  const allowedKeys = new Set(allowed);
  const unknownKeys = Object.keys(value).filter(key => !allowedKeys.has(key));
  if (unknownKeys.length > 0) {
    throw new Error(`${path} contains unknown field(s): ${unknownKeys.join(', ')}.`);
  }
}

function assertOptionalString(
  value: unknown,
  path: string,
  options: { nullable?: boolean; nonEmpty?: boolean; maxLength?: number } = {},
) {
  if (value === undefined) return;
  if (value === null && options.nullable) return;
  if (typeof value !== 'string') throw new Error(`${path} must be a string${options.nullable ? ' or null' : ''}.`);
  if (options.nonEmpty && !value.trim()) throw new Error(`${path} must not be empty.`);
  if (options.maxLength && value.length > options.maxLength) {
    throw new Error(`${path} must be at most ${options.maxLength} characters.`);
  }
}

function assertOptionalBoolean(value: unknown, path: string) {
  if (value !== undefined && typeof value !== 'boolean') throw new Error(`${path} must be a boolean.`);
}

function validateStringArray(value: unknown, path: string) {
  if (!Array.isArray(value)) throw new Error(`${path} must be an array.`);
  value.forEach((item, index) => {
    if (typeof item !== 'string' || !item.trim()) {
      throw new Error(`${path}[${index}] must be a non-empty string.`);
    }
    if (item.length > 500) throw new Error(`${path}[${index}] must be at most 500 characters.`);
  });
}

function validateBoundary(value: unknown) {
  if (value === undefined) return;
  if (!isRecord(value)) throw new Error('config.boundary must be a JSON object.');
  assertKnownKeys(value, ['supauth_owned', 'tenant_configured'], 'config.boundary');
  if (value.supauth_owned !== undefined) validateStringArray(value.supauth_owned, 'config.boundary.supauth_owned');
  if (value.tenant_configured !== undefined) {
    validateStringArray(value.tenant_configured, 'config.boundary.tenant_configured');
  }
}

function validateContentItem(value: unknown, path: string) {
  if (!isRecord(value)) throw new Error(`${path} must be a JSON object.`);
  assertKnownKeys(value, ['icon', 'title', 'name', 'desc', 'description'], path);
  assertOptionalString(value.icon, `${path}.icon`, { nonEmpty: true, maxLength: 32 });
  assertOptionalString(value.title, `${path}.title`, { nonEmpty: true, maxLength: 255 });
  assertOptionalString(value.name, `${path}.name`, { nonEmpty: true, maxLength: 255 });
  assertOptionalString(value.desc, `${path}.desc`, { nonEmpty: true, maxLength: 1_000 });
  assertOptionalString(value.description, `${path}.description`, { nonEmpty: true, maxLength: 1_000 });

  if (typeof value.icon === 'string' && !ALLOWED_CONTENT_ICONS.has(value.icon)) {
    throw new Error(`${path}.icon must be one of: ${[...ALLOWED_CONTENT_ICONS].join(', ')}.`);
  }
  const hasText = [value.title, value.name, value.desc, value.description]
    .some(item => typeof item === 'string' && item.trim());
  if (!hasText) throw new Error(`${path} must provide title/name or desc/description.`);
}

function validateBrandingContent(value: unknown, path: string) {
  if (value === undefined || value === null) return;
  if (!isRecord(value)) throw new Error(`${path} must be a JSON object or null.`);
  assertKnownKeys(value, ['layout', 'illustration', 'items', 'features'], path);

  if (value.layout !== undefined && value.layout !== 'features') {
    throw new Error(`${path}.layout must be "features".`);
  }
  if (value.illustration !== undefined) {
    if (typeof value.illustration !== 'string' || !ALLOWED_ILLUSTRATIONS.has(value.illustration)) {
      throw new Error(`${path}.illustration must be one of: ${[...ALLOWED_ILLUSTRATIONS].join(', ')}.`);
    }
  }
  if (value.items !== undefined && value.features !== undefined) {
    throw new Error(`${path} must not define both items and features.`);
  }

  const entries = value.items ?? value.features;
  if (entries === undefined) return;
  if (!Array.isArray(entries)) throw new Error(`${path}.${value.items !== undefined ? 'items' : 'features'} must be an array.`);
  if (entries.length > 8) throw new Error(`${path} supports at most 8 feature items.`);
  entries.forEach((item, index) => validateContentItem(item, `${path}.${value.items !== undefined ? 'items' : 'features'}[${index}]`));
}

function validateBranding(value: unknown) {
  if (!isRecord(value)) throw new Error('sign_in_experience.branding must be provided as a JSON object.');
  assertKnownKeys(value, [
    'logo_url',
    'favicon_url',
    'primary_color',
    'page_title',
    'description',
    'background_url',
    'button_label',
    'custom_css',
    'content',
  ], 'sign_in_experience.branding');

  assertOptionalString(value.logo_url, 'sign_in_experience.branding.logo_url', { nullable: true, maxLength: 2_048 });
  assertOptionalString(value.favicon_url, 'sign_in_experience.branding.favicon_url', { nullable: true, maxLength: 2_048 });
  assertOptionalString(value.primary_color, 'sign_in_experience.branding.primary_color', { nullable: true, maxLength: 32 });
  assertOptionalString(value.page_title, 'sign_in_experience.branding.page_title', {
    nullable: false,
    nonEmpty: true,
    maxLength: 255,
  });
  assertOptionalString(value.description, 'sign_in_experience.branding.description', { nullable: true, maxLength: 5_000 });
  assertOptionalString(value.background_url, 'sign_in_experience.branding.background_url', { nullable: true, maxLength: 2_048 });
  assertOptionalString(value.button_label, 'sign_in_experience.branding.button_label', { nullable: true, maxLength: 255 });
  assertOptionalString(value.custom_css, 'sign_in_experience.branding.custom_css', { nullable: true, maxLength: 100_000 });

  if (
    typeof value.primary_color === 'string'
    && !/^#(?:[0-9a-f]{3}|[0-9a-f]{4}|[0-9a-f]{6}|[0-9a-f]{8})$/i.test(value.primary_color)
  ) {
    throw new Error('sign_in_experience.branding.primary_color must be a hexadecimal CSS color.');
  }
  if (typeof value.page_title !== 'string' || !value.page_title.trim()) {
    throw new Error('sign_in_experience.branding.page_title is required.');
  }
  validateBrandingContent(value.content, 'sign_in_experience.branding.content');
}

function validateSignInMethods(value: unknown) {
  if (value === undefined) return;
  if (!Array.isArray(value) || value.length === 0) {
    throw new Error('sign_in_experience.sign_in_methods must be a non-empty array.');
  }
  const seen = new Set<string>();
  value.forEach((method, index) => {
    if (typeof method !== 'string' || !ALLOWED_SIGN_IN_METHODS.has(method as SignInMethod)) {
      throw new Error(
        `sign_in_experience.sign_in_methods[${index}] must be one of: ${[...ALLOWED_SIGN_IN_METHODS].join(', ')}.`,
      );
    }
    if (seen.has(method)) throw new Error(`sign_in_experience.sign_in_methods contains duplicate value: ${method}.`);
    seen.add(method);
  });
}

function validatePasswordPolicy(value: unknown) {
  if (value === undefined) return;
  if (!isRecord(value)) throw new Error('sign_in_experience.password_policy must be a JSON object.');
  assertKnownKeys(value, [
    'min_length',
    'require_uppercase',
    'require_lowercase',
    'require_numbers',
    'require_symbols',
  ], 'sign_in_experience.password_policy');

  if (value.min_length !== undefined) {
    if (!Number.isInteger(value.min_length) || (value.min_length as number) < 6 || (value.min_length as number) > 128) {
      throw new Error('sign_in_experience.password_policy.min_length must be an integer from 6 to 128.');
    }
  }
  assertOptionalBoolean(value.require_uppercase, 'sign_in_experience.password_policy.require_uppercase');
  assertOptionalBoolean(value.require_lowercase, 'sign_in_experience.password_policy.require_lowercase');
  assertOptionalBoolean(value.require_numbers, 'sign_in_experience.password_policy.require_numbers');
  assertOptionalBoolean(value.require_symbols, 'sign_in_experience.password_policy.require_symbols');
  mapPasswordRequiredCharacters(value);
}

function mapPasswordRequiredCharacters(policy: JsonObject | SignInExperiencePayload['password_policy']) {
  if (!policy) return undefined;
  const keys = ['require_uppercase', 'require_lowercase', 'require_numbers', 'require_symbols'] as const;
  const definedCount = keys.filter(key => policy[key] !== undefined).length;
  if (definedCount === 0) return undefined;
  if (definedCount !== keys.length) {
    throw new Error(
      'sign_in_experience.password_policy must provide all four require_* booleans when syncing GoTrue character requirements.',
    );
  }

  const uppercase = policy.require_uppercase === true;
  const lowercase = policy.require_lowercase === true;
  const numbers = policy.require_numbers === true;
  const symbols = policy.require_symbols === true;

  if (!uppercase && !lowercase && !numbers && !symbols) return GOTRUE_PASSWORD_CHARACTERS.none;
  if (uppercase && lowercase && numbers && !symbols) return GOTRUE_PASSWORD_CHARACTERS.lowerUpperAndNumbers;
  if (uppercase && lowercase && numbers && symbols) return GOTRUE_PASSWORD_CHARACTERS.lowerUpperNumbersAndSymbols;

  throw new Error(
    'sign_in_experience.password_policy require_* combination cannot be represented exactly by GoTrue password_required_characters.',
  );
}

function validatePayload(candidate: JsonObject) {
  assertKnownKeys(candidate, [
    'branding',
    'sign_in_methods',
    'sign_up_enabled',
    'password_policy',
  ], 'sign_in_experience');
  validateBranding(candidate.branding);
  validateSignInMethods(candidate.sign_in_methods);
  assertOptionalBoolean(candidate.sign_up_enabled, 'sign_in_experience.sign_up_enabled');
  validatePasswordPolicy(candidate.password_policy);
}

export function extractSignInExperiencePayload(config: unknown): SignInExperiencePayload {
  if (!isRecord(config)) throw new Error('Config must be a JSON object.');
  const hasEnvelope = Object.prototype.hasOwnProperty.call(config, 'sign_in_experience');
  let candidate: JsonObject;

  if (hasEnvelope) {
    assertKnownKeys(config, ['name', 'description', 'boundary', 'sign_in_experience'], 'config');
    assertOptionalString(config.name, 'config.name', { nonEmpty: true, maxLength: 255 });
    assertOptionalString(config.description, 'config.description', { nonEmpty: true, maxLength: 5_000 });
    validateBoundary(config.boundary);
    if (!isRecord(config.sign_in_experience)) throw new Error('sign_in_experience must be a JSON object.');
    candidate = config.sign_in_experience;
  } else {
    candidate = config;
  }

  validatePayload(candidate);
  return candidate as SignInExperiencePayload;
}

export function readSignInExperiencePayload(configPath: string) {
  const path = resolve(configPath);
  const parsed = JSON.parse(readFileSync(path, 'utf8')) as unknown;
  return extractSignInExperiencePayload(parsed);
}

export function buildAuthConfigPayload(payload: SignInExperiencePayload) {
  const authConfig: JsonObject = {};
  if (payload.sign_up_enabled !== undefined) {
    authConfig.enable_signup = payload.sign_up_enabled;
    authConfig.disable_signup = !payload.sign_up_enabled;
  }
  if (payload.password_policy?.min_length !== undefined) {
    authConfig.password_min_length = payload.password_policy.min_length;
  }
  const passwordRequiredCharacters = mapPasswordRequiredCharacters(payload.password_policy);
  if (passwordRequiredCharacters !== undefined) {
    authConfig.password_required_characters = passwordRequiredCharacters;
  }
  return authConfig;
}

function resolveBearerToken(options: ApplySignInExperienceOptions) {
  const legacyToken = options.token?.trim() || '';
  const explicitToken = options.bearerToken?.trim() || '';
  if (legacyToken && explicitToken && legacyToken !== explicitToken) {
    throw new Error('token and bearerToken must match when both are provided.');
  }
  const token = explicitToken || legacyToken;
  if (!token) {
    throw new Error(
      'An exchanged admin session token or SSO bearer is required for non-dry-run apply. '
      + 'Use --bearer-token/--token or SUPAUTH_ADMIN_TOKEN; do not pass the raw ADMIN_TOKEN.',
    );
  }
  if (/^Bearer\s/i.test(token)) {
    throw new Error('Pass only the bearer token value, without the "Bearer " prefix.');
  }
  if (token.length < 16 || token.length > 16_384 || /[\u0000-\u0020\u007f]/.test(token)) {
    throw new Error('The admin bearer token has an invalid length or contains whitespace/control characters.');
  }
  return token;
}

function parseResponseBody(text: string): unknown {
  if (!text.trim()) return null;
  try {
    return JSON.parse(text) as unknown;
  } catch {
    return text;
  }
}

async function requestStage(
  stage: string,
  fetchImpl: typeof fetch,
  endpoint: string,
  init: RequestInit,
) {
  let response: Response;
  try {
    response = await fetchImpl(endpoint, {
      ...init,
      signal: init.signal || AbortSignal.timeout(REQUEST_TIMEOUT_MS),
    });
  } catch (error) {
    throw new Error(`${stage} stage failed before receiving a response: ${error instanceof Error ? error.message : String(error)}`);
  }
  const text = await response.text().catch(() => '');
  const body = parseResponseBody(text);
  if (!response.ok) {
    const detail = text.trim() ? `: ${text.trim().slice(0, 500)}` : '';
    throw new Error(`${stage} stage failed: ${init.method || 'GET'} ${endpoint} returned HTTP ${response.status}${detail}`);
  }
  return { status: response.status, body };
}

function assertReadBackObject(value: unknown, stage: string): JsonObject {
  if (!isRecord(value)) throw new Error(`${stage} read-back must return a JSON object.`);
  return value;
}

function assertDeepSubset(actual: unknown, expected: unknown, path: string) {
  if (Array.isArray(expected)) {
    if (!Array.isArray(actual) || actual.length !== expected.length) {
      throw new Error(`${path} read-back mismatch.`);
    }
    expected.forEach((item, index) => assertDeepSubset(actual[index], item, `${path}[${index}]`));
    return;
  }
  if (isRecord(expected)) {
    if (!isRecord(actual)) throw new Error(`${path} read-back mismatch.`);
    for (const [key, value] of Object.entries(expected)) {
      assertDeepSubset(actual[key], value, `${path}.${key}`);
    }
    return;
  }
  if (!Object.is(actual, expected)) {
    throw new Error(`${path} read-back mismatch: expected ${JSON.stringify(expected)}, received ${JSON.stringify(actual)}.`);
  }
}

export async function applySignInExperience(options: ApplySignInExperienceOptions) {
  if (!options.baseUrl) throw new Error('baseUrl is required. Use --base-url or SUPAUTH_PUBLIC_URL.');
  if (!options.configPath) throw new Error('configPath is required. Use --config.');

  const payload = readSignInExperiencePayload(options.configPath);
  const endpoint = buildSignInExperienceEndpoint(options.baseUrl, options.endpointPath);
  const authConfigEndpoint = buildAuthConfigEndpoint(
    options.baseUrl,
    options.endpointPath,
    options.authConfigEndpointPath,
  );
  const authConfigPayload = buildAuthConfigPayload(payload);

  if (options.dryRun) {
    return {
      dryRun: true,
      endpoint,
      authConfigEndpoint,
      payload,
      authConfigPayload,
    };
  }

  const token = resolveBearerToken(options);
  const fetchImpl = options.fetchImpl || fetch;
  const headers = () => new Headers({
    'Content-Type': 'application/json',
    Authorization: `Bearer ${token}`,
  });

  let authConfigUpdate: Awaited<ReturnType<typeof requestStage>> | null = null;
  let authConfigReadBack: Awaited<ReturnType<typeof requestStage>> | null = null;
  if (Object.keys(authConfigPayload).length > 0) {
    authConfigUpdate = await requestStage('auth-config update', fetchImpl, authConfigEndpoint, {
      method: 'PATCH',
      headers: headers(),
      body: JSON.stringify(authConfigPayload),
    });
  }

  const signInUpdate = await requestStage('sign-in-experience update', fetchImpl, endpoint, {
    method: 'PUT',
    headers: headers(),
    body: JSON.stringify(payload),
  });

  if (authConfigUpdate) {
    authConfigReadBack = await requestStage('auth-config read-back', fetchImpl, authConfigEndpoint, {
      method: 'GET',
      headers: headers(),
    });
    const actualAuthConfig = assertReadBackObject(authConfigReadBack.body, 'auth-config');
    assertDeepSubset(actualAuthConfig, authConfigPayload, 'auth-config');
  }

  const signInReadBack = await requestStage('sign-in-experience read-back', fetchImpl, endpoint, {
    method: 'GET',
    headers: headers(),
  });
  const actualSignInExperience = assertReadBackObject(signInReadBack.body, 'sign-in-experience');
  assertDeepSubset(actualSignInExperience, payload, 'sign-in-experience');

  return {
    dryRun: false,
    endpoint,
    authConfigEndpoint,
    status: signInUpdate.status,
    response: signInUpdate.body,
    authConfig: authConfigUpdate
      ? {
          payload: authConfigPayload,
          status: authConfigUpdate.status,
          response: authConfigUpdate.body,
          readBackStatus: authConfigReadBack?.status,
          readBack: authConfigReadBack?.body,
        }
      : { skipped: true, reason: 'No GoTrue-compatible fields were present.' },
    signInExperience: {
      status: signInUpdate.status,
      response: signInUpdate.body,
      readBackStatus: signInReadBack.status,
      readBack: signInReadBack.body,
    },
    verified: true,
  };
}

function parseArgs(argv: string[]) {
  const args: Record<string, string | boolean> = {};
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === '--dry-run') {
      args.dryRun = true;
      continue;
    }
    if (!arg.startsWith('--')) continue;
    const key = arg.slice(2);
    const value = argv[index + 1];
    if (!value || value.startsWith('--')) throw new Error(`Missing value for --${key}`);
    args[key] = value;
    index += 1;
  }
  return args;
}

if (import.meta.main) {
  const args = parseArgs(Bun.argv.slice(2));
  const result = await applySignInExperience({
    baseUrl: String(args['base-url'] || process.env.SUPAUTH_PUBLIC_URL || ''),
    configPath: String(args.config || ''),
    endpointPath: typeof args.path === 'string' ? args.path : undefined,
    authConfigEndpointPath: typeof args['auth-config-path'] === 'string' ? args['auth-config-path'] : undefined,
    bearerToken: String(
      args['bearer-token']
      || args.token
      || process.env.SUPAUTH_ADMIN_TOKEN
      || '',
    ),
    dryRun: args.dryRun === true,
  });
  console.log(JSON.stringify(result, null, 2));
}
