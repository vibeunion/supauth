import { afterEach, describe, expect, test } from 'bun:test';
import { mkdtemp, chmod, readFile, rm, stat, symlink } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { validManagementPath, validTestTunnelProcess, writeDeploymentEvidence } from '../scripts/real-contract-deploy.js';

const directories: string[] = [];
async function fixture() {
  const directory = await mkdtemp(join(tmpdir(), 'supauth-deploy-'));
  directories.push(directory);
  await chmod(directory, 0o700);
  return directory;
}
afterEach(async () => {
  for (const directory of directories.splice(0)) await rm(directory, { recursive: true, force: true });
});

describe('deployment evidence', () => {
  test('permits only bounded task summaries in query strings, never query writes', () => {
    const path = '/v1/projects/npdxmbxmnnzkdqlwtizu/tasks?summary=true&limit=100';
    expect(validManagementPath(path, 'GET')).toBe(true);
    expect(validManagementPath(path, 'POST')).toBe(false);
    for (const rejected of [
      path.replace('summary=true', 'summary=false'), `${path}&payload=true`,
      path.replace('limit=100', 'limit=1000'), 'https://example.com/v1/projects',
      '/v1/projects/../settings', '/v1/projects/%2e%2e/settings',
    ]) expect(validManagementPath(rejected, 'GET')).toBe(false);
  });
  test('accepts only the exact current-user test management tunnel', () => {
    const command = 'ssh -o BatchMode=yes -o StrictHostKeyChecking=yes -o UpdateHostKeys=no '
      + '-o ConnectTimeout=5 -o ControlMaster=no -o ControlPath=none -o ForwardAgent=no '
      + '-o ExitOnForwardFailure=yes -N -L 127.0.0.1:29190:127.0.0.1:9090 root@192.168.200.112';
    const uid = String(process.getuid?.());
    expect(validTestTunnelProcess(command, uid)).toBe(true);
    expect(validTestTunnelProcess(command.replace(':9090', ':9000'), uid)).toBe(false);
    expect(validTestTunnelProcess(command.replace('192.168.200.112', '192.168.1.48'), uid)).toBe(false);
    expect(validTestTunnelProcess(`${command} -R 9000:localhost:9090`, uid)).toBe(false);
    expect(validTestTunnelProcess(command, '-1')).toBe(false);
  });
  test('creates private durable records without overwriting existing evidence', async () => {
    const directory = await fixture();
    await writeDeploymentEvidence(directory, 'receipt.json', { ref: 'test' });
    expect((await stat(join(directory, 'receipt.json'))).mode & 0o777).toBe(0o600);
    expect(await readFile(join(directory, 'receipt.json'), 'utf8')).toContain('"ref": "test"');
    await expect(writeDeploymentEvidence(directory, 'receipt.json', {})).rejects.toThrow();
    expect(await readFile(join(directory, 'receipt.json'), 'utf8')).toContain('"ref": "test"');
  });
  test('rejects traversal, nonprivate directories and symlink destinations', async () => {
    const directory = await fixture();
    await expect(writeDeploymentEvidence(directory, '../escape.json', {})).rejects.toThrow();
    await chmod(directory, 0o755);
    await expect(writeDeploymentEvidence(directory, 'bad.json', {})).rejects.toThrow();
    await chmod(directory, 0o700);
    await symlink('/tmp', join(directory, 'linked'));
    await expect(writeDeploymentEvidence(join(directory, 'linked'), 'bad.json', {})).rejects.toThrow();
  });
});
