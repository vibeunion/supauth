import { parseJson, requireRecord } from './tooling-values.js';
import { Type, StringKeySchema, decodeSchema, type Static } from '../packages/shared/src/schema.js';
import fs from 'node:fs';
import path from 'node:path';

// SDK packages that publish to npm — need workspace:* rewrite
const npmPackageDirs = [
  'packages/authorization-core',
  'packages/authorization-postgres',
  'packages/authorization-conformance',
  'packages/shared',
  'packages/sdks/typescript',
  'packages/sdks/auth-ui',
];

// Private packages that also use workspace:* deps — rewrite for reproducible builds
const privatePackageDirs = [
  'packages/auth-server',
  'packages/admin-console',
];

const StringMapSchema = Type.Record(StringKeySchema, Type.String());
const PackageManifestSchema = Type.Object({
  name: Type.String({ minLength: 1 }),
  version: Type.String({ minLength: 1 }),
  private: Type.Optional(Type.Boolean()),
  files: Type.Optional(Type.Array(Type.String())),
  dependencies: Type.Optional(StringMapSchema),
  peerDependencies: Type.Optional(StringMapSchema),
  optionalDependencies: Type.Optional(StringMapSchema),
});

export function decodePackageManifest(value: unknown): Record<string, unknown> & Static<typeof PackageManifestSchema> {
  const source = requireRecord(value, 'package.json');
  return { ...source, ...decodeSchema(PackageManifestSchema, source) };
}

export function readPackageManifest(filePath: string) {
  return decodePackageManifest(parseJson(fs.readFileSync(filePath, 'utf8')));
}

function writeJson(filePath: string, value: unknown) {
  fs.writeFileSync(filePath, `${JSON.stringify(value, null, 2)}\n`);
}

export function rewritePackageDependencies(
  pkg: ReturnType<typeof decodePackageManifest>,
  versions: Readonly<Record<string, string>>,
): boolean {
  let changed = false;
  for (const field of ['dependencies', 'peerDependencies', 'optionalDependencies'] as const) {
    const dependencies = pkg[field];
    if (dependencies === undefined) continue;
    for (const [name, version] of Object.entries(dependencies)) {
      const workspaceVersion = versions[name];
      if (version === 'workspace:*' && workspaceVersion !== undefined) {
        dependencies[name] = `^${workspaceVersion}`;
        changed = true;
      }
    }
  }
  return changed;
}

function rewriteWorkspaceDeps(
  dir: string,
  versions: Readonly<Record<string, string>>,
  shouldWrite: boolean,
  enforcePublic = false,
) {
  const packageJsonPath = path.join(dir, 'package.json');
  const pkg = readPackageManifest(packageJsonPath);

  if (enforcePublic && pkg.private === true) {
    throw new Error(`${pkg.name} is still private and cannot be published to npm`);
  }

  const changed = rewritePackageDependencies(pkg, versions);

  if (changed && shouldWrite) {
    writeJson(packageJsonPath, pkg);
    console.log(`Rewrote workspace dependencies in ${packageJsonPath}`);
  } else if (changed) {
    console.log(`Would rewrite workspace dependencies in ${packageJsonPath}`);
  }
}

function main() {
  const shouldWrite = process.argv.includes('--write');
  const versions: Record<string, string> = {};
  for (const dir of [...npmPackageDirs, ...privatePackageDirs]) {
    const pkg = readPackageManifest(path.join(dir, 'package.json'));
    versions[pkg.name] = pkg.version;
  }
  for (const dir of npmPackageDirs) {
    const pkg = readPackageManifest(path.join(dir, 'package.json'));

    if (pkg.private === true) {
      throw new Error(`${pkg.name} is still private and cannot be published`);
    }
    if (!pkg.files?.includes('dist')) {
      throw new Error(`${pkg.name} package.json must include dist in files`);
    }
    if (!fs.existsSync(path.join(dir, 'dist', 'index.js'))) {
      throw new Error(`${pkg.name} is missing dist/index.js`);
    }
    if (!fs.existsSync(path.join(dir, 'dist', 'index.d.ts'))) {
      throw new Error(`${pkg.name} is missing dist/index.d.ts`);
    }

    rewriteWorkspaceDeps(dir, versions, shouldWrite, true);
  }

  // Rewrite workspace deps in private packages for reproducible version references
  for (const dir of privatePackageDirs) {
    rewriteWorkspaceDeps(dir, versions, shouldWrite, false);
  }
}

if (import.meta.main) main();
