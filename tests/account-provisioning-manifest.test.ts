import { afterEach, describe, expect, test } from 'bun:test';
import { chmod, mkdtemp, mkdir, readFile, readdir, rename, rm, stat, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { basename, join } from 'node:path';
import * as XLSX from 'xlsx';
import { writeSensitiveOutputs } from '../scripts/generate-account-provisioning-manifest';

let temporaryDirectory: string | null = null;

afterEach(async () => {
  if (temporaryDirectory) await rm(temporaryDirectory, { recursive: true });
  temporaryDirectory = null;
});

function transactionArtifacts(fileNames: string[]): string[] {
  return fileNames.filter(name => /\.(tmp|backup|recovery|cleanup|lock)$/.test(name));
}

function secondCommitFailure(reviewPath: string) {
  return {
    beforeCommit: async ({ targetPath }: { targetPath: string }): Promise<void> => {
      if (targetPath === reviewPath) throw new Error('Injected review commit failure');
    },
  };
}

describe('account provisioning manifest', () => {
  test('generates high-entropy claim proofs in owner-readable artifacts', async () => {
    temporaryDirectory = await mkdtemp(join(tmpdir(), 'supauth-account-manifest-'));
    const inputPath = join(temporaryDirectory, 'accounts.xlsx');
    const manifestPath = join(temporaryDirectory, 'manifest.json');
    const reviewPath = join(temporaryDirectory, 'review.csv');
    const sheet = XLSX.utils.json_to_sheet([{ '数字ID': '0267', '姓名': '张三', '状态': '正常' }]);
    const workbook = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(workbook, sheet, 'Accounts');
    XLSX.writeFile(workbook, inputPath);

    const process = Bun.spawn([
      'bun',
      'run',
      'scripts/generate-account-provisioning-manifest.ts',
      inputPath,
      `--out=${manifestPath}`,
      `--csv=${reviewPath}`,
      '--domain=example.test',
    ], { cwd: import.meta.dir + '/..', stdout: 'pipe', stderr: 'pipe' });
    const [exitCode, stdout, stderr] = await Promise.all([
      process.exited,
      new Response(process.stdout).text(),
      new Response(process.stderr).text(),
    ]);

    expect(exitCode, stderr).toBe(0);
    const manifest = JSON.parse(await readFile(manifestPath, 'utf8'));
    const proof = manifest.records[0].claim_proof;
    expect(proof).toMatch(/^[A-Za-z0-9_-]{43}$/);
    expect(stdout).not.toContain(proof);
    expect(await readFile(reviewPath, 'utf8')).toContain(`claim_proof`);
    expect((await stat(manifestPath)).mode & 0o777).toBe(0o600);
    expect((await stat(reviewPath)).mode & 0o777).toBe(0o600);
  });

  test('cleans staged proof files when the second output cannot be committed', async () => {
    temporaryDirectory = await mkdtemp(join(tmpdir(), 'supauth-account-manifest-failure-'));
    const inputPath = join(temporaryDirectory, 'accounts.xlsx');
    const manifestPath = join(temporaryDirectory, 'manifest.json');
    const reviewPath = join(temporaryDirectory, 'review.csv');
    const sheet = XLSX.utils.json_to_sheet([{ '数字ID': '0267', '姓名': '张三', '状态': '正常' }]);
    const workbook = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(workbook, sheet, 'Accounts');
    XLSX.writeFile(workbook, inputPath);
    await mkdir(reviewPath);

    const process = Bun.spawn([
      'bun',
      'run',
      'scripts/generate-account-provisioning-manifest.ts',
      inputPath,
      `--out=${manifestPath}`,
      `--csv=${reviewPath}`,
      '--domain=example.test',
    ], { cwd: import.meta.dir + '/..', stdout: 'pipe', stderr: 'pipe' });
    const [exitCode, stderr] = await Promise.all([
      process.exited,
      new Response(process.stderr).text(),
    ]);

    expect(exitCode).not.toBe(0);
    expect(stderr).not.toContain('claim_proof');
    await expect(stat(manifestPath)).rejects.toThrow();
    const temporaryFiles = (await readdir(temporaryDirectory)).filter(name => name.endsWith('.tmp'));
    expect(temporaryFiles).toEqual([]);
  });

  test.skipIf(process.platform !== 'darwin')('preserves existing outputs when the second output commit fails', async () => {
    temporaryDirectory = await mkdtemp(join(tmpdir(), 'supauth-account-manifest-rollback-'));
    const inputPath = join(temporaryDirectory, 'accounts.xlsx');
    const manifestPath = join(temporaryDirectory, 'manifest.json');
    const reviewPath = join(temporaryDirectory, 'review.csv');
    const sheet = XLSX.utils.json_to_sheet([{ '数字ID': '0267', '姓名': '张三', '状态': '正常' }]);
    const workbook = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(workbook, sheet, 'Accounts');
    XLSX.writeFile(workbook, inputPath);
    await writeFile(manifestPath, 'ORIGINAL_MANIFEST', { mode: 0o640 });
    await writeFile(reviewPath, 'ORIGINAL_REVIEW', { mode: 0o604 });
    await chmod(manifestPath, 0o640);
    await chmod(reviewPath, 0o604);

    const lockReview = Bun.spawn(['chflags', 'uchg', reviewPath], { stdout: 'pipe', stderr: 'pipe' });
    expect(await lockReview.exited).toBe(0);
    let exitCode: number;
    let stderr: string;
    try {
      const process = Bun.spawn([
        'bun',
        'run',
        'scripts/generate-account-provisioning-manifest.ts',
        inputPath,
        `--out=${manifestPath}`,
        `--csv=${reviewPath}`,
        '--domain=example.test',
      ], { cwd: import.meta.dir + '/..', stdout: 'pipe', stderr: 'pipe' });
      [exitCode, stderr] = await Promise.all([
        process.exited,
        new Response(process.stderr).text(),
      ]);
    } finally {
      const unlockReview = Bun.spawn(['chflags', 'nouchg', reviewPath], { stdout: 'pipe', stderr: 'pipe' });
      expect(await unlockReview.exited).toBe(0);
    }

    expect(exitCode!).not.toBe(0);
    expect(stderr!).not.toContain('claim_proof');
    expect(await readFile(manifestPath, 'utf8')).toBe('ORIGINAL_MANIFEST');
    expect(await readFile(reviewPath, 'utf8')).toBe('ORIGINAL_REVIEW');
    expect((await stat(manifestPath)).mode & 0o777).toBe(0o640);
    expect((await stat(reviewPath)).mode & 0o777).toBe(0o604);
    expect(transactionArtifacts(await readdir(temporaryDirectory))).toEqual([]);
  });

  test('restores both existing files byte-for-byte after the second commit fails', async () => {
    temporaryDirectory = await mkdtemp(join(tmpdir(), 'supauth-account-manifest-injected-rollback-'));
    const manifestPath = join(temporaryDirectory, 'manifest.json');
    const reviewPath = join(temporaryDirectory, 'review.csv');
    await writeFile(manifestPath, 'ORIGINAL_MANIFEST', { mode: 0o640 });
    await writeFile(reviewPath, 'ORIGINAL_REVIEW', { mode: 0o604 });
    await chmod(manifestPath, 0o640);
    await chmod(reviewPath, 0o604);

    await expect(writeSensitiveOutputs({
      manifestPath,
      reviewPath,
      manifestContent: '{"claim_proof":"NEW_MANIFEST_PROOF"}',
      reviewContent: 'claim_proof\nNEW_REVIEW_PROOF\n',
    }, secondCommitFailure(reviewPath))).rejects.toThrow('Injected review commit failure');

    expect(await readFile(manifestPath, 'utf8')).toBe('ORIGINAL_MANIFEST');
    expect(await readFile(reviewPath, 'utf8')).toBe('ORIGINAL_REVIEW');
    expect((await stat(manifestPath)).mode & 0o777).toBe(0o640);
    expect((await stat(reviewPath)).mode & 0o777).toBe(0o604);
    expect(transactionArtifacts(await readdir(temporaryDirectory))).toEqual([]);
  });

  test('rolls back an existing exchange when its staged metadata read fails', async () => {
    temporaryDirectory = await mkdtemp(join(tmpdir(), 'supauth-account-manifest-metadata-failure-'));
    const manifestPath = join(temporaryDirectory, 'manifest.json');
    const reviewPath = join(temporaryDirectory, 'review.csv');
    await writeFile(manifestPath, 'ORIGINAL_MANIFEST', { mode: 0o640 });
    await writeFile(reviewPath, 'ORIGINAL_REVIEW', { mode: 0o604 });
    await chmod(manifestPath, 0o640);
    await chmod(reviewPath, 0o604);
    const metadataFailure = Object.assign(new Error('Injected post-exchange metadata read failure'), {
      code: 'EIO',
    });
    let observedExchange = false;
    const failCommittedStageMetadataRead = {
      readCommittedStageIdentity: async (stagedPath: string): Promise<never> => {
        observedExchange = true;
        expect(await readFile(manifestPath, 'utf8')).toBe('NEW_MANIFEST');
        expect(await readFile(stagedPath, 'utf8')).toBe('ORIGINAL_MANIFEST');
        throw metadataFailure;
      },
    };

    await expect(writeSensitiveOutputs({
      manifestPath,
      reviewPath,
      manifestContent: 'NEW_MANIFEST',
      reviewContent: 'NEW_REVIEW',
    }, failCommittedStageMetadataRead)).rejects.toThrow(metadataFailure.message);

    expect(observedExchange).toBe(true);
    expect(metadataFailure.code).toBe('EIO');
    expect(await readFile(manifestPath, 'utf8')).toBe('ORIGINAL_MANIFEST');
    expect(await readFile(reviewPath, 'utf8')).toBe('ORIGINAL_REVIEW');
    expect((await stat(manifestPath)).mode & 0o777).toBe(0o640);
    expect((await stat(reviewPath)).mode & 0o777).toBe(0o604);
    expect(transactionArtifacts(await readdir(temporaryDirectory))).toEqual([]);
  });

  test('preserves an external writer when metadata inspection fails after exchange', async () => {
    temporaryDirectory = await mkdtemp(join(tmpdir(), 'supauth-account-manifest-metadata-race-'));
    const manifestPath = join(temporaryDirectory, 'manifest.json');
    const reviewPath = join(temporaryDirectory, 'review.csv');
    const foreignPath = join(temporaryDirectory, 'foreign-manifest.json');
    await writeFile(manifestPath, 'ORIGINAL_MANIFEST', { mode: 0o640 });
    await writeFile(reviewPath, 'ORIGINAL_REVIEW', { mode: 0o604 });
    await writeFile(foreignPath, 'FOREIGN_MANIFEST', { mode: 0o600 });
    const foreignIdentity = await stat(foreignPath);
    const failAfterForeignReplacement = {
      readCommittedStageIdentity: async (): Promise<never> => {
        await rename(foreignPath, manifestPath);
        throw Object.assign(new Error('Injected metadata failure after foreign replacement'), { code: 'EIO' });
      },
    };

    let transactionError: unknown;
    try {
      await writeSensitiveOutputs({
        manifestPath,
        reviewPath,
        manifestContent: 'NEW_MANIFEST',
        reviewContent: 'NEW_REVIEW',
      }, failAfterForeignReplacement);
    } catch (cause) {
      transactionError = cause;
    }

    expect(transactionError).toBeInstanceOf(AggregateError);
    expect((transactionError as AggregateError).errors.join('\n')).toContain('not owned by this transaction');
    expect(await readFile(manifestPath, 'utf8')).toBe('FOREIGN_MANIFEST');
    expect(await readFile(reviewPath, 'utf8')).toBe('ORIGINAL_REVIEW');
    const preservedForeignIdentity = await stat(manifestPath);
    expect([preservedForeignIdentity.dev, preservedForeignIdentity.ino]).toEqual([
      foreignIdentity.dev,
      foreignIdentity.ino,
    ]);
    const remainingFiles = await readdir(temporaryDirectory);
    expect(remainingFiles.filter(name => /\.(tmp|recovery|cleanup|lock)$/.test(name))).toEqual([]);
    const recoverySnapshots = remainingFiles.filter(name => name.endsWith('.backup'));
    expect(recoverySnapshots).toHaveLength(1);
    expect(await readFile(join(temporaryDirectory, recoverySnapshots[0]), 'utf8')).toBe('ORIGINAL_MANIFEST');
  });

  test('removes every new output and transaction artifact after the second commit fails', async () => {
    temporaryDirectory = await mkdtemp(join(tmpdir(), 'supauth-account-manifest-new-rollback-'));
    const manifestPath = join(temporaryDirectory, 'manifest.json');
    const reviewPath = join(temporaryDirectory, 'review.csv');

    await expect(writeSensitiveOutputs({
      manifestPath,
      reviewPath,
      manifestContent: '{"claim_proof":"NEW_MANIFEST_PROOF"}',
      reviewContent: 'claim_proof\nNEW_REVIEW_PROOF\n',
    }, secondCommitFailure(reviewPath))).rejects.toThrow('Injected review commit failure');

    await expect(stat(manifestPath)).rejects.toThrow();
    await expect(stat(reviewPath)).rejects.toThrow();
    expect(await readdir(temporaryDirectory)).toEqual([]);
  });

  test('replaces either or both existing outputs and removes snapshots', async () => {
    temporaryDirectory = await mkdtemp(join(tmpdir(), 'supauth-account-manifest-replace-'));
    for (const existingOutputs of ['manifest', 'review', 'both'] as const) {
      const caseDirectory = join(temporaryDirectory, existingOutputs);
      const manifestPath = join(caseDirectory, 'manifest.json');
      const reviewPath = join(caseDirectory, 'review.csv');
      await mkdir(caseDirectory);
      if (existingOutputs !== 'review') await writeFile(manifestPath, 'OLD_MANIFEST', { mode: 0o640 });
      if (existingOutputs !== 'manifest') await writeFile(reviewPath, 'OLD_REVIEW', { mode: 0o604 });

      await writeSensitiveOutputs({
        manifestPath,
        reviewPath,
        manifestContent: 'NEW_MANIFEST',
        reviewContent: 'NEW_REVIEW',
      });

      expect(await readFile(manifestPath, 'utf8')).toBe('NEW_MANIFEST');
      expect(await readFile(reviewPath, 'utf8')).toBe('NEW_REVIEW');
      expect((await stat(manifestPath)).mode & 0o777).toBe(0o600);
      expect((await stat(reviewPath)).mode & 0o777).toBe(0o600);
      expect(transactionArtifacts(await readdir(caseDirectory))).toEqual([]);
    }
  });

  test('rejects a concurrent writer without deleting the active transaction files', async () => {
    temporaryDirectory = await mkdtemp(join(tmpdir(), 'supauth-account-manifest-concurrent-'));
    const manifestPath = join(temporaryDirectory, 'manifest.json');
    const reviewPath = join(temporaryDirectory, 'review.csv');
    let announceFirstCommit!: () => void;
    let resumeFirstCommit!: () => void;
    const firstCommitStarted = new Promise<void>(resolve => { announceFirstCommit = resolve; });
    const firstCommitMayReturn = new Promise<void>(resolve => { resumeFirstCommit = resolve; });
    const pausingCommit = {
      afterCommit: async ({ targetPath }: { targetPath: string }): Promise<void> => {
        if (targetPath !== manifestPath) return;
        announceFirstCommit();
        await firstCommitMayReturn;
      },
    };
    const firstWriter = writeSensitiveOutputs({
      manifestPath,
      reviewPath,
      manifestContent: 'FIRST_MANIFEST',
      reviewContent: 'FIRST_REVIEW',
    }, pausingCommit);
    await firstCommitStarted;

    try {
      await expect(writeSensitiveOutputs({
        manifestPath,
        reviewPath,
        manifestContent: 'SECOND_MANIFEST',
        reviewContent: 'SECOND_REVIEW',
      })).rejects.toThrow(/EEXIST/);
    } finally {
      resumeFirstCommit();
    }
    await firstWriter;

    expect(await readFile(manifestPath, 'utf8')).toBe('FIRST_MANIFEST');
    expect(await readFile(reviewPath, 'utf8')).toBe('FIRST_REVIEW');
    expect(transactionArtifacts(await readdir(temporaryDirectory))).toEqual([]);
  });

  test('does not roll back over a foreign replacement', async () => {
    temporaryDirectory = await mkdtemp(join(tmpdir(), 'supauth-account-manifest-ownership-'));
    const manifestPath = join(temporaryDirectory, 'manifest.json');
    const reviewPath = join(temporaryDirectory, 'review.csv');
    const foreignPath = join(temporaryDirectory, 'foreign-manifest.json');
    await writeFile(manifestPath, 'ORIGINAL_MANIFEST', { mode: 0o640 });
    await writeFile(reviewPath, 'ORIGINAL_REVIEW', { mode: 0o604 });
    await writeFile(foreignPath, 'FOREIGN_MANIFEST', { mode: 0o600 });
    const foreignIdentity = await stat(foreignPath);
    const replaceBeforeFailure = {
      beforeCommit: async ({ targetPath }: { targetPath: string }): Promise<void> => {
        if (targetPath !== reviewPath) return;
        await rename(foreignPath, manifestPath);
        throw new Error('Injected failure after foreign replacement');
      },
    };

    let rollbackFailure: unknown;
    try {
      await writeSensitiveOutputs({
        manifestPath,
        reviewPath,
        manifestContent: '{"claim_proof":"NEW_MANIFEST_PROOF"}',
        reviewContent: 'claim_proof\nNEW_REVIEW_PROOF\n',
      }, replaceBeforeFailure);
    } catch (cause) {
      rollbackFailure = cause;
    }

    expect(rollbackFailure).toBeInstanceOf(AggregateError);
    expect((rollbackFailure as AggregateError).errors.join('\n')).toContain('not owned by this transaction');
    expect(await readFile(manifestPath, 'utf8')).toBe('FOREIGN_MANIFEST');
    expect(await readFile(reviewPath, 'utf8')).toBe('ORIGINAL_REVIEW');
    const restoredForeignIdentity = await stat(manifestPath);
    expect([restoredForeignIdentity.dev, restoredForeignIdentity.ino]).toEqual([
      foreignIdentity.dev,
      foreignIdentity.ino,
    ]);
    const remainingFiles = await readdir(temporaryDirectory);
    expect(remainingFiles.filter(name => /\.(tmp|recovery|cleanup|lock)$/.test(name))).toEqual([]);
    const recoverySnapshots = remainingFiles.filter(name => name.endsWith('.backup'));
    expect(recoverySnapshots).toHaveLength(1);
    expect(await readFile(join(temporaryDirectory, recoverySnapshots[0]), 'utf8')).toBe('ORIGINAL_MANIFEST');
  });

  test('fails closed when a target is replaced after validation but before commit', async () => {
    temporaryDirectory = await mkdtemp(join(tmpdir(), 'supauth-account-manifest-commit-race-'));
    const manifestPath = join(temporaryDirectory, 'manifest.json');
    const reviewPath = join(temporaryDirectory, 'review.csv');
    const foreignPath = join(temporaryDirectory, 'foreign-manifest.json');
    await writeFile(manifestPath, 'ORIGINAL_MANIFEST', { mode: 0o640 });
    await writeFile(reviewPath, 'ORIGINAL_REVIEW', { mode: 0o604 });
    await writeFile(foreignPath, 'FOREIGN_MANIFEST', { mode: 0o600 });
    const foreignIdentity = await stat(foreignPath);
    const replaceAtManifestCommit = {
      beforeCommit: async ({ targetPath }: { targetPath: string }): Promise<void> => {
        if (targetPath === manifestPath) await rename(foreignPath, manifestPath);
      },
    };

    await expect(writeSensitiveOutputs({
      manifestPath,
      reviewPath,
      manifestContent: 'NEW_MANIFEST',
      reviewContent: 'NEW_REVIEW',
    }, replaceAtManifestCommit)).rejects.toThrow(/changed|foreign|atomic/i);

    expect(await readFile(manifestPath, 'utf8')).toBe('FOREIGN_MANIFEST');
    expect(await readFile(reviewPath, 'utf8')).toBe('ORIGINAL_REVIEW');
    const restoredForeignIdentity = await stat(manifestPath);
    expect([restoredForeignIdentity.dev, restoredForeignIdentity.ino]).toEqual([
      foreignIdentity.dev,
      foreignIdentity.ino,
    ]);
    const remainingFiles = await readdir(temporaryDirectory);
    expect(remainingFiles.filter(name => /\.(tmp|recovery|cleanup|lock)$/.test(name))).toEqual([]);
    const recoverySnapshots = remainingFiles.filter(name => name.endsWith('.backup'));
    expect(recoverySnapshots).toHaveLength(1);
    expect(await readFile(join(temporaryDirectory, recoverySnapshots[0]), 'utf8')).toBe('ORIGINAL_MANIFEST');
  });

  test('rolls back the first output when the second target is replaced at commit', async () => {
    temporaryDirectory = await mkdtemp(join(tmpdir(), 'supauth-account-manifest-second-race-'));
    const manifestPath = join(temporaryDirectory, 'manifest.json');
    const reviewPath = join(temporaryDirectory, 'review.csv');
    const foreignPath = join(temporaryDirectory, 'foreign-review.csv');
    await writeFile(manifestPath, 'ORIGINAL_MANIFEST', { mode: 0o640 });
    await writeFile(reviewPath, 'ORIGINAL_REVIEW', { mode: 0o604 });
    await writeFile(foreignPath, 'FOREIGN_REVIEW', { mode: 0o600 });
    const foreignIdentity = await stat(foreignPath);
    const replaceAtReviewCommit = {
      beforeCommit: async ({ targetPath }: { targetPath: string }): Promise<void> => {
        if (targetPath === reviewPath) await rename(foreignPath, reviewPath);
      },
    };

    await expect(writeSensitiveOutputs({
      manifestPath,
      reviewPath,
      manifestContent: 'NEW_MANIFEST',
      reviewContent: 'NEW_REVIEW',
    }, replaceAtReviewCommit)).rejects.toThrow(/changed|foreign|atomic/i);

    expect(await readFile(manifestPath, 'utf8')).toBe('ORIGINAL_MANIFEST');
    expect(await readFile(reviewPath, 'utf8')).toBe('FOREIGN_REVIEW');
    const restoredForeignIdentity = await stat(reviewPath);
    expect([restoredForeignIdentity.dev, restoredForeignIdentity.ino]).toEqual([
      foreignIdentity.dev,
      foreignIdentity.ino,
    ]);
    const remainingFiles = await readdir(temporaryDirectory);
    expect(remainingFiles.filter(name => /\.(tmp|recovery|cleanup|lock)$/.test(name))).toEqual([]);
    const recoverySnapshots = remainingFiles.filter(name => name.endsWith('.backup'));
    expect(recoverySnapshots).toHaveLength(1);
    expect(await readFile(join(temporaryDirectory, recoverySnapshots[0]), 'utf8')).toBe('ORIGINAL_REVIEW');
  });

  test('uses atomic no-replace when a missing target is created at commit', async () => {
    temporaryDirectory = await mkdtemp(join(tmpdir(), 'supauth-account-manifest-create-race-'));
    const manifestPath = join(temporaryDirectory, 'manifest.json');
    const reviewPath = join(temporaryDirectory, 'review.csv');
    let foreignDevice = 0;
    let foreignInode = 0;
    const createAtManifestCommit = {
      beforeCommit: async ({ targetPath }: { targetPath: string }): Promise<void> => {
        if (targetPath !== manifestPath) return;
        await writeFile(manifestPath, 'FOREIGN_MANIFEST', { mode: 0o600 });
        const createdIdentity = await stat(manifestPath);
        foreignDevice = createdIdentity.dev;
        foreignInode = createdIdentity.ino;
      },
    };

    await expect(writeSensitiveOutputs({
      manifestPath,
      reviewPath,
      manifestContent: 'NEW_MANIFEST',
      reviewContent: 'NEW_REVIEW',
    }, createAtManifestCommit)).rejects.toThrow(/EEXIST/);

    expect(await readFile(manifestPath, 'utf8')).toBe('FOREIGN_MANIFEST');
    const preservedForeignIdentity = await stat(manifestPath);
    expect([preservedForeignIdentity.dev, preservedForeignIdentity.ino]).toEqual([foreignDevice, foreignInode]);
    await expect(stat(reviewPath)).rejects.toThrow();
    expect(transactionArtifacts(await readdir(temporaryDirectory))).toEqual([]);
  });

  test('retains recovery material when a newly committed target is replaced before rollback', async () => {
    temporaryDirectory = await mkdtemp(join(tmpdir(), 'supauth-account-manifest-new-target-race-'));
    const manifestPath = join(temporaryDirectory, 'manifest.json');
    const reviewPath = join(temporaryDirectory, 'review.csv');
    const foreignPath = join(temporaryDirectory, 'foreign-manifest.json');
    await writeFile(foreignPath, 'FOREIGN_MANIFEST', { mode: 0o600 });
    const foreignIdentity = await stat(foreignPath);
    const replaceCommittedManifest = {
      afterCommit: async ({ targetPath }: { targetPath: string }): Promise<void> => {
        if (targetPath === manifestPath) await rename(foreignPath, manifestPath);
      },
      beforeCommit: async ({ targetPath }: { targetPath: string }): Promise<void> => {
        if (targetPath === reviewPath) throw new Error('Injected review failure after foreign replacement');
      },
    };

    let transactionError: unknown;
    try {
      await writeSensitiveOutputs({
        manifestPath,
        reviewPath,
        manifestContent: 'NEW_MANIFEST',
        reviewContent: 'NEW_REVIEW',
      }, replaceCommittedManifest);
    } catch (cause) {
      transactionError = cause;
    }

    expect(transactionError).toBeInstanceOf(AggregateError);
    expect((transactionError as AggregateError).errors.join('\n')).toContain('not owned by this transaction');
    expect(await readFile(manifestPath, 'utf8')).toBe('FOREIGN_MANIFEST');
    const restoredForeignIdentity = await stat(manifestPath);
    expect([restoredForeignIdentity.dev, restoredForeignIdentity.ino]).toEqual([
      foreignIdentity.dev,
      foreignIdentity.ino,
    ]);
    await expect(stat(reviewPath)).rejects.toThrow();

    const remainingFiles = await readdir(temporaryDirectory);
    expect(remainingFiles.filter(name => name.endsWith('.lock'))).toEqual([]);
    const stagedFiles = remainingFiles.filter(name => name.endsWith('.tmp'));
    const recoveryFiles = remainingFiles.filter(name => name.endsWith('.recovery'));
    expect(stagedFiles).toHaveLength(1);
    expect(recoveryFiles).toHaveLength(1);
    expect(await readFile(join(temporaryDirectory, stagedFiles[0]), 'utf8')).toBe('NEW_MANIFEST');
    expect((await stat(join(temporaryDirectory, stagedFiles[0]))).mode & 0o777).toBe(0o600);
    expect(await readFile(join(temporaryDirectory, recoveryFiles[0]), 'utf8')).toBe('FOREIGN_MANIFEST');
    const recoveryIdentity = await stat(join(temporaryDirectory, recoveryFiles[0]));
    expect([recoveryIdentity.dev, recoveryIdentity.ino]).toEqual([
      foreignIdentity.dev,
      foreignIdentity.ino,
    ]);
    expect(recoveryIdentity.mode & 0o777).toBe(0o600);
  });

  test('refuses to delete a foreign inode placed at a staged cleanup path', async () => {
    temporaryDirectory = await mkdtemp(join(tmpdir(), 'supauth-account-manifest-cleanup-race-'));
    const manifestPath = join(temporaryDirectory, 'manifest.json');
    const reviewPath = join(temporaryDirectory, 'review.csv');
    const foreignPath = join(temporaryDirectory, 'foreign-cleanup.json');
    await writeFile(foreignPath, 'FOREIGN_CLEANUP', { mode: 0o600 });
    const foreignIdentity = await stat(foreignPath);
    let replacedStagePath = '';
    const replaceManifestStage = {
      afterCommit: async ({ stagedPath, targetPath }: { stagedPath: string; targetPath: string }): Promise<void> => {
        if (targetPath !== manifestPath) return;
        replacedStagePath = stagedPath;
        await rename(foreignPath, stagedPath);
      },
    };

    let cleanupError: unknown;
    try {
      await writeSensitiveOutputs({
        manifestPath,
        reviewPath,
        manifestContent: 'NEW_MANIFEST',
        reviewContent: 'NEW_REVIEW',
      }, replaceManifestStage);
    } catch (cause) {
      cleanupError = cause;
    }

    expect(cleanupError).toBeInstanceOf(AggregateError);
    expect((cleanupError as Error).message).toContain('cleanup failed');
    expect((cleanupError as AggregateError).errors.join('\n')).toContain('not owned by this transaction');
    expect(await readFile(manifestPath, 'utf8')).toBe('NEW_MANIFEST');
    expect(await readFile(reviewPath, 'utf8')).toBe('NEW_REVIEW');

    const remainingFiles = await readdir(temporaryDirectory);
    expect(remainingFiles.filter(name => name.endsWith('.lock'))).toEqual([]);
    const preservedForeignFiles: string[] = [];
    for (const fileName of remainingFiles) {
      const fileStats = await stat(join(temporaryDirectory, fileName));
      if (fileStats.dev === foreignIdentity.dev && fileStats.ino === foreignIdentity.ino) {
        preservedForeignFiles.push(fileName);
      }
    }
    expect(preservedForeignFiles).toContain(basename(replacedStagePath));
    expect(preservedForeignFiles.some(fileName => fileName.endsWith('.cleanup'))).toBe(true);
    expect(preservedForeignFiles).toHaveLength(2);
    for (const fileName of preservedForeignFiles) {
      const preservedPath = join(temporaryDirectory, fileName);
      expect(await readFile(preservedPath, 'utf8')).toBe('FOREIGN_CLEANUP');
      expect((await stat(preservedPath)).mode & 0o777).toBe(0o600);
    }
  });
});
