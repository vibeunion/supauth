import { afterEach, describe, expect, test } from 'bun:test';
import { chmod, mkdtemp, readdir, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { claimManagedMutation } from '../scripts/real-contract-managed-database.js';

const directories: string[] = [];
afterEach(async () => {
  for (const directory of directories.splice(0)) await rm(directory, { recursive: true, force: true });
});
describe('managed database mutation journal', () => {
  test('a claim is exclusive across repeated calls', async () => {
    const directory = await mkdtemp(join(tmpdir(), 'supauth-managed-'));
    directories.push(directory);
    await chmod(directory, 0o700);
    const key = `7a91e5ac-961d-4537-9f79-901c50f214db:npdxmbxmnnzkdqlwtizu:migration:1:${'a'.repeat(64)}`;
    expect(await claimManagedMutation(directory, key)).toBe(true);
    expect(await claimManagedMutation(directory, key)).toBe(false);
    expect(await readdir(directory)).toHaveLength(1);
  });
  test('rejects another project or a nonmigration operation before writing', async () => {
    await expect(claimManagedMutation('/missing', 'other:project:migration:1')).rejects.toThrow('MANAGED_CLAIM_SCOPE_REJECTED');
    await expect(claimManagedMutation('/missing',
      '7a91e5ac-961d-4537-9f79-901c50f214db:npdxmbxmnnzkdqlwtizu:function-secrets',
    )).rejects.toThrow('MANAGED_CLAIM_SCOPE_REJECTED');
  });
});
