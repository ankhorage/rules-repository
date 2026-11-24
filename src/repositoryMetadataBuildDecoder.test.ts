import { expect, test } from 'bun:test';

import { decodeRepositoryMetadata } from './index.js';

test('decodes independently declared native and web build targets', () => {
  const document = {
    ...metadata(),
    build: {
      targets: {
        native: {
          builder: { script: 'build' },
          entry: '.',
          framework: 'react-native',
          language: 'typescript',
          outDir: 'dist',
          platforms: ['ios', 'android', 'web'],
          sources: { include: ['src/**/*.ts', 'src/**/*.tsx'] },
        },
        web: {
          builder: { script: 'build' },
          entry: './web/*',
          framework: 'react',
          language: 'typescript',
          outDir: 'web-dist',
          platforms: ['web'],
          sources: { include: ['src/features/**/public.ts', 'src/authoring.browser.ts'] },
        },
      },
    },
  };
  expect(decodeRepositoryMetadata(document)).toEqual({ document, ok: true });
});

test('rejects unsupported build target members', () => {
  expect(
    decodeRepositoryMetadata({
      ...metadata(),
      build: {
        targets: {
          web: {
            entry: './web',
            framework: 'react',
            language: 'typescript',
            outDir: 'web-dist',
            platforms: ['web'],
            unsupported: true,
          },
        },
      },
    }),
  ).toEqual({
    diagnostics: [
      {
        code: 'unexpected-property',
        message: 'Property is not supported by RepositoryMetadata v1.',
        path: '#/build/targets/web/unsupported',
      },
    ],
    ok: false,
  });
});

function metadata() {
  return {
    kind: 'library' as const,
    purpose: 'Validate repository metadata.',
    schemaVersion: 1 as const,
    summary: 'Valid metadata.',
    title: 'Repository metadata',
  };
}
