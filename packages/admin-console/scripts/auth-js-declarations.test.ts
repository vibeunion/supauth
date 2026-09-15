import { afterAll, beforeAll, describe, expect, test } from 'bun:test';
import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import {
  cpSync, mkdirSync, mkdtempSync, readFileSync, readdirSync,
  rmSync, symlinkSync, writeFileSync,
} from 'node:fs';
import { createRequire } from 'node:module';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import ts from 'typescript';

const require = createRequire(import.meta.url);
const installed = dirname(require.resolve('@supabase/auth-js/package.json'));
const patch = join(fileURLToPath(new URL('../../../patches/', import.meta.url)), '@supabase%2Fauth-js@2.113.0.patch');
const options: ts.CompilerOptions = {
  strict: true,
  noUncheckedIndexedAccess: true,
  exactOptionalPropertyTypes: true,
  noImplicitOverride: true,
  noPropertyAccessFromIndexSignature: true,
  noFallthroughCasesInSwitch: true,
  skipLibCheck: false,
  noEmit: true,
  target: ts.ScriptTarget.ES2022,
  module: ts.ModuleKind.ESNext,
  moduleResolution: ts.ModuleResolutionKind.Bundler,
  lib: ['lib.es2022.d.ts', 'lib.dom.d.ts'],
  types: [],
};

let scratch: string | undefined;

function directory(): string {
  if (scratch === undefined) throw new Error('Fixture directory was not initialized');
  return scratch;
}

function applyPatch(cwd: string, args: string[]): void {
  const result = spawnSync('git', ['apply', ...args, patch], { cwd, encoding: 'utf8' });
  if (result.status !== 0) throw new Error(result.stderr || 'Dependency patch failed');
}

function runtimeHashes(root: string, relative = ''): string[] {
  return readdirSync(join(root, relative), { withFileTypes: true }).flatMap((entry) => {
    const path = join(relative, entry.name);
    if (entry.isDirectory()) return runtimeHashes(root, path);
    if (!entry.isFile() || !entry.name.endsWith('.js')) return [];
    return [`${path}:${createHash('sha256').update(readFileSync(join(root, path))).digest('hex')}`];
  }).sort();
}

function diagnose(source: string, flavor: 'main' | 'module', packageName = 'patched') {
  const fixture = join(directory(), `consumer-${flavor}-${packageName}.ts`);
  const prefix = `./${packageName}/dist/${flavor}`;
  writeFileSync(fixture, source.replaceAll('__PACKAGE__', prefix));
  const program = ts.createProgram([fixture, join(directory(), packageName, 'dist', flavor, 'index.d.ts')], options);
  return ts.getPreEmitDiagnostics(program).map((diagnostic) => ({
    code: diagnostic.code,
    file: diagnostic.file?.fileName,
    line: diagnostic.file && diagnostic.start !== undefined
      ? diagnostic.file.getLineAndCharacterOfPosition(diagnostic.start).line + 1
      : undefined,
    message: ts.flattenDiagnosticMessageText(diagnostic.messageText, '\n'),
    isConsumer: diagnostic.file?.fileName === fixture,
  }));
}

beforeAll(() => {
  const manifest: unknown = JSON.parse(readFileSync(join(installed, 'package.json'), 'utf8'));
  if (typeof manifest !== 'object' || manifest === null
    || !('name' in manifest) || manifest.name !== '@supabase/auth-js'
    || !('version' in manifest) || manifest.version !== '2.113.0') {
    throw new Error('The reviewed auth-js declaration patch requires @supabase/auth-js@2.113.0');
  }
  scratch = mkdtempSync(join(tmpdir(), 'auth-js-declarations-'));
  const pristine = join(directory(), 'pristine');
  cpSync(installed, pristine, { recursive: true });
  const check = spawnSync('git', ['apply', '--check', patch], { cwd: pristine, encoding: 'utf8' });
  if (check.status !== 0) {
    // 集成补丁后也重建原始对照组，不修改实际安装目录。
    applyPatch(pristine, ['--reverse', '--check']);
    applyPatch(pristine, ['--reverse']);
  }
  const patched = join(directory(), 'patched');
  cpSync(pristine, patched, { recursive: true });
  applyPatch(patched, ['--check']);
  applyPatch(patched, []);
  mkdirSync(join(directory(), 'node_modules'));
  const dependencyRequire = createRequire(join(installed, 'package.json'));
  symlinkSync(dirname(dependencyRequire.resolve('tslib/package.json')), join(directory(), 'node_modules', 'tslib'), 'dir');
});

afterAll(() => {
  if (scratch !== undefined) rmSync(scratch, { recursive: true, force: true });
});

const positive = `
import type {
  RegistrationCredentialNative, AuthenticationCredentialNative, RegistrationResponseJSON, AuthenticationResponseJSON,
  RegistrationResponseLegacy, AuthenticationResponseLegacy, RegistrationCredentialForSerialization,
  AuthenticationCredentialForSerialization, AuthenticationExtensionsClientOutputsJSON,
  RegistrationResponseLegacyInput, AuthenticationResponseLegacyInput
} from '__PACKAGE__/lib/webauthn.dom';
import { createCredential, getCredential, serializeCredentialCreationResponse, serializeCredentialRequestResponse } from '__PACKAGE__/lib/webauthn';
import type { ServerCredentialResponse } from '__PACKAGE__/lib/webauthn';
import type { PasskeyRegistrationVerifyParams, PasskeyAuthenticationVerifyParams } from '__PACKAGE__/lib/types';
declare const registration: RegistrationCredentialNative;
declare const authentication: AuthenticationCredentialNative;
export const domRegistration: PublicKeyCredential = registration;
export const domAuthentication: PublicKeyCredential = authentication;
export const nativeRegistration: globalThis.RegistrationResponseJSON = registration.toJSON();
export const nativeAuthentication: globalThis.AuthenticationResponseJSON = authentication.toJSON();
export const algorithm: number = registration.toJSON().response.publicKeyAlgorithm;
export const transports: string[] = registration.toJSON().response.transports;
export const authenticatorData: string = registration.toJSON().response.authenticatorData;
export const extensions: AuthenticationExtensionsClientOutputsJSON = {
  appid: true, credProps: { rk: true }, hmacCreateSecret: true,
  largeBlob: { blob: 'AQ', supported: true, written: false },
  prf: { enabled: true, results: { first: 'AQ', second: 'Ag' } },
};
declare const registrationJSON: RegistrationResponseJSON & { extra: 'preserved' };
declare const authenticationJSON: AuthenticationResponseJSON & { extra: 'preserved' };
export const nativeExtra: 'preserved' = serializeCredentialCreationResponse({ toJSON: () => registrationJSON }).extra;
export const nativeAuthExtra: 'preserved' = serializeCredentialRequestResponse({ toJSON: () => authenticationJSON }).extra;
const binary = new ArrayBuffer(1);
const rawExtensions: AuthenticationExtensionsClientOutputs = {
  appid: true, credProps: { rk: true }, hmacCreateSecret: true,
  largeBlob: { blob: binary, supported: true, written: false },
  prf: { enabled: true, results: { first: binary, second: binary } },
};
const legacyRegistration = {
  id: 'AQ', response: { attestationObject: binary, clientDataJSON: binary },
  getClientExtensionResults: () => rawExtensions, authenticatorAttachment: null,
};
const legacyAuthentication = {
  id: 'AQ', response: { authenticatorData: binary, clientDataJSON: binary, signature: binary, userHandle: null },
  getClientExtensionResults: () => rawExtensions,
};
export const legacy: RegistrationResponseLegacy = serializeCredentialCreationResponse(legacyRegistration);
export const legacyAuth: AuthenticationResponseLegacy = serializeCredentialRequestResponse(legacyAuthentication);
export const legacyBlob: ArrayBuffer | undefined = legacy.clientExtensionResults.largeBlob?.blob;
export const legacyFirst: BufferSource | undefined = legacyAuth.clientExtensionResults.prf?.results?.first;
export const nativeBlob: string | undefined = serializeCredentialCreationResponse(registration).clientExtensionResults.largeBlob?.blob;
export const nativeFirst: string | undefined = serializeCredentialRequestResponse(authentication).clientExtensionResults.prf?.results?.first;
declare const uncertain: RegistrationCredentialForSerialization;
declare const uncertainAuth: AuthenticationCredentialForSerialization;
export const unionBlob: string | ArrayBuffer | undefined = serializeCredentialCreationResponse(uncertain).clientExtensionResults.largeBlob?.blob;
export const unionFirst: string | BufferSource | undefined = serializeCredentialRequestResponse(uncertainAuth).clientExtensionResults.prf?.results?.first;
export const legacyRequest: PasskeyRegistrationVerifyParams = { challenge_id: 'id', credential: legacy };
export const nativeRequest: PasskeyRegistrationVerifyParams = { challenge_id: 'id', credential: registrationJSON };
export const legacyAuthRequest: PasskeyAuthenticationVerifyParams = { challenge_id: 'id', credential: legacyAuth };
export const nativeAuthRequest: PasskeyAuthenticationVerifyParams = { challenge_id: 'id', credential: authenticationJSON };
const oldRegistrationInput: RegistrationResponseLegacyInput = {
  id: 'AQ', rawId: 'AQ', type: 'public-key', clientExtensionResults: {},
  response: { attestationObject: 'AQ', clientDataJSON: 'AQ' },
};
const oldRegistrationWithMetadata: RegistrationResponseLegacyInput = {
  ...oldRegistrationInput,
  clientExtensionResults: rawExtensions,
  response: { attestationObject: 'AQ', clientDataJSON: 'AQ', transports: ['internal'] },
};
const oldAuthenticationInput: AuthenticationResponseLegacyInput = {
  id: 'AQ', rawId: 'AQ', type: 'public-key', clientExtensionResults: rawExtensions,
  response: { authenticatorData: 'AQ', clientDataJSON: 'AQ', signature: 'AQ' },
};
export const oldWireRegistration: PasskeyRegistrationVerifyParams = { challenge_id: 'id', credential: oldRegistrationInput };
export const oldWireRegistrationMetadata: PasskeyRegistrationVerifyParams = { challenge_id: 'id', credential: oldRegistrationWithMetadata };
export const oldWireAuthentication: PasskeyAuthenticationVerifyParams = { challenge_id: 'id', credential: oldAuthenticationInput };
export const oldWireUnion: ServerCredentialResponse = oldRegistrationInput;
export const oldAuthWireUnion: ServerCredentialResponse = oldAuthenticationInput;
export function fromCreation(result: Awaited<ReturnType<typeof createCredential>>): string | ArrayBuffer | undefined {
  if (result.error !== null) throw result.error;
  return serializeCredentialCreationResponse(result.data).clientExtensionResults.largeBlob?.blob;
}
export function fromAuthentication(result: Awaited<ReturnType<typeof getCredential>>): string | BufferSource | undefined {
  if (result.error !== null) throw result.error;
  return serializeCredentialRequestResponse(result.data).clientExtensionResults.prf?.results?.first;
}
`;

const negative = `
import type {
  RegistrationResponseJSON, AuthenticationResponseJSON, RegistrationResponseLegacy,
  AuthenticationResponseLegacy, AuthenticationExtensionsClientOutputsJSON,
  RegistrationCredentialForSerialization, AuthenticationCredentialForSerialization,
  PublicKeyCredentialFuture, RegistrationCredential, AuthenticationCredential,
  RegistrationResponseLegacyInput, AuthenticationResponseLegacyInput
} from '__PACKAGE__/lib/webauthn.dom';
import { serializeCredentialCreationResponse, serializeCredentialRequestResponse } from '__PACKAGE__/lib/webauthn';
declare const native: RegistrationResponseJSON;
declare const nativeAuth: AuthenticationResponseJSON;
declare const legacy: RegistrationResponseLegacy;
declare const legacyAuth: AuthenticationResponseLegacy;
declare const uncertain: RegistrationCredentialForSerialization;
declare const uncertainAuth: AuthenticationCredentialForSerialization;
declare const createdCredential: RegistrationCredential;
declare const retrievedCredential: AuthenticationCredential;
declare const nativeCredential: PublicKeyCredentialFuture;
declare const oldRegistrationInput: RegistrationResponseLegacyInput;
declare const oldAuthenticationInput: AuthenticationResponseLegacyInput;
const binary = new ArrayBuffer(1);
const badBlob: AuthenticationExtensionsClientOutputsJSON = { largeBlob: { blob: binary } }; // REJECT
const badFirst: AuthenticationExtensionsClientOutputsJSON = { prf: { results: { first: binary } } }; // REJECT
const badSecond: AuthenticationExtensionsClientOutputsJSON = { prf: { results: { first: 'AQ', second: binary } } }; // REJECT
const badFlag: AuthenticationExtensionsClientOutputsJSON = { hmacCreateSecret: 'yes' }; // REJECT
const badEnabled: AuthenticationExtensionsClientOutputsJSON = { prf: { enabled: 'yes' } }; // REJECT
const badSupport: AuthenticationExtensionsClientOutputsJSON = { largeBlob: { supported: 'yes' } }; // REJECT
const badWritten: AuthenticationExtensionsClientOutputsJSON = { largeBlob: { written: 'yes' } }; // REJECT
const missingFirst: AuthenticationExtensionsClientOutputsJSON = { prf: { results: { second: 'AQ' } } }; // REJECT
const missingMetadata: RegistrationResponseJSON['response'] = { clientDataJSON: 'AQ', attestationObject: 'AQ' }; // REJECT
const nativeAsBinary: ArrayBuffer | undefined = native.clientExtensionResults.largeBlob?.blob; // REJECT
const nativePrfAsBinary: BufferSource | undefined = nativeAuth.clientExtensionResults.prf?.results?.first; // REJECT
const legacyAsJSON: string | undefined = legacy.clientExtensionResults.largeBlob?.blob; // REJECT
const legacyPrfAsJSON: string | undefined = legacyAuth.clientExtensionResults.prf?.results?.first; // REJECT
const missingFallbackField: string = legacy.response.authenticatorData; // REJECT
const missingFallbackTransport: string[] = legacy.response.transports; // REJECT
const missingFallbackAlgorithm: number = legacy.response.publicKeyAlgorithm; // REJECT
const legacyNative: RegistrationResponseJSON = legacy; // REJECT
const undefinedJSONAttachment: RegistrationResponseJSON = { ...native, authenticatorAttachment: undefined }; // REJECT
const badNativeGeneric: PublicKeyCredentialFuture<RegistrationResponseLegacy> = legacy; // REJECT
const uncertainAsNative: RegistrationResponseJSON = serializeCredentialCreationResponse(uncertain); // REJECT
const uncertainAuthAsNative: AuthenticationResponseJSON = serializeCredentialRequestResponse(uncertainAuth); // REJECT
serializeCredentialCreationResponse({ toJSON: () => legacy }); // REJECT
serializeCredentialRequestResponse({ toJSON: () => legacyAuth }); // REJECT
serializeCredentialCreationResponse({ toJSON: () => ({ invalid: true }) }); // REJECT
createdCredential.toJSON(); // REJECT
retrievedCredential.toJSON(); // REJECT
const createdAsNative: RegistrationResponseJSON = serializeCredentialCreationResponse(createdCredential); // REJECT
const retrievedAsNative: AuthenticationResponseJSON = serializeCredentialRequestResponse(retrievedCredential); // REJECT
nativeCredential.parseCreationOptionsFromJSON({}); // REJECT
nativeCredential.parseRequestOptionsFromJSON({}); // REJECT
nativeCredential.isConditionalMediationAvailable(); // REJECT
serializeCredentialCreationResponse({ toJSON: () => oldRegistrationInput }); // REJECT
serializeCredentialRequestResponse({ toJSON: () => oldAuthenticationInput }); // REJECT
const oldInputAsExactOutput: RegistrationResponseLegacy = oldRegistrationInput; // REJECT
const oldAuthInputAsExactOutput: AuthenticationResponseLegacy = oldAuthenticationInput; // REJECT
`;

const runtime = `
import { serializeCredentialCreationResponse, serializeCredentialRequestResponse } from '__PACKAGE__/lib/webauthn.js';
import type { RegistrationResponseJSON, AuthenticationResponseJSON } from '__PACKAGE__/lib/webauthn.dom';
const bytes = new Uint8Array([1, 2, 3]).buffer;
const rawExtensions = {
  appid: true, credProps: { rk: true }, hmacCreateSecret: true,
  largeBlob: { blob: bytes, supported: true, written: false },
  prf: { enabled: true, results: { first: bytes, second: bytes } },
};
const jsonExtensions = {
  appid: true, credProps: { rk: true }, hmacCreateSecret: true,
  largeBlob: { blob: 'AQID', supported: true, written: false },
  prf: { enabled: true, results: { first: 'AQID', second: 'AQID' } },
};
const nativeRegistration = {
  id: 'AQID', rawId: 'AQID', type: 'public-key', clientExtensionResults: jsonExtensions,
  response: { attestationObject: 'AQID', clientDataJSON: 'AQID', authenticatorData: 'AQID', transports: ['internal'], publicKeyAlgorithm: -7 },
} satisfies RegistrationResponseJSON;
const nativeAuthentication = {
  id: 'AQID', rawId: 'AQID', type: 'public-key', clientExtensionResults: jsonExtensions,
  response: { authenticatorData: 'AQID', clientDataJSON: 'AQID', signature: 'AQID' },
} satisfies AuthenticationResponseJSON;
const nativeRegResult = serializeCredentialCreationResponse({ toJSON() { return nativeRegistration; } });
const nativeAuthResult = serializeCredentialRequestResponse({ toJSON() { return nativeAuthentication; } });
if (nativeRegResult !== nativeRegistration || nativeAuthResult !== nativeAuthentication) throw new Error('Native identity changed');
const legacy = serializeCredentialCreationResponse({
  id: 'AQID', response: { attestationObject: bytes, clientDataJSON: bytes },
  getClientExtensionResults: () => rawExtensions, authenticatorAttachment: null,
});
const legacyAuth = serializeCredentialRequestResponse({
  id: 'AQID', response: { authenticatorData: bytes, clientDataJSON: bytes, signature: bytes, userHandle: null },
  getClientExtensionResults: () => rawExtensions,
});
if (legacy.clientExtensionResults !== rawExtensions || legacyAuth.clientExtensionResults !== rawExtensions) throw new Error('Fallback cloned or encoded extensions');
if (legacy.clientExtensionResults.largeBlob?.blob !== bytes || legacyAuth.clientExtensionResults.prf?.results?.first !== bytes) throw new Error('Binary fallback changed');
if (legacy.response.attestationObject !== 'AQID' || legacyAuth.response.signature !== 'AQID') throw new Error('Fallback response encoding changed');
if (Object.keys(legacy.response).sort().join(',') !== 'attestationObject,clientDataJSON') throw new Error('Fallback invented registration metadata');
if (!Object.hasOwn(legacy, 'authenticatorAttachment') || legacy.authenticatorAttachment !== undefined) throw new Error('Attachment absence not represented accurately');
if (!Object.hasOwn(legacyAuth.response, 'userHandle') || legacyAuth.response.userHandle !== undefined) throw new Error('User handle absence not represented accurately');
const legacyWithHandle = serializeCredentialRequestResponse({
  id: 'AQID', response: { authenticatorData: bytes, clientDataJSON: bytes, signature: bytes, userHandle: bytes },
  getClientExtensionResults: () => rawExtensions, authenticatorAttachment: 'platform', toJSON: undefined,
});
if (legacyWithHandle.response.userHandle !== 'AQID' || legacyWithHandle.authenticatorAttachment !== 'platform') throw new Error('Present optional data lost');
const legacyWire: unknown = JSON.parse(JSON.stringify(legacy));
if (JSON.stringify(legacyWire) === JSON.stringify(nativeRegistration)) throw new Error('Legacy is not native JSON');
`;

describe('auth-js WebAuthn declaration patch', () => {
  test('patch is declarations-only and preserves every JavaScript runtime hash', () => {
    const content = readFileSync(patch, 'utf8');
    const targets = content.split('\n').filter((line) => line.startsWith('+++ b/'));
    expect(targets).toHaveLength(6);
    expect(targets.every((line) => line.endsWith('.d.ts'))).toBe(true);
    const baseline = runtimeHashes(join(directory(), 'pristine'));
    expect(baseline.length).toBeGreaterThan(0);
    expect(runtimeHashes(join(directory(), 'patched'))).toEqual(baseline);
  });

  for (const flavor of ['module', 'main'] as const) {
    test(`${flavor}: reproduces the original DOM declaration conflict`, () => {
      const diagnostics = diagnose('export {};', flavor, 'pristine');
      expect(diagnostics).toHaveLength(1);
      expect(diagnostics[0]?.code).toBe(2430);
      expect(diagnostics[0]?.file?.endsWith('/lib/webauthn.dom.d.ts')).toBe(true);
    });

    test(`${flavor}: strict noEmit checks the full exported declaration graph and positive consumers`, () => {
      expect(diagnose(positive, flavor)).toEqual([]);
      expect(diagnose(runtime, flavor)).toEqual([]);
    });

    test(`${flavor}: every invalid consumer is rejected without suppressions`, () => {
      const diagnostics = diagnose(negative, flavor);
      const expectedLines = negative.split('\n').flatMap((line, index) => line.endsWith('// REJECT') ? [index + 1] : []);
      expect(diagnostics.every((diagnostic) => diagnostic.isConsumer)).toBe(true);
      expect([...new Set(diagnostics.map((diagnostic) => diagnostic.line))].sort((left, right) => (left ?? 0) - (right ?? 0))).toEqual(expectedLines);
      expect(expectedLines).toHaveLength(35);
    });

    test(`${flavor}: actual native and manual runtime branches match the declarations`, () => {
      const fixture = join(directory(), `runtime-${flavor}.ts`);
      writeFileSync(fixture, runtime.replaceAll('__PACKAGE__', `./patched/dist/${flavor}`));
      const result = spawnSync(process.execPath, ['--no-env-file', '--no-install', fixture], {
        cwd: directory(), encoding: 'utf8', env: {},
      });
      expect({ status: result.status, stderr: result.stderr }).toEqual({ status: 0, stderr: '' });
    });
  }
});
