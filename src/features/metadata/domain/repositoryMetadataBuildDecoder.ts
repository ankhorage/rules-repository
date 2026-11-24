import type {
  RepositoryMetadataBuild,
  RepositoryMetadataBuildTarget,
  RepositoryMetadataBuildTargetBuilder,
  RepositoryMetadataBuildTargetSources,
} from '@ankhorage/contracts/metadata';

import {
  type DecodedValue,
  type JsonProperty,
  repositoryMetadataDecoderSupport,
} from './repositoryMetadataDecoderSupport.js';

const BUILD_PROPERTIES = new Set(['targets']);
const TARGET_PROPERTIES = new Set([
  'builder',
  'entry',
  'framework',
  'language',
  'outDir',
  'platforms',
  'sources',
]);

interface TargetFields {
  readonly entry: DecodedValue<string>;
  readonly framework: DecodedValue<string>;
  readonly language: DecodedValue<string>;
  readonly outDir: DecodedValue<string>;
  readonly platforms: DecodedValue<readonly string[]>;
}

/*** Decode portable declarative build artifacts without consulting build tooling. */
export function decodeOptionalBuild(property: JsonProperty): DecodedValue<RepositoryMetadataBuild> {
  if (!property.exists) return { diagnostics: [], value: undefined };
  if (!repositoryMetadataDecoderSupport.isJsonObject(property.value)) {
    return repositoryMetadataDecoderSupport.failed(
      '#/build',
      'expected-object',
      'build must be an object.',
    );
  }
  const targets = decodeTargets(
    repositoryMetadataDecoderSupport.readOwnProperty(property.value, 'targets'),
  );
  const diagnostics = [
    ...repositoryMetadataDecoderSupport.unexpectedProperties(
      property.value,
      BUILD_PROPERTIES,
      '#/build',
    ),
    ...targets.diagnostics,
  ];
  return diagnostics.length > 0 || targets.value === undefined
    ? { diagnostics, value: undefined }
    : { diagnostics: [], value: { targets: targets.value } };
}

/*** Decode repository-defined build targets keyed by their authored names. */
function decodeTargets(
  property: JsonProperty,
): DecodedValue<Readonly<Record<string, RepositoryMetadataBuildTarget>>> {
  if (!property.exists || !repositoryMetadataDecoderSupport.isJsonObject(property.value)) {
    return repositoryMetadataDecoderSupport.failed(
      '#/build/targets',
      'expected-object',
      'build.targets must be an object.',
    );
  }
  const targetObject = property.value;
  const decoded = Object.keys(targetObject)
    .sort()
    .map((name) => ({
      name,
      target: decodeTarget(
        repositoryMetadataDecoderSupport.readOwnProperty(targetObject, name),
        name,
      ),
    }));
  const diagnostics = decoded.flatMap(({ target }) => target.diagnostics);
  const targets = Object.fromEntries(
    decoded.flatMap(({ name, target }) =>
      target.value === undefined ? [] : [[name, target.value] as const],
    ),
  );
  return diagnostics.length > 0
    ? { diagnostics, value: undefined }
    : { diagnostics: [], value: targets };
}

/*** Decode one build target and its optional sources and builder references. */
function decodeTarget(
  property: JsonProperty,
  name: string,
): DecodedValue<RepositoryMetadataBuildTarget> {
  const path = '#/build/targets/' + name.replaceAll('~', '~0').replaceAll('/', '~1');
  if (!property.exists || !repositoryMetadataDecoderSupport.isJsonObject(property.value)) {
    return repositoryMetadataDecoderSupport.failed(
      path,
      'expected-object',
      'Build target must be an object.',
    );
  }
  const { value } = property;
  const fields = decodeTargetFields(value, path);
  const { builder, sources } = decodeTargetDetails(value, path);
  const diagnostics = [
    ...repositoryMetadataDecoderSupport.unexpectedProperties(value, TARGET_PROPERTIES, path),
    ...fields.entry.diagnostics,
    ...fields.framework.diagnostics,
    ...fields.language.diagnostics,
    ...fields.outDir.diagnostics,
    ...fields.platforms.diagnostics,
    ...sources.diagnostics,
    ...builder.diagnostics,
  ];
  return diagnostics.length > 0 ||
    fields.entry.value === undefined ||
    fields.framework.value === undefined ||
    fields.language.value === undefined ||
    fields.outDir.value === undefined ||
    fields.platforms.value === undefined
    ? { diagnostics, value: undefined }
    : {
        diagnostics: [],
        value: {
          ...(builder.value === undefined ? {} : { builder: builder.value }),
          entry: fields.entry.value,
          framework: fields.framework.value,
          language: fields.language.value,
          outDir: fields.outDir.value,
          platforms: fields.platforms.value,
          ...(sources.value === undefined ? {} : { sources: sources.value }),
        },
      };
}

/*** Decode the optional source and builder details of one build target. */
function decodeTargetDetails(value: object, path: string) {
  return {
    builder: decodeBuilder(
      repositoryMetadataDecoderSupport.readOwnProperty(value, 'builder'),
      path,
    ),
    sources: decodeSources(
      repositoryMetadataDecoderSupport.readOwnProperty(value, 'sources'),
      path,
    ),
  };
}

/*** Decode the required portable identity fields of one build target. */
function decodeTargetFields(value: object, path: string): TargetFields {
  return {
    entry: requiredString(value, 'entry', path),
    framework: requiredString(value, 'framework', path),
    language: requiredString(value, 'language', path),
    outDir: requiredString(value, 'outDir', path),
    platforms: requiredArray(value, 'platforms', path),
  };
}

/*** Decode optional explicit source entries and include patterns. */
function decodeSources(
  property: JsonProperty,
  targetPath: string,
): DecodedValue<RepositoryMetadataBuildTargetSources> {
  if (!property.exists) return { diagnostics: [], value: undefined };
  const path = targetPath + '/sources';
  if (!repositoryMetadataDecoderSupport.isJsonObject(property.value))
    return repositoryMetadataDecoderSupport.failed(
      path,
      'expected-object',
      'sources must be an object.',
    );
  const entries = repositoryMetadataDecoderSupport.decodeOptionalStringArray(
    repositoryMetadataDecoderSupport.readOwnProperty(property.value, 'entries'),
    path + '/entries',
  );
  const include = repositoryMetadataDecoderSupport.decodeOptionalStringArray(
    repositoryMetadataDecoderSupport.readOwnProperty(property.value, 'include'),
    path + '/include',
  );
  const diagnostics = [
    ...repositoryMetadataDecoderSupport.unexpectedProperties(
      property.value,
      new Set(['entries', 'include']),
      path,
    ),
    ...entries.diagnostics,
    ...include.diagnostics,
  ];
  return diagnostics.length > 0
    ? { diagnostics, value: undefined }
    : {
        diagnostics: [],
        value: {
          ...(entries.value === undefined ? {} : { entries: entries.value }),
          ...(include.value === undefined ? {} : { include: include.value }),
        },
      };
}

/*** Decode an optional repository-owned builder script reference. */
function decodeBuilder(
  property: JsonProperty,
  targetPath: string,
): DecodedValue<RepositoryMetadataBuildTargetBuilder> {
  if (!property.exists) return { diagnostics: [], value: undefined };
  const path = targetPath + '/builder';
  if (!repositoryMetadataDecoderSupport.isJsonObject(property.value))
    return repositoryMetadataDecoderSupport.failed(
      path,
      'expected-object',
      'builder must be an object.',
    );
  const script = requiredString(property.value, 'script', path);
  const diagnostics = [
    ...repositoryMetadataDecoderSupport.unexpectedProperties(
      property.value,
      new Set(['script']),
      path,
    ),
    ...script.diagnostics,
  ];
  return diagnostics.length > 0 || script.value === undefined
    ? { diagnostics, value: undefined }
    : { diagnostics: [], value: { script: script.value } };
}

/*** Decode one required text property. */
function requiredString(value: object, property: string, path: string): DecodedValue<string> {
  const field = repositoryMetadataDecoderSupport.readOwnProperty(value, property);
  return field.exists
    ? repositoryMetadataDecoderSupport.decodeString(field.value, path + '/' + property)
    : repositoryMetadataDecoderSupport.failed(
        path + '/' + property,
        'missing-required-property',
        property + ' is required.',
      );
}

/*** Decode one required array-of-text property. */
function requiredArray(
  value: object,
  property: string,
  path: string,
): DecodedValue<readonly string[]> {
  const field = repositoryMetadataDecoderSupport.readOwnProperty(value, property);
  return field.exists
    ? repositoryMetadataDecoderSupport.decodeOptionalStringArray(field, path + '/' + property)
    : repositoryMetadataDecoderSupport.failed(
        path + '/' + property,
        'missing-required-property',
        property + ' is required.',
      );
}
