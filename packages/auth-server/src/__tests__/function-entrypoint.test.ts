import { describe, expect, it } from 'bun:test';

function setSupacloudFunctionEnv() {
  process.env.SUPACLOUD_API_URL = '';
  process.env.SUPACLOUD_MASTER_TOKEN = '';
  process.env.PROJECT_REF = '';
  process.env.OAUTH_RUNTIME_URL = '';
  process.env.DATABASE_URL = '';
  process.env.SUPACLOUD_INTERNAL_API_URL = 'http://supacloud.internal';
  process.env.SUPACLOUD_INTERNAL_TOKEN = 'test-token';
  process.env.SUPACLOUD_PROJECT_REF = 'test-project';
  process.env.SUPACLOUD_RUNTIME_URL = 'http://runtime.internal';
  process.env.SUPACLOUD_DATABASE_URL = 'postgres://test';
}

describe('SupAuth function entrypoint', () => {
  it('does not bind a standalone server when imported', async () => {
    setSupacloudFunctionEnv();

    const { app, handleSupAuthRequest } = await import('../index.js');

    expect(app.server).toBeNull();

    const response = await handleSupAuthRequest(new Request('http://supauth.local/v1/health'));
    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toMatchObject({
      status: 'ok',
      runtime_mode: 'gotrue',
    });
    expect(app.server).toBeNull();
  });

  it('accepts SupaCloud manifest /api routes without a standalone proxy', async () => {
    setSupacloudFunctionEnv();
    const supauthFunction = (await import('../supacloud-function.js')).default;

    const response = await supauthFunction.fetch(new Request('http://supauth.local/api/v1/health'));

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toMatchObject({
      status: 'ok',
      runtime_mode: 'gotrue',
    });
  });

  it('accepts direct SupaCloud function invoke paths', async () => {
    setSupacloudFunctionEnv();
    const supauthFunction = (await import('../supacloud-function.js')).default;

    const response = await supauthFunction.fetch(
      new Request('http://runtime.local/functions/v1/supauth/api/v1/health'),
    );

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toMatchObject({
      status: 'ok',
      runtime_mode: 'gotrue',
    });
  });
});
