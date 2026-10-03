import { describe, expect, it } from 'bun:test';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { initSync, parse } from 'es-module-lexer';

const root = resolve(import.meta.dir, '..');
const authServer = resolve(root, 'packages/auth-server');
const environment = {
  PATH: process.env['PATH'] || '',
  NODE_ENV: 'test',
  RUNTIME_MODE: 'gotrue',
  SUPACLOUD_PROJECT_REF: 'framework-test',
  SUPACLOUD_INTERNAL_API_URL: 'https://management.example.test',
  SUPACLOUD_INTERNAL_TOKEN: 'test-management-token',
  SUPABASE_SERVICE_ROLE_KEY: 'test-only-service-role-key',
  SUPAOAUTH_BFF_SIGNING_SECRET: 'test-only-independent-bff-signing-secret',
  SUPACLOUD_RUNTIME_URL: 'https://runtime.example.test',
  SUPACLOUD_DATABASE_URL: 'postgres://test:test@127.0.0.1:1/test',
  ADMIN_TOKEN: 'framework-test-admin-token',
};

describe('SupAuth compiled application migration', () => {
  it('keeps the checked-in factories in sync with the strict module graph', () => {
    const result = Bun.spawnSync(
      [process.execPath, '--no-env-file', 'run', 'app:compile:check'],
      { cwd: authServer, env: environment, stdout: 'pipe', stderr: 'pipe' },
    );
    const output = new TextDecoder().decode(result.stdout)
      + new TextDecoder().decode(result.stderr);
    expect({ exitCode: result.exitCode, output: result.exitCode === 0 ? '' : output })
      .toEqual({ exitCode: 0, output: '' });
  });

  it.each(['source', 'bundle'])('preserves Function routing, auth and middleware in the %s entry', (mode) => {
    if (mode === 'bundle') {
      const build = Bun.spawnSync([process.execPath, '--no-env-file', 'run', 'scripts/build-supauth-function.ts'], {
        cwd: root, env: environment, stdout: 'pipe', stderr: 'pipe', timeout: 30_000,
      });
      expect({
        exitCode: build.exitCode,
        output: build.exitCode === 0 ? '' : new TextDecoder().decode(build.stderr),
      }).toEqual({ exitCode: 0, output: '' });
      const bundleSource = readFileSync(resolve(authServer, 'dist/supacloud-function/supacloud-function.js'), 'utf8');
      initSync();
      const [imports] = parse(bundleSource);
      const loaderAccess = imports.filter(entry => entry.d === -2
        && !/^\s*\.\s*(?:url|dir)\b/.test(bundleSource.slice(entry.e)));
      expect(loaderAccess).toEqual([]);
    }
    const entrypoint = mode === 'bundle'
      ? './packages/auth-server/dist/supacloud-function/supacloud-function.js'
      : './packages/auth-server/src/supacloud-function.ts';
    // 子进程隔离配置与模块缓存；禁止使用真实租户和远程服务。
    const script = `
      import assert from 'node:assert/strict';
      globalThis.fetch = async () => { throw new Error('Unexpected remote request'); };
      const { app } = await import('./packages/auth-server/src/index.ts');
      const { createSupAuthHttpApplication } = await import('./packages/auth-server/src/http-application.ts');
      const { createCompiledModules } = await import('./packages/auth-server/generated/application.ts');
      const { createCompiledRuntime } = await import('./packages/auth-server/src/compiled-runtime.ts');
      const { default: handler } = await import(${JSON.stringify(entrypoint)});
      const modules = createCompiledModules();
      const runtime = createCompiledRuntime(modules);
      const native = await runtime.resolve(services => createSupAuthHttpApplication(modules, services));
      const routes = (application) => application.routes.map(({ method, path }) => method + ' ' + path);
      assert.deepEqual(routes(app), routes(native));
      assert.ok(app.server == null);
      const baseline = await Bun.file('./tests/fixtures/supacloud-v1-routes.json').json();
      const canonicalRoute = route => route.endsWith(' /') ? route : route.replace(/\\/$/, '');
      assert.deepEqual(routes(app).filter(route => !route.startsWith('HEAD ')).map(canonicalRoute).sort(),
        baseline.routes.map(({ method, path }) => canonicalRoute(method + ' ' + path)).sort());
      assert.deepEqual(routes(app).filter(route => route.startsWith('HEAD ')).map(route => route.slice(5)).sort(),
        routes(app).filter(route => route.startsWith('GET ')).map(route => route.slice(4)).sort());
      const compiledRoutes = modules.flatMap(module => module.controllers.flatMap(controller =>
        controller.routes.map(route => route.method + ' ' + controller.path + route.path)));
      assert.equal(compiledRoutes.length, baseline.routes.length - 4);
      assert.equal(new Set(compiledRoutes).size, compiledRoutes.length);
      assert.ok(routes(app).includes('GET /v1/health'));
      assert.ok(routes(app).some(route => route.replace(/\\/$/, '') === 'GET /v1/applications'));
      for (const path of ['/v1/health', '/api/v1/health', '/functions/v1/supauth/api/v1/health', '/supauth/v1/health']) {
        const response = await handler.fetch(new Request('https://supauth.example.test' + path, {
          headers: { 'x-request-id': 'framework-health' },
        }));
        assert.equal(response.status, 200, path);
        assert.deepEqual(await response.json(), {
          status: 'ok', runtime_mode: 'gotrue', project_ref: 'framework-test',
        });
        assert.equal(response.headers.get('x-request-id'), 'framework-health');
        assert.equal(response.headers.get('x-content-type-options'), 'nosniff');
      }
      const denied = await handler.fetch(new Request('https://supauth.example.test/api/v1/applications', {
        headers: { 'x-request-id': 'framework-denied' },
      }));
      assert.equal(denied.status, 401);
      assert.equal(denied.headers.get('x-request-id'), 'framework-denied');
      const deniedSlash = await handler.fetch(new Request('https://supauth.example.test/api/v1/applications/'));
      assert.equal(deniedSlash.status, 401);
      assert.ok(!routes(app).some(route => route.includes('/auth/v1/')));
      const preflight = await handler.fetch(new Request('https://supauth.example.test/api/v1/applications', {
        method: 'OPTIONS',
        headers: { origin: 'http://localhost:5173', 'access-control-request-method': 'GET' },
      }));
      assert.ok(preflight.status >= 200 && preflight.status < 300);
      assert.equal(preflight.headers.get('access-control-allow-origin'), 'http://localhost:5173');
      assert.equal(preflight.headers.get('access-control-max-age'), '5');
      const allowedOrigin = await handler.fetch(new Request('https://supauth.example.test/api/v1/health', {
        headers: { origin: 'http://localhost:5173', 'x-request-id': 'framework-cors' },
      }));
      assert.ok(allowedOrigin.headers.get('access-control-expose-headers').split(',').map(value => value.trim()).includes('x-request-id'));
      const blockedOrigin = await handler.fetch(new Request('https://supauth.example.test/api/v1/health', {
        headers: { origin: 'https://untrusted.example.test' },
      }));
      assert.equal(blockedOrigin.headers.get('access-control-allow-origin'), null);
      assert.equal(blockedOrigin.headers.get('access-control-expose-headers'), null);
      const missing = await handler.fetch(new Request('https://supauth.example.test/v1/does-not-exist', {
        headers: { 'x-request-id': 'framework-missing' },
      }));
      assert.equal(missing.status, 404);
      assert.equal((await missing.json()).error.code, 'not_found');
      assert.equal(missing.headers.get('x-request-id'), 'framework-missing');
      const head = await handler.fetch(new Request('https://supauth.example.test/v1/health', { method: 'HEAD' }));
      assert.equal(head.status, 200);
      assert.equal(await head.text(), '');
      const hosted = await handler.fetch(new Request('https://supauth.example.test/login'));
      assert.equal(hosted.status, 200);
      assert.ok(hosted.headers.get('content-type').includes('text/html'));
      assert.ok((await hosted.text()).includes('<html'));
      const sso = await handler.fetch(new Request('https://supauth.example.test/oauth/sso/authorize?client_id=test-client&redirect_uri=https%3A%2F%2Fclient.example.test%2Fcallback&response_type=code'));
      assert.equal(sso.status, 302, await sso.clone().text());
      assert.ok(sso.headers.get('location').includes('/auth/v1/oauth/authorize'));
      const document = await handler.fetch(new Request('https://supauth.example.test/swagger/json'));
      assert.equal(document.status, 200);
      const openapi = await document.json();
      assert.deepEqual(Object.keys(openapi.paths).sort(), Object.keys(baseline.openapi).sort());
      for (const [path, methods] of Object.entries(baseline.openapi)) {
        assert.deepEqual(Object.keys(openapi.paths[path]).sort(), Object.keys(methods).sort(), path);
        for (const [method, operation] of Object.entries(methods)) {
          assert.deepEqual(Object.keys(openapi.paths[path][method].responses ?? {}).sort(), operation.responses, method + ' ' + path);
        }
      }
      const login = await handler.fetch(new Request('https://supauth.example.test/api/v1/auth/login', {
        method: 'POST', headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ token: 'framework-test-admin-token' }),
      }));
      assert.equal(login.status, 200, await login.clone().text());
      const { token } = await login.json();
      assert.equal(typeof token, 'string');
      const invalidWrite = await handler.fetch(new Request('https://supauth.example.test/api/v1/applications', {
        method: 'POST', headers: { 'content-type': 'application/json', authorization: 'Bearer ' + token },
        body: JSON.stringify({ invalid: true }),
      }));
      assert.equal(invalidWrite.status, 400, await invalidWrite.clone().text());
      const retiredWrite = await handler.fetch(new Request('https://supauth.example.test/api/v1/applications/test-client/secrets', {
        method: 'POST', headers: { 'content-type': 'application/json', authorization: 'Bearer ' + token },
        body: '{}',
      }));
      assert.equal(retiredWrite.status, 501, await retiredWrite.clone().text());
      const signedMalformed = await handler.fetch(new Request('https://supauth.example.test/api/v1/auth-hooks/before-user-created', {
        method: 'POST', headers: { 'content-type': 'application/json' }, body: '{invalid',
      }));
      assert.equal(signedMalformed.status, 401);
      await runtime.close();
      console.log('compiled-function-boundary-ok');
    `;
    const result = Bun.spawnSync([process.execPath, '--no-env-file', '-e', script], {
      cwd: root, env: environment, stdout: 'pipe', stderr: 'pipe', timeout: 15_000,
    });
    const output = new TextDecoder().decode(result.stdout)
      + new TextDecoder().decode(result.stderr);
    expect({ exitCode: result.exitCode, output: result.exitCode === 0 ? '' : output })
      .toEqual({ exitCode: 0, output: '' });
    expect(output).toContain('compiled-function-boundary-ok');
  });

  it('checks architecture drift before bundling and retains the deployment installer', () => {
    const entry = readFileSync(resolve(authServer, 'src/index.ts'), 'utf8');
    expect(entry).toContain('../generated/application.js');
    expect(entry).not.toContain('new Elysia(');
    const build = readFileSync(resolve(root, 'scripts/build-supauth-function.ts'), 'utf8');
    expect(build.indexOf("'app:compile:check'")).toBeGreaterThan(0);
    expect(build.indexOf("'app:compile:check'")).toBeLessThan(build.indexOf('Bun.build('));
    const installer = readFileSync(resolve(root, 'scripts/install-supacloud-app.ts'), 'utf8');
    expect(installer).toContain('verifySupacloudAppArtifact');
    expect(installer).toContain('supauthFunctionRuntimeSecrets');
  });

  it('preserves domain validation, protocol ordering and native response transport', () => {
    const script = `
      import assert from 'node:assert/strict';
      const { Type } = await import('./packages/shared/src/schema.ts');
      const { serverContract } = await import('./packages/auth-server/src/utils/server-contract.ts');
      const { configurationContract } = await import('./packages/auth-server/src/utils/configuration-contract.ts');
      const { defineHttpOperation } = await import('./packages/auth-server/src/http/operation.ts');
      const { applyCorsHeaders } = await import('./packages/auth-server/src/http/cors.ts');
      const { ApplicationPostRootAction } = await import('./packages/auth-server/src/app/features/application.module.ts');
      const { applicationRoutes } = await import('./packages/auth-server/src/routes/applications.ts');
      const { withAdminRequestContext } = await import('./packages/auth-server/src/auth/request-context.ts');
      let privilegedCalls = 0;
      const action = new ApplicationPostRootAction();
      const originalExecute = applicationRoutes.operations.postRoot.execute;
      applicationRoutes.operations.postRoot.execute = () => { privilegedCalls++; return {}; };
      try {
        assert.throws(() => action.execute({}), error => error.status === 401);
        withAdminRequestContext({
          requestId: 'action-permission-test', principal: { permissions: ['applications.read'] },
        }, () => assert.throws(() => action.execute({}), error => error.status === 403));
        assert.equal(privilegedCalls, 0);
      } finally {
        applicationRoutes.operations.postRoot.execute = originalExecute;
      }
      const { app } = await import('./packages/auth-server/src/index.ts');
      const { verifyAdminBearer } = await import('./packages/auth-server/src/auth/index.ts');
      const login = await app.handle(new Request('https://supauth.example.test/v1/auth/login', {
        method: 'POST', headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ token: 'framework-test-admin-token' }),
      }));
      const { token } = await login.json();
      const access = await verifyAdminBearer({ authorization: 'Bearer ' + token });
      assert.equal(access.status, 'authenticated');
      access.session.permissions = ['audit.read'];
      let remoteCalls = 0;
      globalThis.fetch = async () => { remoteCalls++; throw new Error('Unexpected audit operation'); };
      for (const path of ['/v1/audit/export', '/v1/audit/export/job/download', '/v1/audit/event-id']) {
        const response = await app.handle(new Request('https://supauth.example.test' + path, {
          method: 'HEAD', headers: { authorization: 'Bearer ' + token },
        }));
        assert.equal(response.status, 403, path);
      }
      assert.equal(remoteCalls, 0);
      let configurationCalls = 0;
      for (const matches of [true, false]) {
        const configured = defineHttpOperation('GET', '/configuration', ({ set }) => {
          configurationCalls++;
          set.status = 302;
          set.headers.location = '/expected';
          return { redirect: matches ? '/expected' : '/different' };
        }, configurationContract('authorizePublicConnector', {}));
        const response = await configured.invoke({
          request: new Request('https://supauth.example.test/configuration'),
        });
        assert.equal(response.status, matches ? 302 : 502);
      }
      assert.equal(configurationCalls, 2);
      let executions = 0;
      const contract = {
        request: 'validated',
        input: Type.Object({ body: Type.Object({ value: Type.String() }, { additionalProperties: false }) }),
        responses: { 200: { kind: 'validated', schema: Type.Object({ ok: Type.Boolean() }) } },
      };
      const options = serverContract('migration:validated', { contract });
      const validRequest = () => new Request('https://supauth.example.test/example', {
        method: 'POST', headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ value: 'accepted' }),
      });
      const valid = defineHttpOperation('POST', '/example', () => {
        executions++;
        return { ok: true };
      }, options);
      const invalid = await valid.invoke({ request: new Request('https://supauth.example.test/example', {
        method: 'POST', headers: { 'content-type': 'application/json' }, body: '{"value":42}',
      }) });
      assert.equal(invalid.status, 400);
      assert.equal(executions, 0);
      const validResponse = await valid.invoke({ request: validRequest() });
      assert.deepEqual(await validResponse.json(), { ok: true });
      assert.equal(executions, 1);
      for (const native of [false, true]) {
        const badOutput = defineHttpOperation('POST', '/example', () => {
          executions++;
          return native ? Response.json({ ok: 'invalid' }) : { ok: 'invalid' };
        }, options);
        const before = executions;
        const response = await badOutput.invoke({ request: validRequest() });
        assert.equal(response.status, 502);
        assert.equal(executions, before + 1);
        const failure = await response.json();
        assert.equal(failure.error.code, 'invalid_upstream_response');
        assert.ok(!JSON.stringify(failure).includes('accepted'));
      }
      const order = [];
      const signed = defineHttpOperation('POST', '/signed', () => {
        order.push('handler');
        return { ok: true };
      }, {
        ...options,
        beforeParse: async request => {
          order.push('verify');
          assert.equal(await request.clone().text(), '{broken');
          return new Response('Unauthorized', { status: 401 });
        },
      });
      const signatureFailure = await signed.invoke({ request: new Request('https://supauth.example.test/signed', {
        method: 'POST', headers: { 'content-type': 'application/json' }, body: '{broken',
      }) });
      assert.equal(signatureFailure.status, 401);
      assert.deepEqual(order, ['verify']);

      const binary = defineHttpOperation('POST', '/binary', async ({ request, body }) => {
        assert.equal(body, undefined);
        return new Response(await request.arrayBuffer(), { headers: { 'content-type': 'application/octet-stream' } });
      }, {
        ...serverContract('migration:binary', {
          contract: {
            request: 'protocol', input: Type.Object({}),
            responses: { 200: { kind: 'binary', contentTypes: ['application/octet-stream'] } },
          },
          beforeValidate: ({ body }) => { assert.equal(body, undefined); },
        }),
        parse: 'none',
      });
      const bytes = new Uint8Array([0, 255, 13, 10, 128]);
      const uploaded = await binary.invoke({ request: new Request('https://supauth.example.test/binary', {
        method: 'POST', headers: { 'content-type': 'application/octet-stream' }, body: bytes,
      }) });
      assert.equal(uploaded.status, 200);
      assert.deepEqual(new Uint8Array(await uploaded.arrayBuffer()), bytes);

      const redirect = defineHttpOperation('GET', '/redirect', () => {
        const headers = new Headers({ location: '/account' });
        headers.append('set-cookie', 'one=1; HttpOnly; Path=/');
        headers.append('set-cookie', 'two=2; HttpOnly; Path=/');
        return new Response(null, { status: 302, headers });
      }, serverContract('migration:redirect', {
        contract: { request: 'none', input: Type.Object({}), responses: { 302: { kind: 'redirect' } } },
      }));
      const redirectRequest = new Request('https://supauth.example.test/redirect', {
        headers: { origin: 'https://console.example.test' },
      });
      const redirected = applyCorsHeaders(redirectRequest,
        await redirect.invoke({ request: redirectRequest }), ['https://console.example.test']);
      assert.equal(redirected.status, 302);
      assert.equal(redirected.headers.get('location'), '/account');
      assert.equal(redirected.headers.getSetCookie().length, 2);
      assert.equal(await redirected.text(), '');
      assert.ok(redirected.headers.get('vary').includes('Origin'));
      console.log('compiled-domain-contracts-ok');
    `;
    const result = Bun.spawnSync([process.execPath, '--no-env-file', '-e', script], {
      cwd: root, env: environment, stdout: 'pipe', stderr: 'pipe', timeout: 15_000,
    });
    const output = new TextDecoder().decode(result.stdout)
      + new TextDecoder().decode(result.stderr);
    expect({ exitCode: result.exitCode, output: result.exitCode === 0 ? '' : output })
      .toEqual({ exitCode: 0, output: '' });
    expect(output).toContain('compiled-domain-contracts-ok');
  });

  it('initializes every compiled module and rolls back failures without leaking resources', () => {
    const script = `
      import assert from 'node:assert/strict';
      const { createCompiledRuntime } = await import('./packages/auth-server/src/compiled-runtime.ts');
      const events = [];
      const token = {};
      const module = (name, overrides = {}) => ({
        name, controllers: [], commands: [], jobs: [],
        createServices: () => ({}),
        ...overrides,
      });
      const runtime = createCompiledRuntime([
        module('__proto__', {
          createServices(deps, imported) {
            assert.equal(Object.getPrototypeOf(imported), null);
            assert.equal(deps.token, token);
            events.push('create:dependency');
            return { token, appInitializer: async () => events.push('app:dependency') };
          },
          initializeServices: async () => events.push('init:dependency'),
          destroyServices: async () => events.push('destroy:dependency'),
        }),
        module('root', {
          createServices(deps, imported) {
            assert.equal(imported.__proto__.token, token);
            events.push('create:root');
            return { appInitializer: async () => events.push('app:root') };
          },
          initializeServices: async () => events.push('init:root'),
          destroyServices: async () => events.push('destroy:root'),
        }),
      ], { deps: { token } });
      await runtime.ready;
      assert.equal(runtime.servicesByModule.__proto__.token, token);
      assert.deepEqual(events, [
        'create:dependency', 'create:root', 'init:dependency', 'init:root',
        'app:dependency', 'app:root',
      ]);
      const close = runtime.close();
      assert.equal(runtime.closed, true);
      assert.equal(runtime.close(), close);
      await close;
      assert.deepEqual(events.slice(-2), ['destroy:root', 'destroy:dependency']);
      await runtime.close();
      assert.equal(events.filter(value => value.startsWith('destroy:')).length, 2);

      let duplicateCreated = false;
      assert.throws(() => createCompiledRuntime([
        module('duplicate', { createServices: () => { duplicateCreated = true; return {}; } }),
        module('duplicate'),
      ]), /Duplicate compiled module/);
      assert.equal(duplicateCreated, false);

      for (const phase of ['create', 'init', 'app']) {
        const destroyed = [];
        const failure = new Error('startup:' + phase);
        const failed = createCompiledRuntime([
          module('dependency', { destroyServices: async () => destroyed.push('dependency') }),
          module('failing', {
            createServices() {
              if (phase === 'create') throw failure;
              return { appInitializer: () => { if (phase === 'app') throw failure; } };
            },
            initializeServices: async () => { if (phase === 'init') throw failure; },
            destroyServices: async () => destroyed.push('failing'),
          }),
        ]);
        await assert.rejects(failed.ready, error => error === failure);
        assert.equal(failed.closed, true);
        assert.deepEqual(destroyed, phase === 'create' ? ['dependency'] : ['failing', 'dependency']);
        await failed.close();
        assert.equal(destroyed.length, phase === 'create' ? 1 : 2);
      }

      const cleanupEvents = [];
      const startupFailure = new Error('startup');
      const cleanupFailure = new Error('cleanup');
      const failedCleanup = createCompiledRuntime([
        module('dependency', { destroyServices: async () => cleanupEvents.push('dependency') }),
        module('root', {
          initializeServices: async () => { throw startupFailure; },
          destroyServices: async () => { cleanupEvents.push('root'); throw cleanupFailure; },
        }),
      ]);
      await assert.rejects(failedCleanup.ready, error =>
        error instanceof AggregateError && error.cause === startupFailure
        && error.errors[0] === startupFailure
        && error.errors[1] instanceof AggregateError
        && error.errors[1].errors[0] === cleanupFailure);
      await assert.rejects(failedCleanup.close(), error =>
        error instanceof AggregateError && error.errors[0] === cleanupFailure);
      assert.deepEqual(cleanupEvents, ['root', 'dependency']);

      let release;
      const pending = new Promise(resolve => { release = resolve; });
      const waitingEvents = [];
      const waiting = createCompiledRuntime([module('pending', {
        initializeServices: async () => { waitingEvents.push('init'); await pending; },
        destroyServices: async () => waitingEvents.push('destroy'),
      })]);
      const waitingClose = waiting.close();
      await Promise.resolve();
      assert.deepEqual(waitingEvents, ['init']);
      release();
      await waitingClose;
      assert.deepEqual(waitingEvents, ['init', 'destroy']);

      let startRequest;
      let finishRequest;
      const requestStarted = new Promise(resolve => { startRequest = resolve; });
      const requestFinished = new Promise(resolve => { finishRequest = resolve; });
      const requestEvents = [];
      const serving = createCompiledRuntime([module('serving', {
        destroyServices: async () => requestEvents.push('destroy'),
      })]);
      const request = serving.run(async () => {
        requestEvents.push('start');
        startRequest();
        await requestFinished;
        requestEvents.push('finish');
        throw new Error('request-failure');
      });
      const rejectedRequest = assert.rejects(request, /request-failure/);
      await requestStarted;
      const drained = serving.close();
      await assert.rejects(serving.run(() => { throw new Error('must not run'); }), /runtime is closed/);
      assert.deepEqual(requestEvents, ['start']);
      finishRequest();
      await Promise.all([drained, rejectedRequest]);
      assert.deepEqual(requestEvents, ['start', 'finish', 'destroy']);

      let finishInit;
      const initPending = new Promise(resolve => { finishInit = resolve; });
      let workCalled = false;
      const initializing = createCompiledRuntime([module('initializing', {
        initializeServices: () => initPending,
      })]);
      const queued = initializing.run(() => { workCalled = true; });
      const queuedRejection = assert.rejects(queued, /runtime is closed/);
      await Promise.resolve();
      assert.equal(workCalled, false);
      const initializingClose = initializing.close();
      finishInit();
      await Promise.all([queuedRejection, initializingClose]);
      assert.equal(workCalled, false);

      for (const failCleanup of [false, true]) {
        const selectionFailure = new Error('Missing compiled HTTP application');
        const selectionCleanupFailure = new Error('selection cleanup');
        let selectionDestroyed = 0;
        const selection = createCompiledRuntime([module('invalid-http', {
          destroyServices: async () => {
            selectionDestroyed++;
            if (failCleanup) throw selectionCleanupFailure;
          },
        })]);
        await assert.rejects(selection.resolve(() => { throw selectionFailure; }), error =>
          failCleanup
            ? error instanceof AggregateError && error.cause === selectionFailure
              && error.errors[0] === selectionFailure
              && error.errors[1] instanceof AggregateError
              && error.errors[1].errors[0] === selectionCleanupFailure
            : error === selectionFailure);
        assert.equal(selection.closed, true);
        assert.equal(selectionDestroyed, 1);
      }
      console.log('compiled-lifecycle-ok');
    `;
    const result = Bun.spawnSync([process.execPath, '--no-env-file', '-e', script], {
      cwd: root, env: environment, stdout: 'pipe', stderr: 'pipe', timeout: 15_000,
    });
    const output = new TextDecoder().decode(result.stdout)
      + new TextDecoder().decode(result.stderr);
    expect({ exitCode: result.exitCode, output: result.exitCode === 0 ? '' : output })
      .toEqual({ exitCode: 0, output: '' });
    expect(output).toContain('compiled-lifecycle-ok');
  });
});
