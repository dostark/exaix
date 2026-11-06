/**
 * @module ExaCtlConfigCommand
 * @path apps/exactl/src/command_builders/config_command.ts
 * @description Builds the exactl config command tree from the shared runtime services.
 * @architectural-layer CLI
 * @related-files [apps/exactl/src/exactl.ts, apps/exactl/src/exactl_runtime.ts]
 */

import { Command } from "@cliffy/command";
import { ConfigOutputFormat, DEFAULT_UNKNOWN_ERROR_MESSAGE } from "@exaix/core";
import type { Opt, Reason } from "@exaix/core/types";
import type { IExaCtlRuntime } from "../exactl_runtime.ts";
import {
  CLI_CMD_LIST,
  CLI_OPTION_JSON_HELP,
  CONFIG_DIFF_LABEL,
  CONFIG_LABEL,
  CONFIG_VALIDATE_ACTION,
  ExaCtlSubNoun,
  ExaCtlVerb,
} from "../exactl_constants.ts";

function createConfigCommand(runtime: IExaCtlRuntime) {
  const command = new Command()
    .description("View and modify Exaix configuration");
  for (
    const [name, child] of [
      ...addConfigCommands1(runtime),
      ...addConfigCommands2(runtime),
      ...addConfigCommands3(runtime),
      ...addConfigCommands4(runtime),
      ...addConfigCommands5(runtime),
      ...addConfigCommands6(runtime),
    ]
  ) command.command(name, child);
  command.command(ExaCtlSubNoun.LOCK, createLockCommand(runtime));
  command.command(ExaCtlSubNoun.PROFILE, createProfileCommand(runtime));
  return command;
}

function addConfigCommands1(runtime: IExaCtlRuntime) {
  const { display, configCommands } = runtime;
  return [
    [
      "get <path>",
      new Command()
        .description("Print effective value at path")
        .option("--profile <name:string>", "Target a named profile (reads profile.<name>.<path>)")
        .action(async (options, ...args: string[]) => {
          try {
            const value = await configCommands.get(args[0], options.profile);
            display.info("config.get", args[0], { value: String(value), profile: options.profile });
          } catch (error) {
            display.error("cli.error", "config get", {
              message: error instanceof Error ? error.message : DEFAULT_UNKNOWN_ERROR_MESSAGE,
            });
            Deno.exit(1);
          }
        }),
    ],
    [
      "set <path> <value>",
      new Command()
        .description("Set value, validate, write, reload")
        .option("--profile <name:string>", "Target a named profile (writes profile.<name>.<path>)")
        .action(async (options, ...args: string[]) => {
          try {
            await configCommands.set(args[0], args[1], options.profile);
            display.info("config.set", args[0], { value: args[1], profile: options.profile });
          } catch (error) {
            display.error("cli.error", "config set", {
              message: error instanceof Error ? error.message : DEFAULT_UNKNOWN_ERROR_MESSAGE,
            });
            Deno.exit(1);
          }
        }),
    ],
    [
      "unset <path>",
      new Command()
        .description("Reset key to default")
        .action(async (_options, ...args: string[]) => {
          try {
            await configCommands.unset(args[0]);
            display.info("config.unset", args[0], {});
          } catch (error) {
            display.error("cli.error", "config unset", {
              message: error instanceof Error ? error.message : DEFAULT_UNKNOWN_ERROR_MESSAGE,
            });
            Deno.exit(1);
          }
        }),
    ],
  ] as const;
}

function addConfigCommands2(runtime: IExaCtlRuntime) {
  const { display, configCommands } = runtime;
  return [
    [
      "history <path>",
      new Command()
        .description("Show the append-only override history for a key (newest first)")
        .action(async (_options, ...args: string[]) => {
          try {
            const rows = await configCommands.history(args[0]);
            for (const row of rows) {
              display.info("config.history.entry", args[0], {
                id: row.id,
                value: row.value,
                source: row.source,
                created_at: row.created_at,
              });
            }
            display.info("config.history", args[0], { count: rows.length });
          } catch (error) {
            display.error("cli.error", "config history", {
              message: error instanceof Error ? error.message : DEFAULT_UNKNOWN_ERROR_MESSAGE,
            });
            Deno.exit(1);
          }
        }),
    ],
    [
      "rollback <path> <id>",
      new Command()
        .description("Revert a key to the value at a history id (appends a rollback row)")
        .action(async (_options, ...args: string[]) => {
          try {
            const id = Number(args[1]);
            const restored = await configCommands.rollback(args[0], id);
            display.info("config.rollback", args[0], { to_id: id, restored_value: restored });
          } catch (error) {
            display.error("cli.error", "config rollback", {
              message: error instanceof Error ? error.message : DEFAULT_UNKNOWN_ERROR_MESSAGE,
            });
            Deno.exit(1);
          }
        }),
    ],
  ] as const;
}

function addConfigCommands3(runtime: IExaCtlRuntime) {
  const { display, configCommands } = runtime;
  return [
    [
      "edit",
      new Command()
        .description("Edit config overrides in $EDITOR (changes applied through the set() funnel)")
        .action(async () => {
          try {
            await configCommands.edit();
            display.info("config.edit", CONFIG_LABEL, { applied: true });
          } catch (error) {
            display.error("cli.error", "config edit", {
              message: error instanceof Error ? error.message : DEFAULT_UNKNOWN_ERROR_MESSAGE,
            });
            Deno.exit(1);
          }
        }),
    ],
  ] as const;
}

function addConfigCommands4(runtime: IExaCtlRuntime) {
  const { display, configCommands } = runtime;
  return [
    [
      "block",
      new Command()
        .description("Manage the MCP config-write deny-permanently blocklist")
        .command(
          "add <pattern>",
          new Command()
            .description("Block a config path pattern from MCP writes (glob: system.*)")
            .option("--reason <text:string>", "Optional admin note for the block")
            .action(async (options, ...args: string[]) => {
              try {
                await configCommands.blockAdd(args[0], options.reason);
                display.info("config.block.add", args[0], { reason: options.reason });
              } catch (error) {
                display.error("cli.error", "config block add", {
                  message: error instanceof Error ? error.message : DEFAULT_UNKNOWN_ERROR_MESSAGE,
                });
                Deno.exit(1);
              }
            }),
        )
        .command(
          "remove <pattern>",
          new Command()
            .description("Remove a blocklist pattern")
            .action(async (_options, ...args: string[]) => {
              try {
                await configCommands.blockRemove(args[0]);
                display.info("config.block.remove", args[0], {});
              } catch (error) {
                display.error("cli.error", "config block remove", {
                  message: error instanceof Error ? error.message : DEFAULT_UNKNOWN_ERROR_MESSAGE,
                });
                Deno.exit(1);
              }
            }),
        )
        .command(
          CLI_CMD_LIST,
          new Command()
            .description("List all blocklist patterns")
            .action(async () => {
              try {
                const blocks = await configCommands.blockList();
                for (const b of blocks) {
                  console.log(`${b.pattern}${b.reason ? `  (${b.reason})` : ""}`);
                }
                display.info("config.block.list", CONFIG_LABEL, { count: blocks.length });
              } catch (error) {
                display.error("cli.error", "config block list", {
                  message: error instanceof Error ? error.message : DEFAULT_UNKNOWN_ERROR_MESSAGE,
                });
                Deno.exit(1);
              }
            }),
        ),
    ],
  ] as const;
}

function addConfigCommands5(runtime: IExaCtlRuntime) {
  const { display, configCommands } = runtime;
  return [
    [
      "compact",
      new Command()
        .description("Compact config_overrides to one row per key (recovers DB headroom)")
        .action(async () => {
          try {
            const removed = await configCommands.compact();
            display.info("config.compact", CONFIG_LABEL, { removed });
          } catch (error) {
            display.error("cli.error", "config compact", {
              message: error instanceof Error ? error.message : DEFAULT_UNKNOWN_ERROR_MESSAGE,
            });
            Deno.exit(1);
          }
        }),
    ],
    [
      "validate",
      new Command()
        .description("Validate entire config or specific path")
        .arguments("[path:string]")
        .action(async (_options, path?: Opt<string, Reason.OptionalInput>) => {
          try {
            const report = await configCommands.validate(path);
            if (report.valid) {
              display.info(CONFIG_VALIDATE_ACTION, CONFIG_LABEL, { valid: true });
            } else {
              for (const issue of report.issues) {
                display.warn(CONFIG_VALIDATE_ACTION, issue.path, { message: issue.message, code: issue.code });
              }
            }
          } catch (error) {
            display.error("cli.error", "config validate", {
              message: error instanceof Error ? error.message : DEFAULT_UNKNOWN_ERROR_MESSAGE,
            });
            Deno.exit(1);
          }
        }),
    ],
    [
      "show",
      new Command()
        .description("Show effective config")
        .option("--json", CLI_OPTION_JSON_HELP)
        .option("--sources", "Include provenance source for each key")
        .action(async (options) => {
          try {
            const format = options.json ? ConfigOutputFormat.JSON : ConfigOutputFormat.HUMAN;
            const output = await configCommands.show(format, options.sources);
            console.log(output);
          } catch (error) {
            display.error("cli.error", "config show", {
              message: error instanceof Error ? error.message : DEFAULT_UNKNOWN_ERROR_MESSAGE,
            });
            Deno.exit(1);
          }
        }),
    ],
  ] as const;
}

function addConfigCommands6(runtime: IExaCtlRuntime) {
  const { display, configCommands } = runtime;
  return [
    [
      CONFIG_DIFF_LABEL,
      new Command()
        .description("Show uncommitted config changes")
        .action(async () => {
          try {
            console.log(await configCommands.diff());
          } catch (error) {
            display.error("cli.error", "config diff", {
              message: error instanceof Error ? error.message : DEFAULT_UNKNOWN_ERROR_MESSAGE,
            });
            Deno.exit(1);
          }
        }),
    ],
  ] as const;
}

function createLockCommand(runtime: IExaCtlRuntime) {
  const { display, configCommands } = runtime;
  return new Command()
    .description("Lock config keys against all writes (CLI, MCP and daemon)")
    .command(
      `${ExaCtlVerb.ADD} <path>`,
      new Command()
        .description("Lock a config key against all writes (CLI/MCP/daemon)")
        .option("--reason <text:string>", "Optional note for the lock")
        .action(async (options, ...args: string[]) => {
          try {
            await configCommands.lock(args[0], options.reason);
            display.info("config.lock", args[0], { reason: options.reason });
          } catch (error) {
            display.error("cli.error", "config lock add", {
              message: error instanceof Error ? error.message : DEFAULT_UNKNOWN_ERROR_MESSAGE,
            });
            Deno.exit(1);
          }
        }),
    )
    .command(
      `${ExaCtlVerb.REMOVE} <path>`,
      new Command()
        .description("Unlock a previously locked config key")
        .action(async (_options, ...args: string[]) => {
          try {
            await configCommands.unlock(args[0]);
            display.info("config.unlock", args[0], {});
          } catch (error) {
            display.error("cli.error", "config lock remove", {
              message: error instanceof Error ? error.message : DEFAULT_UNKNOWN_ERROR_MESSAGE,
            });
            Deno.exit(1);
          }
        }),
    )
    .command(
      ExaCtlVerb.LIST,
      new Command()
        .description("List all locked config keys")
        .action(async () => {
          try {
            const locks = await configCommands.listLocks();
            for (const l of locks) {
              display.info("config.lock.entry", l.key, { locked_by: l.locked_by, reason: l.reason });
            }
            display.info("config.lock.list", CONFIG_LABEL, { count: locks.length });
          } catch (error) {
            display.error("cli.error", "config lock list", {
              message: error instanceof Error ? error.message : DEFAULT_UNKNOWN_ERROR_MESSAGE,
            });
            Deno.exit(1);
          }
        }),
    );
}

function createProfileCommand(runtime: IExaCtlRuntime) {
  const { display, configCommands } = runtime;
  return new Command()
    .description("Manage configuration profiles")
    .command(
      `${ExaCtlVerb.USE} <name:string>`,
      new Command()
        .description("Set active profile")
        .action(async (_options, ...args: string[]) => {
          try {
            await configCommands.useProfile(args[0]);
            display.info("config.use-profile", args[0], {});
          } catch (error) {
            display.error("cli.error", "config profile use", {
              message: error instanceof Error ? error.message : DEFAULT_UNKNOWN_ERROR_MESSAGE,
            });
            Deno.exit(1);
          }
        }),
    )
    .command(
      ExaCtlVerb.LIST,
      new Command()
        .description("List all profiles")
        .action(async () => {
          try {
            const profiles = await configCommands.listProfiles();
            for (const p of profiles) {
              console.log(`  ${p}`);
            }
            if (profiles.length === 0) {
              console.log("  No profiles configured.");
            }
          } catch (error) {
            display.error("cli.error", "config profile list", {
              message: error instanceof Error ? error.message : DEFAULT_UNKNOWN_ERROR_MESSAGE,
            });
            Deno.exit(1);
          }
        }),
    );
}

export function buildConfigCommand(runtime: IExaCtlRuntime): ReturnType<typeof createConfigCommand> {
  return createConfigCommand(runtime);
}
