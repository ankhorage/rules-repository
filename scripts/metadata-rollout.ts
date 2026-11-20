import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { tmpdir } from 'node:os';

type Mode = 'dry-run' | 'apply' | 'verify' | 'resume';
type RolloutStatus = 'VERIFIED' | 'EXEMPT' | 'PENDING' | 'BLOCKED' | 'FAILED';
type CommandResult = { readonly code: number; readonly output: string };
type Repository = {
  readonly name: string;
  readonly archived: boolean;
  readonly default_branch: string;
};
type ReportEntry = {
  readonly repository: string;
  readonly status: RolloutStatus;
  readonly defaultBranch: string;
  readonly defaultSha: string | null;
  readonly metadata: 'present' | 'missing' | 'unverified';
  readonly ci: 'enforced' | 'missing' | 'unverified';
  readonly changes: readonly string[];
  readonly validations: readonly string[];
  readonly prUrl: string | null;
  readonly reason: string;
};

const ORGANIZATION = 'ankhorage';
const UMBRELLA = 'ankhorage/rules-repository#14';
const APPROVED_EXCLUSIONS = new Set([
  'ankhorage4',
  'goldkind',
  'osx',
  'release-wave-e2e-consumer',
  'release-wave-e2e-control',
  'release-wave-e2e-publisher',
  'types',
]);
const OWNER_HELD = new Set([
  'api-gateway',
  'atlas',
  'orchestrator-module-expo-localization',
  'scraper',
  'studio',
  'templates',
]);
const PARALLEL_OWNER_WORK = new Map([
  [
    'ch-deinjob',
    'ch-deinjob #50 / PR #51 is owner-held; PR #51 must never be merged by this rollout.',
  ],
  ['flow', 'Flow #34 is owner-held container/OCI work and must not be overwritten.'],
]);
const MANAGED_PATHS = new Set([
  '.github/scripts/ci-impact.ts',
  '.github/workflows/ci.yml',
  '.github/workflows/release.yml',
  '.github/workflows/renovate.yml',
  'renovate.json5',
]);

const main = async (): Promise<void> => {
  const options = parseOptions(process.argv.slice(2));
  const devtoolsVersion = await readDevtoolsVersion();
  const repositories = await listRepositories();
  const applicable = repositories.filter((repository) => !APPROVED_EXCLUSIONS.has(repository.name));
  if (applicable.length !== 92) {
    throw new Error(
      `Approved inventory mismatch: expected 92 applicable repositories, received ${applicable.length}.`,
    );
  }
  const entries = await mapBounded(applicable, 8, (repository) =>
    inspectRepository(repository, options, devtoolsVersion),
  );
  const excluded = repositories
    .filter((repository) => APPROVED_EXCLUSIONS.has(repository.name))
    .map((repository) => exemptEntry(repository));
  const report = {
    generatedAt: new Date().toISOString(),
    mode: options.mode,
    devtoolsVersion,
    inventory: {
      total: repositories.length,
      applicable: applicable.length,
      exclusions: [...APPROVED_EXCLUSIONS].sort(),
    },
    entries: [...entries, ...excluded].sort((left, right) =>
      left.repository.localeCompare(right.repository),
    ),
  };
  await writeReport(options.reportDirectory, report);
  const incomplete = report.entries.some((entry) => !['VERIFIED', 'EXEMPT'].includes(entry.status));
  process.exitCode = incomplete ? 1 : 0;
};

const parseOptions = (argv: readonly string[]) => {
  const mode = argv.includes('--apply')
    ? 'apply'
    : argv.includes('--verify')
      ? 'verify'
      : argv.includes('--resume')
        ? 'resume'
        : 'dry-run';
  const reportIndex = argv.indexOf('--report-dir');
  const reportDirectory =
    reportIndex === -1
      ? resolve('.metadata-rollout-reports')
      : resolve(argv[reportIndex + 1] ?? '');
  if (reportIndex !== -1 && argv[reportIndex + 1] === undefined)
    throw new Error('--report-dir requires a directory.');
  const unknown = argv.filter(
    (value, index) =>
      !['--apply', '--verify', '--resume', '--dry-run', '--report-dir'].includes(value) &&
      index !== reportIndex + 1,
  );
  if (unknown.length > 0) throw new Error(`Unknown arguments: ${unknown.join(', ')}`);
  return { mode: mode as Mode, reportDirectory };
};

const inspectRepository = async (
  repository: Repository,
  options: ReturnType<typeof parseOptions>,
  devtoolsVersion: string,
): Promise<ReportEntry> => {
  const defaultSha = await defaultBranchSha(repository);
  const workflow = await githubFile(repository, '.github/workflows/ci.yml');
  const metadata = await metadataState(repository);
  const base = {
    repository: repository.name,
    defaultBranch: repository.default_branch,
    defaultSha,
    metadata,
    ci:
      workflow === null
        ? ('unverified' as const)
        : workflow.includes('--enforce-repository-metadata')
          ? ('enforced' as const)
          : ('missing' as const),
    changes: [] as string[],
    validations: [] as string[],
    prUrl: null as string | null,
  };
  if (OWNER_HELD.has(repository.name))
    return {
      ...base,
      status: 'PENDING',
      reason: 'Explicit owner-held repository; inspected read-only.',
    };
  const parallelReason = PARALLEL_OWNER_WORK.get(repository.name);
  if (parallelReason !== undefined) return { ...base, status: 'PENDING', reason: parallelReason };
  if (workflow?.includes('--enforce-repository-metadata') && metadata === 'present')
    return {
      ...base,
      status: 'VERIFIED',
      reason: 'Default branch has authored metadata and explicit CI enforcement.',
    };
  if (workflow === null)
    return {
      ...base,
      status: 'BLOCKED',
      reason: 'No root .github/workflows/ci.yml; profile-specific CI evidence is required.',
    };
  if (options.mode === 'dry-run')
    return {
      ...base,
      status: 'PENDING',
      validations: ['default-branch inventory only; no checkout or write'],
      reason:
        'Default branch lacks effective metadata enforcement; --apply will load local instructions before any write.',
    };
  if (options.mode === 'verify')
    return {
      ...base,
      status: 'PENDING',
      reason: 'Default branch lacks effective metadata enforcement.',
    };
  return synchronizeSafely(repository, base, options, devtoolsVersion, workflow);
};

const synchronizeSafely = async (
  repository: Repository,
  entry: Omit<ReportEntry, 'status' | 'reason'>,
  options: ReturnType<typeof parseOptions>,
  devtoolsVersion: string,
  originalWorkflow: string,
): Promise<ReportEntry> => {
  const checkout = await mkdtemp(join(tmpdir(), `metadata-rollout-${repository.name}-`));
  try {
    const clone = await run('git', [
      'clone',
      '--depth',
      '1',
      '--branch',
      repository.default_branch,
      `https://github.com/${ORGANIZATION}/${repository.name}.git`,
      checkout,
    ]);
    if (clone.code !== 0) return blocked(entry, `Clone failed: ${firstLine(clone.output)}`);
    const instructions = await loadInstructions(checkout);
    if (instructions !== null) return blocked(entry, instructions);
    if (
      !(await exists(join(checkout, 'package.json'))) ||
      !(await exists(join(checkout, 'bun.lock')))
    )
      return blocked(
        entry,
        'Not a standard Bun/TypeScript repository; profile-specific evidence is required.',
      );
    const preview = await runDevtools(checkout, devtoolsVersion, true);
    if (preview.code !== 0)
      return blocked(entry, `Published Devtools dry-run failed: ${firstLine(preview.output)}`);
    const planned = parseManagedPaths(preview.output);
    if (planned.length === 0)
      return blocked(
        entry,
        'Workflow is not enforced but published Devtools reports no safe managed change.',
      );
    if (planned.some((path) => !MANAGED_PATHS.has(path)))
      return blocked(
        entry,
        `Devtools planned an unapproved path: ${planned.filter((path) => !MANAGED_PATHS.has(path)).join(', ')}.`,
      );
    if (options.mode === 'dry-run')
      return {
        ...entry,
        status: 'PENDING',
        changes: planned,
        validations: ['published Devtools dry-run', 'AGENTS.md and required local skills read'],
        reason:
          'Safe candidate identified; rerun with --apply to write only after the prewrite contract guard.',
      };
    const sync = await runDevtools(checkout, devtoolsVersion, false);
    if (sync.code !== 0)
      return blocked(entry, `Published Devtools sync failed: ${firstLine(sync.output)}`);
    const changed = await changedPaths(checkout);
    const generatedWorkflow = await readFile(join(checkout, '.github/workflows/ci.yml'), 'utf8');
    const guard = guardWorkflowContract(originalWorkflow, generatedWorkflow, changed);
    if (guard !== null) return blocked(entry, guard);
    const validations = await validateCheckout(checkout);
    if (validations.some((validation) => validation.startsWith('FAILED:')))
      return {
        ...entry,
        status: 'FAILED',
        changes: changed,
        validations,
        reason: 'Required local validation failed; checkout was discarded without a commit.',
      };
    const idempotence = await runDevtools(checkout, devtoolsVersion, true);
    if (
      idempotence.code !== 0 ||
      parseManagedPaths(idempotence.output).some(
        (path) => !idempotence.output.includes(`${path} unchanged`),
      )
    )
      return blocked(entry, 'Second Devtools dry-run did not prove idempotence.');
    const prUrl = await commitAndCreatePr(checkout, repository, changed);
    return {
      ...entry,
      status: prUrl === null ? 'FAILED' : 'PENDING',
      changes: changed,
      validations: [...validations, 'second Devtools dry-run idempotent'],
      prUrl,
      reason:
        prUrl === null
          ? 'Commit or PR creation failed; no merge attempted.'
          : 'PR created or updated; normal CI and review remain required before merge.',
    };
  } finally {
    await rm(checkout, { recursive: true, force: true });
  }
};

const guardWorkflowContract = (
  before: string,
  after: string,
  changed: readonly string[],
): string | null => {
  if (!after.includes('--enforce-repository-metadata'))
    return 'Generated CI lacks explicit --enforce-repository-metadata enforcement.';
  if (changed.some((path) => !MANAGED_PATHS.has(path)))
    return `Sync changed non-managed paths: ${changed.filter((path) => !MANAGED_PATHS.has(path)).join(', ')}.`;
  const beforeContract = workflowContract(before);
  const afterContract = workflowContract(after);
  const removed = [...beforeContract.jobs].filter((job) => !afterContract.jobs.has(job));
  if (removed.length > 0) return `Prewrite guard rejected removed CI jobs: ${removed.join(', ')}.`;
  const missingServices = [...beforeContract.services].filter(
    (service) => !afterContract.services.has(service),
  );
  if (missingServices.length > 0)
    return `Prewrite guard rejected removed CI services: ${missingServices.join(', ')}.`;
  const missingRuns = [...beforeContract.runs].filter((run) => !afterContract.runs.has(run));
  return missingRuns.length === 0
    ? null
    : `Prewrite guard rejected removed CI run contracts: ${missingRuns.join(' | ')}.`;
};

const workflowContract = (workflow: string) => ({
  jobs: new Set(
    [...workflow.matchAll(/^ {2}([A-Za-z0-9_-]+):\s*(?:#.*)?$/gm)]
      .map((match) => match[1])
      .filter((name) => !['on', 'env', 'permissions', 'defaults', 'concurrency'].includes(name)),
  ),
  services: new Set(
    [...workflow.matchAll(/^ {6}([A-Za-z0-9_-]+):\s*(?:#.*)?$/gm)].map((match) => match[1]),
  ),
  runs: new Set([...workflow.matchAll(/^\s*run:\s*(.+)$/gm)].map((match) => match[1].trim())),
});

const validateCheckout = async (checkout: string): Promise<string[]> => {
  const install = await run('bun', ['install', '--frozen-lockfile'], checkout);
  if (install.code !== 0)
    return [`FAILED: bun install --frozen-lockfile: ${firstLine(install.output)}`];
  const manifest = JSON.parse(await readFile(join(checkout, 'package.json'), 'utf8')) as {
    scripts?: Record<string, string>;
  };
  const candidates = [
    'build',
    'check-types',
    'typecheck',
    'lint',
    'knip:check',
    'format:check',
    'test',
  ].filter((name) => manifest.scripts?.[name] !== undefined);
  return Promise.all(
    candidates.map(async (script) => {
      const result = await run('bun', ['run', script], checkout);
      return result.code === 0
        ? `passed: bun run ${script}`
        : `FAILED: bun run ${script}: ${firstLine(result.output)}`;
    }),
  );
};

const commitAndCreatePr = async (
  checkout: string,
  repository: Repository,
  changed: readonly string[],
): Promise<string | null> => {
  const branch = `chore/14-repository-metadata-${repository.name}`;
  if ((await run('git', ['switch', '-c', branch], checkout)).code !== 0) return null;
  if ((await run('git', ['add', ...changed], checkout)).code !== 0) return null;
  if (
    (await run('git', ['commit', '-m', 'chore(ci): enforce repository metadata'], checkout))
      .code !== 0
  )
    return null;
  if ((await run('git', ['push', '--set-upstream', 'origin', branch], checkout)).code !== 0)
    return null;
  const existing = await run(
    'gh',
    [
      'pr',
      'list',
      '--repo',
      `${ORGANIZATION}/${repository.name}`,
      '--head',
      branch,
      '--json',
      'url',
      '--jq',
      '.[0].url',
    ],
    checkout,
  );
  if (existing.code === 0 && existing.output.trim() !== '') return existing.output.trim();
  const created = await run(
    'gh',
    [
      'pr',
      'create',
      '--repo',
      `${ORGANIZATION}/${repository.name}`,
      '--base',
      repository.default_branch,
      '--head',
      branch,
      '--title',
      'chore(ci): enforce repository metadata',
      '--body',
      `Refs ${UMBRELLA}\n\nCanonical published Devtools workflow synchronization after a fail-closed contract comparison.`,
      '--assignee',
      'artiphishle',
    ],
    checkout,
  );
  return created.code === 0 ? created.output.trim() : null;
};

const loadInstructions = async (checkout: string): Promise<string | null> => {
  const required = [
    'AGENTS.md',
    '.agents/skills/ankhorage-coding-rules/SKILL.md',
    '.agents/skills/ankhorage-project-structure/SKILL.md',
    '.agents/skills/hexagonal-architecture/SKILL.md',
  ];
  for (const relativePath of required) {
    try {
      await readFile(join(checkout, relativePath), 'utf8');
    } catch {
      return `Required repository instructions are unavailable: ${relativePath}.`;
    }
  }
  return null;
};

const runDevtools = (checkout: string, version: string, dryRun: boolean): Promise<CommandResult> =>
  run(
    'bunx',
    [
      '--package',
      `@ankhorage/devtools@${version}`,
      'ankhorage-repository',
      'workflows',
      'sync',
      '.',
      ...(dryRun ? ['--dry-run'] : []),
    ],
    checkout,
  );
const parseManagedPaths = (output: string): string[] =>
  [...output.matchAll(/^[+↻✓-]\s+([^\s]+)\s+(?:would |created|updated|unchanged|removed)/gm)].map(
    (match) => match[1],
  );
const changedPaths = async (checkout: string): Promise<string[]> =>
  (await run('git', ['diff', '--name-only'], checkout)).output.split('\n').filter(Boolean);
const readDevtoolsVersion = async (): Promise<string> => {
  const result = await run('bun', ['pm', 'view', '@ankhorage/devtools', 'version']);
  if (result.code !== 0)
    throw new Error(`Unable to resolve published Devtools: ${firstLine(result.output)}`);
  return result.output.trim();
};
const listRepositories = async (): Promise<Repository[]> => {
  const result = await run('gh', [
    'api',
    '--paginate',
    '--slurp',
    `orgs/${ORGANIZATION}/repos?per_page=100&type=all`,
  ]);
  if (result.code !== 0) throw new Error(firstLine(result.output));
  return (JSON.parse(result.output) as Repository[][])
    .flat()
    .map(({ name, archived, default_branch }) => ({ name, archived, default_branch }));
};
const defaultBranchSha = async (repository: Repository): Promise<string | null> => {
  const result = await run('gh', [
    'api',
    `repos/${ORGANIZATION}/${repository.name}/git/ref/heads/${repository.default_branch}`,
    '--jq',
    '.object.sha',
  ]);
  return result.code === 0 ? result.output.trim() : null;
};
const githubFile = async (repository: Repository, path: string): Promise<string | null> => {
  const result = await run('gh', [
    'api',
    `repos/${ORGANIZATION}/${repository.name}/contents/${path}?ref=${repository.default_branch}`,
    '--jq',
    '.content',
  ]);
  return result.code === 0
    ? Buffer.from(result.output.replace(/\s/g, ''), 'base64').toString('utf8')
    : null;
};
const metadataState = async (
  repository: Repository,
): Promise<'present' | 'missing' | 'unverified'> => {
  const source = await run('gh', [
    'api',
    `repos/${ORGANIZATION}/${repository.name}/contents/src/metadata/repository.json?ref=${repository.default_branch}`,
  ]);
  if (source.code === 0) return 'present';
  const nonSource = await run('gh', [
    'api',
    `repos/${ORGANIZATION}/${repository.name}/contents/metadata/repository.json?ref=${repository.default_branch}`,
  ]);
  if (nonSource.code === 0) return 'present';
  return isNotFound(source.output) && isNotFound(nonSource.output) ? 'missing' : 'unverified';
};
const exemptEntry = (repository: Repository): ReportEntry => ({
  repository: repository.name,
  status: 'EXEMPT',
  defaultBranch: repository.default_branch,
  defaultSha: null,
  metadata: 'unverified',
  ci: 'unverified',
  changes: [],
  validations: [],
  prUrl: null,
  reason: 'Approved inventory exclusion.',
});
const blocked = (entry: Omit<ReportEntry, 'status' | 'reason'>, reason: string): ReportEntry => ({
  ...entry,
  status: 'BLOCKED',
  reason,
});
const firstLine = (text: string): string => text.trim().split('\n')[0] || 'no diagnostic output';
const isNotFound = (output: string): boolean =>
  output.includes('HTTP 404') || output.includes('"status":404');
const exists = async (path: string): Promise<boolean> => {
  try {
    await readFile(path);
    return true;
  } catch {
    return false;
  }
};
const mapBounded = async <Input, Output>(
  values: readonly Input[],
  concurrency: number,
  mapper: (value: Input) => Promise<Output>,
): Promise<Output[]> => {
  const output: Output[] = [];
  const pending = [...values];
  const workers = Array.from({ length: Math.min(concurrency, values.length) }, async () => {
    for (;;) {
      const value = pending.shift();
      if (value === undefined) return;
      output.push(await mapper(value));
    }
  });
  await Promise.all(workers);
  return output;
};
const run = async (
  command: string,
  arguments_: readonly string[],
  cwd?: string,
): Promise<CommandResult> => {
  const process = Bun.spawn([command, ...arguments_], { cwd, stdout: 'pipe', stderr: 'pipe' });
  const [stdout, stderr, code] = await Promise.all([
    new Response(process.stdout).text(),
    new Response(process.stderr).text(),
    process.exited,
  ]);
  return { code, output: `${stdout}${stderr}` };
};
const writeReport = async (
  directory: string,
  report: { readonly entries: readonly ReportEntry[] } & Record<string, unknown>,
): Promise<void> => {
  await mkdir(directory, { recursive: true });
  const stamp = new Date().toISOString().replaceAll(':', '-');
  await writeFile(
    join(directory, `metadata-rollout-${stamp}.json`),
    `${JSON.stringify(report, null, 2)}\n`,
  );
  const rows = report.entries
    .map(
      (entry) =>
        `| ${entry.repository} | ${entry.status} | ${entry.ci} | ${entry.metadata} | ${entry.prUrl ?? ''} | ${entry.reason.replaceAll('|', '\\|')} |`,
    )
    .join('\n');
  await writeFile(
    join(directory, `metadata-rollout-${stamp}.md`),
    `# Metadata rollout report\n\n| Repository | Status | CI | Metadata | PR | Reason |\n| --- | --- | --- | --- | --- | --- |\n${rows}\n`,
  );
};

void main();
