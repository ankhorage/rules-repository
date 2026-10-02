import type { Rule } from '@ankhorage/rules';

import { REPOSITORY_RULE_METADATA } from '../../../../constants/repository.js';
import { REPOSITORY_RULE_IDS } from '../../../../constants/repositoryRuleIds.js';
import type { RepositoryRuleContext } from '../../../../types/repository.js';
import { repositoryRuleSupport } from '../../utils/repositoryRuleSupport.js';

/*** Create CLI package-layout rules without owning CLI implementation details. */
export function createCliRules(): readonly Rule<RepositoryRuleContext>[] {
  return [legacyRootRule(), cliExportRule(), cliCommandPathRule()];
}

/*** Reject the superseded src/cli.ts root implementation. */
function legacyRootRule(): Rule<RepositoryRuleContext> {
  return repositoryRuleSupport.createRule(
    REPOSITORY_RULE_IDS.cliRootFile,
    'CLI implementation must live below src/cli rather than src/cli.ts.',
    (context) =>
      repositoryRuleSupport.hasPath(context, REPOSITORY_RULE_METADATA.cli.legacyRootFile, 'file')
        ? [
            repositoryRuleSupport.finding(
              REPOSITORY_RULE_IDS.cliRootFile,
              'src/cli.ts is not a current CLI owner.',
              REPOSITORY_RULE_METADATA.cli.legacyRootFile,
              {},
            ),
          ]
        : [],
  );
}

/*** Require ./cli package export whenever src/cli exists. */
function cliExportRule(): Rule<RepositoryRuleContext> {
  return repositoryRuleSupport.createRule(
    REPOSITORY_RULE_IDS.cliExport,
    'CLI-capable packages must publish the canonical ./cli export.',
    (context) => {
      const hasCli = context.paths.some(
        ({ path }) =>
          path === REPOSITORY_RULE_METADATA.cli.sourceRoot ||
          path.startsWith(REPOSITORY_RULE_METADATA.cli.sourceRoot + '/'),
      );
      return (
        !hasCli ||
        context.packageJson.exports.includes(REPOSITORY_RULE_METADATA.cli.packageExport)
      )
        ? []
        : [
            repositoryRuleSupport.finding(
              REPOSITORY_RULE_IDS.cliExport,
              'CLI-capable package must export ./cli.',
              'package.json',
              {},
            ),
          ];
    },
  );
}

/*** Require public command implementations to mirror their command path below src/cli/commands. */
function cliCommandPathRule(): Rule<RepositoryRuleContext> {
  return repositoryRuleSupport.createRule(
    REPOSITORY_RULE_IDS.cliCommandPath,
    'Public Ankh command implementations must mirror their command path below src/cli/commands.',
    ({ cliCommands }) =>
      cliCommands.flatMap((command) => {
        const expected =
          REPOSITORY_RULE_METADATA.cli.commandsRoot + '/' + command.commandPath.join('/') + '.ts';
        return command.sourcePath === expected
          ? []
          : [
              repositoryRuleSupport.finding(
                REPOSITORY_RULE_IDS.cliCommandPath,
                'Command implementation must live at ' + expected + '.',
                command.sourcePath,
                { expected },
              ),
            ];
      }),
  );
}
