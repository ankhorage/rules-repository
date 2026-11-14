import { describe, expect, test } from 'bun:test';

import {
  evaluateRepository,
  evaluateRepositoryMetadataPreflight,
  REPOSITORY_RULE_METADATA,
} from './index.js';
import type { RepositoryRuleContext } from './types/repository.js';

describe('repository metadata preflight', () => {
  test(
    'reports no finding for meaningful metadata at the source profile path',
    validMetadataScenario,
  );
  test(
    'reports missing authored metadata as an advisory preflight finding',
    missingMetadataScenario,
  );
  test(
    'does not create a global gate before Doctor enables the dedicated policy',
    noGlobalGateScenario,
  );
  test(
    'reports placeholders, noncanonical paths, and invalid implementation references',
    invalidMetadataScenario,
  );
  test(
    'exempts archived, legacy, and third-party facts without fabricating metadata',
    exemptionScenario,
  );
});

/*** Verify valid metadata produces no preflight finding. */
function validMetadataScenario(): void {
  const result = evaluateRepositoryMetadataPreflight(contextWithMetadata());

  expect(result.findings).toEqual([]);
  expect(result.results.every(({ status }) => status === 'PASS')).toBe(true);
}

/*** Verify missing eligible metadata produces only an advisory preflight finding. */
function missingMetadataScenario(): void {
  const result = evaluateRepositoryMetadataPreflight({
    ...contextWithMetadata(),
    metadata: { eligibility: 'applicable', managed: true, profile: 'source' },
  });

  expect(result.findings).toEqual([
    expect.objectContaining({
      ruleId: 'repository.metadata.document.required',
      severity: 'warning',
      subjects: [expect.objectContaining({ path: 'src/metadata/repository.json' })],
    }),
  ]);
}

/*** Verify the default repository evaluator remains free of metadata enforcement. */
function noGlobalGateScenario(): void {
  const context = contextWithMetadata();
  const baseline = evaluateRepository({
    ...context,
    metadata: { eligibility: 'applicable', managed: true, profile: 'source' },
  });

  expect(REPOSITORY_RULE_METADATA.metadata.enforcement.defaultMode).toBe('report-only');
  expect(baseline.findings.map(({ ruleId }) => ruleId)).not.toContain(
    'repository.metadata.document.required',
  );
}

/*** Verify malformed authored values receive actionable advisory diagnostics. */
function invalidMetadataScenario(): void {
  const result = evaluateRepositoryMetadataPreflight({
    ...contextWithMetadata(),
    metadata: {
      document: {
        schemaVersion: 1,
        kind: 'adapter',
        title: 'TODO',
        summary: 'Connects portable policy to an external provider.',
        purpose: 'Provide a standalone adapter.',
        implements: [{ packageName: ' ', subpath: 'db', interfaceId: ' ' }],
      },
      eligibility: 'applicable',
      managed: true,
      path: 'metadata/repository.json',
      profile: 'source',
    },
  });

  expect(result.findings.map(({ ruleId }) => ruleId)).toEqual([
    'repository.metadata.implements.valid',
    'repository.metadata.location.canonical',
    'repository.metadata.text.meaningful',
  ]);
  expect(result.findings.every(({ severity }) => severity === 'warning')).toBe(true);
}

/*** Verify exempt repositories remain outside metadata authoring requirements. */
function exemptionScenario(): void {
  for (const eligibility of ['archived', 'legacy', 'third-party'] as const) {
    const result = evaluateRepositoryMetadataPreflight({
      ...contextWithMetadata(),
      metadata: { eligibility, managed: eligibility !== 'third-party', profile: 'non-source' },
    });

    expect(result.findings).toEqual([]);
  }
}

/*** Create the minimum repository facts needed to isolate metadata preflight behavior. */
function contextWithMetadata(): RepositoryRuleContext {
  return {
    cliCommands: [],
    imports: [],
    metadata: {
      document: {
        schemaVersion: 1,
        kind: 'tooling',
        title: 'Repository rules',
        summary: 'Evaluates deterministic repository policy facts.',
        purpose:
          'Keep managed repository maintenance consistent without hidden runtime dependencies.',
        responsibilities: ['Report repository policy findings from supplied facts.'],
        boundaries: ['Does not fetch repository state or execute user code.'],
        audience: ['Repository tooling consumers'],
        useCases: ['Run organization metadata inventory preflight.'],
      },
      eligibility: 'applicable',
      managed: true,
      path: 'src/metadata/repository.json',
      profile: 'source',
    },
    packageJson: { dependencies: [], exports: [], fields: {}, scripts: {} },
    paths: [],
    workflowBunVersions: {},
  };
}
