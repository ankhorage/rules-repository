import { createRuleRegistry, evaluateConfiguredRules, evaluateRules } from '@ankhorage/rules';

import type {
  RepositoryEvaluationOptions,
  RepositoryEvaluationResult,
  RepositoryRuleContext,
} from '../../../types/repository.js';
import { repositoryRuleSupport } from '../utils/repositoryRuleSupport.js';
import { createRepositoryRuleSet } from './createRepositoryRuleSet.js';

/*** Evaluate normalized repository facts through the canonical repository RuleSet. */
export function evaluateRepository(
  context: RepositoryRuleContext,
  options: RepositoryEvaluationOptions = {},
): RepositoryEvaluationResult {
  const ruleSet = createRepositoryRuleSet();
  return options.config === undefined
    ? evaluateRules(context, ruleSet.rules, {
        capabilities: options.capabilities ?? [repositoryRuleSupport.capabilities.facts],
      })
    : evaluateConfiguredRules(context, options.config, createRuleRegistry([ruleSet]), {
        capabilities: options.capabilities ?? [repositoryRuleSupport.capabilities.facts],
      });
}
