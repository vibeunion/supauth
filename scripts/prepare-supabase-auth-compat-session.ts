#!/usr/bin/env bun

import { appendFileSync } from 'node:fs';
import { createClient } from '@supabase/supabase-js';

const runtimeUrl = requiredEnv('OAUTH_RUNTIME_URL').replace(/\/auth\/v1\/?$/, '').replace(/\/+$/, '');
const clientId = requiredEnv('OAUTH21_CLIENT_ID');
const redirectUri = requiredEnv('OAUTH21_REDIRECT_URI');
const anonKey = requiredEnv('SUPABASE_ANON_KEY');
const email = requiredEnv('SUPABASE_TEST_EMAIL');
const password = requiredEnv('SUPABASE_TEST_PASSWORD');
const githubEnv = requiredEnv('GITHUB_ENV');

const codeVerifier = randomBase64Url(48);
const codeChallenge = base64Url(new Uint8Array(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(codeVerifier))));
const state = crypto.randomUUID();
const authorizeUrl = new URL(`${runtimeUrl}/auth/v1/oauth/authorize`);
authorizeUrl.searchParams.set('response_type', 'code');
authorizeUrl.searchParams.set('client_id', clientId);
authorizeUrl.searchParams.set('redirect_uri', redirectUri);
authorizeUrl.searchParams.set('scope', 'openid email profile');
authorizeUrl.searchParams.set('state', state);
authorizeUrl.searchParams.set('code_challenge', codeChallenge);
authorizeUrl.searchParams.set('code_challenge_method', 'S256');

const authorizationResponse = await fetch(authorizeUrl, { redirect: 'manual' });
const authorizationLocation = authorizationResponse.headers.get('location');
if (![302, 303].includes(authorizationResponse.status) || !authorizationLocation) {
  throw new Error(`OAuth authorization initialization failed with status ${authorizationResponse.status}`);
}

const authorizationPageUrl = new URL(authorizationLocation, runtimeUrl);
const authorizationId = authorizationPageUrl.searchParams.get('authorization_id');
if (!authorizationId) throw new Error('OAuth authorization redirect did not include authorization_id');

const supabase = createClient(runtimeUrl, anonKey, {
  auth: {
    autoRefreshToken: false,
    persistSession: false,
    detectSessionInUrl: false,
  },
});

const signIn = await supabase.auth.signInWithPassword({ email, password });
if (signIn.error || !signIn.data.session) {
  throw new Error(`Supabase Auth compatibility sign-in failed: ${signIn.error?.message || 'missing session'}`);
}

const approvalResponse = await fetch(
  `${authorizationPageUrl.origin}/v1/public/oauth/authorizations/${encodeURIComponent(authorizationId)}/approve`,
  { method: 'POST', headers: { authorization: `Bearer ${signIn.data.session.access_token}` } },
);
const approval = await approvalResponse.json().catch(() => null) as { redirect_url?: string; error?: string } | null;
if (!approvalResponse.ok || !approval?.redirect_url) {
  throw new Error(`OAuth authorization approval failed with status ${approvalResponse.status}: ${approval?.error || 'missing redirect URL'}`);
}

const callbackUrl = new URL(approval.redirect_url);
if (callbackUrl.searchParams.get('state') !== state) throw new Error('OAuth authorization state mismatch');
const authorizationCode = callbackUrl.searchParams.get('code');
if (!authorizationCode) throw new Error('OAuth authorization approval did not return a code');

const tokenResponse = await fetch(`${runtimeUrl}/auth/v1/oauth/token`, {
  method: 'POST',
  headers: { accept: 'application/json', 'content-type': 'application/x-www-form-urlencoded' },
  body: new URLSearchParams({
    grant_type: 'authorization_code',
    code: authorizationCode,
    client_id: clientId,
    redirect_uri: redirectUri,
    code_verifier: codeVerifier,
  }),
});
const tokens = await tokenResponse.json().catch(() => null) as { access_token?: string; refresh_token?: string; error?: string } | null;
if (!tokenResponse.ok || !tokens?.access_token || !tokens.refresh_token) {
  throw new Error(`OAuth authorization-code exchange failed with status ${tokenResponse.status}: ${tokens?.error || 'missing tokens'}`);
}

const accessToken = tokens.access_token;
const refreshToken = tokens.refresh_token;
const payload = decodeJwtPayload(accessToken);
const grantedScopes = typeof payload.scope === 'string' ? payload.scope.split(/\s+/).filter(Boolean) : [];
const expectedScopes = ['openid', 'email', 'profile'];
if (
  payload.client_id !== clientId
  || typeof payload.sub !== 'string'
  || expectedScopes.some((scope) => !grantedScopes.includes(scope))
) {
  throw new Error([
    'SupAuth OAuth compatibility exchange returned an unexpected token shape',
    `client_id_present=${typeof payload.client_id === 'string'}`,
    `client_id_matches=${payload.client_id === clientId}`,
    `sub_present=${typeof payload.sub === 'string'}`,
    `scope_present=${typeof payload.scope === 'string'}`,
    `scope_values=${grantedScopes.join(',') || '<empty>'}`,
  ].join('; '));
}

console.log(`::add-mask::${accessToken}`);
console.log(`::add-mask::${refreshToken}`);
appendFileSync(githubEnv, `OAUTH21_ACCESS_TOKEN=${accessToken}\nOAUTH21_REFRESH_TOKEN=${refreshToken}\n`);
console.log('Prepared ephemeral OAuth compatibility session for this CI job.');

function requiredEnv(name: string): string {
  const value = process.env[name]?.trim();
  if (!value) throw new Error(`Missing required environment variable: ${name}`);
  return value;
}

function decodeJwtPayload(token: string): Record<string, unknown> {
  const payload = token.split('.')[1];
  if (!payload) throw new Error('OAuth access token is not a JWT');
  const normalized = payload.replace(/-/g, '+').replace(/_/g, '/');
  const padded = normalized.padEnd(Math.ceil(normalized.length / 4) * 4, '=');
  return JSON.parse(atob(padded)) as Record<string, unknown>;
}

function randomBase64Url(bytes: number): string {
  const value = new Uint8Array(bytes);
  crypto.getRandomValues(value);
  return base64Url(value);
}

function base64Url(value: Uint8Array): string {
  return Buffer.from(value).toString('base64url');
}
