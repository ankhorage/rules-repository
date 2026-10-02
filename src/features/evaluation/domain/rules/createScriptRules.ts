import type { Rule } from '@ankhorage/rules';

import { REPOSITORY_RULE_METADATA } from '../../../../constants/repository.js';
import type { RepositoryRuleContext } from '../../../../types/repository.js';
import { repositoryRuleSupport } from '../../utils/repositoryRuleSupport.js';

/*** Create required public-package script rules. */
export function createScriptRules(): readonly Rule<RepositoryRuleContext>[] {
  return REPOSITORY_RULE_METADATA.publicPackage.requiredScripts.map((required) =>
    repositoryRuleSupport.createRule(
      required.ruleId,
      'Public packages require the canonical package scripts.',
      ({ packageJson }) =>
        typeof packageJson.scripts[required.name] === 'string' &&
        packageJson.scripts[required.name] !== ''
          ? []
          : [
              repositoryRuleSupport.finding(
                required.ruleId,
                'Missing required package script: ' + required.name + '.',
                'package.json',
                { script: required.name },
              ),
            ],
    ),
  );
}
