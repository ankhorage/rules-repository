import { mkdirSync, mkdtempSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { describe, expect, test } from 'bun:test';

const packageRoot = process.cwd();
const temporaryCacheDirectory = join(tmpdir(), 'rules-repository-metadata-consumer-cache');

describe('packed metadata preflight consumer', () => {
  test('evaluates published metadata policy from an isolated installation', () => {
    const temporaryDirectory = mkdtempSync(join(tmpdir(), 'rules-repository-metadata-consumer-'));
    const consumerDirectory = join(temporaryDirectory, 'package');
    const packedDirectory = join(temporaryDirectory, 'packed');

    try {
      mkdirSync(consumerDirectory);
      mkdirSync(packedDirectory);
      writeConsumerFiles(consumerDirectory);
      packAndInstall(consumerDirectory, packedDirectory);
      verifyConsumer(consumerDirectory);
    } finally {
      rmSync(temporaryDirectory, { force: true, recursive: true });
    }
  }, 30_000);
});

/*** Write an isolated JavaScript consumer that exercises the public metadata preflight export. */
function writeConsumerFiles(consumerDirectory: string): void {
  writeFileSync(
    join(consumerDirectory, 'package.json'),
    JSON.stringify({ name: 'rules-repository-metadata-consumer', private: true, type: 'module' }),
  );
  writeFileSync(
    join(consumerDirectory, 'consumer.mjs'),
    [
      "import { evaluateRepositoryMetadataPreflight } from '@ankhorage/rules-repository';",
      "const result = evaluateRepositoryMetadataPreflight({ cliCommands: [], imports: [], metadata: { eligibility: 'applicable', managed: true, profile: 'source' }, packageJson: { dependencies: [], exports: [], fields: {}, scripts: {} }, paths: [], workflowBunVersions: {} });",
      "if (!result.findings.some(({ ruleId }) => ruleId === 'repository.metadata.document.required')) throw new Error('metadata preflight was unavailable');",
    ].join('\n'),
  );
}

/*** Pack the current package and install it without using sibling source files. */
function packAndInstall(consumerDirectory: string, packedDirectory: string): void {
  runCommand(['bun', 'run', 'build'], packageRoot);
  runCommand(
    ['npm', 'pack', '--ignore-scripts', '--pack-destination', packedDirectory],
    packageRoot,
  );

  const archiveName = readdirSync(packedDirectory).find((entry) => entry.endsWith('.tgz'));
  expect(archiveName).toBeDefined();
  runCommand(
    ['bun', 'add', '--ignore-scripts', join(packedDirectory, archiveName ?? 'missing.tgz')],
    consumerDirectory,
  );
}

/*** Run the public consumer with both Node ESM and Bun. */
function verifyConsumer(consumerDirectory: string): void {
  runCommand(['node', 'consumer.mjs'], consumerDirectory);
  runCommand(['bun', 'consumer.mjs'], consumerDirectory);
}

/*** Run one isolated command while preserving useful failure output. */
function runCommand(command: string[], cwd: string): void {
  const result = Bun.spawnSync(command, {
    cwd,
    env: {
      ...process.env,
      BUN_INSTALL_CACHE_DIR: temporaryCacheDirectory,
      npm_config_cache: temporaryCacheDirectory,
    },
  });
  const output = `${result.stdout.toString()}${result.stderr.toString()}`;

  expect(result.exitCode, output).toBe(0);
}
