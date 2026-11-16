import type { RepositoryImplementationRef } from '@ankhorage/contracts/metadata';

const PLACEHOLDER_TEXTS = new Set(['-', 'n/a', 'none', 'tbd', 'todo', 'unknown']);

/*** Reuse repository-metadata authoring policy independently of metadata acquisition. */
export const repositoryMetadataPolicy = {
  isImplementationReference,
  isMeaningfulText,
} as const;

/*** Return whether one authored string contains more than a common placeholder token. */
function isMeaningfulText(value: string): boolean {
  const normalized = value.trim().toLowerCase();
  return normalized.length > 0 && !PLACEHOLDER_TEXTS.has(normalized);
}

/*** Verify one explicit implementation reference without inspecting dependencies or consumers. */
function isImplementationReference(value: RepositoryImplementationRef): boolean {
  return (
    isMeaningfulText(value.packageName) &&
    (value.subpath === undefined || (value.subpath.startsWith('./') && value.subpath.length > 2)) &&
    (value.interfaceId === undefined || isMeaningfulText(value.interfaceId))
  );
}
