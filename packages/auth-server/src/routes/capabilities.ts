import { Elysia } from 'elysia';
import { getSupaCloudAdapter } from '../supacloud/adapter.js';
import { ApiContractError } from '../utils/api-contract.js';

const adapter = getSupaCloudAdapter();

export interface CapabilityStatus {
  available: boolean;
  source: 'gotrue' | 'supacloud' | 'supaoauth';
  version: string | null;
  reason_code: string | null;
}

export interface CapabilitiesResponse {
  runtime_mode: 'gotrue';
  capabilities: Record<string, CapabilityStatus>;
}

export const capabilityRoutes = new Elysia({ prefix: '/v1' })
  .get('/capabilities', async (): Promise<CapabilitiesResponse> => ({
    runtime_mode: 'gotrue',
    capabilities: platformCapabilities(await adapter.getCapabilities()),
  }), {
    detail: {
      summary: 'Get negotiated GoTrue and SupaCloud capabilities',
      tags: ['Project'],
    },
  });

function platformCapabilities(payload: unknown): Record<string, CapabilityStatus> {
  if (!payload || typeof payload !== 'object') throw invalidCapabilityResponse();
  const record = payload as Record<string, unknown>;
  const rawCapabilities = record.capabilities ?? record;
  if (!rawCapabilities || typeof rawCapabilities !== 'object' || Array.isArray(rawCapabilities)) {
    throw invalidCapabilityResponse();
  }

  return Object.fromEntries(
    Object.entries(rawCapabilities as Record<string, unknown>).map(([name, status]) => [name, capabilityStatus(name, status)]),
  );
}

function capabilityStatus(name: string, status: unknown): CapabilityStatus {
  if (!status || typeof status !== 'object') throw invalidCapabilityResponse(name);
  const record = status as Record<string, unknown>;
  if (typeof record.available !== 'boolean') throw invalidCapabilityResponse(name);
  return {
    available: record.available,
    source: capabilitySource(record.source),
    version: typeof record.version === 'string' ? record.version : null,
    reason_code: typeof record.reason_code === 'string' ? record.reason_code : null,
  };
}

function capabilitySource(source: unknown): CapabilityStatus['source'] {
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
