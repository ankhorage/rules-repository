import { expect, test } from 'bun:test';

import { decodeRepositoryMetadata, evaluateRepositoryMetadataPreflight } from './index.js';

const METADATA_KINDS = [
  'adapter',
  'application',
  'configuration',
  'contract',
  'infrastructure',
  'library',
  'tooling',
  'website',
] as const;

test('decodes every supported kind from parsed JSON', () => {
  for (const kind of METADATA_KINDS) {
    expect(decodeRepositoryMetadata(JSON.parse(JSON.stringify(documentFor(kind))))).toEqual({
      document: documentFor(kind),
      ok: true,
    });
  }
});

test('preserves every valid optional metadata field', () => {
  const document = documentFor('adapter');

  expect(decodeRepositoryMetadata(document)).toEqual({ document, ok: true });
});

test('reports root, version, kind, and required-field diagnostics', () => {
  expect(decodeRepositoryMetadata([])).toEqual({
    diagnostics: [
      { code: 'expected-object', message: 'Metadata must be a plain JSON object.', path: '#' },
    ],
    ok: false,
  });
  expect(decodeRepositoryMetadata({ kind: 'unsupported', schemaVersion: 2, summary: 3 })).toEqual({
    diagnostics: [
      {
        code: 'expected-schema-version',
        message: 'schemaVersion must be 1.',
        path: '#/schemaVersion',
      },
      {
        code: 'expected-kind',
        message: 'kind must be a supported RepositoryMetadata v1 kind.',
        path: '#/kind',
      },
      { code: 'missing-required-property', message: 'title is required.', path: '#/title' },
      { code: 'expected-string', message: 'Value must be a string.', path: '#/summary' },
      { code: 'missing-required-property', message: 'purpose is required.', path: '#/purpose' },
    ],
    ok: false,
  });
});

test('reports malformed optional nested values with JSON-pointer paths', () => {
  const result = decodeRepositoryMetadata({
    ...documentFor('adapter'),
    architecture: { invariants: ['valid', 7], role: [] },
    constraints: { platforms: 'Node.js', unsupported: true },
    implements: [{ packageName: 5, subpath: false, unexpected: true }],
    responsibilities: ['valid', false],
  });

  expect(result).toEqual({ diagnostics: malformedNestedDiagnostics, ok: false });
});

test('rejects unsupported members without silently extending the v1 contract', () => {
  expect(decodeRepositoryMetadata({ ...documentFor('library'), extra: true })).toEqual({
    diagnostics: [
      {
        code: 'unexpected-property',
        message: 'Property is not supported by RepositoryMetadata v1.',
        path: '#/extra',
      },
    ],
    ok: false,
  });
});

test('is deterministic and leaves JSON syntax failures to the host', () => {
  const value = { ...documentFor('tooling'), audience: [null] };

  expect(decodeRepositoryMetadata(value)).toEqual(decodeRepositoryMetadata(value));
  expect(() => {
    JSON.parse('{');
  }).toThrow();
});

test('rejects present non-JSON properties without invoking accessors', () => {
  let accessorReads = 0;
  const accessorDocument = documentFor('tooling');
  Object.defineProperty(accessorDocument, 'title', {
    enumerable: true,
    get() {
      accessorReads += 1;
      return 'must not be read';
    },
  });

  expect(decodeRepositoryMetadata(accessorDocument)).toEqual({
    diagnostics: [{ code: 'expected-string', message: 'Value must be a string.', path: '#/title' }],
    ok: false,
  });
  expect(accessorReads).toBe(0);
  expect(decodeRepositoryMetadata({ ...documentFor('tooling'), domain: undefined })).toEqual({
    diagnostics: [
      { code: 'expected-string', message: 'Value must be a string.', path: '#/domain' },
    ],
    ok: false,
  });
});

test('leaves meaningful-text and implementation-reference policy to existing preflight rules', () => {
  const decoded = decodeRepositoryMetadata({
    ...documentFor('adapter'),
    implements: [{ packageName: ' ', subpath: 'db' }],
    title: 'TODO',
  });

  expect(decoded.ok).toBe(true);
  if (!decoded.ok) throw new Error('Expected structurally valid metadata.');

  const preflight = evaluateRepositoryMetadataPreflight({
    cliCommands: [],
    imports: [],
    metadata: {
      document: decoded.document,
      eligibility: 'applicable',
      managed: true,
      path: 'src/metadata/repository.json',
      profile: 'source',
    },
    packageJson: { dependencies: [], exports: [], fields: {}, scripts: {} },
    paths: [],
    workflowBunVersions: {},
  });

  expect(preflight.findings.map(({ ruleId }) => ruleId)).toEqual([
    'repository.metadata.implements.valid',
    'repository.metadata.text.meaningful',
  ]);
});
const malformedNestedDiagnostics = [
  { code: 'expected-string', message: 'Value must be a string.', path: '#/responsibilities/1' },
  { code: 'expected-string', message: 'Value must be a string.', path: '#/architecture/role' },
  {
    code: 'expected-string',
    message: 'Value must be a string.',
    path: '#/architecture/invariants/1',
  },
  {
    code: 'unexpected-property',
    message: 'Property is not supported by RepositoryMetadata v1.',
    path: '#/implements/0/unexpected',
  },
  {
    code: 'expected-string',
    message: 'Value must be a string.',
    path: '#/implements/0/packageName',
  },
  { code: 'expected-string', message: 'Value must be a string.', path: '#/implements/0/subpath' },
  {
    code: 'unexpected-property',
    message: 'Property is not supported by RepositoryMetadata v1.',
    path: '#/constraints/unsupported',
  },
  {
    code: 'expected-array',
    message: 'Value must be an array of strings.',
    path: '#/constraints/platforms',
  },
] as const;

/*** Construct valid Contract-v1 metadata with every optional field represented. */
function documentFor(kind: (typeof METADATA_KINDS)[number]) {
  return {
    architecture: { invariants: ['Remain portable.'], role: 'Reusable package.' },
    audience: ['Package consumers.'],
    boundaries: ['Does not read repositories.'],
    constraints: {
      configuration: ['Uses explicit configuration.'],
      limitations: ['Requires parsed JSON input.'],
      platforms: ['Node.js'],
      security: ['Does not execute metadata.'],
    },
    domain: 'repository policy',
    implements: [
      {
        interfaceId: 'RepositoryMetadataDecoder',
        packageName: '@ankhorage/contracts',
        subpath: './metadata',
      },
    ],
    kind,
    purpose: 'Provide a canonical runtime metadata decoder.',
    responsibilities: ['Decode portable repository metadata.'],
    schemaVersion: 1 as const,
    summary: 'Decodes repository metadata without host integration.',
    title: 'Repository metadata decoder',
    useCases: ['Validate parsed metadata before repository policy evaluation.'],
  };
}
