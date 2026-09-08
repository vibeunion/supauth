import { describe, expect, test } from 'bun:test';
import path from 'node:path';

const repositoryRoot = path.resolve(import.meta.dir, '..');
const workflowPath = path.join(repositoryRoot, '.github/workflows/release-please.yml');
const releaseAssetsWorkflowPath = path.join(repositoryRoot, '.github/workflows/publish-release-assets.yml');
const workflow = await Bun.file(workflowPath).text();
const releaseAssetsWorkflow = await Bun.file(releaseAssetsWorkflowPath).text();

describe('npm release workflow', () => {
  test('publishes release-please outputs directly with OIDC', () => {
    expect(workflow).toContain('releases_created: ${{ steps.release.outputs.releases_created }}');
    expect(workflow).toContain('paths_released: ${{ steps.release.outputs.paths_released }}');
    expect(workflow).toContain('publish-released-npm:');
    expect(workflow).toContain("needs.release-please.outputs.releases_created == 'true'");
    expect(workflow).toContain('id-token: write');
    expect(workflow).toContain('npm install --global npm@11.19.1');
    expect(workflow).toContain('npm publish --provenance --access public');
    expect(workflow).not.toContain('NODE_AUTH_TOKEN');
    expect(workflow).not.toContain('NPM_TOKEN');
  });

  test('publishes public packages in dependency order', () => {
    const publishStep = workflow.slice(workflow.indexOf('Publish released npm packages with OIDC'));
    const orderedPackageDirs = [
      'packages/authorization-core',
      'packages/authorization-postgres',
      'packages/authorization-conformance',
      'packages/shared',
      'packages/sdks/typescript',
      'packages/sdks/auth-ui',
    ];

    let previousIndex = -1;
    for (const packageDir of orderedPackageDirs) {
      const packageIndex = publishStep.indexOf(packageDir, previousIndex + 1);
      expect(packageIndex).toBeGreaterThan(previousIndex);
      previousIndex = packageIndex;
    }
  });

  test('retains the single-tag recovery path', () => {
    expect(workflow).toContain("github.event_name == 'workflow_dispatch' && inputs.release_tag != ''");
    expect(workflow).toContain('ref: ${{ inputs.release_tag }}');
    expect(workflow).toContain('PUBLISH_TAG=backfill');
    expect(workflow).toContain('npm publish --provenance --access public --tag "$PUBLISH_TAG"');
  });

  test('does not dispatch a second npm publisher from release assets', () => {
    expect(releaseAssetsWorkflow).not.toContain('gh workflow run release-please.yml');
    expect(releaseAssetsWorkflow).toContain('published directly by release-please.yml with Trusted Publisher OIDC');
  });
});
