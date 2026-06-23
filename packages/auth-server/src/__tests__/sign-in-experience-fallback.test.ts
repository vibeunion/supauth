import { describe, expect, it, mock } from 'bun:test';

const tenantRow = {
  id: 'tenant-sie',
  logoUrl: null,
  faviconUrl: null,
  primaryColor: '#4f46e5',
  pageTitle: '西谷智灯枢鉴系统',
  description: '统一身份认证与授权中心。',
  backgroundUrl: null,
  buttonLabel: '进入枢鉴',
  customCss: null,
  content: null,
  signInMethods: [],
  signUpEnabled: true,
  mfaRequired: false,
  passwordMinLength: 8,
  passwordRequireUppercase: false,
  passwordRequireLowercase: false,
  passwordRequireNumbers: false,
  passwordRequireSymbols: false,
  createdAt: new Date('2026-01-01T00:00:00Z'),
  updatedAt: new Date('2026-01-01T00:00:00Z'),
};

mock.module('../db/index.js', () => ({
  getDb: () => ({
    select: () => ({
      from: () => ({
        limit: async () => [tenantRow],
        where: () => ({
          limit: async () => {
            throw new Error('relation "supaoauth.application_sign_in_experience" does not exist');
          },
        }),
      }),
    }),
  }),
}));

describe('Sign-in experience repository fallback behavior', () => {
  it('keeps OAuth login usable when application sign-in experience storage is unavailable', async () => {
    const { resolveSignInExperience } = await import('../repositories/sign-in-experience.js');

    const experience = await resolveSignInExperience('d2b37315-105f-4d50-96fc-aa6e7b891b11');

    expect(experience?.branding.page_title).toBe('西谷智灯枢鉴系统');
    expect(experience?.branding.button_label).toBe('进入枢鉴');
    expect((experience as { application?: unknown } | null)?.application).toBeNull();
  });
});
