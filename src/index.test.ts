import { describe, expect, test } from 'bun:test';

import { evaluateRepository, REPOSITORY_RULE_METADATA } from './index.js';
import type { RepositoryRuleContext } from './types/repository.js';

describe('repository rules', () => {
  test('publishes the canonical runtime and tooling contract', () => {
    expect(REPOSITORY_RULE_METADATA.runtime.bun).toMatchObject({
      packageManager: 'bun@1.4.2',
      typesRange: '^1.4.2',
      version: '1.4.2',
    });
    expect(REPOSITORY_RULE_METADATA.runtime.node.major).toBe(24);
  });

  test('accepts a canonical public package repository', () => {
    expect(evaluateRepository(createCanonicalContext())).toEqual({
      diagnostics: [],
      findings: [],
    });
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

/*** Build one canonical package and repository fact fixture. */
function createCanonicalContext(): RepositoryRuleContext {
  return {
    cliCommands: [],
    imports: [],
    packageJson: {
      dependencies: canonicalDependencies(),
      exports: [],
      fields: canonicalFields(),
      packageManager: 'bun@1.4.2',
      scripts: canonicalScripts(),
    },
    paths: REPOSITORY_RULE_METADATA.publicPackage.requiredRepoPaths.map(({ path, kind }) => ({
      kind,
      path,
    })),
    workflowBunVersions: {
      '.github/workflows/ci.yml': '1.4.2',
      '.github/workflows/release.yml': '1.4.2',
    },
  };
}

/*** Build canonical direct dependency facts. */
function canonicalDependencies(): RepositoryRuleContext['packageJson']['dependencies'] {
  return [
    { name: '@ankhorage/devtools', section: 'devDependencies', value: '^2.0.13' },
    { name: '@ankhorage/paradox', section: 'devDependencies', value: '^0.2.6' },
    { name: '@types/bun', section: 'devDependencies', value: '^1.4.2' },
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
