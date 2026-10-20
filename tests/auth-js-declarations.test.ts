import { expect, it } from 'bun:test';
import { dirname, join, resolve } from 'node:path';
import ts from 'typescript';

const root = resolve(import.meta.dir, '..');
const supabaseRoot = dirname(Bun.resolveSync('@supabase/supabase-js/package.json', root));
const authRoot = dirname(Bun.resolveSync('@supabase/auth-js/package.json', supabaseRoot));

for (const entry of ['main', 'module']) {
  it(`keeps installed auth-js passkey declarations strict (${entry})`, () => {
    const declarationRoot = join(authRoot, 'dist', entry, 'lib');
    const positivePath = join(root, `.auth-js-${entry}-positive.ts`);
    const negativePath = join(root, `.auth-js-${entry}-negative.ts`);
    const imports = `
      import type { PasskeyRegistrationVerifyParams, PasskeyAuthenticationVerifyParams } from ${JSON.stringify(join(declarationRoot, 'types.js'))};
      import type { RegistrationResponseInput, AuthenticationResponseInput } from ${JSON.stringify(join(declarationRoot, 'webauthn.js'))};
    `;
    const fixtures = new Map([
      [positivePath, `${imports}
        type Equal<A, B> = (<T>() => T extends A ? 1 : 2) extends (<T>() => T extends B ? 1 : 2) ? true : false;
        type Assert<T extends true> = T;
        type Registration = Assert<Equal<PasskeyRegistrationVerifyParams['credential'], RegistrationResponseInput>>;
        type Authentication = Assert<Equal<PasskeyAuthenticationVerifyParams['credential'], AuthenticationResponseInput>>;
      `],
      [negativePath, `${imports}
        const registration: PasskeyRegistrationVerifyParams['credential'] = 1;
        const authentication: PasskeyAuthenticationVerifyParams['credential'] = 1;
      `],
    ]);
    const options: ts.CompilerOptions = {
      strict: true,
      exactOptionalPropertyTypes: true,
      noUncheckedIndexedAccess: true,
      noPropertyAccessFromIndexSignature: true,
      skipLibCheck: false,
      noEmit: true,
      target: ts.ScriptTarget.ESNext,
      module: ts.ModuleKind.ESNext,
      moduleResolution: ts.ModuleResolutionKind.Bundler,
      lib: ['lib.esnext.d.ts', 'lib.dom.d.ts'],
      types: ['bun'],
      typeRoots: [join(root, 'node_modules', '@types')],
    };
    const host = ts.createCompilerHost(options);
    const originalGetSourceFile = host.getSourceFile.bind(host);
    host.getSourceFile = (fileName, languageVersion, onError, shouldCreateNewSourceFile) => {
      const source = fixtures.get(fileName);
      return source === undefined
        ? originalGetSourceFile(fileName, languageVersion, onError, shouldCreateNewSourceFile)
        : ts.createSourceFile(fileName, source, languageVersion, true);
    };
    const program = ts.createProgram([...fixtures.keys()], options, host);
    const diagnostics = ts.getPreEmitDiagnostics(program);
    expect(diagnostics.filter(diagnostic => diagnostic.file?.fileName !== negativePath).map(diagnostic => ({
      file: diagnostic.file?.fileName,
      code: diagnostic.code,
      message: ts.flattenDiagnosticMessageText(diagnostic.messageText, ' '),
    }))).toEqual([]);
    expect(diagnostics.filter(diagnostic => diagnostic.file?.fileName === negativePath)
      .map(diagnostic => diagnostic.code)).toEqual([2322, 2322]);
    expect(program.getSourceFiles().some(source =>
      source.fileName === join(declarationRoot, 'types.d.ts'))).toBe(true);
  }, 60_000);
}
