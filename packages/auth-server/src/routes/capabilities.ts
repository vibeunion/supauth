import { Elysia } from 'elysia';
import { getSupaCloudAdapter } from '../supacloud/adapter.js';
import { ApiContractError } from '../utils/api-contract.js';

const adapter = getSupaCloudAdapter();

// Keep this package-local until project references replace the shared-source path alias.
type CapabilitySource = 'gotrue' | 'supacloud' | 'supaoauth';

export type CapabilityStatus = {
  source: CapabilitySource;
  version: string | null;
  last_verified_at: string;
} & (
  | { available: true; reason_code: null }
  | { available: false; reason_code: string }
);

export interface CapabilitiesResponse {
  runtime_mode: 'gotrue';
  capabilities: Record<string, CapabilityStatus>;
}

const FAIL_CLOSED_CAPABILITY_SOURCES = {
  gotrue_admin_user_sessions: 'gotrue',
  gotrue_admin_identity_unlink: 'gotrue',
  gotrue_admin_oauth_grants: 'gotrue',
  gotrue_passkey_ceremony: 'gotrue',
  gotrue_client_credentials: 'gotrue',
  gotrue_id_token_custom_claims: 'gotrue',
  gotrue_oauth_client_ownership: 'gotrue',
  supacloud_identity_analytics_v1: 'supacloud',
  supacloud_webhook_metrics_v1: 'supacloud',
} as const satisfies Record<string, CapabilitySource>;

const RFC3339_TIMESTAMP = /^(\d{4})-(\d{2})-(\d{2})T(?:[01]\d|2[0-3]):[0-5]\d:[0-5]\d(?:\.\d+)?(?:Z|[+-](?:[01]\d|2[0-3]):[0-5]\d)$/;

export const capabilityRoutes = new Elysia({ prefix: '/v1' })
  .get('/capabilities', negotiatedCapabilityResponse, {
    detail: {
      summary: 'Get negotiated GoTrue and SupaCloud capabilities',
      tags: ['Project'],
    },
  });

async function negotiatedCapabilityResponse() {
  try {
    const upstreamCapabilities = await adapter.getCapabilities();
    return capabilityResponse(upstreamCapabilities, new Date().toISOString());
  } catch (error) {
    if (!(error instanceof ApiContractError)
      || error.code !== 'capability_unavailable'
      || error.details?.capability !== 'project_capabilities_v1') throw error;
    return capabilityResponse(
      {},
      new Date().toISOString(),
      'capability_negotiation_unavailable',
    );
  }
}

function capabilityResponse(
  payload: unknown,
  verifiedAt: string,
  failClosedReason = 'not_advertised_by_upstream',
): CapabilitiesResponse {
  return {
    runtime_mode: 'gotrue',
    capabilities: negotiatedCapabilities(payload, verifiedAt, failClosedReason),
  };
}

export function negotiatedCapabilities(
  payload: unknown,
  verifiedAt: string,
  failClosedReason = 'not_advertised_by_upstream',
): Record<string, CapabilityStatus> {
  const negotiationTimestamp = capabilityTimestamp('negotiation', verifiedAt);
  const unavailableReason = requiredReasonCode('negotiation', failClosedReason);
  const upstreamCapabilities = platformCapabilities(payload, negotiationTimestamp);
  return { ...failClosedCapabilities(negotiationTimestamp, unavailableReason), ...upstreamCapabilities };
}

function platformCapabilities(payload: unknown, verifiedAt: string): Record<string, CapabilityStatus> {
  if (!payload || typeof payload !== 'object') throw invalidCapabilityResponse();
  const record = payload as Record<string, unknown>;
  const rawCapabilities = record.capabilities ?? record;
  if (!rawCapabilities || typeof rawCapabilities !== 'object' || Array.isArray(rawCapabilities)) {
    throw invalidCapabilityResponse();
  }

  return Object.fromEntries(
    Object.entries(rawCapabilities as Record<string, unknown>)
      .map(([name, status]) => [name, capabilityStatus(name, status, verifiedAt)]),
  );
}

function capabilityStatus(name: string, status: unknown, verifiedAt: string): CapabilityStatus {
  if (!status || typeof status !== 'object') throw invalidCapabilityResponse(name);
  const record = status as Record<string, unknown>;
  if (typeof record.available !== 'boolean') throw invalidCapabilityResponse(name);
  const source = capabilitySource(record.source);
  const expectedSource = FAIL_CLOSED_CAPABILITY_SOURCES[
    name as keyof typeof FAIL_CLOSED_CAPABILITY_SOURCES
  ];
  if (expectedSource && source !== expectedSource) throw invalidCapabilityResponse(name);
  const reasonCode = nullableCapabilityString(name, record, 'reason_code');
  const commonStatus = {
    source,
    version: nullableCapabilityString(name, record, 'version'),
    last_verified_at: capabilityVerifiedAt(name, record, verifiedAt),
  };
  if (record.available) {
    if (reasonCode !== null) throw invalidCapabilityResponse(name);
    return { ...commonStatus, available: true, reason_code: null };
  }
  return {
    ...commonStatus,
    available: false,
    reason_code: requiredReasonCode(name, reasonCode),
  };
}

function requiredReasonCode(name: string, candidate: unknown) {
  if (typeof candidate === 'string' && candidate.trim().length > 0) return candidate;
  throw invalidCapabilityResponse(name);
}

function nullableCapabilityString(
  name: string,
  status: Record<string, unknown>,
  field: 'version' | 'reason_code',
) {
  if (!Object.hasOwn(status, field) || status[field] === null) return null;
  if (typeof status[field] === 'string') return status[field];
  throw invalidCapabilityResponse(name);
}

function failClosedCapabilities(
  verifiedAt: string,
  reasonCode: string,
): Record<string, CapabilityStatus> {
  return Object.fromEntries(Object.entries(FAIL_CLOSED_CAPABILITY_SOURCES).map(([name, source]) => [name, {
    available: false as const,
    source,
    version: null,
    reason_code: reasonCode,
    last_verified_at: verifiedAt,
  }]));
}

function capabilityVerifiedAt(name: string, status: Record<string, unknown>, fallback: string) {
  if (!Object.hasOwn(status, 'last_verified_at')) return fallback;
  return capabilityTimestamp(name, status.last_verified_at);
}

function capabilityTimestamp(name: string, candidate: unknown) {
  if (typeof candidate === 'string' && isRfc3339Timestamp(candidate)) return candidate;
  throw invalidCapabilityResponse(name);
}

function isRfc3339Timestamp(candidate: string) {
  const match = RFC3339_TIMESTAMP.exec(candidate);
  if (!match) return false;
  const year = Number(match[1]);
  const month = Number(match[2]);
  const day = Number(match[3]);
  return month >= 1 && month <= 12 && day >= 1 && day <= daysInMonth(year, month);
}

function daysInMonth(year: number, month: number) {
  if (month !== 2) return [4, 6, 9, 11].includes(month) ? 30 : 31;
  const leapYear = year % 4 === 0 && (year % 100 !== 0 || year % 400 === 0);
  return leapYear ? 29 : 28;
}

function capabilitySource(source: unknown): CapabilitySource {
  if (source === 'gotrue' || source === 'supaoauth' || source === 'supacloud') return source;
  throw invalidCapabilityResponse('source');
}

function invalidCapabilityResponse(capability?: string) {
  return new ApiContractError(
    502,
    'invalid_upstream_response',
    'SupaCloud capability response has an invalid shape',
    capability ? { capability } : undefined,
  );
}
