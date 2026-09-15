import { describe, expect, test } from 'bun:test';
import { TypeGuard } from '@sinclair/typebox';
import {
  decodeSchema, JsonObjectSchema, JsonValueSchema, SchemaDecodeError,
  StringKeySchema, Type, type Static, type TSchema,
} from '../schema.js';
import {
  SupaOAuthApplicationProjectionSchema, SupaOAuthProjectProjectionSchema, SupaOAuthAppMetadataSchema,
} from '../claims.js';
import { CapabilitiesResponseSchema } from '../core.js';
import { EnterpriseSSOConfigSchema, tenantConfigurationValues } from '../sdk-models.js';
import { sdkEndpoints } from '../sdk-endpoints.js';
import { AccountNormalizationSchemas, accountEndpoints } from '../server-account.js';

const tenantPhrases = tenantConfigurationValues.account_claim.properties.phrases;
const claimPhrases = accountEndpoints.claimConfig.result.properties.config.properties.phrases;
const tenantPhraseValues = Object.values(tenantPhrases.patternProperties)[0];
const claimPhraseValues = Object.values(claimPhrases.patternProperties)[0];
if (!tenantPhraseValues || !claimPhraseValues) throw new Error('Missing phrase value schema');

const maps: Array<{ name: string; schema: TSchema; valid: unknown; invalid: unknown }> = [
  {
    name: 'claims application organizations', schema: SupaOAuthApplicationProjectionSchema.properties.organizations,
    valid: { permissions: ['read'] }, invalid: { permissions: [1] },
  },
  {
    name: 'claims project organizations', schema: SupaOAuthProjectProjectionSchema.properties.organizations,
    valid: { roles: ['reader'] }, invalid: { roles: [1] },
  },
  {
    name: 'claims project applications', schema: SupaOAuthProjectProjectionSchema.properties.applications,
    valid: { organization_ids: ['organization'] }, invalid: { organization_ids: [1] },
  },
  {
    name: 'claims projects', schema: SupaOAuthAppMetadataSchema.properties.projects,
    valid: { application_id: 'application' }, invalid: { application_id: 1 },
  },
  {
    name: 'core capabilities', schema: CapabilitiesResponseSchema.properties.capabilities,
    valid: { source: 'gotrue', version: null, last_verified_at: '2026-09-08', available: true, reason_code: null },
    invalid: { source: 'gotrue', version: null, last_verified_at: '2026-09-08', available: 'yes', reason_code: null },
  },
  ...(['orgMembershipMapping', 'org_membership_mapping', 'roleMapping', 'role_mapping'] as const).map(key => ({
    name: `enterprise ${key}`, schema: EnterpriseSSOConfigSchema.properties[key], valid: 'reader', invalid: 42,
  })),
  { name: 'tenant phrase', schema: tenantConfigurationValues.phrase, valid: 'Hello', invalid: 42 },
  { name: 'tenant account phrase languages', schema: tenantPhrases, valid: { greeting: 'Hello' }, invalid: 42 },
  { name: 'tenant account phrase messages', schema: tenantPhraseValues, valid: 'Hello', invalid: 42 },
  ...(['org_membership_mapping', 'role_mapping'] as const).map(key => ({
    name: `enterprise input ${key}`,
    schema: sdkEndpoints.createEnterpriseSSOConfig.input.properties.body.properties[key].anyOf[0], valid: 'reader', invalid: 42,
  })),
  { name: 'normalized profile', schema: AccountNormalizationSchemas.profile, valid: 'Alice', invalid: { nested: true } },
  { name: 'claim config languages', schema: claimPhrases, valid: { greeting: 'Hello' }, invalid: 42 },
  { name: 'claim config messages', schema: claimPhraseValues, valid: 'Hello', invalid: 42 },
  { name: 'sync status counts', schema: accountEndpoints.syncStatus.result.properties.counts, valid: 42, invalid: '42' },
];

const keys = ['', 'ordinary', 'line\nbreak', '\nleading', 'trailing\n', 'line\rbreak', '\r\n', '\u2028', '\u2029'];

describe('managed Record keys cover every JSON string', () => {
  test('declares a genuine all-string pattern while retaining static value types', () => {
    expect(StringKeySchema).toMatchObject({ type: 'string', pattern: '^[\\s\\S]*$' });
    const schema = Type.Record(StringKeySchema, Type.String());
    const valid: Static<typeof schema> = { 'line\nbreak': 'value' };
    expect(decodeSchema(schema, valid)).toEqual(valid);
    // @ts-expect-error 任意字符串键不能削弱 Record 的具体值类型。
    const invalid: Static<typeof schema> = { 'line\nbreak': 42 };
    expect(() => decodeSchema(schema, invalid)).toThrow(SchemaDecodeError);
  });

  test('accounts for all 20 managed Record occurrences', () => {
    expect(maps).toHaveLength(18);
    for (const entry of maps) {
      if (!TypeGuard.IsRecord(entry.schema)) throw new Error('Expected record schema');
      expect(Object.keys(entry.schema.patternProperties)).toEqual(['^[\\s\\S]*$']);
    }
    expect(Object.keys(JsonObjectSchema.patternProperties)).toEqual(['^[\\s\\S]*$']);
    const recursive: unknown = JsonValueSchema;
    if (!TypeGuard.IsUnion(recursive)) throw new Error('Expected recursive union schema');
    const recursiveRecord = recursive.anyOf.find(TypeGuard.IsRecord);
    expect(recursiveRecord).toBeDefined();
    expect(Object.keys(recursiveRecord?.patternProperties ?? {})).toEqual(['^[\\s\\S]*$']);
  });

  for (const { name, schema, valid, invalid } of maps) {
    test(`${name}: newline keys accept valid values and cannot hide invalid values`, () => {
      for (const key of keys) {
        const input = { [key]: valid };
        expect(decodeSchema(schema, input)).toBe(input);
        expect(() => decodeSchema(schema, { [key]: invalid })).toThrow(SchemaDecodeError);
      }
    });
  }

  test('checks both levels of nested phrase maps for newline keys', () => {
    for (const schema of [tenantPhrases, claimPhrases]) {
      const value = { 'locale\none': { 'message\ntwo': 'Hello' } };
      expect(decodeSchema(schema, value)).toBe(value);
      expect(() => decodeSchema(schema, { 'locale\none': { 'message\ntwo': 42 } }))
        .toThrow(SchemaDecodeError);
    }
  });

  test('checks nested claim projects, applications and organizations', () => {
    const projection = <P>(permissions: P) => ({
      schema_version: 2 as const,
      projects: { 'project\none': {
        applications: { 'application\ntwo': {
          organizations: { 'organization\nthree': { permissions } },
        } },
      } },
    });
    expect(decodeSchema(SupaOAuthAppMetadataSchema, projection(['read']))).toEqual(projection(['read']));
    expect(() => decodeSchema(SupaOAuthAppMetadataSchema, projection([42]))).toThrow(SchemaDecodeError);
  });

  test('keeps recursive JSON extensions and rejects non-JSON values under newline keys', () => {
    for (const schema of [JsonObjectSchema, JsonValueSchema]) {
      const value = { 'outer\nkey': [{ 'inner\r\nkey': [null, true, 42, 'value'] }] };
      expect(decodeSchema(schema, value)).toBe(value);
      for (const invalid of [undefined, new Map([['key', 'value']]), new Set(['value']), new Date(), NaN]) {
        expect(() => decodeSchema(schema, { 'outer\nkey': [{ 'inner\r\nkey': invalid }] }))
          .toThrow(SchemaDecodeError);
      }
    }
  });
});
