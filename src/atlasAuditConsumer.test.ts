import { cp, mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';

import { afterEach, describe, expect, test } from 'bun:test';

import { REPOSITORY_RULE_METADATA } from './index.js';

const temporaryDirectories: string[] = [];

afterEach(async () => {
  await Promise.all(
    temporaryDirectories.splice(0).map((path) => rm(path, { force: true, recursive: true })),
  );
});

describe('published Atlas audit consumer', () => {
  test('writes the blocking cycle audit artifact before exiting with code 2', async () => {
    const fixturePath = await copyFixtureAsync('cyclic');
    const result = await runContractAsync(fixturePath);
    const audit = await readAuditAsync(fixturePath);

    expect(result.exitCode).toBe(2);
    expect(audit.evaluation.cyclicPackages.length).toBeGreaterThan(0);
    assertBlockingCyclicDependenciesRule(audit, 'failed');
  }, 30_000);

  test('accepts a workspace with no package cycle', async () => {
    const fixturePath = await copyFixtureAsync('clean');
    const result = await runContractAsync(fixturePath);
    const audit = await readAuditAsync(fixturePath);

    expect(result.exitCode).toBe(0);
    expect(audit.evaluation.cyclicPackages).toEqual([]);
    assertBlockingCyclicDependenciesRule(audit, 'passed');
  }, 30_000);

  test('does not turn an unavailable Atlas package into a successful audit', async () => {
    const fixturePath = await copyFixtureAsync('clean');
    const result = await runCommandAsync(
      'cd src && bunx @ankhorage/atlas-not-published@0.14.1 --out atlas-audit.json --rule cyclic-dependencies=block',
      fixturePath,
    );

    expect(result.exitCode).not.toBe(0);
  });
});

/*** Run the canonical published Atlas command in one isolated fixture copy. */
async function runContractAsync(fixturePath: string): Promise<Bun.Subprocess> {
  return runCommandAsync(REPOSITORY_RULE_METADATA.atlasAudit.command, fixturePath);
}

/*** Run one CLI command without masking its process status or output artifact behavior. */
async function runCommandAsync(command: string, cwd: string): Promise<Bun.Subprocess> {
  const process = Bun.spawn({ cmd: ['sh', '-lc', command], cwd, stderr: 'pipe', stdout: 'pipe' });
  await process.exited;
  return process;
}

/*** Read the artifact from the exact path owned by the published metadata contract. */
async function readAuditAsync(fixturePath: string): Promise<AtlasAudit> {
  const artifact = await readFile(
    join(fixturePath, REPOSITORY_RULE_METADATA.atlasAudit.artifactPath),
    'utf8',
  );
  return JSON.parse(artifact) as AtlasAudit;
}

/*** Copy one immutable fixture into a disposable published-consumer working directory. */
async function copyFixtureAsync(name: string): Promise<string> {
  const destination = await mkdtemp(join(tmpdir(), 'rules-atlas-audit-'));
  temporaryDirectories.push(destination);
  await cp(resolve(process.cwd(), 'test/fixtures/atlas-audit', name), destination, {
    recursive: true,
  });
  return destination;
}

/*** Read the only cyclic-dependency rule from the persisted audit contract. */
function readCyclicDependenciesRule(audit: AtlasAudit): AtlasAuditRule {
  const rule = audit.evaluation.rules.find(({ id }) => id === 'cyclic-dependencies');
  if (rule === undefined) throw new Error('Atlas audit did not include cyclic-dependencies.');
  return rule;
}

/*** Verify the explicit managed blocking policy recorded for cyclic dependencies. */
function assertBlockingCyclicDependenciesRule(audit: AtlasAudit, status: string): void {
  const rule = readCyclicDependenciesRule(audit);
  expect(rule.id).toBe('cyclic-dependencies');
  expect(rule.policy).toBe('blocking');
  expect(rule.status).toBe(status);
}

interface AtlasAudit {
  readonly evaluation: {
    readonly cyclicPackages: readonly unknown[];
    readonly rules: readonly AtlasAuditRule[];
  };
}

interface AtlasAuditRule {
  readonly id: string;
  readonly policy: string;
  readonly status: string;
}
