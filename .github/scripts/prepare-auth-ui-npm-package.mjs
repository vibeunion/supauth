import fs from 'node:fs';
import path from 'node:path';

const packageDirs = [
  'packages/shared',
  'packages/sdks/typescript',
  'packages/sdks/auth-ui',
];
const shouldWrite = process.argv.includes('--write');

function readJson(filePath) {
  return JSON.parse(fs.readFileSync(filePath, 'utf8'));
}

function writeJson(filePath, value) {
  fs.writeFileSync(filePath, `${JSON.stringify(value, null, 2)}\n`);
}

const versions = Object.fromEntries(
  packageDirs.map((dir) => {
    const pkg = readJson(path.join(dir, 'package.json'));
    return [pkg.name, pkg.version];
  }),
);

for (const dir of packageDirs) {
  const packageJsonPath = path.join(dir, 'package.json');
  const pkg = readJson(packageJsonPath);

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

  let changed = false;
  for (const field of ['dependencies', 'peerDependencies', 'optionalDependencies']) {
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
