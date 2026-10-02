# Public API

## createRepositoryRuleSet

Kind: `function`
Module: `src/features/evaluation/domain/createRepositoryRuleSet.ts`
Source: `src/features/evaluation/domain/createRepositoryRuleSet.ts:12:1`

Create canonical repository, package, runtime, dependency, and CLI compliance rules.

### Signatures

- `() => RuleSet<RepositoryRuleContext>`
  - returns: `RuleSet<RepositoryRuleContext>`

## evaluateRepository

Kind: `function`
Module: `src/features/evaluation/domain/evaluateRepository.ts`
Source: `src/features/evaluation/domain/evaluateRepository.ts:11:1`

Evaluate normalized repository facts through the canonical repository RuleSet.

### Signatures

- `(context: RepositoryRuleContext, options?: RepositoryEvaluationOptions) => import("@ankhorage/rules").RuleEvaluationResult`
  - context: `RepositoryRuleContext`
  - options: `RepositoryEvaluationOptions` (optional)
  - returns: `import("@ankhorage/rules").RuleEvaluationResult`

## REPOSITORY_RULE_IDS

Kind: `value`
Module: `src/constants/repositoryRuleIds.ts`
Source: `src/constants/repositoryRuleIds.ts:2:14`

Stable repository rule identities preserved across the Policy-to-Rules migration.

## REPOSITORY_RULE_METADATA

Kind: `value`
Module: `src/constants/repository.ts`
Source: `src/constants/repository.ts:4:14`

Canonical repository metadata used by validators and managed-file renderers.

## RepositoryCliCommandFact

Kind: `type`
Module: `src/types/repository.ts`
Source: `src/types/repository.ts:24:1`

One normalized public CLI command and its implementation source.

### Members

| Name | Kind | Type | Required | Description |
| --- | --- | --- | --- | --- |
| commandPath | property | `readonly string[]` | yes |  |
| sourcePath | property | `string` | yes |  |

## RepositoryDependencyFact

Kind: `type`
Module: `src/types/repository.ts`
Source: `src/types/repository.ts:10:1`

One package dependency fact normalized across dependency sections.

### Members

| Name | Kind | Type | Required | Description |
| --- | --- | --- | --- | --- |
| name | property | `string` | yes |  |
| section | property | `"dependencies" \| "devDependencies" \| "optionalDependencies" \| "peerDependencies"` | yes |  |
| value | property | `string` | yes |  |

## RepositoryEvaluationOptions

Kind: `type`
Module: `src/types/repository.ts`
Source: `src/types/repository.ts:48:1`

Optional generic Rules configuration applied to repository rules.

### Members

| Name | Kind | Type | Required | Description |
| --- | --- | --- | --- | --- |
| config | property | `RulesConfig \| undefined` | no |  |

## RepositoryEvaluationResult

Kind: `unknown`
Module: `src/types/repository.ts`
Source: `src/types/repository.ts:53:1`

Generic Rules result produced by repository evaluation.

## RepositoryImportFact

Kind: `type`
Module: `src/types/repository.ts`
Source: `src/types/repository.ts:18:1`

One source import fact used for current-only package-boundary checks.

### Members

| Name | Kind | Type | Required | Description |
| --- | --- | --- | --- | --- |
| path | property | `string` | yes |  |
| specifier | property | `string` | yes |  |

## RepositoryPackageFact

Kind: `type`
Module: `src/types/repository.ts`
Source: `src/types/repository.ts:30:1`

Portable package.json facts required by repository rules.

### Members

| Name | Kind | Type | Required | Description |
| --- | --- | --- | --- | --- |
| dependencies | property | `readonly RepositoryDependencyFact[]` | yes |  |
| exports | property | `readonly string[]` | yes |  |
| fields | property | `Readonly<Record<string, JsonValue \| undefined>>` | yes |  |
| packageManager | property | `string \| undefined` | no |  |
| scripts | property | `Readonly<Record<string, string>>` | yes |  |

## RepositoryPathFact

Kind: `type`
Module: `src/types/repository.ts`
Source: `src/types/repository.ts:4:1`

One repository path fact independent of filesystem implementation.

### Members

| Name | Kind | Type | Required | Description |
| --- | --- | --- | --- | --- |
| kind | property | `"directory" \| "file"` | yes |  |
| path | property | `string` | yes |  |

## RepositoryRuleContext

Kind: `type`
Module: `src/types/repository.ts`
Source: `src/types/repository.ts:39:1`

Portable repository facts evaluated independently of filesystem and parser technology.

### Members

| Name | Kind | Type | Required | Description |
| --- | --- | --- | --- | --- |
| cliCommands | property | `readonly RepositoryCliCommandFact[]` | yes |  |
| imports | property | `readonly RepositoryImportFact[]` | yes |  |
| packageJson | property | `RepositoryPackageFact` | yes |  |
| paths | property | `readonly RepositoryPathFact[]` | yes |  |
| workflowBunVersions | property | `Readonly<Record<string, string \| undefined>>` | yes |  |
