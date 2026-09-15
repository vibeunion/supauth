import { parseJson } from './tooling-values.js';
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { decodeRouteContractInventory, inspectContractCoverage } from './type-safety-contract.js';

const root = resolve(import.meta.dir, '..');
const directory = mkdtempSync(join(tmpdir(), 'supauth-type-safety-'));
try {
  const specPath = join(directory, 'openapi.json');
  const inventoryPath = join(directory, 'routes.json');
  const child = Bun.spawnSync(['bun', '--no-env-file', 'run', 'scripts/export-openapi.ts', specPath, inventoryPath], {
    cwd: root,
    stdout: 'pipe',
    stderr: 'pipe',
  });
  if (child.exitCode !== 0) {
    // 导出进程可能加载认证配置，失败时不把其原始输出带入持久化诊断。
    throw new Error(`Contract export failed (exit ${child.exitCode})`);
  }
  const result = inspectContractCoverage(
    (parseJson(readFileSync(specPath, 'utf8'))),
    decodeRouteContractInventory(parseJson(readFileSync(inventoryPath, 'utf8'))),
  );
  const reportDirectory = join(root, 'artifacts', 'type-safety');
  mkdirSync(reportDirectory, { recursive: true });
  const reportPath = join(reportDirectory, 'contract-coverage.json');
  writeFileSync(reportPath, JSON.stringify(result, null, 2));
  if (process.argv.includes('--json')) {
    console.log(JSON.stringify(result, null, 2));
  } else {
    console.log(`Route contracts: ${result.covered}/${result.total}; hidden routes included: ${result.hidden}`);
    for (const issue of result.issues.slice(0, 20)) console.error(`${issue.code}: ${issue.operation}`);
    if (result.issues.length > 20) console.error(`... ${result.issues.length - 20} more issue(s)`);
    console.log(`Full report: ${reportPath}`);
  }
  if (result.issues.length > 0) process.exitCode = 1;
} finally {
  rmSync(directory, { recursive: true, force: true });
}
