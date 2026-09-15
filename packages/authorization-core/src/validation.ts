import type { AuthorizationRequest } from './index.js';

const CONTEXT_PART_PATTERN = /^[^\s]{1,512}$/u;

function record(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

function contextPart(value: unknown, label: string): string {
  if (typeof value !== 'string' || !CONTEXT_PART_PATTERN.test(value)) {
    throw new TypeError(`${label} must be a non-empty string without whitespace`);
  }
  return value;
}

export function readAuthorizationRequest(value: unknown): AuthorizationRequest {
  if (!record(value) || !record(value['principal']) || !record(value['domain'])) {
    throw new TypeError('Authorization request must contain principal and domain objects');
  }
  const principal = value['principal'];
  const domain = value['domain'];
  const kind = principal['kind'];
  if (kind !== 'user' && kind !== 'service') throw new TypeError('principal.kind must be user or service');
  return {
    principal: {
      kind,
      issuer: contextPart(principal['issuer'], 'principal.issuer'),
      subject: contextPart(principal['subject'], 'principal.subject'),
    },
    applicationId: contextPart(value['applicationId'], 'applicationId'),
    domain: {
      type: contextPart(domain['type'], 'domain.type'),
      id: contextPart(domain['id'], 'domain.id'),
    },
  };
}

export function readResolvedPermissions(value: unknown): readonly string[] {
  if (!Array.isArray(value)) throw new TypeError('resolved permissions must be an array');
  const values: readonly unknown[] = value;
  const result: string[] = [];
  for (const permission of values) {
    if (typeof permission !== 'string') throw new TypeError('resolved permission must be a string');
    result.push(permission);
  }
  return result;
}
