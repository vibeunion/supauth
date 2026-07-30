import { afterEach, describe, expect, test } from 'bun:test';
import { runtimeEnv } from '../config/platform-env.js';

const name = 'ADMIN_SSO_REQUIRE_AAL2';
const scopedName = `EDGEFN_SUPAUTH_${name}`;
const original = {
  name: process.env[name],
  scopedName: process.env[scopedName],
};

afterEach(() => {
  if (original.name === undefined) delete process.env[name];
  else process.env[name] = original.name;
  if (original.scopedName === undefined) delete process.env[scopedName];
  else process.env[scopedName] = original.scopedName;
});

describe('SupaCloud Function environment aliases', () => {
  test('prefers the SupaCloud Function-scoped value', () => {
    process.env[name] = 'true';
    process.env[scopedName] = 'false';

    expect(runtimeEnv(name)).toBe('false');
  });

  test('does not fall back when the Function-scoped value is explicitly empty', () => {
    process.env[name] = 'true';
    process.env[scopedName] = '';

    expect(runtimeEnv(name)).toBe('');
  });
});
