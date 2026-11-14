import type { JsonValue, Rule, RuleEvaluationOutcome, RuleFinding } from '@ankhorage/rules';

import { REPOSITORY_RULE_METADATA } from '../../../constants/repository.js';
import type { RepositoryPackageFact, RepositoryRuleContext } from '../../../types/repository.js';

/*** Shared feature-local primitives for deterministic repository rules. */
export const repositoryRuleSupport = {
  capabilities: { facts: 'repository.facts' },
  createRule,
  createWarningRule,
  finding,
  hasDependency,
  hasDependencyInSection,
  hasPath,
} as const;

/*** Build one deterministic error-level repository rule. */
function createRule(
  id: string,
  summary: string,
  evaluate: (context: RepositoryRuleContext) => readonly RuleFinding[],
): Rule<RepositoryRuleContext> {
  return {
    defaultSeverity: 'error',
    dependencies: [],
    evaluate: ({ context }) => outcome(evaluate(context)),
    identity: { id, version: '1' },
    requiredCapabilities: [repositoryRuleSupport.capabilities.facts],
    summary,
  };
}

/*** Build one deterministic warning-level preflight rule.
 *
 * Metadata rollout findings are intentionally advisory until Doctor activates the separate
 * enforcement policy after organization-wide authoring is complete.
 */
function createWarningRule(
  id: string,
  summary: string,
  evaluate: (context: RepositoryRuleContext) => readonly RuleFinding[],
): Rule<RepositoryRuleContext> {
  return {
    defaultSeverity: 'warning',
    dependencies: [],
    evaluate: ({ context }) => outcome(evaluate(context)),
    identity: { id, version: '1' },
    requiredCapabilities: [REPOSITORY_RULE_METADATA.metadata.capability],
    summary,
  };
}

/*** Translate deterministic provider findings into the generic evaluator outcome contract. */
function outcome(findings: readonly RuleFinding[]): RuleEvaluationOutcome {
  return { findings, status: findings.length === 0 ? 'PASS' : 'FAIL' };
}

/*** Build one portable repository finding. */
function finding(ruleId: string, message: string, path: string, evidence: JsonValue): RuleFinding {
  return {
    evidence,
    message,
    ruleId,
    severity: 'error',
    subjects: [{ id: path, kind: 'repository-path', path }],
  };
}

/*** Return whether the normalized package declares one direct dependency. */
function hasDependency(packageJson: RepositoryPackageFact, name: string): boolean {
  return packageJson.dependencies.some((dependency) => dependency.name === name);
}

/*** Return whether one dependency is declared in one exact package section. */
function hasDependencyInSection(
  packageJson: RepositoryPackageFact,
  name: string,
  section: RepositoryPackageFact['dependencies'][number]['section'],
): boolean {
  return packageJson.dependencies.some(
    (dependency) => dependency.name === name && dependency.section === section,
  );
}

/*** Return whether one exact path fact exists with the requested kind. */
function hasPath(
  context: Pick<RepositoryRuleContext, 'paths'>,
  path: string,
  kind?: 'directory' | 'file',
): boolean {
  return context.paths.some(
    (candidate) => candidate.path === path && (kind === undefined || candidate.kind === kind),
  );
}
