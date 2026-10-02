import type { JsonValue, Rule } from '@ankhorage/rules';

import { REPOSITORY_RULE_METADATA } from '../../../../constants/repository.js';
import { REPOSITORY_RULE_IDS } from '../../../../constants/repositoryRuleIds.js';
import type { RepositoryRuleContext } from '../../../../types/repository.js';
import { repositoryRuleSupport } from '../../utils/repositoryRuleSupport.js';

/*** Create public-package metadata and tooling dependency rules. */
export function createPackageRules(): readonly Rule<RepositoryRuleContext>[] {
  return [
    ...requiredFieldRules(),
    packageTypeRule(),
    publishAccessRule(),
    publicPackageRule(),
    ...toolingDependencyRules(),
    paradoxDependencyRule(),
    changesetsDependencyRule(),
  ];
}

/*** Require canonical package metadata field shapes. */
function requiredFieldRules(): readonly Rule<RepositoryRuleContext>[] {
  return REPOSITORY_RULE_METADATA.publicPackage.requiredFields.map((required) =>
    repositoryRuleSupport.createRule(
      required.ruleId,
      'Public packages require canonical package.json metadata.',
      ({ packageJson }) =>
        fieldMatchesKind(packageJson.fields[required.name], required.kind)
          ? []
          : [
              repositoryRuleSupport.finding(
                required.ruleId,
                'Invalid or missing package.json field: ' + required.name + '.',
                'package.json',
                { field: required.name, kind: required.kind },
              ),
            ],
    ),
  );
}

/*** Require ESM package type. */
function packageTypeRule(): Rule<RepositoryRuleContext> {
  return repositoryRuleSupport.createRule(
    REPOSITORY_RULE_IDS.packageTypeModule,
    'Public packages use ESM package.json type=module.',
    ({ packageJson }) =>
      packageJson.fields.type === REPOSITORY_RULE_METADATA.publicPackage.packageType.value
        ? []
        : [
            repositoryRuleSupport.finding(
              REPOSITORY_RULE_IDS.packageTypeModule,
              'package.json type must be module.',
              'package.json',
              { actual: packageJson.fields.type ?? null },
            ),
          ],
  );
}

/*** Require public npm publish access. */
function publishAccessRule(): Rule<RepositoryRuleContext> {
  return repositoryRuleSupport.createRule(
    REPOSITORY_RULE_IDS.packagePublishPublic,
    'Public packages require publishConfig.access=public.',
    ({ packageJson }) =>
      packageJson.fields.publishConfigAccess ===
      REPOSITORY_RULE_METADATA.publicPackage.publishAccess.value
        ? []
        : [
            repositoryRuleSupport.finding(
              REPOSITORY_RULE_IDS.packagePublishPublic,
              'publishConfig.access must be public.',
              'package.json',
              { actual: packageJson.fields.publishConfigAccess ?? null },
            ),
          ],
  );
}

/*** Reject private=true for published packages. */
function publicPackageRule(): Rule<RepositoryRuleContext> {
  return repositoryRuleSupport.createRule(
    REPOSITORY_RULE_IDS.packagePrivate,
    'Public packages must not set private=true.',
    ({ packageJson }) =>
      packageJson.fields.private === true
        ? [
            repositoryRuleSupport.finding(
              REPOSITORY_RULE_IDS.packagePrivate,
              'Public package must not set private=true.',
              'package.json',
              {},
            ),
          ]
        : [],
  );
}

/*** Require the shared tooling dependencies owned by the repository contract. */
function toolingDependencyRules(): readonly Rule<RepositoryRuleContext>[] {
  const requirements = [
    ['typescript', REPOSITORY_RULE_IDS.dependencyTypescript],
    ['@types/bun', REPOSITORY_RULE_IDS.dependencyBunTypes],
    ['@types/node', REPOSITORY_RULE_IDS.dependencyNodeTypes],
    ['@ankhorage/devtools', REPOSITORY_RULE_IDS.dependencyDevtools],
  ] as const;
  return requirements.map(([name, ruleId]) =>
    repositoryRuleSupport.createRule(
      ruleId,
      'Repository requires shared tooling.',
      ({ packageJson }) =>
        repositoryRuleSupport.hasDependency(packageJson, name)
          ? []
          : [
              repositoryRuleSupport.finding(
                ruleId,
                'Missing required dependency: ' + name + '.',
                'package.json',
                { name },
              ),
            ],
    ),
  );
}

/*** Require Paradox when the package owns a docs script, except for Paradox itself. */
function paradoxDependencyRule(): Rule<RepositoryRuleContext> {
  return repositoryRuleSupport.createRule(
    REPOSITORY_RULE_IDS.dependencyParadox,
    'Packages owning generated documentation require @ankhorage/paradox.',
    ({ packageJson }) => {
      const packageName = packageJson.fields.name;
      const ownsDocs = typeof packageJson.scripts.docs === 'string';
      const exempt = packageName === '@ankhorage/paradox';
      return !ownsDocs ||
        exempt ||
        repositoryRuleSupport.hasDependency(packageJson, '@ankhorage/paradox')
        ? []
        : [
            repositoryRuleSupport.finding(
              REPOSITORY_RULE_IDS.dependencyParadox,
              'Package owning docs must declare @ankhorage/paradox.',
              'package.json',
              {},
            ),
          ];
    },
  );
}

/*** Enforce Changesets CLI ownership by Devtools only. */
function changesetsDependencyRule(): Rule<RepositoryRuleContext> {
  return repositoryRuleSupport.createRule(
    REPOSITORY_RULE_IDS.dependencyChangesets,
    'Changesets execution is owned by @ankhorage/devtools.',
    ({ packageJson }) => {
      const packageName = packageJson.fields.name;
      const dependency = repositoryRuleSupport.hasDependencyInSection(
        packageJson,
        '@changesets/cli',
        'dependencies',
      );
      const devDependency = repositoryRuleSupport.hasDependencyInSection(
        packageJson,
        '@changesets/cli',
        'devDependencies',
      );
      const valid =
        packageName === '@ankhorage/devtools'
          ? dependency && !devDependency
          : !dependency && !devDependency;
      return valid
        ? []
        : [
            repositoryRuleSupport.finding(
              REPOSITORY_RULE_IDS.dependencyChangesets,
              'Only @ankhorage/devtools may declare @changesets/cli directly.',
              'package.json',
              { packageName: typeof packageName === 'string' ? packageName : '' },
            ),
          ];
    },
  );
}

/*** Validate one normalized package field against its canonical shape. */
function fieldMatchesKind(
  value: JsonValue | undefined,
  kind: 'non-empty-string' | 'record' | 'string-array',
): boolean {
  if (kind === 'non-empty-string') return typeof value === 'string' && value.trim() !== '';
  if (kind === 'string-array') {
    if (!Array.isArray(value) || value.length === 0) return false;
    return value.every((entry) => typeof entry === 'string');
  }
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}
