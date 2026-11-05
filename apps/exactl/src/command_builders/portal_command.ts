/**
 * @module ExaCtlPortalCommand
 * @path apps/exactl/src/command_builders/portal_command.ts
 * @description Builds the exactl portal command tree from the shared runtime services.
 * @architectural-layer CLI
 * @related-files [apps/exactl/src/exactl.ts, apps/exactl/src/exactl_runtime.ts]
 */

import { Command } from "@cliffy/command";
import {
  DEFAULT_UNKNOWN_ERROR_MESSAGE,
  type PortalAnalysisMode,
  PortalExecutionStrategy,
  PortalStatus,
  RequestOperation,
} from "@exaix/core";
import type { Opt, Reason } from "@exaix/core/types";
import type { IExaCtlRuntime } from "../exactl_runtime.ts";
import { CLI_OPTION_JSON_HELP } from "../exactl_constants.ts";

function createPortalCommand(runtime: IExaCtlRuntime) {
  const { display, portalCommands } = runtime;
  return new Command()
    .description("Manage external project portals")
    .command(
      "add <target-path> <alias>",
      new Command()
        .description("Add a new portal (symlink to external project)")
        .option("--default-branch <branch:string>", "Default base branch for this portal")
        .option(
          "--execution-strategy <strategy:string>",
          "Execution strategy: branch (default) or worktree",
        )
        .action(async (options, ...args: string[]) => {
          const targetPath = args[0];
          const alias = args[1];
          try {
            const strategy = options.executionStrategy as string | undefined;
            const parsedStrategy = strategy
              ? (strategy === PortalExecutionStrategy.BRANCH
                ? PortalExecutionStrategy.BRANCH
                : strategy === PortalExecutionStrategy.WORKTREE
                ? PortalExecutionStrategy.WORKTREE
                : undefined)
              : undefined;
            if (strategy && !parsedStrategy) {
              throw new Error(
                `Invalid execution strategy. Must be one of: ${PortalExecutionStrategy.BRANCH}, ${PortalExecutionStrategy.WORKTREE}`,
              );
            }

            await portalCommands.add(targetPath, alias, {
              defaultBranch: options.defaultBranch,
              executionStrategy: parsedStrategy,
            });
          } catch (error) {
            display.error("cli.error", "portal add", {
              message: error instanceof Error ? error.message : DEFAULT_UNKNOWN_ERROR_MESSAGE,
            });
            Deno.exit(1);
          }
        }),
    )
    .command(
      RequestOperation.LIST,
      new Command()
        .description("List all configured portals")
        .action(async () => {
          try {
            const portals = await portalCommands.list();
            if (portals.length === 0) {
              display.info("portal.list", "portals", {
                count: 0,
                hint: "Add a portal with: exactl portal add <path> <alias>",
              });
              return;
            }
            display.info("portal.list", "portals", { count: portals.length });
            for (const portal of portals) {
              display.info(portal.alias, portal.symlinkPath, {
                status: portal.status === PortalStatus.ACTIVE ? "Active ✓" : "Broken ⚠",
                target: portal.targetPath + (portal.status === "broken" ? " (not found)" : ""),
                context: portal.contextCardPath,
              });
            }
          } catch (error) {
            display.error("cli.error", "portal list", {
              message: error instanceof Error ? error.message : DEFAULT_UNKNOWN_ERROR_MESSAGE,
            });
            Deno.exit(1);
          }
        }),
    )
    .command(
      "show <alias>",
      new Command()
        .description("Show detailed information about a portal")
        .action(async (_options, ...args: string[]) => {
          const alias = args[0];
          try {
            const portal = await portalCommands.show(alias);
            display.info("portal.show", portal.alias, {
              target_path: portal.targetPath,
              symlink: portal.symlinkPath,
              status: portal.status === "active" ? "Active ✓" : "Broken ⚠",
              context_card: portal.contextCardPath,
              permissions: portal.permissions ?? null,
              created: portal.created ?? null,
              last_verified: portal.lastVerified ?? null,
              default_branch: portal.defaultBranch ?? null,
              execution_strategy: portal.executionStrategy ?? null,
            });
          } catch (error) {
            display.error("cli.error", "portal show", {
              message: error instanceof Error ? error.message : DEFAULT_UNKNOWN_ERROR_MESSAGE,
            });
            Deno.exit(1);
          }
        }),
    )
    .command(
      "remove <alias>",
      new Command()
        .description("Remove a portal (archives context card)")
        .option("--keep-card", "Keep context card instead of archiving")
        .action(async (options, ...args: string[]) => {
          const alias = args[0];
          try {
            await portalCommands.remove(alias, { keepCard: options.keepCard });
          } catch (error) {
            display.error("cli.error", "portal remove", {
              message: error instanceof Error ? error.message : DEFAULT_UNKNOWN_ERROR_MESSAGE,
            });
            Deno.exit(1);
          }
        }),
    )
    .command(
      "verify",
      new Command()
        .description("Verify portal integrity")
        .arguments("[alias:string]")
        .action(async (_options, alias?: Opt<string, Reason.OptionalInput>) => {
          try {
            const results = await portalCommands.verify(alias);
            let healthy = 0;
            let broken = 0;
            for (const result of results) {
              if (result.issues && result.issues.length > 0) {
                display.warn("portal.verify", result.alias, { status: "FAILED", issues: result.issues });
                broken++;
              } else {
                display.info("portal.verify", result.alias, { status: "OK" });
                healthy++;
              }
            }
            display.info("portal.verify.summary", "portals", { healthy, broken });
          } catch (error) {
            display.error("cli.error", "portal verify", {
              message: error instanceof Error ? error.message : DEFAULT_UNKNOWN_ERROR_MESSAGE,
            });
            Deno.exit(1);
          }
        }),
    )
    .command(
      "refresh <alias>",
      new Command()
        .description("Refresh portal context card (re-scan project)")
        .action(async (_options, ...args: string[]) => {
          const alias = args[0];
          try {
            await portalCommands.refresh(alias);
          } catch (error) {
            display.error("cli.error", "portal refresh", {
              message: error instanceof Error ? error.message : DEFAULT_UNKNOWN_ERROR_MESSAGE,
            });
            Deno.exit(1);
          }
        }),
    )
    .command(
      "analyze <alias>",
      new Command()
        .description("Trigger codebase knowledge analysis for a portal")
        .option("-m, --mode <mode:string>", "Analysis mode: quick, standard, deep")
        .option("-f, --force", "Force re-analysis even if fresh knowledge exists")
        .action(async (options, ...args: string[]) => {
          const alias = args[0];
          try {
            const summary = await portalCommands.analyze(alias, {
              mode: options.mode as PortalAnalysisMode,
              force: options.force,
            });
            console.log(summary);
          } catch (error) {
            display.error("cli.error", "portal analyze", {
              message: error instanceof Error ? error.message : DEFAULT_UNKNOWN_ERROR_MESSAGE,
            });
            Deno.exit(1);
          }
        }),
    )
    .command(
      "knowledge <alias>",
      new Command()
        .description("Display gathered knowledge for a portal")
        .option("--json", CLI_OPTION_JSON_HELP)
        .action(async (options, ...args: string[]) => {
          const alias = args[0];
          try {
            const output = await portalCommands.knowledge(alias, {
              json: options.json,
            });
            console.log(output);
          } catch (error) {
            display.error("cli.error", "portal knowledge", {
              message: error instanceof Error ? error.message : DEFAULT_UNKNOWN_ERROR_MESSAGE,
            });
            Deno.exit(1);
          }
        }),
    );
}

export function buildPortalCommand(runtime: IExaCtlRuntime): ReturnType<typeof createPortalCommand> {
  return createPortalCommand(runtime);
}
