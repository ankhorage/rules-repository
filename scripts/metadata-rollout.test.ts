import { describe, expect, test } from 'bun:test';
import { mkdtemp, mkdir, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import {
  branchProtectionEvidence,
  childEnvironment,
  changedPaths,
  classifyDefaultBranchEvidence,
  doctorVersionFromWorkflow,
  guardWorkflowContract,
  unchangedPublishedManagedWorkflow,
  loadInstructions,
  MANAGED_PATHS,
  prepareCandidateBranch,
  requiredCheckState,
  successfulCheckEvidence,
  serializeDoctorResolution,
  parseOptions,
  selectRepositories,
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
  test('limits mutating execution to explicit applicable repositories', () => {
    expect(
      parseOptions(['--apply', '--repositories', 'reader,infra-r2,reader']).repositories,
    ).toEqual(['infra-r2', 'reader']);
    expect(
      selectRepositories(
        [
          { name: 'chess', archived: false, default_branch: 'main' },
          { name: 'reader', archived: false, default_branch: 'main' },
        ],
        ['reader'],
      ).map((repository) => repository.name),
    ).toEqual(['reader']);
    expect(() => selectRepositories([], ['outside-scope'])).toThrow('not applicable inventory');
  });

  test('passes the prepared Bun environment to spawned commands', () => {
    const previous = process.env.BUN_INSTALL_CACHE_DIR;
    try {
      process.env.BUN_INSTALL_CACHE_DIR = '/tmp/metadata-rollout-cache';
      expect(childEnvironment().BUN_INSTALL_CACHE_DIR).toBe('/tmp/metadata-rollout-cache');
    } finally {
      if (previous === undefined) delete process.env.BUN_INSTALL_CACHE_DIR;
      else process.env.BUN_INSTALL_CACHE_DIR = previous;
    }
  });

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
      await mkdir(join(directory, '.agents/skills/ankhorage-coding-rules'), { recursive: true });
      await writeFile(
        join(directory, 'AGENTS.md'),
        'Load .agents/skills/ankhorage-coding-rules/SKILL.md before edits.',
      );
      await writeFile(join(directory, '.agents/skills/ankhorage-coding-rules/SKILL.md'), '# Rules');
      expect(await loadInstructions(directory)).toEqual([
        'applied AGENTS.md through isolated checkout, no force push, and managed-path-only guard',
        'applied supported local policy .agents/skills/ankhorage-coding-rules/SKILL.md',
      ]);
      expect(MANAGED_PATHS.has('package.json')).toBe(true);
      expect(MANAGED_PATHS.has('bun.lock')).toBe(true);
      await mkdir(join(directory, '.agents/skills/custom'), { recursive: true });
      await writeFile(join(directory, '.agents/skills/custom/SKILL.md'), '# Custom');
      expect(await loadInstructions(directory)).toContain('requiring human review');
    } finally {
      await rm(directory, { recursive: true, force: true });
    }
  });

  test('requires a proven published baseline before accepting managed workflow replacements', () => {
    const legacy = `name: CI
on: [push, pull_request]
jobs:
  validate:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - name: Run tests
        run: bun run test
      - name: Validate Ankhorage repository
        run: bunx @ankhorage/doctor@0.14.0 validate .
`;
    const canonical = legacy.replace(
      'bunx @ankhorage/doctor@0.14.0 validate .',
      'bunx @ankhorage/doctor@0.15.1 validate . --enforce-repository-metadata',
    );
    expect(
      guardWorkflowContract({ ci: legacy, release }, { ci: canonical, release }, [
        '.github/workflows/ci.yml',
      ]),
    ).toContain('weakened CI');
    expect(
      guardWorkflowContract(
        { ci: legacy, release },
        { ci: canonical, release },
        ['.github/workflows/ci.yml'],
        true,
      ),
    ).toBeNull();
    const chess = legacy.replace(
      '    steps:',
      '    services:\n      redis:\n        image: redis\n    steps:',
    );
    expect(
      guardWorkflowContract({ ci: chess, release }, { ci: canonical, release }, [
        '.github/workflows/ci.yml',
      ]),
    ).toContain('weakened CI');
    const flow = legacy.replace('    steps:', '    container: ghcr.io/example/oci\n    steps:');
    expect(
      guardWorkflowContract({ ci: flow, release }, { ci: canonical, release }, [
        '.github/workflows/ci.yml',
      ]),
    ).toContain('weakened CI');
  });

  test('requires published provenance for the canonical upgrade exception', () => {
    const legacy = `name: CI
on: [push, pull_request]
jobs:
  validate:
    runs-on: ubuntu-latest
    steps:
      - name: Run tests
        run: bun run test
      - name: Validate Ankhorage repository
        run: bunx @ankhorage/doctor@0.14.0 validate .
`;
    const canonical = legacy.replace(
      'bunx @ankhorage/doctor@0.14.0 validate .',
      'bunx @ankhorage/doctor@0.15.1 validate . --enforce-repository-metadata',
    );
    const published = { ci: legacy, release };
    const disguisedTest = legacy.replace('run: bun run test', 'run: bun run test:critical');
    const alteredTrigger = legacy.replace('on: [push, pull_request]', 'on: push');
    const alteredPermission = legacy.replace(
      '    runs-on:',
      '    permissions: { contents: write }\n    runs-on:',
    );
    const alteredCondition = legacy.replace(
      '    runs-on:',
      '    if: github.event_name == push\n    runs-on:',
    );
    const alteredEnv = legacy.replace(
      '    runs-on:',
      '    env: { DATABASE_URL: postgres://example }\n    runs-on:',
    );
    for (const custom of [
      disguisedTest,
      alteredTrigger,
      alteredPermission,
      alteredCondition,
      alteredEnv,
    ]) {
      expect(unchangedPublishedManagedWorkflow({ ci: custom, release }, published)).not.toBeNull();
      expect(
        guardWorkflowContract({ ci: custom, release }, { ci: canonical, release }, [
          '.github/workflows/ci.yml',
        ]),
      ).toContain('weakened CI');
    }
    expect(unchangedPublishedManagedWorkflow(published, published)).toBeNull();
    expect(
      unchangedPublishedManagedWorkflow(published, {
        ci: legacy,
        release: release.replace('bun run release', 'bun run bad-release'),
      }),
    ).toContain('release workflow differs');
  });

  test('extracts an effective Doctor pin from a step, never a workflow comment', () => {
    expect(
      doctorVersionFromWorkflow(
        '# bunx @ankhorage/doctor@0.15.1 validate . --enforce-repository-metadata\n' + ci,
      ),
    ).toBeNull();
    expect(
      doctorVersionFromWorkflow(
        ci.replace(
          '          bun run test:integration',
          '          bunx @ankhorage/doctor@0.15.1 validate . --enforce-repository-metadata',
        ),
      ),
    ).toBe('0.15.1');
  });

  test('requires the latest successful required check and tolerates no optional inference', () => {
    expect(
      requiredCheckState(
        [
          {
            name: 'validate',
            status: 'completed',
            conclusion: 'success',
            completed_at: '2026-01-01T00:00:00Z',
          },
          {
            name: 'validate',
            status: 'in_progress',
            conclusion: null,
            started_at: '2026-01-01T00:01:00Z',
          },
          {
            name: 'optional',
            status: 'completed',
            conclusion: 'skipped',
            completed_at: '2026-01-01T00:02:00Z',
          },
        ],
        ['validate'],
      ),
    ).toContain('pending');
    expect(
      requiredCheckState(
        [
          {
            name: 'validate',
            status: 'completed',
            conclusion: 'success',
            completed_at: '2026-01-01T00:03:00Z',
          },
          {
            name: 'optional',
            status: 'completed',
            conclusion: 'failure',
            completed_at: '2026-01-01T00:02:00Z',
          },
        ],
        ['validate'],
      ),
    ).toBeNull();
    expect(requiredCheckState([], ['validate'])).toContain('absent');
  });

  test('separates inaccessible or absent branch protection from exact-SHA CI evidence', () => {
    const successfulChecks = [
      { name: 'validate', status: 'completed', conclusion: 'success' },
      { name: 'container-acceptance', status: 'completed', conclusion: 'success' },
    ];
    expect(successfulCheckEvidence(successfulChecks, ci)).toBeNull();
    const unavailable = branchProtectionEvidence({
      code: 1,
      output: 'HTTP 403: Resource not accessible by integration',
    });
    expect(unavailable).toEqual({
      kind: 'unavailable',
      reason: 'HTTP 403: Resource not accessible by integration',
    });
    expect(
      classifyDefaultBranchEvidence({
        defaultSha: 'head',
        currentSha: 'head',
        policy: unavailable,
        checkState: successfulCheckEvidence(successfulChecks, ci),
      }),
    ).toBeNull();
    const unprotected = branchProtectionEvidence({
      code: 1,
      output: 'HTTP 404: Branch not protected',
    });
    expect(unprotected).toEqual({ kind: 'unprotected' });
  });

  test('rejects a failed or absent declared CI job even when an unrelated check succeeds', () => {
    const multiJobCi = `${ci}\n  acceptance:\n    runs-on: ubuntu-latest\n    steps:\n      - run: bun run test:acceptance\n`;
    const checks = [
      { name: 'validate', status: 'completed', conclusion: 'success' },
      { name: 'other-workflow', status: 'completed', conclusion: 'success' },
    ];
    expect(successfulCheckEvidence(checks, multiJobCi)).toContain('Required check');
    expect(
      successfulCheckEvidence(
        [...checks, { name: 'validate', status: 'completed', conclusion: 'failure' }],
        multiJobCi,
      ),
    ).toContain('did not succeed');
  });

  test('fails missing checks and stale evidence while accepting protected default-head success', () => {
    const policy = branchProtectionEvidence({ code: 0, output: '["validate"]' });
    const checks = [{ name: 'validate', status: 'completed', conclusion: 'success' }];
    expect(
      classifyDefaultBranchEvidence({
        defaultSha: 'head',
        currentSha: 'head',
        policy,
        checkState: requiredCheckState(checks, ['validate']),
      }),
    ).toBeNull();
    expect(
      classifyDefaultBranchEvidence({
        defaultSha: 'head',
        currentSha: 'head',
        policy,
        checkState: requiredCheckState([], ['validate']),
      }),
    ).toContain('ACTUAL_CI_CONTRACT_DRIFT');
    expect(
      classifyDefaultBranchEvidence({
        defaultSha: 'head',
        currentSha: 'advanced',
        policy,
        checkState: null,
      }),
    ).toContain('ACTUAL_CI_CONTRACT_DRIFT');
  });

  test('serializes published Doctor requests and continues after a failed request', async () => {
    const sequence: string[] = [];
    const first = serializeDoctorResolution(async () => {
      sequence.push('first-start');
      await Promise.resolve();
      sequence.push('first-end');
      return 1;
    });
    const second = serializeDoctorResolution(async () => {
      sequence.push('second-start');
      throw new Error('expected Doctor resolution failure');
    });
    const third = serializeDoctorResolution(async () => {
      sequence.push('third-start');
      return 3;
    });
    const results = await Promise.allSettled([first, second, third]);
    expect(results.map((result) => result.status)).toEqual(['fulfilled', 'rejected', 'fulfilled']);
    expect(sequence).toEqual(['first-start', 'first-end', 'second-start', 'third-start']);
  });

  test('safely resumes an existing remote branch after main advances and rejects a merge conflict', async () => {
    const directory = await mkdtemp(join(tmpdir(), 'metadata-rollout-remote-'));
    const remote = join(directory, 'remote.git');
    const seed = join(directory, 'seed');
    const resumed = join(directory, 'resumed');
    const conflicting = join(directory, 'conflicting');
    const repository = { name: 'fixture', archived: false, default_branch: 'main' };
    const git = async (...arguments_: string[]) => Bun.$`git ${arguments_}`.quiet();
    try {
      await git('init', '--bare', remote);
      await git('clone', remote, seed);
      await git('-C', seed, 'checkout', '-b', 'main');
      await git('-C', seed, 'config', 'user.email', 'test@example.invalid');
      await git('-C', seed, 'config', 'user.name', 'test');
      await writeFile(join(seed, 'workflow.txt'), 'base\n');
      await git('-C', seed, 'add', '.');
      await git('-C', seed, 'commit', '-m', 'initial');
      await git('-C', seed, 'push', '-u', 'origin', 'main');
      await git('clone', '--branch', 'main', remote, resumed);
      await git('-C', resumed, 'config', 'user.email', 'test@example.invalid');
      await git('-C', resumed, 'config', 'user.name', 'test');
      expect(await prepareCandidateBranch(resumed, repository)).toBeNull();
      await writeFile(join(resumed, 'branch.txt'), 'rollout\n');
      await git('-C', resumed, 'add', '.');
      await git('-C', resumed, 'commit', '-m', 'rollout');
      await git('-C', resumed, 'push', '-u', 'origin', 'chore/14-repository-metadata-fixture');
      await writeFile(join(seed, 'main.txt'), 'advanced\n');
      await git('-C', seed, 'add', '.');
      await git('-C', seed, 'commit', '-m', 'advanced main');
      await git('-C', seed, 'push');
      await git('clone', '--branch', 'main', remote, conflicting);
      await git('-C', conflicting, 'config', 'user.email', 'test@example.invalid');
      await git('-C', conflicting, 'config', 'user.name', 'test');
      expect(await prepareCandidateBranch(conflicting, repository)).toBeNull();
      expect(await Bun.file(join(conflicting, 'main.txt')).text()).toBe('advanced\n');
      const branchEditor = join(directory, 'branch-editor');
      await git('clone', '--branch', 'chore/14-repository-metadata-fixture', remote, branchEditor);
      await git('-C', branchEditor, 'config', 'user.email', 'test@example.invalid');
      await git('-C', branchEditor, 'config', 'user.name', 'test');
      await writeFile(join(branchEditor, 'workflow.txt'), 'branch\n');
      await git('-C', branchEditor, 'add', '.');
      await git('-C', branchEditor, 'commit', '-m', 'branch edit');
      await git('-C', branchEditor, 'push');
      await writeFile(join(seed, 'workflow.txt'), 'main\n');
      await git('-C', seed, 'add', '.');
      await git('-C', seed, 'commit', '-m', 'conflicting main edit');
      await git('-C', seed, 'push');
      const retry = join(directory, 'retry');
      await git('clone', '--branch', 'main', remote, retry);
      await git('-C', retry, 'config', 'user.email', 'test@example.invalid');
      await git('-C', retry, 'config', 'user.name', 'test');
      expect(await prepareCandidateBranch(retry, repository)).toContain('cannot merge');
    } finally {
      await rm(directory, { recursive: true, force: true });
    }
  });
});
