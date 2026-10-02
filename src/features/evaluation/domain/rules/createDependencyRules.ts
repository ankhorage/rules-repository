import type { Rule } from '@ankhorage/rules';

import { REPOSITORY_RULE_METADATA } from '../../../../constants/repository.js';
import { REPOSITORY_RULE_IDS } from '../../../../constants/repositoryRuleIds.js';
import type { RepositoryRuleContext } from '../../../../types/repository.js';
import { repositoryRuleSupport } from '../../utils/repositoryRuleSupport.js';

/*** Create current-only package dependency and source import rules. */
export function createDependencyRules(): readonly Rule<RepositoryRuleContext>[] {
  return [
    compatibilityDependencyRule(),
    localProtocolDependencyRule(),
    legacySourceDependencyRule(),
    compatibilityImportRule(),
    legacySourceImportRule(),
    outsideRootImportRule(),
  ];
}

/*** Reject legacy @ankh/* package dependencies. */
function compatibilityDependencyRule(): Rule<RepositoryRuleContext> {
  return repositoryRuleSupport.createRule(
    REPOSITORY_RULE_IDS.compatibilityDependency,
    'Legacy @ankh/* compatibility package dependencies are not allowed.',
    ({ packageJson }) =>
      packageJson.dependencies.flatMap((dependency) =>
        dependency.name.startsWith(REPOSITORY_RULE_METADATA.dependencies.compatibilityPackagePrefix)
          ? [
              repositoryRuleSupport.finding(
                REPOSITORY_RULE_IDS.compatibilityDependency,
                'Legacy compatibility dependency is not allowed: ' + dependency.name + '.',
                'package.json',
                { name: dependency.name },
              ),
            ]
          : [],
      ),
  );
}

/*** Reject local and source-control dependency protocols in published packages. */
function localProtocolDependencyRule(): Rule<RepositoryRuleContext> {
  return repositoryRuleSupport.createRule(
    REPOSITORY_RULE_IDS.localProtocolDependency,
    'Published packages must use registry-resolvable dependency versions.',
    ({ packageJson }) =>
      packageJson.dependencies.flatMap((dependency) =>
        REPOSITORY_RULE_METADATA.dependencies.localProtocolPrefixes.some((prefix) =>
          dependency.value.startsWith(prefix),
        )
          ? [
              repositoryRuleSupport.finding(
                REPOSITORY_RULE_IDS.localProtocolDependency,
                'Local dependency protocol is not allowed for ' + dependency.name + '.',
                'package.json',
                { name: dependency.name, value: dependency.value },
              ),
            ]
          : [],
      ),
  );
}

/*** Reject active dependency values that reference the legacy source tree. */
function legacySourceDependencyRule(): Rule<RepositoryRuleContext> {
  return repositoryRuleSupport.createRule(
    REPOSITORY_RULE_IDS.legacySourceDependency,
    'Active package dependencies must not reference legacy Ankhorage source.',
    ({ packageJson }) =>
      packageJson.dependencies.flatMap((dependency) =>
        dependency.value.includes(REPOSITORY_RULE_METADATA.dependencies.legacySourceMarker)
          ? [
              repositoryRuleSupport.finding(
                REPOSITORY_RULE_IDS.legacySourceDependency,
                'Legacy source dependency is not allowed: ' + dependency.name + '.',
                'package.json',
                { name: dependency.name },
              ),
            ]
          : [],
      ),
  );
}

/*** Reject legacy @ankh/* source imports. */
function compatibilityImportRule(): Rule<RepositoryRuleContext> {
  return repositoryRuleSupport.createRule(
    REPOSITORY_RULE_IDS.compatibilityImport,
    'Legacy @ankh/* compatibility imports are not allowed.',
    ({ imports }) =>
      imports.flatMap((sourceImport) =>
        sourceImport.specifier.startsWith(
          REPOSITORY_RULE_METADATA.dependencies.compatibilityPackagePrefix,
        )
          ? [
              repositoryRuleSupport.finding(
                REPOSITORY_RULE_IDS.compatibilityImport,
                'Legacy compatibility import is not allowed: ' + sourceImport.specifier + '.',
                sourceImport.path,
                { specifier: sourceImport.specifier },
              ),
            ]
          : [],
      ),
  );
}

/*** Reject active imports that reference the legacy source tree. */
function legacySourceImportRule(): Rule<RepositoryRuleContext> {
  return repositoryRuleSupport.createRule(
    REPOSITORY_RULE_IDS.legacySourceImport,
    'Active imports must not reference legacy Ankhorage source.',
    ({ imports }) =>
      imports.flatMap((sourceImport) =>
        sourceImport.specifier.includes(REPOSITORY_RULE_METADATA.dependencies.legacySourceMarker)
          ? [
              repositoryRuleSupport.finding(
                REPOSITORY_RULE_IDS.legacySourceImport,
                'Legacy source import is not allowed: ' + sourceImport.specifier + '.',
                sourceImport.path,
                { specifier: sourceImport.specifier },
              ),
            ]
          : [],
      ),
  );
}

/*** Reject normalized source imports that escape the standalone repository boundary. */
function outsideRootImportRule(): Rule<RepositoryRuleContext> {
  return repositoryRuleSupport.createRule(
    REPOSITORY_RULE_IDS.importOutsideRoot,
    'Relative source imports must stay inside the standalone repository root.',
    ({ imports }) =>
      imports.flatMap((sourceImport) =>
        sourceImport.escapesRepositoryRoot === true
          ? [
              repositoryRuleSupport.finding(
                REPOSITORY_RULE_IDS.importOutsideRoot,
                'Relative import escapes the standalone repository root: ' +
                  sourceImport.specifier +
                  '.',
                sourceImport.path,
                { specifier: sourceImport.specifier },
              ),
            ]
          : [],
      ),
  );
}
