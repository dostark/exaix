/**
 * @module ExaCtlPortalCommand
 * @path apps/exactl/src/command_builders/portal_command.ts
 * @description Builds the exactl portal command tree from the shared runtime services.
 * @architectural-layer CLI
 * @related-files [apps/exactl/src/exactl.ts, apps/exactl/src/exactl_runtime.ts]
 */

import { confirmAction } from "../output/exactl_confirm.ts";
import { Command } from "@cliffy/command";
import { type PortalAnalysisMode, PortalExecutionStrategy, PortalStatus } from "@exaix/core";
import type { IPortalDetails, IPortalInfo, Opt, Reason } from "@exaix/core/types";
import { ExaCtlOutputFormat, type IExaCtlColumn } from "@exaix/cli";
import { formatKnowledge } from "@exaix/cli/formatters/portal_knowledge.ts";
import type { IExaCtlRuntime } from "../exactl_runtime.ts";
import { ExaCtlCommandName, ExaCtlSubNoun, ExaCtlVerb, MutationStatus } from "../exactl_constants.ts";
import { actionOutput, cellText, ColumnHeader, type IJsonRow, toRow } from "../output/exactl_output.ts";
import { failCommand } from "./command_failure.ts";
import { documentLeaves } from "./documented_children.ts";
import { documentedNoun } from "../docs/exactl_noun_doc.ts";
import { nounDocFor } from "../command_docs/mod.ts";

const ALIAS_ARGUMENT = "<alias>";
const NOT_FOUND_SUFFIX = " (not found)";
const ACTIVE_LABEL = "Active ✓";
const BROKEN_LABEL = "Broken ⚠";

const PORTAL_COLUMNS: readonly IExaCtlColumn<IJsonRow>[] = [
  { header: "Alias", value: (portal) => cellText(portal.alias) },
  { header: "Symlink", value: (portal) => cellText(portal.symlinkPath) },
  {
    header: ColumnHeader.STATUS,
    value: (portal) => portal.status === PortalStatus.ACTIVE ? ACTIVE_LABEL : BROKEN_LABEL,
  },
  {
    header: "Target",
    value: (portal) => cellText(portal.targetPath) + (portal.status === PortalStatus.ACTIVE ? "" : NOT_FOUND_SUFFIX),
  },
  { header: "Context card", value: (portal) => cellText(portal.contextCardPath) },
];

const VERIFY_COLUMNS: readonly IExaCtlColumn<IJsonRow>[] = [
  { header: "Alias", value: (result) => cellText(result.alias) },
  {
    header: ColumnHeader.STATUS,
    value: (result) => Array.isArray(result.issues) && result.issues.length > 0 ? "FAILED" : "OK",
  },
  {
    header: "Issues",
    value: (result) => Array.isArray(result.issues) && result.issues.length > 0 ? result.issues.join("; ") : "",
  },
];

function portalFields(portal: IPortalDetails): readonly IExaCtlColumn<IJsonRow>[] {
  return [
    { header: "Alias", value: () => portal.alias },
    { header: "Target path", value: () => portal.targetPath },
    { header: "Symlink", value: () => portal.symlinkPath },
    { header: ColumnHeader.STATUS, value: () => portal.status === PortalStatus.ACTIVE ? ACTIVE_LABEL : BROKEN_LABEL },
    { header: "Context card", value: () => portal.contextCardPath },
    { header: "Permissions", value: () => portal.permissions ?? "" },
    { header: ColumnHeader.CREATED, value: () => portal.created ?? "" },
    { header: "Last verified", value: () => portal.lastVerified ?? "" },
    { header: "Default branch", value: () => portal.defaultBranch ?? "" },
    { header: "Execution strategy", value: () => portal.executionStrategy ?? "" },
  ];
}

function parseExecutionStrategy(strategy: Opt<string, Reason.OptionalInput>): PortalExecutionStrategy | undefined {
  if (!strategy) return undefined;
  if (strategy === PortalExecutionStrategy.BRANCH) return PortalExecutionStrategy.BRANCH;
  if (strategy === PortalExecutionStrategy.WORKTREE) return PortalExecutionStrategy.WORKTREE;
  throw new Error(
    `Invalid execution strategy. Must be one of: ${PortalExecutionStrategy.BRANCH}, ${PortalExecutionStrategy.WORKTREE}`,
  );
}

function createPortalCommand(runtime: IExaCtlRuntime) {
  const { display, portalCommands } = runtime;
  const listCommand = new Command().action(async (options) => {
    const { renderer } = actionOutput(runtime, options, ExaCtlOutputFormat.TABLE);
    try {
      const portals: IPortalInfo[] = await portalCommands.list();
      if (portals.length === 0 && !renderer.machine) {
        display.info("portal.list", "portals", {
          count: 0,
          hint: "Add a portal with: exactl portal add <path> <alias>",
        });
        return;
      }
      await renderer.list(portals.map(toRow), PORTAL_COLUMNS, (portal) => cellText(portal.alias));
    } catch (error) {
      failCommand(error as Error);
    }
  });
  const addCommand = new Command()
    .option("--default-branch <branch:string>", "Default base branch for this portal")
    .option(
      "--execution-strategy <strategy:string>",
      "Execution strategy: branch (default) or worktree",
    )
    .action(async (options, ...args: string[]) => {
      const { renderer } = actionOutput(runtime, options, ExaCtlOutputFormat.TEXT);
      try {
        await portalCommands.add(args[0], args[1], {
          defaultBranch: options.defaultBranch,
          executionStrategy: parseExecutionStrategy(options.executionStrategy),
        });
        await renderer.mutation(
          [{ id: args[1], action: ExaCtlVerb.ADD, status: MutationStatus.ADDED, target: args[0] }],
          false,
        );
      } catch (error) {
        failCommand(error as Error);
      }
    });
  const showCommand = new Command().action(async (options, ...args: string[]) => {
    const { renderer } = actionOutput(runtime, options, ExaCtlOutputFormat.TEXT);
    try {
      const portal = await portalCommands.show(args[0]);
      await renderer.item(toRow(portal), portalFields(portal));
    } catch (error) {
      failCommand(error as Error);
    }
  });
  const removeCommand = new Command()
    .option("--keep-card", "Keep context card instead of archiving")
    .action(async (options, ...args: string[]) => {
      const { renderer } = actionOutput(runtime, options, ExaCtlOutputFormat.TEXT);
      try {
        await confirmAction(runtime, "portal remove", `Remove portal ${args[0]}?`, options);
        await portalCommands.remove(args[0], { keepCard: options.keepCard });
        await renderer.mutation([{ id: args[0], action: ExaCtlVerb.REMOVE, status: MutationStatus.REMOVED }], false);
      } catch (error) {
        failCommand(error as Error);
      }
    });
  const verifyCommand = new Command()
    .arguments("[alias:string]")
    .action(async (options, alias?: Opt<string, Reason.OptionalInput>) => {
      const { renderer } = actionOutput(runtime, options, ExaCtlOutputFormat.TABLE);
      try {
        const results = await portalCommands.verify(alias);
        const broken = results.filter((result) => result.issues && result.issues.length > 0).length;
        await renderer.list(results.map(toRow), VERIFY_COLUMNS, (result) => cellText(result.alias));
        if (!renderer.machine) {
          display.info("portal.verify.summary", "portals", { healthy: results.length - broken, broken });
        }
      } catch (error) {
        failCommand(error as Error);
      }
    });
  const refreshCommand = new Command().action(async (options, ...args: string[]) => {
    const { renderer } = actionOutput(runtime, options, ExaCtlOutputFormat.TEXT);
    try {
      await portalCommands.refresh(args[0]);
      await renderer.mutation([{ id: args[0], action: ExaCtlVerb.REFRESH, status: MutationStatus.REFRESHED }], false);
    } catch (error) {
      failCommand(error as Error);
    }
  });
  const analyzeCommand = new Command()
    .option("--mode <mode:string>", "Analysis mode: quick, standard, deep")
    .option("--force", "Force re-analysis even if fresh knowledge exists")
    .action(async (options, ...args: string[]) => {
      const { renderer } = actionOutput(runtime, options, ExaCtlOutputFormat.TEXT);
      try {
        const summary = await portalCommands.analyze(args[0], {
          mode: options.mode as PortalAnalysisMode,
          force: options.force,
        });
        if (renderer.machine) {
          await renderer.mutation(
            [{ id: args[0], action: ExaCtlVerb.ANALYZE, status: MutationStatus.ANALYZED, summary }],
            false,
          );
        } else {
          await renderer.text(summary);
        }
      } catch (error) {
        failCommand(error as Error);
      }
    });
  const knowledgeShowCommand = new Command().action(async (options, ...args: string[]) => {
    const { renderer } = actionOutput(runtime, options, ExaCtlOutputFormat.TEXT);
    try {
      const knowledge = await portalCommands.knowledgeData(args[0]);
      if (knowledge === null) {
        display.warn("portal.knowledge", args[0], {
          hint: `No knowledge available. Run: exactl portal knowledge analyze ${args[0]}`,
        });
        if (renderer.machine) await renderer.item(null, []);
        return;
      }
      if (renderer.machine) await renderer.item(toRow(knowledge), []);
      else await renderer.text(formatKnowledge(knowledge).join("\n"));
    } catch (error) {
      failCommand(error as Error);
    }
  });

  const noun = nounDocFor(ExaCtlCommandName.PORTAL);
  const knowledge = new Command()
    .description("Analyze and display the codebase knowledge of a portal")
    .command(`${ExaCtlVerb.ANALYZE} ${ALIAS_ARGUMENT}`, analyzeCommand)
    .command(`${ExaCtlVerb.SHOW} ${ALIAS_ARGUMENT}`, knowledgeShowCommand);
  const command = documentedNoun(new Command(), noun)
    .command(`${ExaCtlVerb.ADD} <target-path> ${ALIAS_ARGUMENT}`, addCommand)
    .command(ExaCtlVerb.LIST, listCommand)
    .command(`${ExaCtlVerb.SHOW} ${ALIAS_ARGUMENT}`, showCommand)
    .command(`${ExaCtlVerb.REMOVE} ${ALIAS_ARGUMENT}`, removeCommand)
    .command(ExaCtlVerb.VERIFY, verifyCommand)
    .command(`${ExaCtlVerb.REFRESH} ${ALIAS_ARGUMENT}`, refreshCommand)
    .command(ExaCtlSubNoun.KNOWLEDGE, knowledge);
  documentLeaves(command, [ExaCtlCommandName.PORTAL], noun.lifecycle);
  documentLeaves(knowledge, [ExaCtlCommandName.PORTAL, ExaCtlSubNoun.KNOWLEDGE], noun.lifecycle);
  return command;
}

export function buildPortalCommand(runtime: IExaCtlRuntime): ReturnType<typeof createPortalCommand> {
  return createPortalCommand(runtime);
}
