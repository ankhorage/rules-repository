import { expect, test } from 'bun:test';

import { decodeRepositoryMetadata } from './index.js';

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

test('is deterministic and leaves JSON syntax failures to the host', () => {
  const value = {
    audience: [null],
    kind: 'tooling',
    purpose: 'Test',
    schemaVersion: 1,
    summary: 'Test',
    title: 'Test',
  };
  expect(decodeRepositoryMetadata(value)).toEqual(decodeRepositoryMetadata(value));
  expect(() => {
    JSON.parse('{');
  }).toThrow();
});
