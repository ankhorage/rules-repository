import type { RepositoryMetadata } from '@ankhorage/contracts/metadata';
import type {
  JsonValue,
  RuleCapability,
  RuleEvaluationResult,
  RulesConfig,
} from '@ankhorage/rules';

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
  readonly escapesRepositoryRoot?: boolean;
  readonly path: string;
  readonly specifier: string;
}

/*** One normalized public CLI command and its implementation source. */
export interface RepositoryCliCommandFact {
  readonly commandPath: readonly string[];
  readonly sourcePath: string;
}

/** The host-acquired repository metadata fact evaluated only by the explicit preflight. */
export interface RepositoryMetadataFact {
  /** Whether this repository is in the managed Ankhorage rollout population. */
  readonly managed: boolean;
  /** The profile that determines the canonical metadata path without inventing a source directory. */
  readonly profile: 'non-source' | 'source';
  /** The reason metadata is applicable or deliberately exempt from the rollout. */
  readonly eligibility: 'applicable' | 'archived' | 'legacy' | 'third-party';
  /** The discovered path of the authored JSON document, when it exists. */
  readonly path?: string;
  /** The parsed portable contract document, when it exists and was structurally readable. */
  readonly document?: RepositoryMetadata;
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
  readonly metadata?: RepositoryMetadataFact;
  readonly packageJson: RepositoryPackageFact;
  readonly paths: readonly RepositoryPathFact[];
  readonly workflowBunVersions: Readonly<Record<string, string | undefined>>;
}

/*** Optional generic Rules configuration applied to repository rules. */
export interface RepositoryEvaluationOptions {
  /** Available repository fact capabilities supplied by the fact-acquisition host. */
  readonly capabilities?: readonly RuleCapability[];
  readonly config?: RulesConfig;
}

/*** Generic Rules result produced by repository evaluation. */
export type RepositoryEvaluationResult = RuleEvaluationResult;
