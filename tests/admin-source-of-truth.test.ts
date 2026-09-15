import { parseJson } from "../scripts/tooling-values.js";
import { describe, expect, it } from 'bun:test';
import { readFileSync } from 'node:fs';
import { Type, StringKeySchema, decodeSchema } from '../packages/shared/src/schema.js';

const scriptsSchema = Type.Record(StringKeySchema, Type.String());
const rootPackage = decodeSchema(Type.Object({ scripts: scriptsSchema }), parseJson(readFileSync('package.json', 'utf8')));
const adminPackage = decodeSchema(Type.Object({ scripts: scriptsSchema, devDependencies: scriptsSchema }), parseJson(
  readFileSync('packages/admin-console/package.json', 'utf8'),
));
const developmentLauncher = readFileSync('scripts/dev.ts', 'utf8');
const applicationBuildScript = readFileSync('scripts/build-supacloud-app.ts', 'utf8');
const readme = readFileSync('README.md', 'utf8');
const rootViteDeprecation =
  "The root Admin Console entry is retired. Use `bun run dev:admin` for development or `bun run --filter '@supauth/admin-console' build` for builds.";

describe('Admin Console source-of-truth contract', () => {
  it('routes supported development, build, and artifact paths through the Admin package', () => {
    expect(rootPackage.scripts['dev:admin']).toBe("bun run --filter '@supauth/admin-console' dev");
    expect(developmentLauncher).toContain("args: ['bun', 'run', 'dev:admin']");
    expect(applicationBuildScript).toContain(
      "run(['bun', 'run', '--filter', '@supauth/admin-console', 'build']",
    );
    expect(applicationBuildScript).toContain("resolve(root, 'packages/admin-console/build')");
  });

  it('runs the Admin source check without dropping existing root gates', () => {
    const check = rootPackage.scripts["check"];
    if (check === undefined) throw new Error('Root package must define the check script');
    expect(check.split(' && ')).toEqual([
      'bun run check:type-safety',
      'bun run test',
      'bun run check:openapi-additive',
      "bun run --filter '@supauth/admin-console' check",
      "bun run --filter '@supauth/admin-console' build",
    ]);
    const typeSafety = rootPackage.scripts['check:type-safety'];
    if (typeSafety === undefined) throw new Error('Root package must define the aggregate type-safety gate');
    expect(typeSafety.split(' && ')).toEqual([
      'bun run typecheck',
      'bun run typecheck:contracts',
      'bun run typecheck:tooling',
      "bun run --filter '@supauth/admin-console' typecheck",
      'bun run check:contract-coverage',
      'bun run check:static-safety',
      'bun run check:inferred-safety',
    ]);
  });

  it('keeps the TypeScript native compiler required by the Admin check', () => {
    expect(adminPackage.scripts["check"]).toContain('--tsgo-experimental-api');
    expect(adminPackage.scripts["typecheck"]).toContain('--tsgo-experimental-api');
    expect(adminPackage.devDependencies["typescript"]).toBe('~6.0.3');
    expect(adminPackage.devDependencies['@typescript/native']).toBe('npm:typescript@^7.0.2');
  });

  it('documents the package as the only executable Admin source in both languages', () => {
    expect(readme).toContain(
      '`packages/admin-console` is the only Admin Console source of truth for development, testing, builds, and deployment.',
    );
    expect(readme).toContain(
      '`packages/admin-console` 是 Admin Console 开发、测试、构建和部署的唯一 source of truth。',
    );
    expect(readme).not.toContain('Root `src/` is a thin sync');
    expect(readme).not.toContain('根目录 `src/` 是 `packages/admin-console/src/` 的轻量同步');
  });

  it('fails closed when the retired root Vite entry is loaded', async () => {
    await expect(import('../vite.config.js')).rejects.toThrow(rootViteDeprecation);
  });
});
