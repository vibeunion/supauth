import { describe, expect, test } from 'bun:test';
import ts from 'typescript';
import { inspectInferredSafety } from '../scripts/inferred-safety.js';

function inspect(text: string, file = '/__supauth_inferred_probe__.ts') {
  const options: ts.CompilerOptions = {
    strict: true, noEmit: true, target: ts.ScriptTarget.ESNext,
    allowJs: true, checkJs: true, skipLibCheck: false,
  };
  const host = ts.createCompilerHost(options);
  const original = host.getSourceFile.bind(host);
  host.getSourceFile = (name, ...args) => name === file
    ? ts.createSourceFile(file, text, ts.ScriptTarget.ESNext, true)
    : original(name, ...args);
  const program = ts.createProgram([file], options, host);
  return inspectInferredSafety(program, new Set([file]));
}

describe('inferred type safety', () => {
  test('rejects standard-library any that strict compilation alone accepts', () => {
    const issues = inspect('const payload = JSON.parse("{}"); const dictionary = Object.create(null);');
    expect(issues.map(issue => issue.code)).toEqual(['any_binding', 'any_binding']);
  });

  test('checks destructuring and untyped rejection callbacks', () => {
    const issues = inspect('const { value: renamed } = JSON.parse("{}"); Promise.reject(1).catch(error => error);');
    expect(issues.filter(issue => issue.code === 'any_binding')).toHaveLength(2);
    expect(issues.filter(issue => issue.code === 'any_return')).toHaveLength(1);
  });

  test('checks function, method and asynchronous inferred return types', () => {
    const issues = inspect(`
      function value() { return JSON.parse("{}"); }
      const result = { read() { return JSON.parse("{}"); }, get data() { return JSON.parse("{}"); } };
      async function request() { return JSON.parse("{}"); }
    `);
    expect(issues.filter(issue => issue.code === 'any_return')).toHaveLength(3);
    expect(issues.filter(issue => issue.code === 'promise_any_return')).toHaveLength(1);
  });

  test('allows immediate unknown containment, narrowing and typed generic functions', () => {
    expect(inspect(`
      const payload: unknown = JSON.parse("{}");
      const dictionary: unknown = Object.create(null);
      async function request(): Promise<unknown> { return JSON.parse("{}"); }
      function identity<T>(value: T): T { return value; }
      Promise.reject(1).catch((error: unknown): unknown => error);
      if (typeof payload === "string") payload.toUpperCase();
    `)).toEqual([]);
  });

  test('uses JavaScript JSDoc narrowing without scanning fixture string contents', () => {
    expect(inspect('/** @type {unknown} */ const value = JSON.parse("{}"); const text = "let value: any";',
      '/__supauth_inferred_probe__.js')).toEqual([]);
  });
});
