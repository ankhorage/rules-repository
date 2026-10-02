import type { JsonValue, Rule, RuleFinding } from '@ankhorage/rules';

import type { RepositoryPackageFact, RepositoryRuleContext } from '../../../types/repository.js';

/*** Shared feature-local primitives for deterministic repository rules. */
export const repositoryRuleSupport = {
  createRule,
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
    evaluate: ({ context }) => evaluate(context),
    id,
    summary,
  };
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
    (candidate) =>
      candidate.path === path && (kind === undefined || candidate.kind === kind),
  );
}
