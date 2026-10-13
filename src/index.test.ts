import { describe, expect, test } from 'bun:test';

import { evaluateRepository, REPOSITORY_RULE_METADATA } from './index.js';
import type { RepositoryRuleContext } from './types/repository.js';

describe('repository rules', () => {
  test('publishes the canonical runtime and tooling contract', () => {
    const { packageManager, typesRange, version } = REPOSITORY_RULE_METADATA.runtime.bun;
    expect(packageManager).toBe(`bun@${version}`);
    expect(typesRange).toMatch(/^\^\d+\.\d+\.\d+$/u);
    expect(REPOSITORY_RULE_METADATA.runtime.node.major).toBe(24);
  });

  test('publishes the Atlas cyclic-dependency audit contract', assertAtlasAuditContract);

  test('accepts a canonical public package repository', () => {
    expect(evaluateRepository(createCanonicalContext())).toEqual({
      diagnostics: [],
      findings: [],
    });
  });

  test('reports escaped relative imports through the repository-boundary rule', () => {
    const context = createCanonicalContext();
    const result = evaluateRepository({
      ...context,
      imports: [
        {
          escapesRepositoryRoot: true,
          path: 'src/domain/value.ts',
          specifier: '../../../sibling/value',
        },
      ],
    });
    expect(result.findings.map(({ ruleId }) => ruleId)).toContain(
      'package.imports.outside-root.disallowed',
    );
  });

  test('reports repository and package violations as generic Rules findings', () => {
    const context = createCanonicalContext();
    const result = evaluateRepository({
      ...context,
      imports: [{ path: 'src/index.ts', specifier: '@ankh/legacy' }],
      packageJson: {
        ...context.packageJson,
        packageManager: 'npm@11',
      },
    });
    const ids = result.findings.map(({ ruleId }) => ruleId);
    expect(ids).toContain('package.json.package-manager.policy');
    expect(ids).toContain('package.imports.ankh-workspace-alias.disallowed');
  });
});

/*** Verify that generated consumers receive only the canonical Atlas audit metadata. */
function assertAtlasAuditContract(): void {
  expect(REPOSITORY_RULE_METADATA.atlasAudit).toEqual({
    artifactName: 'atlas-audit',
    artifactPath: 'src/atlas-audit.json',
    command:
      'cd src && bunx @ankhorage/atlas@0.12.1 --out atlas-audit.json --rule cyclic-dependencies=block',
    packageName: '@ankhorage/atlas',
    rule: 'cyclic-dependencies=block',
    toolVersion: '0.12.1',
  });
  expect('pkgvizAudit' in REPOSITORY_RULE_METADATA).toBe(false);
}

/*** Build one canonical package and repository fact fixture. */
function createCanonicalContext(): RepositoryRuleContext {
  return {
    cliCommands: [],
    imports: [],
    packageJson: {
      dependencies: canonicalDependencies(),
      exports: [],
      fields: canonicalFields(),
      packageManager: REPOSITORY_RULE_METADATA.runtime.bun.packageManager,
      scripts: canonicalScripts(),
    },
    paths: REPOSITORY_RULE_METADATA.publicPackage.requiredRepoPaths.map(({ path, kind }) => ({
      kind,
      path,
    })),
    workflowBunVersions: {
      '.github/workflows/ci.yml': REPOSITORY_RULE_METADATA.runtime.bun.version,
      '.github/workflows/release.yml': REPOSITORY_RULE_METADATA.runtime.bun.version,
    },
  };
}

/*** Build canonical direct dependency facts. */
function canonicalDependencies(): RepositoryRuleContext['packageJson']['dependencies'] {
  return [
    { name: '@ankhorage/devtools', section: 'devDependencies', value: '^2.0.13' },
    { name: '@ankhorage/paradox', section: 'devDependencies', value: '^0.2.6' },
    {
      name: '@types/bun',
      section: 'devDependencies',
      value: REPOSITORY_RULE_METADATA.runtime.bun.typesRange,
    },
    { name: '@types/node', section: 'devDependencies', value: '^26.6.2' },
    { name: 'typescript', section: 'devDependencies', value: '~6.0.3' },
  ];
}

/*** Build canonical required package fields. */
function canonicalFields(): RepositoryRuleContext['packageJson']['fields'] {
  return {
    bugs: { url: 'https://example.com/issues' },
    description: 'Example package',
    exports: { '.': './dist/index.js' },
    files: ['dist'],
    homepage: 'https://example.com',
    keywords: ['ankhorage'],
    license: 'MIT',
    name: '@ankhorage/example',
    publishConfig: { access: 'public' },
    publishConfigAccess: 'public',
    repository: { type: 'git', url: 'https://example.com/repo.git' },
    type: 'module',
    version: '1.0.0',
  };
}

/*** Build canonical required package scripts. */
function canonicalScripts(): Readonly<Record<string, string>> {
  return Object.fromEntries(
    REPOSITORY_RULE_METADATA.publicPackage.requiredScripts.map(({ name }) => [name, 'run ' + name]),
  );
}
