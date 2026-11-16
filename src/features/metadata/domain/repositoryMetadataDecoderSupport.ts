import type {
  RepositoryImplementationRef,
  RepositoryMetadataArchitecture,
  RepositoryMetadataConstraints,
} from '@ankhorage/contracts/metadata';

import type { RepositoryMetadataDecodeDiagnostic } from '../../../types/repository.js';

const ARCHITECTURE_PROPERTIES = new Set(['invariants', 'role']);
const CONSTRAINT_PROPERTIES = new Set(['configuration', 'limitations', 'platforms', 'security']);
const IMPLEMENTATION_PROPERTIES = new Set(['interfaceId', 'packageName', 'subpath']);

export type JsonObject = Readonly<Record<string, unknown>>;

export interface DecodedValue<Value> {
  readonly diagnostics: readonly RepositoryMetadataDecodeDiagnostic[];
  readonly value: Value | undefined;
}

interface JsonProperty {
  readonly exists: boolean;
  readonly value: unknown;
}

/*** Keep structural decoding primitives private to the metadata feature boundary. */
export const repositoryMetadataDecoderSupport = {
  decodeOptionalArchitecture,
  decodeOptionalConstraints,
  decodeOptionalImplementationReferences,
  decodeOptionalStringArray,
  decodeString,
  failed,
  isJsonObject,
  readOwnProperty,
  unexpectedProperties,
} as const;

/*** Decode one string while preserving valid empty strings for policy evaluation. */
function decodeString(value: unknown, path: string): DecodedValue<string> {
  return typeof value === 'string'
    ? { diagnostics: [], value }
    : failed(path, 'expected-string', 'Value must be a string.');
}

/*** Decode one optional array of authored strings. */
function decodeOptionalStringArray(
  property: JsonProperty,
  path: string,
): DecodedValue<readonly string[]> {
  if (!property.exists) return { diagnostics: [], value: undefined };
  const { value } = property;
  if (!Array.isArray(value)) {
    return failed(path, 'expected-array', 'Value must be an array of strings.');
  }
  const decodedValues = decodeArrayElements(value, (entry, index) =>
    decodeString(entry, path + '/' + index),
  );
  const diagnostics = decodedValues.flatMap(
    ({ diagnostics: entryDiagnostics }) => entryDiagnostics,
  );
  const values = decodedValues.flatMap(({ value: entry }) => (entry === undefined ? [] : [entry]));
  return diagnostics.length > 0
    ? { diagnostics, value: undefined }
    : { diagnostics: [], value: values };
}

/*** Decode the optional architectural facts object. */
function decodeOptionalArchitecture(
  property: JsonProperty,
): DecodedValue<RepositoryMetadataArchitecture> {
  if (!property.exists) return { diagnostics: [], value: undefined };
  const { value } = property;
  if (!isJsonObject(value)) {
    return failed('#/architecture', 'expected-object', 'architecture must be an object.');
  }
  const role = decodeOptionalString(readOwnProperty(value, 'role'), '#/architecture/role');
  const invariants = decodeOptionalStringArray(
    readOwnProperty(value, 'invariants'),
    '#/architecture/invariants',
  );
  const diagnostics = [
    ...unexpectedProperties(value, ARCHITECTURE_PROPERTIES, '#/architecture'),
    ...role.diagnostics,
    ...invariants.diagnostics,
  ];
  return diagnostics.length > 0
    ? { diagnostics, value: undefined }
    : {
        diagnostics: [],
        value: {
          ...(invariants.value === undefined ? {} : { invariants: invariants.value }),
          ...(role.value === undefined ? {} : { role: role.value }),
        },
      };
}

/*** Decode explicit implementation relationships without consulting host state. */
function decodeOptionalImplementationReferences(
  property: JsonProperty,
): DecodedValue<readonly RepositoryImplementationRef[]> {
  if (!property.exists) return { diagnostics: [], value: undefined };
  const { value } = property;
  if (!Array.isArray(value)) {
    return failed('#/implements', 'expected-array', 'implements must be an array of objects.');
  }
  const decodedReferences = decodeArrayElements(value, (entry, index) =>
    decodeImplementationReference(entry, index),
  );
  const diagnostics = decodedReferences.flatMap(
    ({ diagnostics: entryDiagnostics }) => entryDiagnostics,
  );
  const references = decodedReferences.flatMap(({ value: reference }) =>
    reference === undefined ? [] : [reference],
  );
  return diagnostics.length > 0
    ? { diagnostics, value: undefined }
    : { diagnostics: [], value: references };
}

/*** Decode one implementation reference shape while leaving authored-value policy to preflight. */
function decodeImplementationReference(
  value: unknown,
  index: number,
): DecodedValue<RepositoryImplementationRef> {
  const path = '#/implements/' + index;
  if (!isJsonObject(value)) {
    return failed(path, 'expected-object', 'Implementation reference must be an object.');
  }
  const packageName = decodeRequiredString(readOwnProperty(value, 'packageName'), path);
  const subpath = decodeOptionalString(readOwnProperty(value, 'subpath'), path + '/subpath');
  const interfaceId = decodeOptionalString(
    readOwnProperty(value, 'interfaceId'),
    path + '/interfaceId',
  );
  const diagnostics = [
    ...unexpectedProperties(value, IMPLEMENTATION_PROPERTIES, path),
    ...packageName.diagnostics,
    ...subpath.diagnostics,
    ...interfaceId.diagnostics,
  ];
  return diagnostics.length > 0 || packageName.value === undefined
    ? { diagnostics, value: undefined }
    : {
        diagnostics: [],
        value: {
          ...(interfaceId.value === undefined ? {} : { interfaceId: interfaceId.value }),
          packageName: packageName.value,
          ...(subpath.value === undefined ? {} : { subpath: subpath.value }),
        },
      };
}

/*** Decode the optional evidence-backed constraints object. */
function decodeOptionalConstraints(
  property: JsonProperty,
): DecodedValue<RepositoryMetadataConstraints> {
  if (!property.exists) return { diagnostics: [], value: undefined };
  const { value } = property;
  if (!isJsonObject(value)) {
    return failed('#/constraints', 'expected-object', 'constraints must be an object.');
  }
  const platforms = decodeOptionalStringArray(
    readOwnProperty(value, 'platforms'),
    '#/constraints/platforms',
  );
  const configuration = decodeOptionalStringArray(
    readOwnProperty(value, 'configuration'),
    '#/constraints/configuration',
  );
  const security = decodeOptionalStringArray(
    readOwnProperty(value, 'security'),
    '#/constraints/security',
  );
  const limitations = decodeOptionalStringArray(
    readOwnProperty(value, 'limitations'),
    '#/constraints/limitations',
  );
  const diagnostics = [
    ...unexpectedProperties(value, CONSTRAINT_PROPERTIES, '#/constraints'),
    ...platforms.diagnostics,
    ...configuration.diagnostics,
    ...security.diagnostics,
    ...limitations.diagnostics,
  ];
  return diagnostics.length > 0
    ? { diagnostics, value: undefined }
    : {
        diagnostics: [],
        value: {
          ...(configuration.value === undefined ? {} : { configuration: configuration.value }),
          ...(limitations.value === undefined ? {} : { limitations: limitations.value }),
          ...(platforms.value === undefined ? {} : { platforms: platforms.value }),
          ...(security.value === undefined ? {} : { security: security.value }),
        },
      };
}

/*** Decode one optional authored string without treating absence as an empty value. */
function decodeOptionalString(property: JsonProperty, path: string): DecodedValue<string> {
  return property.exists
    ? decodeString(property.value, path)
    : { diagnostics: [], value: undefined };
}

/*** Decode one required implementation reference package name. */
function decodeRequiredString(property: JsonProperty, path: string): DecodedValue<string> {
  return property.exists
    ? decodeString(property.value, path + '/packageName')
    : failed(path + '/packageName', 'missing-required-property', 'packageName is required.');
}

/*** Decode every indexed own data element so untrusted array holes and accessors cannot be skipped or executed. */
function decodeArrayElements<Value>(
  value: readonly unknown[],
  decode: (entry: unknown, index: number) => DecodedValue<Value>,
): readonly DecodedValue<Value>[] {
  return Array.from({ length: value.length }, (_entry, index) => {
    const property = readOwnProperty(value, String(index));
    return decode(
      property.exists && property.value !== undefined ? property.value : undefined,
      index,
    );
  });
}

/*** Report unsupported object members so decoded output never silently expands Contracts v1. */
function unexpectedProperties(
  value: JsonObject,
  allowedProperties: ReadonlySet<string>,
  path: string,
): readonly RepositoryMetadataDecodeDiagnostic[] {
  return Object.keys(value)
    .filter((property) => !allowedProperties.has(property))
    .sort()
    .map((property) =>
      diagnostic(
        path + '/' + escapeJsonPointerSegment(property),
        'unexpected-property',
        'Property is not supported by RepositoryMetadata v1.',
      ),
    );
}

/*** Escape one JSON Pointer reference token according to RFC 6901. */
function escapeJsonPointerSegment(value: string): string {
  return value.replaceAll('~', '~0').replaceAll('/', '~1');
}

/*** Return one failed decoding result. */
function failed<Value>(path: string, code: string, message: string): DecodedValue<Value> {
  return { diagnostics: [diagnostic(path, code, message)], value: undefined };
}

/*** Read an own data property without invoking an untrusted accessor. */
function readOwnProperty(value: object, property: string): JsonProperty {
  const descriptor = Object.getOwnPropertyDescriptor(value, property);
  return descriptor === undefined
    ? { exists: false, value: undefined }
    : {
        exists: true,
        value: 'value' in descriptor ? descriptor.value : undefined,
      };
}

/*** Construct one stable serializable structural diagnostic. */
function diagnostic(
  path: string,
  code: string,
  message: string,
): RepositoryMetadataDecodeDiagnostic {
  return { code, message, path };
}

/*** Accept only non-array plain objects from parsed JSON. */
function isJsonObject(value: unknown): value is JsonObject {
  return (
    typeof value === 'object' &&
    value !== null &&
    !Array.isArray(value) &&
    (Object.getPrototypeOf(value) === null || Object.getPrototypeOf(value) === Object.prototype)
  );
}
