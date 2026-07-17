#!/usr/bin/env bun

import { appendFileSync } from 'node:fs';
import { createSupaCloudOAuthFetch } from '@supacloud/js';
import { createClient } from '@supabase/supabase-js';

const runtimeUrl = requiredEnv('OAUTH_RUNTIME_URL').replace(/\/auth\/v1\/?$/, '').replace(/\/+$/, '');
const clientId = requiredEnv('OAUTH21_CLIENT_ID');
const anonKey = requiredEnv('SUPABASE_ANON_KEY');
const email = requiredEnv('SUPABASE_TEST_EMAIL');
const password = requiredEnv('SUPABASE_TEST_PASSWORD');
const githubEnv = requiredEnv('GITHUB_ENV');

const supabase = createClient(runtimeUrl, anonKey, {
  global: {
    fetch: createSupaCloudOAuthFetch({
      clientId,
      tokenEndpoint: `${runtimeUrl}/auth/v1/oauth/token`,
    }),
  },
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

const refreshed = await supabase.auth.refreshSession(signIn.data.session);
if (refreshed.error || !refreshed.data.session) {
  throw new Error(`SupAuth OAuth compatibility refresh failed: ${refreshed.error?.message || 'missing session'}`);
}

const { access_token: accessToken, refresh_token: refreshToken } = refreshed.data.session;
const payload = decodeJwtPayload(accessToken);
if (payload.client_id !== clientId || payload.user_id !== payload.sub) {
  throw new Error('SupAuth OAuth compatibility refresh returned an unexpected token shape');
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
