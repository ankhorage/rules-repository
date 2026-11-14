import type { RepositoryMetadata } from '@ankhorage/contracts/metadata';
import type { JsonValue, Rule, RuleFinding } from '@ankhorage/rules';

import { REPOSITORY_RULE_METADATA } from '../../../../constants/repository.js';
import { REPOSITORY_RULE_IDS } from '../../../../constants/repositoryRuleIds.js';
import type {
  RepositoryMetadataFact,
  RepositoryRuleContext,
} from '../../../../types/repository.js';
import { repositoryRuleSupport } from '../../../evaluation/utils/repositoryRuleSupport.js';

const PLACEHOLDER_TEXTS = new Set(['-', 'n/a', 'none', 'tbd', 'todo', 'unknown']);
type RepositoryImplementationRef = NonNullable<RepositoryMetadata['implements']>[number];

/*** Create advisory repository-metadata rules for organization inventory and authoring.
 *
 * These rules are intentionally excluded from the default repository RuleSet. They can produce
 * deterministic preflight findings but cannot become a global CI gate until Doctor explicitly
 * selects them through its separately approved enforcement policy.
 */
export function createRepositoryMetadataRules(): readonly Rule<RepositoryRuleContext>[] {
  return [
    metadataDocumentRule(),
    metadataLocationRule(),
    metadataTextRule(),
    metadataImplementsRule(),
  ];
}

/*** Report a missing metadata document only for managed repositories eligible for this rollout. */
function metadataDocumentRule(): Rule<RepositoryRuleContext> {
  return repositoryRuleSupport.createWarningRule(
    REPOSITORY_RULE_IDS.metadataDocument,
    'Eligible managed repositories provide authored repository metadata.',
    (context) => {
      const { metadata } = context;
      if (!isApplicableMetadata(metadata) || metadata.document !== undefined) return [];

      return [
        finding(
          REPOSITORY_RULE_IDS.metadataDocument,
          'Repository metadata is required for this eligible managed repository preflight.',
          canonicalPath(metadata),
          { eligibility: metadata.eligibility, profile: metadata.profile },
        ),
      ];
    },
  );
}

/*** Report a document that was found outside its profile-owned canonical path. */
function metadataLocationRule(): Rule<RepositoryRuleContext> {
  return repositoryRuleSupport.createWarningRule(
    REPOSITORY_RULE_IDS.metadataLocation,
    'Repository metadata uses the canonical profile-owned path.',
    (context) => {
      const { metadata } = context;
      if (!isApplicableMetadata(metadata) || metadata.document === undefined) return [];

      const expectedPath = canonicalPath(metadata);
      return metadata.path === expectedPath
        ? []
        : [
            finding(
              REPOSITORY_RULE_IDS.metadataLocation,
              'Repository metadata must be at ' + expectedPath + ' for the selected profile.',
              metadata.path ?? expectedPath,
              { actualPath: metadata.path ?? null, expectedPath, profile: metadata.profile },
            ),
          ];
    },
  );
}

/*** Reject blank and placeholder authoring while keeping conditional metadata fields optional. */
function metadataTextRule(): Rule<RepositoryRuleContext> {
  return repositoryRuleSupport.createWarningRule(
    REPOSITORY_RULE_IDS.metadataText,
    'Repository metadata contains meaningful authored text.',
    (context) => {
      const { metadata } = context;
      if (!isApplicableMetadata(metadata) || metadata.document === undefined) return [];

      return textEntries(metadata.document).flatMap(({ path, value }) =>
        isMeaningfulText(value)
          ? []
          : [
              finding(
                REPOSITORY_RULE_IDS.metadataText,
                'Repository metadata text must not be blank or a placeholder.',
                path,
                { value },
              ),
            ],
      );
    },
  );
}

/*** Keep explicit implementation relations complete without conflating them with dependencies. */
function metadataImplementsRule(): Rule<RepositoryRuleContext> {
  return repositoryRuleSupport.createWarningRule(
    REPOSITORY_RULE_IDS.metadataImplements,
    'Repository metadata implementation references are complete and public-path shaped.',
    (context) => {
      const { metadata } = context;
      if (!isApplicableMetadata(metadata) || metadata.document?.implements === undefined) return [];

      return metadata.document.implements.flatMap((implementation, index) => {
        const path = canonicalPath(metadata) + '#/implements/' + index;
        return isImplementationReference(implementation)
          ? []
          : [
              finding(
                REPOSITORY_RULE_IDS.metadataImplements,
                'Implementation references require a package name and public-shaped optional subpath/interface ID.',
                path,
                implementation,
              ),
            ];
      });
    },
  );
}

/*** Return whether metadata policy applies to this exact repository fact. */
function isApplicableMetadata(
  metadata: RepositoryMetadataFact | undefined,
): metadata is RepositoryMetadataFact {
  return metadata?.managed === true && metadata.eligibility === 'applicable';
}

/*** Resolve the canonical metadata path from the explicit repository profile. */
function canonicalPath(metadata: RepositoryMetadataFact): string {
  return metadata.profile === 'source'
    ? REPOSITORY_RULE_METADATA.metadata.profiles.source.canonicalPath
    : REPOSITORY_RULE_METADATA.metadata.profiles.nonSource.canonicalPath;
}

/*** Return all required and conditionally authored textual metadata values with JSON-pointer paths. */
function textEntries(document: RepositoryMetadata): readonly { path: string; value: string }[] {
  return [
    { path: '#/title', value: document.title },
    { path: '#/summary', value: document.summary },
    { path: '#/purpose', value: document.purpose },
    ...(document.domain === undefined ? [] : [{ path: '#/domain', value: document.domain }]),
    ...arrayTextEntries('responsibilities', document.responsibilities),
    ...arrayTextEntries('boundaries', document.boundaries),
    ...arrayTextEntries('audience', document.audience),
    ...arrayTextEntries('useCases', document.useCases),
    ...(document.architecture?.role === undefined
      ? []
      : [{ path: '#/architecture/role', value: document.architecture.role }]),
    ...arrayTextEntries('architecture/invariants', document.architecture?.invariants),
    ...arrayTextEntries('constraints/platforms', document.constraints?.platforms),
    ...arrayTextEntries('constraints/configuration', document.constraints?.configuration),
    ...arrayTextEntries('constraints/security', document.constraints?.security),
    ...arrayTextEntries('constraints/limitations', document.constraints?.limitations),
  ];
}

/*** Return individual JSON-pointer entries for one optional array of authored text. */
function arrayTextEntries(
  property: string,
  values: readonly string[] | undefined,
): readonly { path: string; value: string }[] {
  return values?.map((value, index) => ({ path: '#/' + property + '/' + index, value })) ?? [];
}

/*** Return whether one authored string contains more than a common placeholder token. */
function isMeaningfulText(value: string): boolean {
  const normalized = value.trim().toLowerCase();
  return normalized.length > 0 && !PLACEHOLDER_TEXTS.has(normalized);
}

/*** Verify one explicit implementation reference without inspecting dependencies or consumers. */
function isImplementationReference(
  value: RepositoryImplementationRef,
): value is RepositoryImplementationRef {
  return (
    isMeaningfulText(value.packageName) &&
    (value.subpath === undefined || (value.subpath.startsWith('./') && value.subpath.length > 2)) &&
    (value.interfaceId === undefined || isMeaningfulText(value.interfaceId))
  );
}

/*** Create one advisory preflight finding with serializable metadata evidence. */
function finding(ruleId: string, message: string, path: string, evidence: JsonValue): RuleFinding {
  return { ...repositoryRuleSupport.finding(ruleId, message, path, evidence), severity: 'warning' };
}
