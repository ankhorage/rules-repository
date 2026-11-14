import { createRuleRegistry, evaluateConfiguredRules, evaluateRules } from '@ankhorage/rules';

import { REPOSITORY_RULE_METADATA } from '../../../constants/repository.js';
import type {
  RepositoryEvaluationOptions,
  RepositoryEvaluationResult,
  RepositoryRuleContext,
} from '../../../types/repository.js';
import { createRepositoryMetadataPreflightRuleSet } from './createRepositoryMetadataPreflightRuleSet.js';

/*** Evaluate advisory repository metadata facts without adding a global repository enforcement rule. */
export function evaluateRepositoryMetadataPreflight(
  context: RepositoryRuleContext,
  options: RepositoryEvaluationOptions = {},
): RepositoryEvaluationResult {
  const ruleSet = createRepositoryMetadataPreflightRuleSet();
  const capabilities = options.capabilities ?? [REPOSITORY_RULE_METADATA.metadata.capability];
  return options.config === undefined
    ? evaluateRules(context, ruleSet.rules, { capabilities })
    : evaluateConfiguredRules(context, options.config, createRuleRegistry([ruleSet]), {
        capabilities,
      });
}
