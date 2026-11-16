# Public API

## createRepositoryMetadataPreflightRuleSet

Kind: `function`
Module: `src/features/metadata/domain/createRepositoryMetadataPreflightRuleSet.ts`
Source: `src/features/metadata/domain/createRepositoryMetadataPreflightRuleSet.ts:7:1`

Create the report-only repository metadata RuleSet for organization inventory preflight.

### Signatures

- `() => RuleSet<RepositoryRuleContext>`
  - returns: `RuleSet<RepositoryRuleContext>`

## createRepositoryRuleSet

Kind: `function`
Module: `src/features/evaluation/domain/createRepositoryRuleSet.ts`
Source: `src/features/evaluation/domain/createRepositoryRuleSet.ts:12:1`

Create canonical repository, package, runtime, dependency, and CLI compliance rules.

### Signatures

- `() => RuleSet<RepositoryRuleContext>`
  - returns: `RuleSet<RepositoryRuleContext>`

## decodeRepositoryMetadata

Kind: `function`
Module: `src/features/metadata/domain/decodeRepositoryMetadata.ts`
Source: `src/features/metadata/domain/decodeRepositoryMetadata.ts:57:1`

Decode untrusted parsed JSON into canonical RepositoryMetadata v1.

### Signatures

- `(value: unknown) => RepositoryMetadataDecodeResult`
  - value: `unknown`
  - returns: `RepositoryMetadataDecodeResult`

## evaluateRepository

Kind: `function`
Module: `src/features/evaluation/domain/evaluateRepository.ts`
Source: `src/features/evaluation/domain/evaluateRepository.ts:12:1`

Evaluate normalized repository facts through the canonical repository RuleSet.

### Signatures

- `(context: RepositoryRuleContext, options?: RepositoryEvaluationOptions) => import("@ankhorage/rules").RuleEvaluationResult`
  - context: `RepositoryRuleContext`
  - options: `RepositoryEvaluationOptions` (optional)
  - returns: `import("@ankhorage/rules").RuleEvaluationResult`

## evaluateRepositoryMetadataPreflight

Kind: `function`
Module: `src/features/metadata/domain/evaluateRepositoryMetadataPreflight.ts`
Source: `src/features/metadata/domain/evaluateRepositoryMetadataPreflight.ts:12:1`

Evaluate advisory repository metadata facts without adding a global repository enforcement rule.

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
Source: `src/constants/repository.ts:7:14`

Canonical repository metadata used by validators and managed-file renderers.

## RepositoryCliCommandFact

Kind: `type`
Module: `src/types/repository.ts`
Source: `src/types/repository.ts:43:1`

One normalized public CLI command and its implementation source.

### Members

| Name | Kind | Type | Required | Description |
| --- | --- | --- | --- | --- |
| commandPath | property | `readonly string[]` | yes |  |
| sourcePath | property | `string` | yes |  |

## RepositoryDependencyFact

Kind: `type`
Module: `src/types/repository.ts`
Source: `src/types/repository.ts:28:1`

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
Source: `src/types/repository.ts:82:1`

Optional generic Rules configuration applied to repository rules.

### Members

| Name | Kind | Type | Required | Description |
| --- | --- | --- | --- | --- |
| capabilities | property | `readonly string[] \| undefined` | no |  |
| config | property | `RulesConfig \| undefined` | no |  |

## RepositoryEvaluationResult

Kind: `unknown`
Module: `src/types/repository.ts`
Source: `src/types/repository.ts:89:1`

Generic Rules result produced by repository evaluation.

## RepositoryImportFact

Kind: `type`
Module: `src/types/repository.ts`
Source: `src/types/repository.ts:36:1`

One source import fact used for current-only package-boundary checks.

### Members

| Name | Kind | Type | Required | Description |
| --- | --- | --- | --- | --- |
| escapesRepositoryRoot | property | `boolean \| undefined` | no |  |
| path | property | `string` | yes |  |
| specifier | property | `string` | yes |  |

## RepositoryMetadataDecodeDiagnostic

Kind: `type`
Module: `src/types/repository.ts`
Source: `src/types/repository.ts:10:1`

### Members

| Name | Kind | Type | Required | Description |
| --- | --- | --- | --- | --- |
| code | property | `string` | yes |  |
| message | property | `string` | yes |  |
| path | property | `string` | yes |  |

## RepositoryMetadataDecodeResult

Kind: `unknown`
Module: `src/types/repository.ts`
Source: `src/types/repository.ts:17:1`

## RepositoryMetadataFact

Kind: `type`
Module: `src/types/repository.ts`
Source: `src/types/repository.ts:49:1`

### Members

| Name | Kind | Type | Required | Description |
| --- | --- | --- | --- | --- |
| document | property | `RepositoryMetadata \| undefined` | no |  |
| eligibility | property | `"applicable" \| "archived" \| "legacy" \| "third-party"` | yes |  |
| managed | property | `boolean` | yes |  |
| path | property | `string \| undefined` | no |  |
| profile | property | `"non-source" \| "source"` | yes |  |

## RepositoryPackageFact

Kind: `type`
Module: `src/types/repository.ts`
Source: `src/types/repository.ts:63:1`

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
Source: `src/types/repository.ts:22:1`

One repository path fact independent of filesystem implementation.

### Members

| Name | Kind | Type | Required | Description |
| --- | --- | --- | --- | --- |
| kind | property | `"directory" \| "file"` | yes |  |
| path | property | `string` | yes |  |

## RepositoryRuleContext

Kind: `type`
Module: `src/types/repository.ts`
Source: `src/types/repository.ts:72:1`

Portable repository facts evaluated independently of filesystem and parser technology.

### Members

| Name | Kind | Type | Required | Description |
| --- | --- | --- | --- | --- |
| cliCommands | property | `readonly RepositoryCliCommandFact[]` | yes |  |
| imports | property | `readonly RepositoryImportFact[]` | yes |  |
| metadata | property | `RepositoryMetadataFact \| undefined` | no |  |
| packageJson | property | `RepositoryPackageFact` | yes |  |
| paths | property | `readonly RepositoryPathFact[]` | yes |  |
| workflowBunVersions | property | `Readonly<Record<string, string \| undefined>>` | yes |  |
