import type { AuthorizationSchemaOptions, RlsPermissionPolicy, RlsPolicyOptions } from './index.js';

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

function record(value: unknown): Record<string, unknown> {
  if (!isRecord(value)) throw new TypeError('Expected options object');
  return value;
}

function text(value: Record<string, unknown>, key: string): string {
  const field = value[key];
  if (typeof field !== 'string') throw new TypeError(`${key} must be a string`);
  return field;
}

export function readSchemaName(value: unknown): Pick<AuthorizationSchemaOptions, 'schema'> {
  return { schema: text(record(value), 'schema') };
}

export function readSchemaOptions(value: unknown): AuthorizationSchemaOptions {
  const options = record(value);
  const requireOAuthApplicationClaim = options['requireOAuthApplicationClaim'];
  if (requireOAuthApplicationClaim !== undefined && typeof requireOAuthApplicationClaim !== 'boolean') {
    throw new TypeError('requireOAuthApplicationClaim must be a boolean');
  }
  return {
    schema: text(options, 'schema'),
    applicationId: text(options, 'applicationId'),
    ...(requireOAuthApplicationClaim === undefined ? {} : { requireOAuthApplicationClaim }),
  };
}

function readPolicy(value: unknown): RlsPermissionPolicy {
  const policy = record(value);
  const command = policy['command'];
  switch (command) {
    case 'select':
    case 'delete': return { command, usingPermission: text(policy, 'usingPermission') };
    case 'insert': return { command, checkPermission: text(policy, 'checkPermission') };
    case 'update': return {
      command, usingPermission: text(policy, 'usingPermission'), checkPermission: text(policy, 'checkPermission'),
    };
    default: throw new TypeError('RLS policy command is invalid');
  }
}

export function readRlsOptions(value: unknown): RlsPolicyOptions {
  const options = record(value);
  const domainIdType = options['domainIdType'];
  if (domainIdType !== 'uuid' && domainIdType !== 'text') throw new TypeError('domainIdType must be uuid or text');
  const policies = options['policies'];
  if (!Array.isArray(policies)) throw new TypeError('policies must be an array');
  const entries: readonly unknown[] = policies;
  return {
    schema: text(options, 'schema'), tableSchema: text(options, 'tableSchema'), table: text(options, 'table'),
    domainColumn: text(options, 'domainColumn'), domainIdType, domainType: text(options, 'domainType'),
    policies: Array.from(entries, readPolicy),
  };
}
