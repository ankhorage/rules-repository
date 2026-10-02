import type { JsonValue, RuleEvaluationResult, RulesConfig } from '@ankhorage/rules';

/*** One repository path fact independent of filesystem implementation. */
export interface RepositoryPathFact {
  readonly kind: 'directory' | 'file';
  readonly path: string;
}

/*** One package dependency fact normalized across dependency sections. */
export interface RepositoryDependencyFact {
  readonly name: string;
  readonly section:
    'dependencies' | 'devDependencies' | 'optionalDependencies' | 'peerDependencies';
  readonly value: string;
}

/*** One source import fact used for current-only package-boundary checks. */
export interface RepositoryImportFact {
  readonly path: string;
  readonly specifier: string;
}

/*** One normalized public CLI command and its implementation source. */
export interface RepositoryCliCommandFact {
  readonly commandPath: readonly string[];
  readonly sourcePath: string;
}

/*** Portable package.json facts required by repository rules. */
export interface RepositoryPackageFact {
  readonly dependencies: readonly RepositoryDependencyFact[];
  readonly exports: readonly string[];
  readonly fields: Readonly<Record<string, JsonValue | undefined>>;
  readonly packageManager?: string;
  readonly scripts: Readonly<Record<string, string>>;
}

/*** Portable repository facts evaluated independently of filesystem and parser technology. */
export interface RepositoryRuleContext {
  readonly cliCommands: readonly RepositoryCliCommandFact[];
  readonly imports: readonly RepositoryImportFact[];
  readonly packageJson: RepositoryPackageFact;
  readonly paths: readonly RepositoryPathFact[];
  readonly workflowBunVersions: Readonly<Record<string, string | undefined>>;
}

/*** Optional generic Rules configuration applied to repository rules. */
export interface RepositoryEvaluationOptions {
  readonly config?: RulesConfig;
}

/*** Generic Rules result produced by repository evaluation. */
export type RepositoryEvaluationResult = RuleEvaluationResult;
