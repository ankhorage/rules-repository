import type { Rule } from '@ankhorage/rules';

import { REPOSITORY_RULE_METADATA } from '../../../../constants/repository.js';
import { REPOSITORY_RULE_IDS } from '../../../../constants/repositoryRuleIds.js';
import type { RepositoryRuleContext } from '../../../../types/repository.js';
import { repositoryRuleSupport } from '../../utils/repositoryRuleSupport.js';

/*** Create canonical Bun runtime and workflow rules. */
export function createRuntimeRules(): readonly Rule<RepositoryRuleContext>[] {
  return [
    packageManagerRequiredRule(),
    packageManagerBunRule(),
    packageManagerExactRule(),
    bunTypesRule(),
    ...workflowBunRules(),
  ];
}

/*** Require a packageManager declaration. */
function packageManagerRequiredRule(): Rule<RepositoryRuleContext> {
  return repositoryRuleSupport.createRule(
    REPOSITORY_RULE_IDS.packageManagerRequired,
    'Public packages require a Bun packageManager declaration.',
    ({ packageJson }) =>
      packageJson.packageManager === undefined || packageJson.packageManager.trim() === ''
        ? [
            repositoryRuleSupport.finding(
              REPOSITORY_RULE_IDS.packageManagerRequired,
              'package.json must define packageManager.',
              'package.json',
              {},
            ),
          ]
        : [],
  );
}

/*** Require Bun as the declared package manager. */
function packageManagerBunRule(): Rule<RepositoryRuleContext> {
  return repositoryRuleSupport.createRule(
    REPOSITORY_RULE_IDS.packageManagerBun,
    'Public package packageManager declarations must use Bun.',
    ({ packageJson }) =>
      packageJson.packageManager !== undefined && !packageJson.packageManager.startsWith('bun@')
        ? [
            repositoryRuleSupport.finding(
              REPOSITORY_RULE_IDS.packageManagerBun,
              'packageManager must use Bun.',
              'package.json',
              { actual: packageJson.packageManager },
            ),
          ]
        : [],
  );
}

/*** Require the exact canonical Bun runtime version. */
function packageManagerExactRule(): Rule<RepositoryRuleContext> {
  return repositoryRuleSupport.createRule(
    REPOSITORY_RULE_IDS.bunPackageManager,
    'The package manager declaration must match the canonical Bun runtime policy.',
    ({ packageJson }) =>
      packageJson.packageManager === REPOSITORY_RULE_METADATA.runtime.bun.packageManager
        ? []
        : [
            repositoryRuleSupport.finding(
              REPOSITORY_RULE_IDS.bunPackageManager,
              'packageManager must be ' + REPOSITORY_RULE_METADATA.runtime.bun.packageManager + '.',
              'package.json',
              { actual: packageJson.packageManager ?? '' },
            ),
          ],
  );
}

/*** Require the canonical @types/bun dependency range. */
function bunTypesRule(): Rule<RepositoryRuleContext> {
  return repositoryRuleSupport.createRule(
    REPOSITORY_RULE_IDS.bunTypes,
    'The @types/bun dependency must match the canonical Bun runtime policy.',
    ({ packageJson }) => {
      const dependency = packageJson.dependencies.find(({ name }) => name === '@types/bun');
      return dependency?.value === REPOSITORY_RULE_METADATA.runtime.bun.typesRange
        ? []
        : [
            repositoryRuleSupport.finding(
              REPOSITORY_RULE_IDS.bunTypes,
              '@types/bun must use ' + REPOSITORY_RULE_METADATA.runtime.bun.typesRange + '.',
              'package.json',
              { actual: dependency?.value ?? '' },
            ),
          ];
    },
  );
}

/*** Require canonical Bun versions in managed CI and release workflows. */
function workflowBunRules(): readonly Rule<RepositoryRuleContext>[] {
  return REPOSITORY_RULE_METADATA.runtime.bun.workflowTargets.map((target) =>
    repositoryRuleSupport.createRule(
      target.ruleId,
      'Managed workflow must use the canonical Bun runtime version.',
      ({ workflowBunVersions }) =>
        workflowBunVersions[target.path] === REPOSITORY_RULE_METADATA.runtime.bun.version
          ? []
          : [
              repositoryRuleSupport.finding(
                target.ruleId,
                target.path + ' must use Bun ' + REPOSITORY_RULE_METADATA.runtime.bun.version + '.',
                target.path,
                { actual: workflowBunVersions[target.path] ?? '' },
              ),
            ],
    ),
  );
}
