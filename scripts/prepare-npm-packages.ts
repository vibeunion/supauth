import fs from 'node:fs';
import path from 'node:path';

// SDK packages that publish to npm — need workspace:* rewrite
const npmPackageDirs = [
  'packages/shared',
  'packages/sdks/typescript',
  'packages/sdks/auth-ui',
];

// Private packages that also use workspace:* deps — rewrite for reproducible builds
const privatePackageDirs = [
  'packages/auth-server',
  'packages/admin-console',
];

const shouldWrite = process.argv.includes('--write');

function readJson(filePath: string) {
  return JSON.parse(fs.readFileSync(filePath, 'utf8'));
}

function writeJson(filePath: string, value: unknown) {
  fs.writeFileSync(filePath, `${JSON.stringify(value, null, 2)}\n`);
}

// Collect all package versions
const allDirs = [...npmPackageDirs, ...privatePackageDirs];
const versions = Object.fromEntries(
  allDirs.map((dir) => {
    const pkg = readJson(path.join(dir, 'package.json'));
    return [pkg.name, pkg.version] as [string, string];
  }),
);

function rewriteWorkspaceDeps(dir: string, enforcePublic = false) {
  const packageJsonPath = path.join(dir, 'package.json');
  const pkg = readJson(packageJsonPath);

  if (enforcePublic && pkg.private === true) {
    throw new Error(`${pkg.name} is still private and cannot be published to npm`);
  }

  let changed = false;
  for (const field of ['dependencies', 'peerDependencies', 'optionalDependencies'] as const) {
    if (!pkg[field]) continue;
    for (const [name, version] of Object.entries(pkg[field])) {
      if (version === 'workspace:*' && versions[name]) {
        pkg[field][name] = `^${versions[name]}`;
        changed = true;
      }
    }
  }

  if (changed && shouldWrite) {
    writeJson(packageJsonPath, pkg);
    console.log(`Rewrote workspace dependencies in ${packageJsonPath}`);
  } else if (changed) {
    console.log(`Would rewrite workspace dependencies in ${packageJsonPath}`);
  }
}

// Validate and rewrite npm-publishable packages
for (const dir of npmPackageDirs) {
  const pkg = readJson(path.join(dir, 'package.json'));

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

  rewriteWorkspaceDeps(dir, true);
}

// Rewrite workspace deps in private packages for reproducible version references
for (const dir of privatePackageDirs) {
  rewriteWorkspaceDeps(dir, false);
}
