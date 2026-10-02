import type { RuleSet } from '@ankhorage/rules';

import type { RepositoryRuleContext } from '../../../types/repository.js';
import { createCliRules } from './rules/createCliRules.js';
import { createDependencyRules } from './rules/createDependencyRules.js';
import { createPackageRules } from './rules/createPackageRules.js';
import { createPathRules } from './rules/createPathRules.js';
import { createRuntimeRules } from './rules/createRuntimeRules.js';
import { createScriptRules } from './rules/createScriptRules.js';

/*** Create canonical repository, package, runtime, dependency, and CLI compliance rules. */
export function createRepositoryRuleSet(): RuleSet<RepositoryRuleContext> {
  return {
    id: 'repository',
    rules: [
      ...createRuntimeRules(),
      ...createPathRules(),
      ...createScriptRules(),
      ...createPackageRules(),
      ...createDependencyRules(),
      ...createCliRules(),
    ],
  };
}
