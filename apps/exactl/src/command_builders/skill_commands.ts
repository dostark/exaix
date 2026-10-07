/**
 * @module SkillCommands
 * @path apps/exactl/src/command_builders/skill_commands.ts
 * @description One builder for the skill command group. `exactl skills` and `exactl memory skill`
 *   register the same group, so both aliases expose list, show, match, derive, create, approve,
 *   deprecate, revisions, usage and validate with identical options. A failed command prints its
 *   message and exits with 1, or with 2 for a malformed argument.
 * @architectural-layer CLI
 * @dependencies [@cliffy/command, @exaix/tui, ../commands/memory_commands.ts]
 * @related-files [apps/exactl/src/exactl.ts, apps/exactl/src/commands/memory_commands.ts]
 */

import { Command } from "@cliffy/command";
import { MemoryScope } from "@exaix/core";
import type { MemoryBankSource } from "@exaix/core";
import { UIOutputFormat } from "@exaix/tui";
import type { Opt, Reason } from "@exaix/core/types";
import type { OutputFormat } from "@exaix/cli/types/memory_types.ts";
import { type MemoryCommands, SkillCommandError } from "../commands/memory_commands.ts";

const FORMAT_OPTION = "--format <format:string>";
const FORMAT_HELP = "Output format: table, json, md";
const FORMAT_DEFAULT = { default: UIOutputFormat.TABLE };
const PORTAL_OPTION = "--portal <portal:string>";
const PORTAL_HELP = "Portal whose project skills apply. Without it only global skills apply";
const REVISION_OPTION = "--revision <revision:string>";
const LIMIT_OPTION = "-l, --limit <limit:number>";
const LIMIT_DEFAULT = 10;
const COMMA_SEPARATOR = ",";

function splitList(value: Opt<string, Reason.OptionalInput>): string[] | undefined {
  return value ? value.split(COMMA_SEPARATOR).map((entry) => entry.trim()) : undefined;
}

/** Prints the result. A failure prints its output or message and ends the process with its exit code. */
async function run(action: () => Promise<string>): Promise<void> {
  try {
    console.log(await action());
  } catch (error) {
    if (error instanceof SkillCommandError) {
      if (error.output) console.log(error.output);
      console.error(error.message);
      Deno.exit(error.exitCode);
    }
    throw error;
  }
}

/** Fills one command group with the skill commands. Every alias that exposes them calls this. */
export function registerSkillCommands(group: Command, memory: MemoryCommands): void {
  group
    .option(FORMAT_OPTION, FORMAT_HELP, FORMAT_DEFAULT)
    .option(PORTAL_OPTION, PORTAL_HELP)
    .action((options) =>
      run(() =>
        memory.skillList({ format: options.format as OutputFormat, portal: options.portal as string | undefined })
      )
    )
    .command(
      "list",
      new Command()
        .description("List skills. --all also reports folders that did not load")
        .option("-c, --category <category:string>", "Filter by category: core, project, learned")
        .option("--all", "Include diagnostics for folders that did not load")
        .option(PORTAL_OPTION, PORTAL_HELP)
        .option(FORMAT_OPTION, FORMAT_HELP, FORMAT_DEFAULT)
        .action((options) =>
          run(() =>
            memory.skillList({
              category: options.category as MemoryBankSource | undefined,
              all: options.all === true,
              format: options.format as OutputFormat,
              portal: options.portal as string | undefined,
            })
          )
        ),
    )
    .command(
      "show <skillId:string>",
      new Command()
        .description("Show a skill, or one stored revision of it with --revision")
        .option(REVISION_OPTION, "Show this stored revision instead of the current skill")
        .option(PORTAL_OPTION, PORTAL_HELP)
        .option(FORMAT_OPTION, FORMAT_HELP, FORMAT_DEFAULT)
        .action((options, ...args: string[]) =>
          run(() =>
            memory.skillShow(
              args[0],
              options.format as OutputFormat,
              options.portal as string | undefined,
              options.revision as string | undefined,
            )
          )
        ),
    )
    .command(
      "match <request:string>",
      new Command()
        .description("Match skills for a given request")
        .option("-t, --task-type <taskType:string>", "Task type filter")
        .option("--tags <tags:string>", "Comma-separated tags filter")
        .option(LIMIT_OPTION, "Maximum results", { default: LIMIT_DEFAULT })
        .option(PORTAL_OPTION, PORTAL_HELP)
        .option(FORMAT_OPTION, FORMAT_HELP, FORMAT_DEFAULT)
        .action((options, ...args: string[]) =>
          run(() =>
            memory.skillMatch(args[0], {
              taskType: options.taskType as string | undefined,
              tags: splitList(options.tags as string | undefined),
              limit: options.limit as number,
              format: options.format as OutputFormat,
              portal: options.portal as string | undefined,
            })
          )
        ),
    )
    .command(
      "derive",
      new Command()
        .description("Derive a draft skill from learnings")
        .option("-l, --learning-ids <ids:string>", "Comma-separated learning IDs to derive from", { required: true })
        .option("-n, --name <name:string>", "Name for the derived skill", { required: true })
        .option("-d, --description <desc:string>", "Skill description")
        .option("-i, --instructions <instructions:string>", "Skill instructions")
        .option(PORTAL_OPTION, PORTAL_HELP)
        .option(FORMAT_OPTION, FORMAT_HELP, FORMAT_DEFAULT)
        .action((options) =>
          run(() =>
            memory.skillDerive({
              learningIds: splitList(options.learningIds as string | undefined),
              name: options.name as string,
              description: options.description as string | undefined,
              instructions: options.instructions as string | undefined,
              format: options.format as OutputFormat,
              portal: options.portal as string | undefined,
            })
          )
        ),
    )
    .command(
      "create <name:string>",
      new Command()
        .description("Create a draft skill. Review it, then approve its revision")
        .option("-d, --description <desc:string>", "Skill description")
        .option("-c, --category <category:string>", "Category: core, project, learned", {
          default: MemoryScope.PROJECT,
        })
        .option("-i, --instructions <instructions:string>", "Skill instructions")
        .option("-k, --keywords <keywords:string>", "Comma-separated trigger keywords")
        .option("-t, --task-types <taskTypes:string>", "Comma-separated trigger task types")
        .option(PORTAL_OPTION, PORTAL_HELP)
        .option(FORMAT_OPTION, FORMAT_HELP, FORMAT_DEFAULT)
        .action((options, ...args: string[]) =>
          run(() =>
            memory.skillCreate(args[0], {
              description: options.description as string | undefined,
              category: options.category as MemoryBankSource,
              instructions: options.instructions as string | undefined,
              triggersKeywords: splitList(options.keywords as string | undefined),
              triggersTaskTypes: splitList(options.taskTypes as string | undefined),
              format: options.format as OutputFormat,
              portal: options.portal as string | undefined,
            })
          )
        ),
    )
    .command(
      "approve <name:string>",
      new Command()
        .description("Activate a reviewed draft. The revision must be the one that was reviewed")
        .option(REVISION_OPTION, "Revision UUID that was reviewed", { required: true })
        .option(PORTAL_OPTION, PORTAL_HELP)
        .option(FORMAT_OPTION, FORMAT_HELP, FORMAT_DEFAULT)
        .action((options, ...args: string[]) =>
          run(() =>
            memory.skillApprove(args[0], options.revision as string, {
              portal: options.portal as string | undefined,
              format: options.format as OutputFormat,
            })
          )
        ),
    )
    .command(
      "deprecate <name:string>",
      new Command()
        .description("Take a skill out of matching. A reviewed revision must be approved to bring it back")
        .option(PORTAL_OPTION, PORTAL_HELP)
        .option(FORMAT_OPTION, FORMAT_HELP, FORMAT_DEFAULT)
        .action((options, ...args: string[]) =>
          run(() =>
            memory.skillDeprecate(args[0], {
              portal: options.portal as string | undefined,
              format: options.format as OutputFormat,
            })
          )
        ),
    )
    .command(
      "revisions <name:string>",
      new Command()
        .description("List every stored revision of a skill with its hash, first sighting and use counts")
        .option(PORTAL_OPTION, PORTAL_HELP)
        .option(FORMAT_OPTION, FORMAT_HELP, FORMAT_DEFAULT)
        .action((options, ...args: string[]) =>
          run(() =>
            memory.skillRevisions(args[0], {
              portal: options.portal as string | undefined,
              format: options.format as OutputFormat,
            })
          )
        ),
    )
    .command(
      "usage",
      new Command()
        .description("Show per-call skill usage for one trace, joined to the snapshots used")
        .option("--trace <trace:string>", "Trace id to read", { required: true })
        .option(PORTAL_OPTION, PORTAL_HELP)
        .option(FORMAT_OPTION, FORMAT_HELP, FORMAT_DEFAULT)
        .action((options) =>
          run(() =>
            memory.skillUsageByTrace(options.trace as string, {
              portal: options.portal as string | undefined,
              format: options.format as OutputFormat,
            })
          )
        ),
    )
    .command(
      "validate [name:string]",
      new Command()
        .description("Report typed validation reasons for the current skill roots. Exits 1 when a skill is invalid")
        .option(PORTAL_OPTION, PORTAL_HELP)
        .option(FORMAT_OPTION, FORMAT_HELP, FORMAT_DEFAULT)
        .action((options, ...args: string[]) =>
          run(() =>
            memory.skillValidate(args[0], {
              portal: options.portal as string | undefined,
              format: options.format as OutputFormat,
            })
          )
        ),
    );
}
