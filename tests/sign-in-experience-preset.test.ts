import { describe, expect, it } from 'bun:test';
import { readFileSync } from 'node:fs';
import {
  buildSignInExperienceEndpoint,
  extractSignInExperiencePayload,
} from '../scripts/apply-sign-in-experience.js';

describe('sign-in experience deployment presets', () => {
  it('keeps Xigu Shujian as tenant configuration, not a source default', () => {
    const preset = JSON.parse(readFileSync('config/sign-in-experience/xigu-shujian.json', 'utf8')) as unknown;
    const payload = extractSignInExperiencePayload(preset);

    expect(payload.branding?.page_title).toBe('西谷智灯枢鉴系统');
    expect(payload.branding?.button_label).toBe('进入枢鉴');
    expect(payload.sign_up_enabled).toBe(false);
    expect(payload.password_policy?.min_length).toBe(10);
  });

  it('documents the SupAuth versus tenant-configuration boundary', () => {
    const docs = readFileSync('docs/xigu-shujian-config.md', 'utf8');
    const preset = readFileSync('config/sign-in-experience/xigu-shujian.json', 'utf8');

    expect(docs).toContain('落在 SupAuth 的通用能力');
    expect(docs).toContain('通过西谷租户配置实现');
    expect(docs).toContain('不把“西谷智灯枢鉴系统”写入默认源码');
    expect(preset).toContain('"supauth_owned"');
    expect(preset).toContain('"tenant_configured"');
  });

  it('defaults to the admin API path and allows direct Function path override', () => {
    expect(buildSignInExperienceEndpoint('https://auth.ai.xigu.team/', undefined)).toBe(
      'https://auth.ai.xigu.team/api/v1/sign-in-experience',
    );
    expect(buildSignInExperienceEndpoint('https://auth.ai.xigu.team', '/v1/sign-in-experience')).toBe(
      'https://auth.ai.xigu.team/v1/sign-in-experience',
    );
  });
});
