import { describe, expect, test } from 'bun:test';
import { mkdtemp, mkdir, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import {
  changedPaths,
  guardWorkflowContract,
  loadInstructions,
  MANAGED_PATHS,
} from './metadata-rollout.js';

const ci = `name: CI
on: [push, pull_request]
jobs:
  validate:
    if: github.event_name == 'push'
    runs-on: ubuntu-latest
    services:
      postgres:
        image: postgres:16
    env:
      DATABASE_URL: postgres://postgres
    steps:
      - uses: actions/checkout@v4
      - run: |
          bun run test:integration
          bun run test:browser
`;
const release = `name: Release
on:
  push:
    branches: [main]
jobs:
  publish:
    container: node:22
    steps:
      - uses: actions/checkout@v4
      - run: bun run release
`;

describe('metadata rollout safety contracts', () => {
  test('rejects multiline acceptance, service, environment, condition, and release losses', () => {
    for (const after of [
      ci.replace('          bun run test:browser\n', ''),
      ci.replace('    services:\n      postgres:\n        image: postgres:16\n', ''),
      ci.replace('    env:\n      DATABASE_URL: postgres://postgres\n', ''),
      ci.replace("    if: github.event_name == 'push'\n", ''),
    ]) {
      expect(
        guardWorkflowContract(
          { ci, release },
          { ci: `${after}\n# --enforce-repository-metadata`, release },
          ['.github/workflows/ci.yml'],
        ),
      ).toContain('rejected weakened CI contract');
    }
    expect(
      guardWorkflowContract(
        { ci, release },
        {
          ci: `${ci}\n# --enforce-repository-metadata`,
          release: release.replace('    container: node:22\n', ''),
        },
        ['.github/workflows/ci.yml', '.github/workflows/release.yml'],
      ),
    ).toContain('rejected weakened release contract');
  });

  test('accepts an additive managed enforcement step and rejects unmanaged output', () => {
    const after = ci.replace(
      '      - run: |',
      '      - run: bunx @ankhorage/doctor validate . --enforce-repository-metadata\n      - run: |',
    );
    expect(
      guardWorkflowContract({ ci, release }, { ci: after, release }, ['.github/workflows/ci.yml']),
    ).toBeNull();
    expect(guardWorkflowContract({ ci, release }, { ci: after, release }, ['README.md'])).toContain(
      'non-managed',
    );
  });

  test('includes generated untracked helpers with tracked additions, modifications, and deletions', async () => {
    const directory = await mkdtemp(join(tmpdir(), 'metadata-rollout-test-'));
    try {
      await Bun.$`git init ${directory}`.quiet();
      await Bun.$`git -C ${directory} config user.email test@example.invalid`.quiet();
      await Bun.$`git -C ${directory} config user.name test`.quiet();
      await writeFile(join(directory, 'modified.ts'), 'before');
      await writeFile(join(directory, 'removed.ts'), 'remove');
      await Bun.$`git -C ${directory} add .`.quiet();
      await Bun.$`git -C ${directory} commit -m initial`.quiet();
      await writeFile(join(directory, 'modified.ts'), 'after');
      await Bun.$`rm ${join(directory, 'removed.ts')}`.quiet();
      await mkdir(join(directory, '.github/scripts'), { recursive: true });
      await writeFile(join(directory, '.github/scripts/ci-impact.ts'), 'export {};');
      expect(await changedPaths(directory)).toEqual([
        '.github/scripts/ci-impact.ts',
        'modified.ts',
        'removed.ts',
      ]);
    } finally {
      await rm(directory, { recursive: true, force: true });
    }
  });

  test('discovers declared local skills and keeps dependency artifacts managed', async () => {
    const directory = await mkdtemp(join(tmpdir(), 'metadata-instructions-test-'));
    try {
      await mkdir(join(directory, '.agents/skills/custom'), { recursive: true });
      await writeFile(
        join(directory, 'AGENTS.md'),
        'Load .agents/skills/custom/SKILL.md before edits.',
      );
      await writeFile(join(directory, '.agents/skills/custom/SKILL.md'), '# Custom');
      expect(await loadInstructions(directory)).toEqual([
        'read AGENTS.md',
        'read .agents/skills/custom/SKILL.md',
      ]);
      expect(MANAGED_PATHS.has('package.json')).toBe(true);
      expect(MANAGED_PATHS.has('bun.lock')).toBe(true);
    } finally {
      await rm(directory, { recursive: true, force: true });
    }
  });
});
