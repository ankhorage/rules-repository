import { mkdir, mkdtemp, readFile, readdir, rm, writeFile } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { tmpdir } from 'node:os';
import { parseDocument } from 'yaml';

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
  readonly planning: 'SAFE' | 'BLOCKED' | 'NOT_APPLICABLE';
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
export const MANAGED_PATHS = new Set([
  '.github/scripts/ci-impact.ts',
  '.github/workflows/ci.yml',
  '.github/workflows/release.yml',
  '.github/workflows/renovate.yml',
  'renovate.json5',
  'package.json',
  'bun.lock',
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
    inspectRepositorySafely(repository, options, devtoolsVersion),
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

export const parseOptions = (argv: readonly string[]) => {
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
  if (['--apply', '--verify', '--resume'].filter((option) => argv.includes(option)).length > 1)
    throw new Error('Select at most one of --apply, --verify, or --resume.');
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
    planning: 'NOT_APPLICABLE' as const,
  };
  if (OWNER_HELD.has(repository.name))
    return {
      ...base,
      status: 'PENDING',
      reason: 'Explicit owner-held repository; inspected read-only.',
    };
  const parallelReason = PARALLEL_OWNER_WORK.get(repository.name);
  if (parallelReason !== undefined) return { ...base, status: 'PENDING', reason: parallelReason };
  if (workflow?.includes('--enforce-repository-metadata') && metadata === 'present') {
    const verification = await verifyDefaultBranchEvidence(repository, defaultSha);
    return verification === null
      ? {
          ...base,
          status: 'VERIFIED',
          validations: [
            'published Doctor metadata validation',
            'default-head successful GitHub checks',
          ],
          reason:
            'Default branch metadata, enforcement, published Doctor, and GitHub acceptance are proven.',
        }
      : blocked(base, verification);
  }
  if (workflow === null)
    return {
      ...base,
      status: 'BLOCKED',
      reason: 'No root .github/workflows/ci.yml; profile-specific CI evidence is required.',
    };
  if (options.mode === 'verify')
    return {
      ...base,
      status: 'PENDING',
      reason: 'Default branch lacks effective metadata enforcement.',
    };
  return synchronizeSafely(repository, base, options, devtoolsVersion, workflow);
};

/*** Convert an unexpected repository-local fault into durable evidence while the remaining wave continues. */
export const inspectRepositorySafely = async (
  repository: Repository,
  options: ReturnType<typeof parseOptions>,
  devtoolsVersion: string,
): Promise<ReportEntry> => {
  try {
    return await inspectRepository(repository, options, devtoolsVersion);
  } catch (error) {
    return {
      repository: repository.name,
      status: 'FAILED',
      defaultBranch: repository.default_branch,
      defaultSha: null,
      metadata: 'unverified',
      ci: 'unverified',
      changes: [],
      validations: [],
      prUrl: null,
      planning: 'BLOCKED',
      reason: `Unexpected isolated repository failure: ${error instanceof Error ? error.message : String(error)}`,
    };
  }
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
    if (typeof instructions === 'string') return blocked(entry, instructions);
    if (
      !(await exists(join(checkout, 'package.json'))) ||
      !(await exists(join(checkout, 'bun.lock')))
    )
      return blocked(
        entry,
        'Not a standard Bun/TypeScript repository; profile-specific evidence is required.',
      );
    if (options.mode !== 'dry-run') {
      const resume = await prepareCandidateBranch(checkout, repository);
      if (resume !== null) return blocked(entry, resume);
    }
    const dependency = await synchronizePublishedDevtools(checkout, devtoolsVersion);
    if (dependency !== null) return blocked(entry, dependency);
    const preview = await runDevtools(checkout, true);
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
    const sync = await runDevtools(checkout, false);
    if (sync.code !== 0)
      return blocked(entry, `Published Devtools sync failed: ${firstLine(sync.output)}`);
    const changed = await changedPaths(checkout);
    const generatedWorkflow = await readFile(join(checkout, '.github/workflows/ci.yml'), 'utf8');
    const generatedRelease = await readFile(
      join(checkout, '.github/workflows/release.yml'),
      'utf8',
    );
    const originalRelease = await githubFile(repository, '.github/workflows/release.yml');
    const guard = guardWorkflowContract(
      { ci: originalWorkflow, release: originalRelease },
      { ci: generatedWorkflow, release: generatedRelease },
      changed,
    );
    if (guard !== null) return blocked(entry, guard);
    if (options.mode === 'dry-run')
      return {
        ...entry,
        status: 'PENDING',
        planning: 'SAFE',
        changes: changed,
        validations: [
          ...instructions,
          'published Devtools local workflow preview',
          'managed contract preserved',
        ],
        reason:
          'SAFE plan only: isolated candidate was discarded without a branch, commit, push, or PR.',
      };
    const validations = await validateCheckout(checkout);
    if (validations.some((validation) => validation.startsWith('FAILED:')))
      return {
        ...entry,
        status: 'FAILED',
        changes: changed,
        validations,
        reason: 'Required local validation failed; checkout was discarded without a commit.',
      };
    const idempotence = await runDevtools(checkout, true);
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
      planning: prUrl === null ? 'BLOCKED' : 'SAFE',
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

export const guardWorkflowContract = (
  before: { readonly ci: string; readonly release: string | null },
  after: { readonly ci: string; readonly release: string | null },
  changed: readonly string[],
): string | null => {
  if (!after.ci.includes('--enforce-repository-metadata'))
    return 'Generated CI lacks explicit --enforce-repository-metadata enforcement.';
  if (changed.some((path) => !MANAGED_PATHS.has(path)))
    return `Sync changed non-managed paths: ${changed.filter((path) => !MANAGED_PATHS.has(path)).join(', ')}.`;
  const ciLoss = workflowContractLoss(before.ci, after.ci, 'CI');
  if (ciLoss !== null) return ciLoss;
  if (before.release === null || after.release === null)
    return before.release === after.release
      ? null
      : 'Prewrite guard cannot prove release workflow preservation.';
  return workflowContractLoss(before.release, after.release, 'release');
};

const workflowContractLoss = (before: string, after: string, label: string): string | null => {
  const previous = workflowContract(before);
  const next = workflowContract(after);
  if (previous === null || next === null)
    return `Prewrite guard cannot parse ${label} workflow contract.`;
  const missing = previous.filter((requirement) => !next.includes(requirement));
  if (missing.length > 0 && label === 'CI' && isCanonicalManagedCiUpgrade(before, after))
    return null;
  return missing.length === 0
    ? null
    : `Prewrite guard rejected weakened ${label} contract: ${missing.join(', ')}.`;
};

/*** Recognize only a whole, standard managed CI template migration; bespoke acceptance never qualifies. */
export const isCanonicalManagedCiUpgrade = (before: string, after: string): boolean => {
  const previous = parseWorkflow(before);
  const next = parseWorkflow(after);
  if (previous === null || next === null) return false;
  const previousJobs = Object.entries(previous.jobs);
  const nextJobs = Object.entries(next.jobs);
  if (previousJobs.length !== 1 || nextJobs.length !== 1) return false;
  const [previousName, previousJob] = previousJobs[0];
  const [nextName, nextJob] = nextJobs[0];
  if (previousName !== 'validate' || nextName !== 'validate') return false;
  if (hasBespokeJobContract(previousJob) || hasBespokeJobContract(nextJob)) return false;
  const priorSteps = workflowSteps(previousJob);
  const nextSteps = workflowSteps(nextJob);
  if (priorSteps === null || nextSteps === null) return false;
  const standardStep = (step: Record<string, unknown>): boolean => {
    const name = typeof step.name === 'string' ? step.name : '';
    const uses = typeof step.uses === 'string' ? step.uses : '';
    const run = typeof step.run === 'string' ? step.run : '';
    return (
      uses === 'actions/checkout@v4' ||
      uses === 'oven-sh/setup-bun@v2' ||
      uses === 'actions/setup-node@v4' ||
      /^(Checkout repository|Setup Bun|Setup Node|Install dependencies|Reject package version rollback|Run build|Validate opted-in APM owner release|Validate Ankhorage repository|Run lint|Run format check|Run Knip|Run tests|Run typecheck|Check changesets)$/u.test(
        name,
      ) ||
      /^(bun install --frozen-lockfile|bun run (build|lint|format:check|knip:check|test|typecheck))$/mu.test(
        run,
      )
    );
  };
  return (
    priorSteps.every(standardStep) &&
    nextSteps.every(standardStep) &&
    nextSteps.some(
      (step) =>
        typeof step.run === 'string' &&
        /@ankhorage\/doctor@[^\s]+\s+validate\s+\.\s+--enforce-repository-metadata/u.test(step.run),
    )
  );
};

const parseWorkflow = (workflow: string): Record<string, unknown> | null => {
  const document = parseDocument(workflow, { uniqueKeys: true });
  if (document.errors.length > 0 || document.contents === null) return null;
  const source = document.toJS({ mapAsMap: false });
  return isRecord(source) && isRecord(source.jobs) ? source : null;
};
const workflowSteps = (job: unknown): Record<string, unknown>[] | null =>
  isRecord(job) && Array.isArray(job.steps) && job.steps.every(isRecord) ? job.steps : null;
const hasBespokeJobContract = (job: unknown): boolean =>
  !isRecord(job) ||
  ['container', 'services', 'env', 'permissions', 'strategy', 'defaults'].some(
    (field) => job[field] !== undefined,
  );

/*** Extract every preservation-relevant GitHub Actions field into canonical semantic requirements. */
export const workflowContract = (workflow: string): string[] | null => {
  const source = parseWorkflow(workflow);
  if (source === null) return null;
  const requirements = [
    `trigger:${canonical(source.on ?? source.true)}`,
    `workflow-env:${canonical(source.env)}`,
    `workflow-permissions:${canonical(source.permissions)}`,
    `workflow-concurrency:${canonical(source.concurrency)}`,
  ];
  if (!isRecord(source.jobs)) return null;
  for (const [jobName, jobValue] of Object.entries(source.jobs)) {
    if (!isRecord(jobValue)) return null;
    requirements.push(`job:${jobName}`);
    for (const field of [
      'if',
      'needs',
      'permissions',
      'runs-on',
      'container',
      'services',
      'env',
      'defaults',
      'strategy',
      'timeout-minutes',
    ])
      requirements.push(`job:${jobName}:${field}:${canonical(jobValue[field])}`);
    if (!Array.isArray(jobValue.steps)) return null;
    for (const step of jobValue.steps) {
      if (!isRecord(step)) return null;
      for (const field of [
        'name',
        'id',
        'if',
        'uses',
        'run',
        'shell',
        'working-directory',
        'env',
        'with',
        'continue-on-error',
        'timeout-minutes',
      ])
        requirements.push(`step:${jobName}:${field}:${canonical(step[field])}`);
    }
  }
  return requirements;
};

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value);
const canonical = (value: unknown): string => JSON.stringify(value === undefined ? null : value);

const validateCheckout = async (checkout: string): Promise<string[]> => {
  const install = await run('bun', ['install', '--frozen-lockfile'], checkout);
  if (install.code !== 0)
    return [`FAILED: bun install --frozen-lockfile: ${firstLine(install.output)}`];
  const manifest = JSON.parse(await readFile(join(checkout, 'package.json'), 'utf8')) as {
    scripts?: Record<string, string>;
  };
  const doctorVersion = await doctorVersionFromInstalledDevtools(checkout);
  if (doctorVersion === null)
    return [
      'FAILED: installed published Devtools workflow does not declare an enforcing Doctor release',
    ];
  const doctor = await run(
    'bunx',
    [`@ankhorage/doctor@${doctorVersion}`, 'validate', '.', '--enforce-repository-metadata'],
    checkout,
  );
  if (doctor.code !== 0)
    return [`FAILED: published Doctor metadata validation: ${firstLine(doctor.output)}`];
  const candidates = [
    'build',
    'check-types',
    'typecheck',
    'lint',
    'knip:check',
    'format:check',
    'test',
  ].filter((name) => manifest.scripts?.[name] !== undefined);
  const workflowStatus = await runDevtoolsStatus(checkout);
  if (workflowStatus.code !== 0)
    return [`FAILED: installed Devtools workflow status: ${firstLine(workflowStatus.output)}`];
  const validations = [
    `passed: published Doctor ${doctorVersion} metadata validation with enforcement`,
    'passed: installed Devtools workflow status',
  ];
  for (const script of candidates) {
    const result = await run('bun', ['run', script], checkout);
    validations.push(
      result.code === 0
        ? `passed: bun run ${script}`
        : `FAILED: bun run ${script}: ${firstLine(result.output)}`,
    );
    if (result.code !== 0) break;
  }
  return validations;
};

/*** Read the exact published Doctor pin rendered by the installed Devtools workflow, never a comment. */
export const doctorVersionFromWorkflow = (workflow: string): string | null => {
  const parsed = parseWorkflow(workflow);
  if (parsed === null) return null;
  const jobs = Object.values(parsed.jobs ?? {});
  for (const job of jobs) {
    const steps = workflowSteps(job) ?? [];
    for (const step of steps) {
      if (typeof step.run !== 'string') continue;
      const match =
        /@ankhorage\/doctor@([^\s]+)\s+validate\s+\.\s+--enforce-repository-metadata/u.exec(
          step.run,
        );
      if (match !== null) return match[1];
    }
  }
  return null;
};
const doctorVersionFromInstalledDevtools = async (checkout: string): Promise<string | null> => {
  const rendered = await run(
    'bun',
    [
      '-e',
      "import { readFile } from 'node:fs/promises'; process.stdout.write(await readFile('node_modules/@ankhorage/devtools/dist/tools/workflows/files/ci.yml', 'utf8'))",
    ],
    checkout,
  );
  return rendered.code === 0 ? doctorVersionFromWorkflow(rendered.output) : null;
};

const commitAndCreatePr = async (
  checkout: string,
  repository: Repository,
  changed: readonly string[],
): Promise<string | null> => {
  const branch = `chore/14-repository-metadata-${repository.name}`;
  if ((await run('git', ['branch', '--show-current'], checkout)).output.trim() !== branch)
    return null;
  if ((await run('git', ['add', ...changed], checkout)).code !== 0) return null;
  const staged = await run('git', ['diff', '--cached', '--name-only'], checkout);
  const expected = changed.filter((path) => MANAGED_PATHS.has(path)).sort();
  if (
    staged.code !== 0 ||
    JSON.stringify(staged.output.split('\n').filter(Boolean).sort()) !== JSON.stringify(expected)
  )
    return null;
  if (expected.length === 0) return existingPrUrl(checkout, repository, branch);
  if (
    (await run('git', ['commit', '-m', 'chore(ci): enforce repository metadata'], checkout))
      .code !== 0
  )
    return null;
  const tree = await run(
    'git',
    [
      'ls-tree',
      '-r',
      '--name-only',
      'HEAD',
      '--',
      '.github/scripts/ci-impact.ts',
      '.github/workflows/ci.yml',
    ],
    checkout,
  );
  if (
    tree.code !== 0 ||
    ['.github/scripts/ci-impact.ts', '.github/workflows/ci.yml'].some(
      (path) => !tree.output.split('\n').includes(path),
    )
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

export const prepareCandidateBranch = async (
  checkout: string,
  repository: Repository,
): Promise<string | null> => {
  const branch = `chore/14-repository-metadata-${repository.name}`;
  const remote = await run('git', ['ls-remote', '--heads', 'origin', branch], checkout);
  if (remote.code !== 0)
    return `Cannot inspect existing rollout branch: ${firstLine(remote.output)}`;
  if (remote.output.trim() === '')
    return (await run('git', ['switch', '-c', branch], checkout)).code === 0
      ? null
      : 'Cannot create rollout branch.';
  if ((await run('git', ['fetch', 'origin', branch], checkout)).code !== 0)
    return 'Cannot fetch existing rollout branch.';
  if (
    (await run('git', ['switch', '--track', '-c', branch, `origin/${branch}`], checkout)).code !== 0
  )
    return 'Cannot check out existing rollout branch.';
  const related = await run(
    'git',
    ['merge-base', '--is-ancestor', `origin/${repository.default_branch}`, 'HEAD'],
    checkout,
  );
  if (related.code === 0) return null;
  const merge = await run(
    'git',
    ['merge', '--no-edit', `origin/${repository.default_branch}`],
    checkout,
  );
  return merge.code === 0
    ? null
    : 'Existing rollout branch cannot merge the advanced default branch cleanly; refusing to overwrite or force-push.';
};

const existingPrUrl = async (
  checkout: string,
  repository: Repository,
  branch: string,
): Promise<string | null> => {
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
  return existing.code === 0 && existing.output.trim() !== '' ? existing.output.trim() : null;
};

/*** Discover each repository's own mandatory instructions instead of assuming a global skill profile. */
export const loadInstructions = async (checkout: string): Promise<readonly string[] | string> => {
  let agents: string;
  try {
    agents = await readFile(join(checkout, 'AGENTS.md'), 'utf8');
  } catch {
    return 'Repository AGENTS.md is unavailable; automation cannot prove local instruction compliance.';
  }
  const skills = await findSkillFiles(join(checkout, '.agents', 'skills'));
  const required = [...agents.matchAll(/\.agents\/skills\/([^/\s]+)\/SKILL\.md/g)].map(
    (match) => `.agents/skills/${match[1]}/SKILL.md`,
  );
  const missing = required.filter((path) => !skills.includes(path));
  if (missing.length > 0)
    return `Repository declares unavailable mandatory skills: ${missing.join(', ')}.`;
  const automatable = new Set([
    '.agents/skills/ankhorage-coding-rules/SKILL.md',
    '.agents/skills/ankhorage-project-structure/SKILL.md',
    '.agents/skills/hexagonal-architecture/SKILL.md',
  ]);
  const unsupported = skills.filter((path) => !automatable.has(path));
  if (unsupported.length > 0)
    return `Repository has local instructions requiring human review before automation: ${unsupported.join(', ')}.`;
  const contents = await Promise.all(skills.map((path) => readFile(join(checkout, path), 'utf8')));
  if (contents.some((content) => content.trim().length === 0))
    return 'Repository contains an empty local skill; automation cannot apply it safely.';
  return [
    'applied AGENTS.md through isolated checkout, no force push, and managed-path-only guard',
    ...skills.map((path) => `applied supported local policy ${path}`),
  ];
};

const findSkillFiles = async (
  directory: string,
  relative = '.agents/skills',
): Promise<string[]> => {
  try {
    const entries = await readdir(directory, { withFileTypes: true });
    const descendants = await Promise.all(
      entries.map(async (entry) => {
        const nextRelative = `${relative}/${entry.name}`;
        if (entry.isFile() && entry.name === 'SKILL.md') return [nextRelative];
        return entry.isDirectory() ? findSkillFiles(join(directory, entry.name), nextRelative) : [];
      }),
    );
    return descendants.flat().sort();
  } catch {
    return [];
  }
};

/*** Install the exact published Devtools release in the consumer before generating its workflows. */
export const synchronizePublishedDevtools = async (
  checkout: string,
  version: string,
): Promise<string | null> => {
  const manifest = JSON.parse(await readFile(join(checkout, 'package.json'), 'utf8')) as {
    dependencies?: Record<string, string>;
    devDependencies?: Record<string, string>;
  };
  const declared =
    manifest.devDependencies?.['@ankhorage/devtools'] ??
    manifest.dependencies?.['@ankhorage/devtools'];
  if (declared !== undefined) {
    const existing = await verifyDevtoolsCiImpact(checkout, version);
    if (existing === null) return null;
  }
  const update = await run('bun', ['add', '--dev', `@ankhorage/devtools@${version}`], checkout);
  if (update.code !== 0)
    return `Published Devtools dependency synchronization failed: ${firstLine(update.output)}`;
  const installed = await run('bun', ['install', '--frozen-lockfile'], checkout);
  if (installed.code !== 0)
    return `Published Devtools lockfile validation failed: ${firstLine(installed.output)}`;
  return verifyDevtoolsCiImpact(checkout, version);
};

/*** Prove the installed consumer dependency, rather than a transient bunx package, exposes ci-impact. */
const verifyDevtoolsCiImpact = async (
  checkout: string,
  version: string,
): Promise<string | null> => {
  const versionCheck = await run(
    'bun',
    [
      '-e',
      `const manifest = await import('./node_modules/@ankhorage/devtools/package.json'); if (manifest.default.version !== ${JSON.stringify(version)}) process.exit(1);`,
    ],
    checkout,
  );
  if (versionCheck.code !== 0)
    return 'Installed @ankhorage/devtools does not match the resolved published release.';
  const capability = await run(
    'bun',
    ['-e', "await import('@ankhorage/devtools/ci-impact');"],
    checkout,
  );
  return capability.code === 0
    ? null
    : `Installed @ankhorage/devtools does not expose ci-impact: ${firstLine(capability.output)}`;
};

const runDevtools = (checkout: string, dryRun: boolean): Promise<CommandResult> =>
  run(
    'bunx',
    ['ankhorage-repository', 'workflows', 'sync', '.', ...(dryRun ? ['--dry-run'] : [])],
    checkout,
  );
const runDevtoolsStatus = (checkout: string): Promise<CommandResult> =>
  run(
    'bunx',
    ['--bun', '--no-install', 'ankhorage-repository', 'workflows', 'status', '.'],
    checkout,
  );
const parseManagedPaths = (output: string): string[] =>
  [...output.matchAll(/^[+↻✓-]\s+([^\s]+)\s+(?:would |created|updated|unchanged|removed)/gm)].map(
    (match) => match[1],
  );
/*** Enumerate tracked additions, modifications and deletions plus generated untracked managed files. */
export const changedPaths = async (checkout: string): Promise<string[]> => {
  const [tracked, untracked] = await Promise.all([
    run('git', ['diff', '--name-only', '--diff-filter=ACDMRTUXB'], checkout),
    run('git', ['ls-files', '--others', '--exclude-standard'], checkout),
  ]);
  return [
    ...new Set([...tracked.output.split('\n'), ...untracked.output.split('\n')].filter(Boolean)),
  ].sort();
};
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

/*** Require published Doctor and successful default-head checks before reporting a completed rollout. */
const verifyDefaultBranchEvidence = async (
  repository: Repository,
  defaultSha: string | null,
): Promise<string | null> => {
  if (defaultSha === null) return 'Default branch HEAD is unavailable.';
  const required = await run('gh', [
    'api',
    `repos/${ORGANIZATION}/${repository.name}/branches/${repository.default_branch}/protection/required_status_checks`,
    '--jq',
    '.contexts',
  ]);
  if (required.code !== 0)
    return `Required-check policy is unavailable: ${firstLine(required.output)}`;
  let requiredNames: unknown;
  try {
    requiredNames = JSON.parse(required.output);
  } catch {
    return 'Required-check policy returned malformed evidence.';
  }
  if (
    !Array.isArray(requiredNames) ||
    requiredNames.length === 0 ||
    !requiredNames.every((name) => typeof name === 'string')
  )
    return 'Required-check identities are unavailable or empty.';
  const checks = await run('gh', [
    'api',
    '--paginate',
    '--slurp',
    `repos/${ORGANIZATION}/${repository.name}/commits/${defaultSha}/check-runs`,
  ]);
  if (checks.code !== 0)
    return `Default-head GitHub checks are unavailable: ${firstLine(checks.output)}`;
  let pages: unknown;
  try {
    pages = JSON.parse(checks.output);
  } catch {
    return 'Default-head GitHub checks returned malformed evidence.';
  }
  const checkEvidence = Array.isArray(pages)
    ? pages.flatMap((page) =>
        isRecord(page) && Array.isArray(page.check_runs) ? page.check_runs : [],
      )
    : [];
  const checkState = requiredCheckState(checkEvidence, requiredNames);
  if (checkState !== null) return checkState;
  const checkout = await mkdtemp(join(tmpdir(), `metadata-verify-${repository.name}-`));
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
    if (clone.code !== 0)
      return `Default branch Doctor checkout failed: ${firstLine(clone.output)}`;
    const workflow = await readFile(join(checkout, '.github/workflows/ci.yml'), 'utf8').catch(
      () => null,
    );
    const doctorVersion = workflow === null ? null : doctorVersionFromWorkflow(workflow);
    if (doctorVersion === null) return 'Default branch has no effective enforcing Doctor step.';
    const doctor = await run(
      'bunx',
      [`@ankhorage/doctor@${doctorVersion}`, 'validate', '.', '--enforce-repository-metadata'],
      checkout,
    );
    if (doctor.code !== 0)
      return `Published Doctor rejected metadata with enforcement: ${firstLine(doctor.output)}`;
    const currentSha = await defaultBranchSha(repository);
    return currentSha === defaultSha
      ? null
      : 'Default branch advanced during verification; evidence is stale.';
  } finally {
    await rm(checkout, { recursive: true, force: true });
  }
};

/*** Select the newest attempt for each required identity and reject pending, skipped, failed, or absent gates. */
export const requiredCheckState = (
  checks: readonly unknown[],
  requiredNames: readonly string[],
): string | null => {
  const latest = new Map<string, Record<string, unknown>>();
  for (const value of checks) {
    if (!isRecord(value) || typeof value.name !== 'string' || !requiredNames.includes(value.name))
      continue;
    const prior = latest.get(value.name);
    const timestamp =
      typeof value.completed_at === 'string'
        ? value.completed_at
        : typeof value.started_at === 'string'
          ? value.started_at
          : '';
    const priorTimestamp =
      typeof prior?.completed_at === 'string'
        ? prior.completed_at
        : typeof prior?.started_at === 'string'
          ? prior.started_at
          : '';
    if (prior === undefined || timestamp >= priorTimestamp) latest.set(value.name, value);
  }
  for (const name of requiredNames) {
    const check = latest.get(name);
    if (check === undefined) return `Required check ${name} is absent on the verified SHA.`;
    if (check.status !== 'completed')
      return `Required check ${name} is pending on the verified SHA.`;
    if (check.conclusion !== 'success')
      return `Required check ${name} did not succeed on the verified SHA.`;
  }
  return null;
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
  planning: 'NOT_APPLICABLE',
  reason: 'Approved inventory exclusion.',
});
const blocked = (entry: Omit<ReportEntry, 'status' | 'reason'>, reason: string): ReportEntry => ({
  ...entry,
  status: 'BLOCKED',
  planning: 'BLOCKED',
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
        `| ${entry.repository} | ${entry.status} | ${entry.planning} | ${entry.ci} | ${entry.metadata} | ${entry.prUrl ?? ''} | ${entry.reason.replaceAll('|', '\\|')} |`,
    )
    .join('\n');
  await writeFile(
    join(directory, `metadata-rollout-${stamp}.md`),
    `# Metadata rollout report\n\n| Repository | Status | Plan | CI | Metadata | PR | Reason |\n| --- | --- | --- | --- | --- | --- | --- |\n${rows}\n`,
  );
};

if (import.meta.main) void main();
