import { describe, expect, it } from 'bun:test';
import { Elysia } from 'elysia';
import path from 'node:path';
import { hostedOAuthPageRoutes } from '../routes/sign-in-experience.js';

describe('Sign-in experience repository — module structure', () => {
  it('exports global and application-level experience functions', async () => {
    const repo = await import('../repositories/sign-in-experience.js');
    const expectedFns = [
      'getSignInExperience',
      'updateSignInExperience',
      'getApplicationSignInExperience',
      'upsertApplicationSignInExperience',
      'deleteApplicationSignInExperience',
      'resolveSignInExperience',
      'mergeSupaCloudBrandingDefaults',
    ];

    for (const fn of expectedFns) {
      expect(typeof (repo as Record<string, unknown>)[fn]).toBe('function');
    }
  });

  it('uses SupaCloud project fields as tenant-level branding defaults', async () => {
    const { mergeSupaCloudBrandingDefaults } = await import('../repositories/sign-in-experience.js');
    const branding = mergeSupaCloudBrandingDefaults({
      page_title: 'SupaOAuth',
      logo_url: null,
      favicon_url: null,
      primary_color: null,
    }, {
      project: {
        name: 'Volt',
        config: {
          branding: {
            logo_url: 'https://assets.example.com/volt-logo.png',
            primary_color: '#635bff',
          },
        },
      },
    });

    expect(branding.page_title).toBe('Volt');
    expect(branding.logo_url).toBe('https://assets.example.com/volt-logo.png');
    expect(branding.primary_color).toBe('#635bff');
  });

  it('uses SupaCloud OAuth client metadata as application branding defaults', async () => {
    const { mergeSupaCloudBrandingDefaults } = await import('../repositories/sign-in-experience.js');
    const branding = mergeSupaCloudBrandingDefaults({
      page_title: 'Tenant Name',
      logo_url: 'https://assets.example.com/tenant-logo.png',
      favicon_url: null,
      primary_color: '#0a2540',
    }, {
      application: {
        client_name: 'Volt Studio',
        logo_uri: 'https://assets.example.com/volt-studio-logo.png',
        primary_color: '#00d4ff',
      },
    });

    expect(branding.page_title).toBe('Volt Studio');
    expect(branding.logo_url).toBe('https://assets.example.com/volt-studio-logo.png');
    expect(branding.primary_color).toBe('#00d4ff');
  });

  it('serves the hosted OAuth authorize page at /oauth/authorize', async () => {
    const app = new Elysia().use(hostedOAuthPageRoutes);
    const response = await app.handle(
      new Request('http://localhost/oauth/authorize?authorization_id=test-authz'),
    );
    const body = await response.text();

    expect(response.status).toBe(200);
    expect(response.headers.get('content-type')).toContain('text/html');
    expect(body).toContain('<title>SupaOAuth Sign In</title>');
    expect(body).toContain('authorization_id');
  });

  it('uses /v1/public on auth.* hosted authorize domains', async () => {
    const file = Bun.file(path.resolve(import.meta.dir, '../../../admin-console/static/authorize.html'));
    const body = await file.text();

    expect(body).toContain("hostname.startsWith('auth.')");
    expect(body).toContain("return `${origin}/v1/public`");
  });
});
