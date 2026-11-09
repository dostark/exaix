/**
 * @module ExaCtlConfigCommand
 * @path apps/exactl/src/command_builders/config_command.ts
 * @description Builds the exactl config command tree from the shared runtime services.
 * @architectural-layer CLI
 * @related-files [apps/exactl/src/exactl.ts, apps/exactl/src/exactl_runtime.ts]
 */

import { Command } from "@cliffy/command";
import { DEFAULT_UNKNOWN_ERROR_MESSAGE } from "@exaix/core";
import type { Opt, Reason } from "@exaix/core/types";
import { ExaCtlOutputFormat, type IExaCtlColumn } from "@exaix/cli";
import type { IExaCtlRuntime } from "../exactl_runtime.ts";
import { formatTree } from "../commands/config_commands.ts";
import { actionOutput, cellText, ColumnHeader, type IJsonRow, toRow } from "../output/exactl_output.ts";
import { ExaCtlCommandName, ExaCtlSubNoun, ExaCtlVerb, MutationStatus } from "../exactl_constants.ts";
import { documentLeaves } from "./documented_children.ts";
import { documentedNoun } from "../docs/exactl_noun_doc.ts";
import { nounDocFor } from "../command_docs/mod.ts";

const PATH_ARGUMENT = "<path>";
const PATTERN_ARGUMENT = "<pattern>";
const CONFIG_ID = "config";
const PROFILE_OPTION = "--profile <name:string>";
const REASON_OPTION = "--reason <text:string>";

const HISTORY_COLUMNS: readonly IExaCtlColumn<IJsonRow>[] = [
  { header: ColumnHeader.ID, value: (row) => String(row.id) },
  { header: "Value", value: (row) => cellText(row.value) },
  { header: "Source", value: (row) => cellText(row.source) },
  { header: ColumnHeader.CREATED, value: (row) => cellText(row.created_at) },
];

const BLOCK_COLUMNS: readonly IExaCtlColumn<IJsonRow>[] = [
  { header: "Pattern", value: (row) => cellText(row.pattern) },
  { header: "Reason", value: (row) => cellText(row.reason) },
  { header: ColumnHeader.CREATED, value: (row) => cellText(row.created_at) },
];

const LOCK_COLUMNS: readonly IExaCtlColumn<IJsonRow>[] = [
  { header: "Key", value: (row) => cellText(row.key) },
  { header: "Locked by", value: (row) => cellText(row.locked_by) },
  { header: "Reason", value: (row) => cellText(row.reason) },
];

const DIFF_COLUMNS: readonly IExaCtlColumn<IJsonRow>[] = [
  { header: "Path", value: (row) => cellText(row.path) },
  { header: "Default", value: (row) => cellText(row.default) },
  { header: "Current", value: (row) => cellText(row.current) },
];

const SOURCE_COLUMNS: readonly IExaCtlColumn<IJsonRow>[] = [
  { header: "Key", value: (row) => cellText(row.key) },
  { header: "Value", value: (row) => cellText(row.value) },
  { header: "Source", value: (row) => cellText(row.source) },
];

const PROFILE_COLUMNS: readonly IExaCtlColumn<IJsonRow>[] = [
  { header: "Profile", value: (row) => cellText(row.name) },
];

const ISSUE_COLUMNS: readonly IExaCtlColumn<IJsonRow>[] = [
  { header: "Path", value: (row) => cellText(row.path) },
  { header: "Code", value: (row) => cellText(row.code) },
  { header: "Message", value: (row) => cellText(row.message) },
];

function createConfigCommand(runtime: IExaCtlRuntime) {
  const { display, configCommands } = runtime;
  const noun = nounDocFor(ExaCtlCommandName.CONFIG);

  /** Runs one action. A failure prints its message and ends the process with exit code 1. */
  const guarded = <T extends object | void>(
    action: string,
    textFormat: ExaCtlOutputFormat,
    work: (output: ReturnType<typeof actionOutput>, options: T, ...args: string[]) => Promise<void>,
  ) =>
  async (options: T, ...args: string[]): Promise<void> => {
    try {
      await work(actionOutput(runtime, options, textFormat), options, ...args);
    } catch (error) {
      display.error("cli.error", action, {
        message: error instanceof Error ? error.message : DEFAULT_UNKNOWN_ERROR_MESSAGE,
      });
      Deno.exit(1);
    }
  };

  const get = new Command()
    .option(PROFILE_OPTION, "Target a named profile (reads profile.<name>.<path>)")
    .action(
      guarded("config get", ExaCtlOutputFormat.TEXT, async ({ renderer }, options: { profile?: string }, ...args) => {
        const value = await configCommands.get(args[0], options.profile);
        if (renderer.machine) {
          await renderer.item(toRow({ path: args[0], value, profile: options.profile ?? null }), []);
        } else await renderer.text(String(value));
      }),
    );
  const set = new Command()
    .option(PROFILE_OPTION, "Target a named profile (writes profile.<name>.<path>)")
    .action(
      guarded("config set", ExaCtlOutputFormat.TEXT, async ({ renderer }, options: { profile?: string }, ...args) => {
        await configCommands.set(args[0], args[1], options.profile);
        display.info("cli.config.set", args[0], { value: args[1], profile: options.profile });
        await renderer.mutation(
          [{ id: args[0], action: ExaCtlVerb.SET, status: MutationStatus.SET, value: args[1] }],
          false,
        );
      }),
    );
  const unset = new Command().action(
    guarded("config unset", ExaCtlOutputFormat.TEXT, async ({ renderer }, _options: void, ...args) => {
      await configCommands.unset(args[0]);
      display.info("cli.config.unset", args[0], {});
      await renderer.mutation([{ id: args[0], action: ExaCtlVerb.UNSET, status: MutationStatus.UNSET }], false);
    }),
  );
  const history = new Command().action(
    guarded("config history", ExaCtlOutputFormat.TABLE, async ({ renderer }, _options: void, ...args) => {
      const rows = await configCommands.history(args[0]);
      await renderer.list(rows.map(toRow), HISTORY_COLUMNS, (row) => String(row.id));
    }),
  );
  const rollback = new Command().action(
    guarded("config rollback", ExaCtlOutputFormat.TEXT, async ({ renderer }, _options: void, ...args) => {
      const id = Number(args[1]);
      const restored = await configCommands.rollback(args[0], id);
      display.info("cli.config.rollback", args[0], { to_id: id, restored_value: restored });
      await renderer.mutation(
        [{
          id: args[0],
          action: ExaCtlVerb.ROLLBACK,
          status: MutationStatus.ROLLED_BACK,
          toId: id,
          restoredValue: restored,
        }],
        false,
      );
    }),
  );
  const edit = new Command().action(guarded("config edit", ExaCtlOutputFormat.TEXT, async ({ renderer }) => {
    await configCommands.edit();
    display.info("cli.config.edit", CONFIG_ID, { applied: true });
    await renderer.mutation([{ id: CONFIG_ID, action: ExaCtlVerb.EDIT, status: MutationStatus.APPLIED }], false);
  }));
  const compact = new Command().action(guarded("config compact", ExaCtlOutputFormat.TEXT, async ({ renderer }) => {
    const removed = await configCommands.compact();
    display.info("cli.config.compact", CONFIG_ID, { removed });
    await renderer.mutation(
      [{ id: CONFIG_ID, action: ExaCtlVerb.COMPACT, status: MutationStatus.COMPACTED, removed }],
      false,
    );
  }));
  const validateAction = guarded(
    "config validate",
    ExaCtlOutputFormat.TEXT,
    async ({ renderer }, _options: void, ...args) => {
      const path: Opt<string, Reason.OptionalInput> = args[0];
      const report = await configCommands.validate(path);
      if (renderer.machine) {
        await renderer.item(toRow({ valid: report.valid, issues: report.issues.map(toRow) }), []);
      } else if (report.valid) {
        display.info("cli.config.validate", CONFIG_ID, { valid: true });
      } else {
        await renderer.list(report.issues.map(toRow), ISSUE_COLUMNS, (row) => cellText(row.path));
      }
    },
  );
  const validate = new Command()
    .arguments("[path:string]")
    .action((options, path?: Opt<string, Reason.OptionalInput>) =>
      validateAction(options, ...(path === undefined ? [] : [path]))
    );
  const show = new Command()
    .option("--sources", "Include provenance source for each key")
    .action(guarded("config show", ExaCtlOutputFormat.TEXT, async ({ renderer }, options: { sources?: boolean }) => {
      if (options.sources) {
        const rows = await configCommands.showSources();
        await renderer.list(rows.map(toRow), SOURCE_COLUMNS, (row) => cellText(row.key));
        return;
      }
      const effective = await configCommands.show();
      if (renderer.machine) await renderer.item(toRow(effective), []);
      else await renderer.text(formatTree(effective, 0).trimEnd());
    }));
  const diff = new Command().action(guarded("config diff", ExaCtlOutputFormat.TABLE, async ({ renderer }) => {
    const rows = await configCommands.diff();
    await renderer.list(rows.map(toRow), DIFF_COLUMNS, (row) => cellText(row.path));
  }));

  const block = new Command()
    .description("Manage the MCP config-write deny-permanently blocklist")
    .command(
      `${ExaCtlVerb.ADD} ${PATTERN_ARGUMENT}`,
      new Command()
        .option(REASON_OPTION, "Optional admin note for the block")
        .action(
          guarded(
            "config block add",
            ExaCtlOutputFormat.TEXT,
            async ({ renderer }, options: { reason?: string }, ...args) => {
              await configCommands.blockAdd(args[0], options.reason);
              display.info("cli.config.block.add", args[0], { reason: options.reason });
              await renderer.mutation([{ id: args[0], action: ExaCtlVerb.ADD, status: MutationStatus.BLOCKED }], false);
            },
          ),
        ),
    )
    .command(
      `${ExaCtlVerb.REMOVE} ${PATTERN_ARGUMENT}`,
      new Command().action(
        guarded("config block remove", ExaCtlOutputFormat.TEXT, async ({ renderer }, _options: void, ...args) => {
          await configCommands.blockRemove(args[0]);
          display.info("cli.config.block.remove", args[0], {});
          await renderer.mutation([{ id: args[0], action: ExaCtlVerb.REMOVE, status: MutationStatus.REMOVED }], false);
        }),
      ),
    )
    .command(
      ExaCtlVerb.LIST,
      new Command().action(guarded("config block list", ExaCtlOutputFormat.TABLE, async ({ renderer }) => {
        const blocks = await configCommands.blockList();
        await renderer.list(blocks.map(toRow), BLOCK_COLUMNS, (row) => cellText(row.pattern));
      })),
    );

  const lock = new Command()
    .description("Lock config keys against all writes (CLI, MCP and daemon)")
    .command(
      `${ExaCtlVerb.ADD} ${PATH_ARGUMENT}`,
      new Command()
        .option(REASON_OPTION, "Optional note for the lock")
        .action(
          guarded(
            "config lock add",
            ExaCtlOutputFormat.TEXT,
            async ({ renderer }, options: { reason?: string }, ...args) => {
              await configCommands.lock(args[0], options.reason);
              display.info("cli.config.lock", args[0], { reason: options.reason });
              await renderer.mutation([{ id: args[0], action: ExaCtlVerb.ADD, status: MutationStatus.LOCKED }], false);
            },
          ),
        ),
    )
    .command(
      `${ExaCtlVerb.REMOVE} ${PATH_ARGUMENT}`,
      new Command().action(
        guarded("config lock remove", ExaCtlOutputFormat.TEXT, async ({ renderer }, _options: void, ...args) => {
          await configCommands.unlock(args[0]);
          display.info("cli.config.unlock", args[0], {});
          await renderer.mutation([{ id: args[0], action: ExaCtlVerb.REMOVE, status: MutationStatus.UNLOCKED }], false);
        }),
      ),
    )
    .command(
      ExaCtlVerb.LIST,
      new Command().action(guarded("config lock list", ExaCtlOutputFormat.TABLE, async ({ renderer }) => {
        const locks = await configCommands.listLocks();
        await renderer.list(locks.map(toRow), LOCK_COLUMNS, (row) => cellText(row.key));
      })),
    );

  const profile = new Command()
    .description("Manage configuration profiles")
    .command(
      `${ExaCtlVerb.USE} <name:string>`,
      new Command().action(
        guarded("config profile use", ExaCtlOutputFormat.TEXT, async ({ renderer }, _options: void, ...args) => {
          await configCommands.useProfile(args[0]);
          display.info("cli.config.use-profile", args[0], {});
          await renderer.mutation([{ id: args[0], action: ExaCtlVerb.USE, status: MutationStatus.ACTIVE }], false);
        }),
      ),
    )
    .command(
      ExaCtlVerb.LIST,
      new Command().action(guarded("config profile list", ExaCtlOutputFormat.TABLE, async ({ renderer }) => {
        const profiles = await configCommands.listProfiles();
        await renderer.list(profiles.map((name) => toRow({ name })), PROFILE_COLUMNS, (row) => cellText(row.name));
      })),
    );

  const command = documentedNoun(new Command(), noun)
    .command(`${ExaCtlVerb.GET} ${PATH_ARGUMENT}`, get)
    .command(`${ExaCtlVerb.SET} ${PATH_ARGUMENT} <value>`, set)
    .command(`${ExaCtlVerb.UNSET} ${PATH_ARGUMENT}`, unset)
    .command(`${ExaCtlVerb.HISTORY} ${PATH_ARGUMENT}`, history)
    .command(`${ExaCtlVerb.ROLLBACK} ${PATH_ARGUMENT} <id>`, rollback)
    .command(ExaCtlVerb.EDIT, edit)
    .command(ExaCtlSubNoun.BLOCK, block)
    .command(ExaCtlVerb.COMPACT, compact)
    .command(ExaCtlVerb.VALIDATE, validate)
    .command(ExaCtlVerb.SHOW, show)
    .command(ExaCtlVerb.DIFF, diff)
    .command(ExaCtlSubNoun.LOCK, lock)
    .command(ExaCtlSubNoun.PROFILE, profile);
  const name = ExaCtlCommandName.CONFIG;
  documentLeaves(command, [name], noun.lifecycle);
  documentLeaves(block, [name, ExaCtlSubNoun.BLOCK], noun.lifecycle);
  documentLeaves(lock, [name, ExaCtlSubNoun.LOCK], noun.lifecycle);
  documentLeaves(profile, [name, ExaCtlSubNoun.PROFILE], noun.lifecycle);
  return command;
}

export function buildConfigCommand(runtime: IExaCtlRuntime): ReturnType<typeof createConfigCommand> {
  return createConfigCommand(runtime);
}
