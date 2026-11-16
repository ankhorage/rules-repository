import type { RepositoryMetadata, RepositoryMetadataKind } from '@ankhorage/contracts/metadata';

import type {
  RepositoryMetadataDecodeDiagnostic,
  RepositoryMetadataDecodeResult,
} from '../../../types/repository.js';
import {
  type DecodedValue,
  type JsonObject,
  repositoryMetadataDecoderSupport,
} from './repositoryMetadataDecoderSupport.js';

const METADATA_KINDS: readonly RepositoryMetadataKind[] = [
  'adapter',
  'application',
  'configuration',
  'contract',
  'infrastructure',
  'library',
  'tooling',
  'website',
];
const DOCUMENT_PROPERTIES = new Set([
  'architecture',
  'audience',
  'boundaries',
  'constraints',
  'domain',
  'implements',
  'kind',
  'purpose',
  'responsibilities',
  'schemaVersion',
  'summary',
  'title',
  'useCases',
]);

interface RequiredDocumentFields {
  readonly kind: RepositoryMetadataKind;
  readonly purpose: string;
  readonly schemaVersion: 1;
  readonly summary: string;
  readonly title: string;
}

type OptionalDocumentFields = Omit<RepositoryMetadata, keyof RequiredDocumentFields>;

interface OptionalTextFields {
  readonly audience: DecodedValue<readonly string[]>;
  readonly boundaries: DecodedValue<readonly string[]>;
  readonly responsibilities: DecodedValue<readonly string[]>;
  readonly useCases: DecodedValue<readonly string[]>;
}

/*** Decode untrusted parsed JSON into canonical RepositoryMetadata v1. */
export function decodeRepositoryMetadata(value: unknown): RepositoryMetadataDecodeResult {
  const document = decodeDocument(value);
  return document.value === undefined
    ? { diagnostics: document.diagnostics, ok: false }
    : { document: document.value, ok: true };
}

/*** Decode the document after proving its root is a plain JSON object. */
function decodeDocument(value: unknown): DecodedValue<RepositoryMetadata> {
  if (!repositoryMetadataDecoderSupport.isJsonObject(value))
    return repositoryMetadataDecoderSupport.failed(
      '#',
      'expected-object',
      'Metadata must be a plain JSON object.',
    );
  const required = decodeRequiredDocumentFields(value);
  const optional = decodeOptionalDocumentFields(value);
  const diagnostics = [
    ...repositoryMetadataDecoderSupport.unexpectedProperties(value, DOCUMENT_PROPERTIES, '#'),
    ...required.diagnostics,
    ...optional.diagnostics,
  ];
  return diagnostics.length > 0 || required.value === undefined || optional.value === undefined
    ? { diagnostics, value: undefined }
    : { diagnostics: [], value: { ...optional.value, ...required.value } };
}

/*** Decode mandatory Contract-v1 properties. */
function decodeRequiredDocumentFields(value: JsonObject): DecodedValue<RequiredDocumentFields> {
  const schemaVersionProperty = repositoryMetadataDecoderSupport.readOwnProperty(
    value,
    'schemaVersion',
  );
  const kindProperty = repositoryMetadataDecoderSupport.readOwnProperty(value, 'kind');
  const schemaVersion = schemaVersionProperty.value === 1 ? 1 : undefined;
  const kind = isMetadataKind(kindProperty.value) ? kindProperty.value : undefined;
  const title = requiredString(value, 'title');
  const summary = requiredString(value, 'summary');
  const purpose = requiredString(value, 'purpose');
  const diagnostics = [
    ...(schemaVersion === undefined
      ? [diagnostic('#/schemaVersion', 'expected-schema-version', 'schemaVersion must be 1.')]
      : []),
    ...(kind === undefined
      ? [
          diagnostic(
            '#/kind',
            'expected-kind',
            'kind must be a supported RepositoryMetadata v1 kind.',
          ),
        ]
      : []),
    ...title.diagnostics,
    ...summary.diagnostics,
    ...purpose.diagnostics,
  ];
  return diagnostics.length > 0 ||
    schemaVersion === undefined ||
    kind === undefined ||
    title.value === undefined ||
    summary.value === undefined ||
    purpose.value === undefined
    ? { diagnostics, value: undefined }
    : {
        diagnostics: [],
        value: {
          kind,
          purpose: purpose.value,
          schemaVersion,
          summary: summary.value,
          title: title.value,
        },
      };
}

/*** Decode optional Contract-v1 properties without making any of them mandatory. */
function decodeOptionalDocumentFields(value: JsonObject): DecodedValue<OptionalDocumentFields> {
  const domain = optionalString(value, 'domain', '#/domain');
  const text = decodeOptionalTextFields(value);
  const { audience, boundaries, responsibilities, useCases } = text;
  const architecture = repositoryMetadataDecoderSupport.decodeOptionalArchitecture(
    repositoryMetadataDecoderSupport.readOwnProperty(value, 'architecture'),
  );
  const implementsReferences =
    repositoryMetadataDecoderSupport.decodeOptionalImplementationReferences(
      repositoryMetadataDecoderSupport.readOwnProperty(value, 'implements'),
    );
  const constraints = repositoryMetadataDecoderSupport.decodeOptionalConstraints(
    repositoryMetadataDecoderSupport.readOwnProperty(value, 'constraints'),
  );
  const diagnostics = [
    domain,
    audience,
    boundaries,
    responsibilities,
    useCases,
    architecture,
    implementsReferences,
    constraints,
  ].flatMap(({ diagnostics: fieldDiagnostics }) => fieldDiagnostics);
  return diagnostics.length > 0
    ? { diagnostics, value: undefined }
    : {
        diagnostics: [],
        value: optionalDocumentValue(domain, text, architecture, implementsReferences, constraints),
      };
}

/*** Decode all optional text-array fields while preserving their authored presence. */
function decodeOptionalTextFields(value: JsonObject): OptionalTextFields {
  return {
    audience: repositoryMetadataDecoderSupport.decodeOptionalStringArray(
      repositoryMetadataDecoderSupport.readOwnProperty(value, 'audience'),
      '#/audience',
    ),
    boundaries: repositoryMetadataDecoderSupport.decodeOptionalStringArray(
      repositoryMetadataDecoderSupport.readOwnProperty(value, 'boundaries'),
      '#/boundaries',
    ),
    responsibilities: repositoryMetadataDecoderSupport.decodeOptionalStringArray(
      repositoryMetadataDecoderSupport.readOwnProperty(value, 'responsibilities'),
      '#/responsibilities',
    ),
    useCases: repositoryMetadataDecoderSupport.decodeOptionalStringArray(
      repositoryMetadataDecoderSupport.readOwnProperty(value, 'useCases'),
      '#/useCases',
    ),
  };
}

/*** Assemble decoded optional fields while preserving their authored presence. */
function optionalDocumentValue(
  domain: DecodedValue<string>,
  text: OptionalTextFields,
  architecture: ReturnType<typeof repositoryMetadataDecoderSupport.decodeOptionalArchitecture>,
  implementsReferences: ReturnType<
    typeof repositoryMetadataDecoderSupport.decodeOptionalImplementationReferences
  >,
  constraints: ReturnType<typeof repositoryMetadataDecoderSupport.decodeOptionalConstraints>,
): OptionalDocumentFields {
  return {
    ...(architecture.value === undefined ? {} : { architecture: architecture.value }),
    ...(text.audience.value === undefined ? {} : { audience: text.audience.value }),
    ...(text.boundaries.value === undefined ? {} : { boundaries: text.boundaries.value }),
    ...(constraints.value === undefined ? {} : { constraints: constraints.value }),
    ...(domain.value === undefined ? {} : { domain: domain.value }),
    ...(implementsReferences.value === undefined ? {} : { implements: implementsReferences.value }),
    ...(text.responsibilities.value === undefined
      ? {}
      : { responsibilities: text.responsibilities.value }),
    ...(text.useCases.value === undefined ? {} : { useCases: text.useCases.value }),
  };
}

/*** Decode one required authored string. */
function requiredString(value: JsonObject, property: string): DecodedValue<string> {
  const field = repositoryMetadataDecoderSupport.readOwnProperty(value, property);
  return field.exists
    ? repositoryMetadataDecoderSupport.decodeString(field.value, '#/' + property)
    : repositoryMetadataDecoderSupport.failed(
        '#/' + property,
        'missing-required-property',
        property + ' is required.',
      );
}

/*** Decode one optional authored string without treating absence as empty text. */
function optionalString(value: JsonObject, property: string, path: string): DecodedValue<string> {
  const field = repositoryMetadataDecoderSupport.readOwnProperty(value, property);
  return field.exists
    ? repositoryMetadataDecoderSupport.decodeString(field.value, path)
    : { diagnostics: [], value: undefined };
}

/*** Narrow unknown text to one supported RepositoryMetadata v1 kind. */
function isMetadataKind(value: unknown): value is RepositoryMetadataKind {
  return typeof value === 'string' && METADATA_KINDS.some((kind) => kind === value);
}

/*** Construct one stable serializable structural diagnostic. */
function diagnostic(
  path: string,
  code: string,
  message: string,
): RepositoryMetadataDecodeDiagnostic {
  return { code, message, path };
}
