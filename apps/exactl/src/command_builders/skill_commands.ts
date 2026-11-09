/**
 * @module SkillCommands
 * @path apps/exactl/src/command_builders/skill_commands.ts
 * @description Builds the skill command group. `exactl skill` exposes list, show, match, derive, create,
 *   approve, deprecate, revisions, usage and validate. A failed command prints its message and exits
 *   with 1, or with 2 for a malformed argument.
 * @architectural-layer CLI
 * @dependencies [@cliffy/command, @exaix/cli, ../commands/memory_commands.ts]
 * @related-files [apps/exactl/src/exactl.ts, apps/exactl/src/commands/memory_commands.ts]
 */

import { Command } from "@cliffy/command";
import { MemoryScope } from "@exaix/core";
import type { MemoryBankSource } from "@exaix/core";
import { DEFAULT_NONE_VALUE } from "@exaix/core";
import type { Opt, Reason } from "@exaix/core/types";
import type { ISkill, ISkillMatch } from "@exaix/schemas/memory_bank.ts";
import { CLI_LAYOUT_SKILL_HASH_WIDTH, CLI_LAYOUT_SKILL_REVISION_WIDTH, ExaCtlOutputFormat } from "@exaix/cli";
import type { IExaCtlColumn } from "@exaix/cli";
import { type MemoryCommands, SkillCommandError } from "../commands/memory_commands.ts";
import type { IExaCtlRuntime } from "../exactl_runtime.ts";
import { COMMA_SEPARATOR, ExaCtlCommandName, ExaCtlVerb, MutationStatus } from "../exactl_constants.ts";
import { actionOutput, cellText, ColumnHeader, EMPTY_CELL, type IJsonRow, toRow } from "../output/exactl_output.ts";
import { documentLeaves } from "./documented_children.ts";
import { documentedNoun } from "../docs/exactl_noun_doc.ts";
import { nounDocFor } from "../command_docs/mod.ts";

const PORTAL_OPTION = "--portal <portal:string>";
const PORTAL_HELP = "Portal whose project skills apply. Without it only global skills apply";
const REVISION_OPTION = "--revision <revision:string>";
const LIMIT_OPTION = "-n, --limit <limit:number>";
const LIMIT_DEFAULT = 10;
const NAME_ARGUMENT = "<name:string>";

const SKILL_COLUMNS: readonly IExaCtlColumn<IJsonRow>[] = [
  { header: "Skill ID", value: (skill) => cellText(skill.skill_id) },
  { header: ColumnHeader.NAME, value: (skill) => cellText(skill.title) },
  { header: "Source", value: (skill) => cellText(skill.source) },
  { header: ColumnHeader.REVISION, value: (skill) => cellText(skill.id).slice(0, CLI_LAYOUT_SKILL_REVISION_WIDTH) },
  { header: ColumnHeader.STATUS, value: (skill) => cellText(skill.status) },
];

const DIAGNOSTIC_COLUMNS: readonly IExaCtlColumn<IJsonRow>[] = [
  { header: "Severity", value: (row) => cellText(row.severity) },
  { header: ColumnHeader.NAME, value: (row) => cellText(row.name) },
  { header: "Reason", value: (row) => cellText(row.reason) },
  { header: "Path", value: (row) => `${cellText(row.root_kind)}/${cellText(row.safe_path)}` },
];

const MATCH_COLUMNS: readonly IExaCtlColumn<IJsonRow>[] = [
  { header: "Skill ID", value: (row) => cellText(row.skillId) },
  { header: "Confidence", value: (row) => Number(row.confidence).toFixed(2) },
  { header: "Matched triggers", value: (row) => cellText(row.summary) },
];

const REVISION_COLUMNS: readonly IExaCtlColumn<IJsonRow>[] = [
  { header: ColumnHeader.REVISION, value: (row) => cellText(row.revisionId) },
  { header: "SHA-256", value: (row) => cellText(row.contentSha256).slice(0, CLI_LAYOUT_SKILL_HASH_WIDTH) },
  { header: "First seen", value: (row) => cellText(row.firstSeenAt) },
  { header: "Uses", value: (row) => String(row.useCount) },
  { header: "Last used", value: (row) => cellText(row.lastUsedAt) },
];

const TRACE_COLUMNS: readonly IExaCtlColumn<IJsonRow>[] = [
  { header: "Used at", value: (row) => cellText(row.usedAt) },
  { header: "Skill", value: (row) => cellText(row.skillName) },
  { header: ColumnHeader.REVISION, value: (row) => cellText(row.revisionId) },
  { header: "Match", value: (row) => `${cellText(row.matchSource)}/${cellText(row.renderMode)}` },
  {
    header: "Submission",
    value: (row) => `${cellText(row.submissionKind)} round ${row.round} attempt ${row.attempt}`,
  },
  { header: "Origin", value: (row) => `${cellText(row.rootKind)}/${cellText(row.sourcePath)}` },
];

const VALIDATION_COLUMNS: readonly IExaCtlColumn<IJsonRow>[] = [
  { header: "Valid", value: (row) => String(row.valid) },
];

function listText(values: Opt<readonly string[], Reason.OptionalInput>): string {
  return values && values.length > 0 ? values.join(", ") : DEFAULT_NONE_VALUE;
}

function skillFields(skill: ISkill): readonly IExaCtlColumn<IJsonRow>[] {
  return [
    { header: "Skill ID", value: () => skill.skill_id },
    { header: ColumnHeader.TITLE, value: () => skill.title },
    { header: "Source", value: () => skill.source },
    { header: "Scope", value: () => skill.scope },
    { header: ColumnHeader.REVISION, value: () => skill.id },
    { header: ColumnHeader.STATUS, value: () => skill.status },
    { header: ColumnHeader.DESCRIPTION, value: () => skill.description },
    { header: "Keywords", value: () => listText(skill.triggers.keywords) },
    { header: "Task types", value: () => listText(skill.triggers.task_types) },
    { header: "Tags", value: () => listText(skill.triggers.tags) },
    { header: "Instructions", value: () => skill.instructions },
  ];
}

function matchSummary(match: ISkillMatch): string {
  const parts: string[] = [];
  const { keywords, task_types: taskTypes, tags } = match.matchedTriggers;
  if (keywords?.length) parts.push(`keywords: ${keywords.join(", ")}`);
  if (taskTypes?.length) parts.push(`task types: ${taskTypes.join(", ")}`);
  if (tags?.length) parts.push(`tags: ${tags.join(", ")}`);
  return parts.length > 0 ? parts.join("; ") : EMPTY_CELL;
}

function splitList(value: Opt<string, Reason.OptionalInput>): string[] | undefined {
  return value ? value.split(COMMA_SEPARATOR).map((entry) => entry.trim()) : undefined;
}

/** Fills one command group with the skill commands. */
function registerSkillCommands(group: Command, runtime: IExaCtlRuntime): void {
  const memory: MemoryCommands = runtime.memoryCommands;
  /** Runs one action. A failure prints its message and ends the process with its exit code. */
  async function run(action: string, work: () => Promise<void>): Promise<void> {
    try {
      await work();
    } catch (error) {
      runtime.display.error("cli.error", action, {
        message: error instanceof Error ? error.message : "Skill command failed",
      });
      Deno.exit(error instanceof SkillCommandError ? error.exitCode : 1);
    }
  }
  const out = <T extends object>(options: T) => actionOutput(runtime, options, ExaCtlOutputFormat.TABLE);

  group
    .command(
      ExaCtlVerb.LIST,
      new Command()
        .option("--category <category:string>", "Filter by category: core, project, learned")
        .option("--all", "Include diagnostics for folders that did not load")
        .option(PORTAL_OPTION, PORTAL_HELP)
        .action((options) =>
          run("skill list", async () => {
            const { renderer } = out(options);
            const result = await memory.skillList({
              category: options.category as MemoryBankSource | undefined,
              all: options.all === true,
              portal: options.portal,
            });
            if (result.diagnostics !== undefined && renderer.machine) {
              await renderer.item(
                toRow({ skills: result.skills.map(toRow), diagnostics: result.diagnostics.map(toRow) }),
                [],
              );
              return;
            }
            await renderer.list(result.skills.map(toRow), SKILL_COLUMNS, (skill) => cellText(skill.skill_id));
            if (result.diagnostics !== undefined) {
              await renderer.list(result.diagnostics.map(toRow), DIAGNOSTIC_COLUMNS, (row) => cellText(row.name));
            }
          })
        ),
    )
    .command(
      `${ExaCtlVerb.SHOW} <skill-id:string>`,
      new Command()
        .option(REVISION_OPTION, "Show this stored revision instead of the current skill")
        .option(PORTAL_OPTION, PORTAL_HELP)
        .action((options, ...args: string[]) =>
          run("skill show", async () => {
            const { renderer } = out(options);
            if (options.revision !== undefined) {
              const detail = await memory.skillShowRevision(args[0], options.revision, options.portal);
              const fields: IExaCtlColumn<IJsonRow>[] = [
                { header: "Skill", value: () => detail.skillName },
                { header: ColumnHeader.REVISION, value: () => detail.revisionId },
                { header: "SHA-256", value: () => detail.contentSha256 },
                { header: "First seen", value: () => detail.firstSeenAt },
                {
                  header: "Origin",
                  value: () => detail.origin ? `${detail.origin.rootKind}/${detail.origin.sourcePath}` : "never used",
                },
                {
                  header: "Uses",
                  value: () => `${detail.summary.useCount}, last used ${detail.summary.lastUsedAt ?? "never"}`,
                },
                { header: "SKILL.md", value: () => detail.skillMd },
                { header: "exaix.yaml", value: () => detail.exaixYaml ?? DEFAULT_NONE_VALUE },
                ...detail.references.map((reference) => ({
                  header: reference.path,
                  value: () => reference.content,
                })),
              ];
              await renderer.item(toRow(detail), fields);
              return;
            }
            const { skill, usage } = await memory.skillShow(args[0], options.portal);
            await renderer.item(toRow({ ...skill, usage }), [
              ...skillFields(skill),
              { header: "Total uses", value: () => String(usage.totalUses) },
              { header: "Last used", value: () => usage.lastUsedAt ?? DEFAULT_NONE_VALUE },
            ]);
          })
        ),
    )
    .command(
      `${ExaCtlVerb.MATCH} <request:string>`,
      new Command()
        .option("--task-type <taskType:string>", "Task type filter")
        .option("--tags <tags:string>", "Comma-separated tags filter")
        .option(LIMIT_OPTION, "Maximum results", { default: LIMIT_DEFAULT })
        .option(PORTAL_OPTION, PORTAL_HELP)
        .action((options, ...args: string[]) =>
          run("skill match", async () => {
            const { renderer } = out(options);
            const matches = await memory.skillMatch(args[0], {
              taskType: options.taskType,
              tags: splitList(options.tags),
              limit: options.limit,
              portal: options.portal,
            });
            await renderer.list(
              matches.map((match) => toRow({ ...match, summary: matchSummary(match) })),
              MATCH_COLUMNS,
              (row) => cellText(row.skillId),
            );
          })
        ),
    )
    .command(
      ExaCtlVerb.DERIVE,
      new Command()
        .option("--learning-ids <ids:string>", "Comma-separated learning IDs to derive from", { required: true })
        .option("--name <name:string>", "Name for the derived skill", { required: true })
        .option("--description <desc:string>", "Skill description")
        .option("-i, --instructions <instructions:string>", "Skill instructions")
        .option(PORTAL_OPTION, PORTAL_HELP)
        .action((options) =>
          run("skill derive", async () => {
            const { renderer, display } = out(options);
            const skill = await memory.skillDerive({
              learningIds: splitList(options.learningIds),
              name: options.name,
              description: options.description,
              instructions: options.instructions,
              portal: options.portal,
            });
            display.info("cli.skill.derived", skill.skill_id, {
              draft_path: `${skill.root_kind}/${skill.path}`,
              revision: skill.id,
            });
            await renderer.mutation(
              [{
                id: skill.skill_id,
                action: ExaCtlVerb.DERIVE,
                status: MutationStatus.DERIVED,
                revision: skill.id,
                path: `${skill.root_kind}/${skill.path}`,
              }],
              false,
            );
          })
        ),
    )
    .command(
      `${ExaCtlVerb.CREATE} ${NAME_ARGUMENT}`,
      new Command()
        .option("--description <desc:string>", "Skill description")
        .option("--category <category:string>", "Category: core, project, learned", {
          default: MemoryScope.PROJECT,
        })
        .option("-i, --instructions <instructions:string>", "Skill instructions")
        .option("-k, --keywords <keywords:string>", "Comma-separated trigger keywords")
        .option("--task-types <taskTypes:string>", "Comma-separated trigger task types")
        .option(PORTAL_OPTION, PORTAL_HELP)
        .action((options, ...args: string[]) =>
          run("skill create", async () => {
            const { renderer, display } = out(options);
            const skill = await memory.skillCreate(args[0], {
              description: options.description,
              category: options.category as MemoryBankSource,
              instructions: options.instructions,
              triggersKeywords: splitList(options.keywords),
              triggersTaskTypes: splitList(options.taskTypes),
              portal: options.portal,
            });
            display.info("cli.skill.created", skill.skill_id, {
              title: skill.title,
              draft_path: `${skill.root_kind}/${skill.path}`,
              revision: skill.id,
              next: "Review it, then approve this revision to activate it.",
            });
            await renderer.mutation(
              [{
                id: skill.skill_id,
                action: ExaCtlVerb.CREATE,
                status: MutationStatus.CREATED,
                revision: skill.id,
                path: `${skill.root_kind}/${skill.path}`,
              }],
              false,
            );
          })
        ),
    )
    .command(
      `${ExaCtlVerb.APPROVE} ${NAME_ARGUMENT}`,
      new Command()
        .option(REVISION_OPTION, "Revision UUID that was reviewed", { required: true })
        .option(PORTAL_OPTION, PORTAL_HELP)
        .action((options, ...args: string[]) =>
          run("skill approve", async () => {
            const { renderer, display } = out(options);
            const approved = await memory.skillApprove(args[0], options.revision, { portal: options.portal });
            display.info("cli.skill.approved", approved.name, {
              reviewed_revision: approved.reviewedRevisionId,
              active_revision: approved.activeRevisionId,
            });
            await renderer.mutation(
              [{
                id: approved.name,
                action: ExaCtlVerb.APPROVE,
                status: approved.status,
                reviewedRevisionId: approved.reviewedRevisionId,
                activeRevisionId: approved.activeRevisionId,
              }],
              false,
            );
          })
        ),
    )
    .command(
      `${ExaCtlVerb.DEPRECATE} ${NAME_ARGUMENT}`,
      new Command()
        .option(PORTAL_OPTION, PORTAL_HELP)
        .action((options, ...args: string[]) =>
          run("skill deprecate", async () => {
            const { renderer, display } = out(options);
            const deprecated = await memory.skillDeprecate(args[0], { portal: options.portal });
            display.info("cli.skill.deprecated", deprecated.name, {
              revision: deprecated.revisionId,
              next: "Approve a reviewed revision to reactivate it.",
            });
            await renderer.mutation(
              [{
                id: deprecated.name,
                action: ExaCtlVerb.DEPRECATE,
                status: deprecated.status,
                revisionId: deprecated.revisionId,
              }],
              false,
            );
          })
        ),
    )
    .command(
      `${ExaCtlVerb.REVISIONS} ${NAME_ARGUMENT}`,
      new Command()
        .option(PORTAL_OPTION, PORTAL_HELP)
        .action((options, ...args: string[]) =>
          run("skill revisions", async () => {
            const { renderer } = out(options);
            const rows = await memory.skillRevisions(args[0], { portal: options.portal });
            await renderer.list(rows.map(toRow), REVISION_COLUMNS, (row) => cellText(row.revisionId));
          })
        ),
    )
    .command(
      ExaCtlVerb.USAGE,
      new Command()
        .option("--trace <trace:string>", "Trace id to read", { required: true })
        .option(PORTAL_OPTION, PORTAL_HELP)
        .action((options) =>
          run("skill usage", async () => {
            const { renderer } = out(options);
            const rows = await memory.skillUsageByTrace(options.trace, { portal: options.portal });
            await renderer.list(rows.map(toRow), TRACE_COLUMNS, (row) => cellText(row.callId));
          })
        ),
    )
    .command(
      `${ExaCtlVerb.VALIDATE} [name:string]`,
      new Command()
        .option(PORTAL_OPTION, PORTAL_HELP)
        .action((options, ...args: string[]) =>
          run("skill validate", async () => {
            const { renderer, display } = out(options);
            const result = await memory.skillValidate(args[0], { portal: options.portal });
            if (renderer.machine) {
              await renderer.item(toRow({ valid: result.valid, diagnostics: result.diagnostics.map(toRow) }), []);
            } else {
              await renderer.item(toRow({ valid: result.valid }), VALIDATION_COLUMNS);
              await renderer.list(result.diagnostics.map(toRow), DIAGNOSTIC_COLUMNS, (row) => cellText(row.name));
            }
            if (!result.valid) {
              display.error("cli.skill.invalid", "skills", { errors: result.diagnostics.length });
              Deno.exit(1);
            }
          })
        ),
    );
}

/** The root skill command over the memory skill handlers. */
export function buildSkillCommand(runtime: IExaCtlRuntime): Command {
  const noun = nounDocFor(ExaCtlCommandName.SKILL);
  const command = documentedNoun(new Command(), noun);
  registerSkillCommands(command, runtime);
  documentLeaves(command, [ExaCtlCommandName.SKILL], noun.lifecycle);
  return command;
}
