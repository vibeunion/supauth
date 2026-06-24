#!/usr/bin/env bun

import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

type JsonObject = Record<string, unknown>;

export interface ApplySignInExperienceOptions {
  baseUrl: string;
  configPath: string;
  token?: string;
  endpointPath?: string;
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
    content?: JsonObject | null;
  };
  sign_in_methods?: string[];
  sign_up_enabled?: boolean;
  mfa_required?: boolean;
  password_policy?: {
    min_length?: number;
    require_uppercase?: boolean;
    require_lowercase?: boolean;
    require_numbers?: boolean;
    require_symbols?: boolean;
  };
}

const DEFAULT_ENDPOINT_PATH = '/api/v1/sign-in-experience';

function normalizeBaseUrl(value: string) {
  return value.replace(/\/+$/, '');
}

function normalizePath(value: string) {
  return value.startsWith('/') ? value : `/${value}`;
}

export function buildSignInExperienceEndpoint(baseUrl: string, endpointPath = DEFAULT_ENDPOINT_PATH) {
  return `${normalizeBaseUrl(baseUrl)}${normalizePath(endpointPath)}`;
}

function isRecord(value: unknown): value is JsonObject {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

export function extractSignInExperiencePayload(config: unknown): SignInExperiencePayload {
  if (!isRecord(config)) throw new Error('Config must be a JSON object.');
  const candidate = isRecord(config.sign_in_experience) ? config.sign_in_experience : config;
  if (!isRecord(candidate)) throw new Error('sign_in_experience must be a JSON object.');

  if (!isRecord(candidate.branding)) {
    throw new Error('sign_in_experience.branding must be provided.');
  }
  const pageTitle = candidate.branding.page_title;
  if (typeof pageTitle !== 'string' || !pageTitle.trim()) {
    throw new Error('sign_in_experience.branding.page_title is required.');
  }

  return candidate as SignInExperiencePayload;
}

export function readSignInExperiencePayload(configPath: string) {
  const path = resolve(configPath);
  const parsed = JSON.parse(readFileSync(path, 'utf8')) as unknown;
  return extractSignInExperiencePayload(parsed);
}

export async function applySignInExperience(options: ApplySignInExperienceOptions) {
  if (!options.baseUrl) throw new Error('baseUrl is required. Use --base-url or SUPAUTH_PUBLIC_URL.');
  if (!options.configPath) throw new Error('configPath is required. Use --config.');

  const payload = readSignInExperiencePayload(options.configPath);
  const endpoint = buildSignInExperienceEndpoint(options.baseUrl, options.endpointPath);

  if (options.dryRun) {
    return { dryRun: true, endpoint, payload };
  }

  const headers = new Headers({ 'Content-Type': 'application/json' });
  if (options.token) headers.set('Authorization', `Bearer ${options.token}`);

  const response = await (options.fetchImpl || fetch)(endpoint, {
    method: 'PUT',
    headers,
    body: JSON.stringify(payload),
  });
  const text = await response.text().catch(() => '');
  if (!response.ok) {
    throw new Error(`PUT ${endpoint} failed with HTTP ${response.status}: ${text}`);
  }

  return {
    dryRun: false,
    endpoint,
    status: response.status,
    response: text ? JSON.parse(text) as unknown : null,
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
    token: String(args.token || process.env.SUPAUTH_ADMIN_TOKEN || ''),
    dryRun: args.dryRun === true,
  });
  console.log(JSON.stringify(result, null, 2));
}
