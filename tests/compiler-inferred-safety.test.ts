import { expect, test } from 'bun:test';
import { resolve } from 'node:path';
import ts from 'typescript';
import { checkProject, compileOptionsFromConfig, loadSupacloudConfig } from '@supacloud/compiler';
import { inspectInferredSafety } from '../scripts/inferred-safety.js';
import { inspectStrictOptions } from '../scripts/static-safety.js';

const root = resolve(import.meta.dir, '..');
const server = resolve(root, 'packages/auth-server');
const application = resolve(server, 'generated/application.ts');

test('generated application has no inferred leaks and rejects the original array and invocation regressions', async () => {
  const parsed = ts.getParsedCommandLineOfConfigFile(resolve(server, 'tsconfig.json'), { noEmit: true }, {
    ...ts.sys,
    onUnRecoverableConfigFileDiagnostic(diagnostic) {
      throw new Error(ts.flattenDiagnosticMessageText(diagnostic.messageText, '\n'));
    },
  });
  if (!parsed) throw new Error('Missing auth-server project');
  expect(parsed.errors).toEqual([]);
  expect(inspectStrictOptions(parsed.options)).toEqual([]);
  const source = await Bun.file(application).text();
  const inspect = (text: string) => {
    const host = ts.createCompilerHost(parsed.options);
    const original = host.getSourceFile.bind(host);
    host.getSourceFile = (file, ...args) => file === application
      ? ts.createSourceFile(file, text, ts.ScriptTarget.ESNext, true)
      : original(file, ...args);
    const program = ts.createProgram([application], parsed.options, host);
    expect(ts.getPreEmitDiagnostics(program).map(diagnostic => ({
      code: diagnostic.code,
      message: ts.flattenDiagnosticMessageText(diagnostic.messageText, '\n'),
    }))).toEqual([]);
    return inspectInferredSafety(program, new Set([application]));
  };
  expect(inspect(source)).toEqual([]);
  // 反向变异只存在于内存，证明两处模板修复不是通过放宽检查或包装结果通过。
  const originalArrays = source
    .replaceAll('isUnknownArray(value) ?', 'Array.isArray(value) ?')
    .replace('if (isUnknownArray(group))', 'if (Array.isArray(group))')
    .replace("isUnknownArray(destroyRef['_teardowns'])", "Array.isArray(destroyRef['_teardowns'])");
  expect(inspect(originalArrays).map(issue => issue.code)).toEqual(Array.from({ length: 5 }, () => 'any_binding'));
  const originalInvokers = source.replaceAll('if (!isFunction(handler))', 'if (typeof handler !== "function")');
  const invocationIssues = inspect(originalInvokers);
  expect(invocationIssues).toHaveLength(270);
  expect(invocationIssues.every(issue => issue.code === 'promise_any_return')).toBe(true);
}, 60_000);

test('library renderer matches the normally generated CLI artifacts', async () => {
  const options = compileOptionsFromConfig(await loadSupacloudConfig(server), server);
  const result = await checkProject(options);
  expect(result.diagnostics.filter(diagnostic => diagnostic.severity === 'error')).toEqual([]);
  expect(result.upToDate).toBe(true);
  expect(result.mismatches).toEqual([]);
}, 60_000);

test('generated invoker and array lifecycle guards preserve receivers, return identity and failures', () => {
  const probe = Bun.spawnSync([process.execPath, '--no-env-file', '--no-install', '--config=/dev/null', '-e', `
    import assert from 'node:assert/strict';
    import { runInNewContext } from 'node:vm';
    import ts from 'typescript';
    const source = await Bun.file(${JSON.stringify(application)}).text();
    const file = ts.createSourceFile('application.ts', source, ts.ScriptTarget.ESNext, true);
    const names = new Set([
      'isRecord', 'isFunction', 'isUnknownArray', 'destroyScopeInstances',
      'initializeServiceInstances', 'destroyServiceInstances', 'initializeApplication', 'destroyApplication',
    ]);
    const helpers = file.statements.filter(node => ts.isFunctionDeclaration(node) && node.name && names.has(node.name.text))
      .map(node => node.getText(file).replace(/^export /, '')).join('\\n');
    const invokers = [];
    const visit = node => {
      if (ts.isPropertyAssignment(node) && node.name.getText(file) === 'invoker') invokers.push(node.initializer);
      ts.forEachChild(node, visit);
    };
    visit(file);
    assert.equal(invokers.length, 270);
    const snippet = '(() => {' + helpers + '\\n const scopeDestructions = new WeakMap(); return {' +
      'destroyScopeInstances, initializeServiceInstances, destroyServiceInstances, initializeApplication, destroyApplication,' +
      'invoker: ' + invokers[0].getText(file) + '}; })()';
    const script = ts.transpileModule(snippet, { compilerOptions: { target: ts.ScriptTarget.ESNext } }).outputText;
    const generated = runInNewContext(script, { WeakMap, Set, Reflect, AggregateError, TypeError });
    const input = { sentinel: true };
    const receipt = { id: 'result' };
    const receiver = { postLogin(value) { assert.equal(this, receiver); assert.equal(value, input); return receipt; } };
    assert.equal(await generated.invoker(receiver, { context: input }), receipt);
    assert.equal(await generated.invoker(receiver, input), receipt);
    const native = new Response('native');
    receiver.postLogin = function(value) { assert.equal(this, receiver); assert.equal(value, input); return Promise.resolve(native); };
    assert.equal(await generated.invoker(receiver, { context: input }), native);
    const failure = new Error('original failure');
    receiver.postLogin = function() { assert.equal(this, receiver); throw failure; };
    await assert.rejects(generated.invoker(receiver, { context: input }), error => error === failure);
    receiver.postLogin = function() { assert.equal(this, receiver); return Promise.reject(failure); };
    await assert.rejects(generated.invoker(receiver, { context: input }), error => error === failure);
    await assert.rejects(generated.invoker(null, {}), /not an object/);
    await assert.rejects(generated.invoker({ postLogin: 1 }, {}), /not callable/);

    const events = [];
    const first = { onInit() { assert.equal(this, first); events.push('init'); },
      onDestroy() { assert.equal(this, first); events.push('destroy'); } };
    const second = { ngOnDestroy() { assert.equal(this, second); events.push('legacy'); } };
    const services = { multi: [first, second, first, 42], nonArray: first };
    const plan = [{ key: 'multi', index: 0 }, { key: 'multi', index: 1 },
      { key: 'multi', index: 2 }, { key: 'multi', index: 3 }, { key: 'nonArray', index: 0 },
      { key: 'missing', index: 0 }];
    await generated.initializeServiceInstances(services, plan);
    assert.deepEqual(events, ['init']);
    events.length = 0;
    await generated.destroyServiceInstances(services, plan);
    assert.deepEqual(events, ['destroy', 'legacy']);
    events.length = 0;
    await generated.destroyScopeInstances(services, plan);
    await generated.destroyScopeInstances(services, plan);
    assert.deepEqual(events, ['destroy', 'legacy']);
    await assert.rejects(generated.initializeServiceInstances({ one: [{ onInit() { throw failure; } }] },
      [{ key: 'one', index: 0 }]), error => error === failure);
    for (const destroy of [generated.destroyServiceInstances, generated.destroyScopeInstances]) {
      let continued = false;
      await assert.rejects(destroy({ multi: [
        { onDestroy() { continued = true; } }, { onDestroy() { throw failure; } },
      ] }, [{ key: 'multi', index: 0 }, { key: 'multi', index: 1 }]),
      error => error instanceof AggregateError && error.errors[0] === failure);
      assert.equal(continued, true);
    }
    events.length = 0;
    await generated.initializeApplication({
      environmentInitializer: [() => events.push('environment'), 42],
      appInitializer: () => events.push('application'),
    });
    await generated.destroyApplication({ destroyRef: {
      _teardowns: [() => events.push('first'), null, () => events.push('last')],
    } });
    assert.deepEqual(events, ['environment', 'application', 'last', 'first']);
    await assert.rejects(generated.initializeApplication({ appInitializer: [() => { throw failure; }] }),
      error => error === failure);
    await assert.rejects(generated.destroyApplication({ destroyRef: { _teardowns: [() => { throw failure; }] } }),
      error => error === failure);
    console.log('invocation and lifecycle behavior preserved');
  `], { cwd: root, stdout: 'pipe', stderr: 'pipe', timeout: 20_000 });
  expect({ exit: probe.exitCode, stderr: new TextDecoder().decode(probe.stderr) }).toEqual({ exit: 0, stderr: '' });
  expect(new TextDecoder().decode(probe.stdout)).toContain('invocation and lifecycle behavior preserved');
});
