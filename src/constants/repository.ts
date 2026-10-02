import { REPOSITORY_RULE_IDS as rules } from './repositoryRuleIds.js';

/*** Canonical repository metadata used by validators and managed-file renderers. */
export const REPOSITORY_RULE_METADATA = {
  changesets: {
    binaryName: 'ankhorage-changeset',
    ownerPackageScripts: {
      changeset: 'bun src/cli/bin/changeset.ts',
      'changeset:status': 'bun src/cli/bin/changeset.ts status --since=origin/main',
      'version-packages': 'bun src/cli/bin/changeset.ts version',
    },
    packageName: '@changesets/cli',
    packageScripts: {
      changeset: 'ankhorage-changeset',
      'changeset:status': 'ankhorage-changeset status --since=origin/main',
      'version-packages': 'ankhorage-changeset version',
    },
    workflowCommands: {
      publish: 'bun run changeset -- publish',
      status: 'bun run changeset:status',
      version: 'bun run version-packages',
    },
  },
  cli: {
    commandsRoot: 'src/cli/commands',
    legacyRootFile: 'src/cli.ts',
    packageExport: './cli',
    sourceRoot: 'src/cli',
  },
  dependencies: {
    compatibilityPackagePrefix: '@ankh/',
    legacySourceMarker: 'ankhorage4',
    localProtocolPrefixes: ['file:', 'link:', 'workspace:', 'github:', 'git:', 'git+'],
  },
  pkgvizAudit: {
    artifactName: 'pkgviz-audit',
    artifactPath: 'src/pkgviz-audit.json',
    command: 'cd src && bunx pkgviz@0.8.1 --out pkgviz-audit.json --rule cyclic-dependencies=block',
    rule: 'cyclic-dependencies=block',
    toolVersion: '0.8.1',
  },
  publicPackage: {
    dependencyRules: {
      bunTypes: rules.dependencyBunTypes,
      changesets: rules.dependencyChangesets,
      devtools: rules.dependencyDevtools,
      nodeTypes: rules.dependencyNodeTypes,
      paradox: rules.dependencyParadox,
      typescript: rules.dependencyTypescript,
    },
    packageManager: {
      bunRuleId: rules.packageManagerBun,
      requiredRuleId: rules.packageManagerRequired,
    },
    packageType: { ruleId: rules.packageTypeModule, value: 'module' },
    privateDisallowedRuleId: rules.packagePrivate,
    publishAccess: { ruleId: rules.packagePublishPublic, value: 'public' },
    requiredFields: [
      { kind: 'non-empty-string', name: 'name', ruleId: rules.packageName },
      { kind: 'non-empty-string', name: 'version', ruleId: rules.packageVersion },
      { kind: 'non-empty-string', name: 'type', ruleId: rules.packageType },
      { kind: 'non-empty-string', name: 'description', ruleId: rules.packageDescription },
      { kind: 'record', name: 'repository', ruleId: rules.packageRepository },
      { kind: 'non-empty-string', name: 'homepage', ruleId: rules.packageHomepage },
      { kind: 'record', name: 'bugs', ruleId: rules.packageBugs },
      { kind: 'non-empty-string', name: 'license', ruleId: rules.packageLicense },
      { kind: 'string-array', name: 'keywords', ruleId: rules.packageKeywords },
      { kind: 'string-array', name: 'files', ruleId: rules.packageFiles },
      { kind: 'record', name: 'exports', ruleId: rules.packageExports },
      { kind: 'record', name: 'publishConfig', ruleId: rules.packagePublishConfig },
    ],
    requiredRepoPaths: [
      { kind: 'file', path: 'README.md', ruleId: rules.repoReadme },
      { kind: 'file', path: 'CHANGELOG.md', ruleId: rules.repoChangelog },
      { kind: 'file', path: 'LICENSE', ruleId: rules.repoLicense },
      { kind: 'directory', path: '.changeset', ruleId: rules.repoChangeset },
      { kind: 'directory', path: '.github/workflows', ruleId: rules.repoWorkflows },
    ],
    requiredScripts: [
      { name: 'build', ruleId: rules.scriptBuild },
      { name: 'typecheck', ruleId: rules.scriptTypecheck },
      { name: 'lint', ruleId: rules.scriptLint },
      { name: 'lint:fix', ruleId: rules.scriptLintFix },
      { name: 'format', ruleId: rules.scriptFormat },
      { name: 'format:check', ruleId: rules.scriptFormatCheck },
      { name: 'test', ruleId: rules.scriptTest },
      { name: 'knip:check', ruleId: rules.scriptKnip },
      { name: 'docs', ruleId: rules.scriptDocs },
      { name: 'changeset', ruleId: rules.scriptChangeset },
      { name: 'changeset:status', ruleId: rules.scriptChangesetStatus },
      { name: 'version-packages', ruleId: rules.scriptVersionPackages },
    ],
  },
  runtime: {
    bun: {
      packageManager: 'bun@1.4.2',
      typesRange: '^1.4.2',
      version: '1.4.2',
      workflowTargets: [
        { path: '.github/workflows/ci.yml', ruleId: rules.ciBun },
        { path: '.github/workflows/release.yml', ruleId: rules.releaseBun },
      ],
    },
    node: {
      engineRange: '24.x',
      major: 24,
      setupVersion: '24',
    },
  },
  source: {
    catchAllDirectories: ['common', 'helpers', 'shared'],
  },
} as const;
