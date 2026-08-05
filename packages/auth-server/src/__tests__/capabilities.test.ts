import { describe, expect, it } from 'bun:test';
import { negotiatedCapabilities } from '../routes/capabilities.js';
import { ApiContractError } from '../utils/api-contract.js';

const verifiedAt = '2026-08-04T12:00:00.000Z';

describe('negotiated capability truth', () => {
  it('adds explicit fail-closed status for capabilities not advertised upstream', () => {
    const capabilities = negotiatedCapabilities({ capabilities: {} }, verifiedAt);

    expect(capabilities.gotrue_admin_user_sessions).toEqual({
      available: false,
      source: 'gotrue',
      version: null,
      reason_code: 'not_advertised_by_upstream',
      last_verified_at: verifiedAt,
    });
    expect(capabilities.supacloud_identity_analytics_v1).toMatchObject({
      available: false,
      source: 'supacloud',
      reason_code: 'not_advertised_by_upstream',
    });
  });

  it('lets a strictly validated upstream capability override its fail-closed default', () => {
    const upstreamVerifiedAt = '2026-08-04T12:01:00.000Z';
    const capabilities = negotiatedCapabilities({
      capabilities: {
        gotrue_admin_user_sessions: {
          available: true,
          source: 'gotrue',
          version: '2.194.0',
          reason_code: null,
          last_verified_at: upstreamVerifiedAt,
        },
      },
    }, verifiedAt);

    expect(capabilities.gotrue_admin_user_sessions).toEqual({
      available: true,
      source: 'gotrue',
      version: '2.194.0',
      reason_code: null,
      last_verified_at: upstreamVerifiedAt,
    });
  });

  it('uses the negotiation timestamp when upstream omits last_verified_at', () => {
    const capabilities = negotiatedCapabilities({
      custom_capability: {
        available: true,
        source: 'supaoauth',
      },
    }, verifiedAt);

    expect(capabilities.custom_capability.last_verified_at).toBe(verifiedAt);
  });

  it('accepts missing and explicit null optional metadata for available capabilities', () => {
    const capabilities = negotiatedCapabilities({
      capabilities: {
        missing: { available: true, source: 'supaoauth' },
        explicit_null: {
          available: true,
          source: 'supaoauth',
          version: null,
          reason_code: null,
        },
      },
    }, verifiedAt);

    expect(capabilities.missing).toMatchObject({ version: null, reason_code: null });
    expect(capabilities.explicit_null).toMatchObject({ version: null, reason_code: null });
  });

  it('requires a non-empty reason only for unavailable capabilities', () => {
    const capabilities = negotiatedCapabilities({
      capabilities: {
        unavailable: {
          available: false,
          source: 'supaoauth',
          reason_code: 'not_supported_by_runtime',
        },
      },
    }, verifiedAt);

    expect(capabilities.unavailable.reason_code).toBe('not_supported_by_runtime');
  });

  it('distinguishes an unavailable negotiation endpoint from an unadvertised capability', () => {
    const capabilities = negotiatedCapabilities(
      { capabilities: {} },
      verifiedAt,
      'capability_negotiation_unavailable',
    );

    expect(capabilities.gotrue_admin_user_sessions.reason_code)
      .toBe('capability_negotiation_unavailable');
  });

  it.each([
    null,
    { capabilities: [] },
    { capabilities: { broken: true } },
    { capabilities: { broken: { available: true, source: 'unknown' } } },
    { capabilities: { gotrue_admin_user_sessions: { available: true, source: 'supacloud' } } },
    { capabilities: { broken: { available: true, source: 'gotrue', version: 1 } } },
    { capabilities: { broken: { available: true, source: 'gotrue', reason_code: false } } },
    { capabilities: { broken: { available: true, source: 'gotrue', reason_code: '' } } },
    { capabilities: { broken: { available: true, source: 'gotrue', reason_code: 'not_ready' } } },
    { capabilities: { broken: { available: false, source: 'gotrue' } } },
    { capabilities: { broken: { available: false, source: 'gotrue', reason_code: null } } },
    { capabilities: { broken: { available: false, source: 'gotrue', reason_code: '' } } },
    { capabilities: { broken: { available: false, source: 'gotrue', reason_code: '   ' } } },
    { capabilities: { broken: { available: true, source: 'gotrue', last_verified_at: null } } },
    { capabilities: { broken: { available: true, source: 'gotrue', last_verified_at: 'not-a-date' } } },
    { capabilities: { broken: { available: true, source: 'gotrue', last_verified_at: '2026-02-30T12:00:00Z' } } },
    { capabilities: { broken: { available: true, source: 'gotrue', last_verified_at: '2026-08-04 12:00:00Z' } } },
  ])('rejects invalid upstream capability payloads', (payload) => {
    expect(() => negotiatedCapabilities(payload, verifiedAt)).toThrow(ApiContractError);
  });

  it('rejects a non-RFC3339 negotiation timestamp used by fail-closed states', () => {
    expect(() => negotiatedCapabilities({ capabilities: {} }, 'August 4, 2026'))
      .toThrow(ApiContractError);
  });

  it('rejects an empty fail-closed negotiation reason', () => {
    expect(() => negotiatedCapabilities({ capabilities: {} }, verifiedAt, ''))
      .toThrow(ApiContractError);
  });
});
