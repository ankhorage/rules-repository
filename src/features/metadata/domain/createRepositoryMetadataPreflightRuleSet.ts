import type { RuleSet } from '@ankhorage/rules';

import type { RepositoryRuleContext } from '../../../types/repository.js';
import { createRepositoryMetadataRules } from './rules/createRepositoryMetadataRules.js';

/*** Create the report-only repository metadata RuleSet for organization inventory preflight. */
export function createRepositoryMetadataPreflightRuleSet(): RuleSet<RepositoryRuleContext> {
  return { id: 'repository-metadata-preflight', rules: createRepositoryMetadataRules() };
}
