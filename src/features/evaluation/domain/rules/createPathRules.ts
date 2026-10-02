import type { Rule } from '@ankhorage/rules';

import { REPOSITORY_RULE_METADATA } from '../../../../constants/repository.js';
import { REPOSITORY_RULE_IDS } from '../../../../constants/repositoryRuleIds.js';
import type { RepositoryRuleContext } from '../../../../types/repository.js';
import { repositoryRuleSupport } from '../../utils/repositoryRuleSupport.js';

/*** Create repository-path and source-taxonomy rules. */
export function createPathRules(): readonly Rule<RepositoryRuleContext>[] {
  return [...requiredRepositoryPathRules(), catchAllDirectoryRule()];
}

/*** Require canonical files and directories for public packages. */
function requiredRepositoryPathRules(): readonly Rule<RepositoryRuleContext>[] {
  return REPOSITORY_RULE_METADATA.publicPackage.requiredRepoPaths.map((required) =>
    repositoryRuleSupport.createRule(
      required.ruleId,
      'Public packages require the canonical repository artifacts.',
      (context) =>
        repositoryRuleSupport.hasPath(context, required.path, required.kind)
          ? []
          : [
              repositoryRuleSupport.finding(
                required.ruleId,
                'Required repository path is missing: ' + required.path + '.',
                required.path,
                { kind: required.kind },
              ),
            ],
    ),
  );
}

/*** Reject generic catch-all source directories as repository ownership. */
function catchAllDirectoryRule(): Rule<RepositoryRuleContext> {
  const catchAllDirectories: readonly string[] = REPOSITORY_RULE_METADATA.source.catchAllDirectories;
  return repositoryRuleSupport.createRule(
    REPOSITORY_RULE_IDS.catchAllDirectory,
    'Generic catch-all source directories are not allowed.',
    ({ paths }) =>
      paths.flatMap((candidate) => {
        if (candidate.kind !== 'directory') return [];
        const segments = candidate.path.split('/');
        const name = segments[segments.length - 1] ?? '';
        return catchAllDirectories.includes(name)
          ? [
              repositoryRuleSupport.finding(
                REPOSITORY_RULE_IDS.catchAllDirectory,
                'Generic catch-all directory is not allowed: ' + candidate.path + '.',
                candidate.path,
                { name },
              ),
            ]
          : [];
      }),
  );
}
