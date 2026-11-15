/**
 * @module ExaCtlModelCommand
 * @path apps/exactl/src/command_builders/model_command.ts
 * @description Builds the exactl model command: the registry listing, provider selection, candidate curation and routing inspection.
 * @architectural-layer CLI
 * @related-files [apps/exactl/src/exactl.ts, apps/exactl/src/commands/model_commands.ts, apps/exactl/src/commands/routing_commands.ts]
 */

import { Command } from "@cliffy/command";
import type { JSONValue } from "@exaix/core";
import type { Opt, Reason } from "@exaix/core/types";
import { ExaCtlOutputFormat, type IExaCtlColumn } from "@exaix/cli";
import type { IExaCtlRuntime } from "../exactl_runtime.ts";
import { ExaCtlCommandName, ExaCtlSubNoun, ExaCtlVerb, MutationStatus } from "../exactl_constants.ts";
import { ExaCtlError, ExaCtlExitCode } from "@exaix/cli/errors/exactl_errors.ts";
import {
  actionOutput,
  cellText,
  ColumnHeader,
  EMPTY_CELL,
  type ExaCtlOutputRenderer,
  type IJsonRow,
  toRow,
} from "../output/exactl_output.ts";
import type { IModelListRow } from "../commands/model_commands.ts";
import { failCommand } from "./command_failure.ts";
import { documentLeaves } from "./documented_children.ts";
import { documentedNoun } from "../docs/exactl_noun_doc.ts";
import { nounDocFor } from "../command_docs/mod.ts";

const DEFAULT_MODEL_NAME = "default";
const PROVIDER_MODEL_SEPARATOR = ":";
const MAX_EXPLAINED_CANDIDATES = 5;

/** Splits `provider` or `provider:model` at the first colon, because a model id can hold more colons. */
function parseProviderTarget(target: string): { provider: string; model: Opt<string, Reason.OptionalInput> } {
  const separator = target.indexOf(PROVIDER_MODEL_SEPARATOR);
  const provider = separator === -1 ? target : target.slice(0, separator);
  const model = separator === -1 ? undefined : target.slice(separator + 1);
  if (provider === "" || model === "") {
    throw new ExaCtlError(ExaCtlExitCode.USAGE, `Expected <provider> or <provider>:<model>, got '${target}'.`);
  }
  return { provider, model };
}

const MODEL_REGISTRY_ID = "model-registry";

function priceText(price: JSONValue): string {
  return typeof price === "number" ? `$${price}` : EMPTY_CELL;
}

const MODEL_BASE_COLUMNS: readonly IExaCtlColumn<IJsonRow>[] = [
  { header: "Model", value: (row) => cellText(row.model) },
  { header: "Author", value: (row) => cellText(row.author) },
  { header: "Service", value: (row) => cellText(row.service) },
  { header: "Route", value: (row) => cellText(row.route) },
  { header: "Provenance", value: (row) => cellText(row.price_source) },
  { header: "Source URL", value: (row) => cellText(row.source_url) },
  { header: "Verified", value: (row) => cellText(row.verified_at) },
  { header: "Stale", value: (row) => row.stale === null ? EMPTY_CELL : row.stale ? "yes" : "no" },
  { header: "Input $/Mtok", value: (row) => priceText(row.input_per_mtok) },
  { header: "Output $/Mtok", value: (row) => priceText(row.output_per_mtok) },
];

const EXPLAIN_FIELDS: readonly IExaCtlColumn<IJsonRow>[] = [
  { header: "Selected agent role", value: (row) => cellText(row.selected_agent_role) },
  { header: "Selected version", value: (row) => cellText(row.selected_version) },
  { header: "Strategy", value: (row) => cellText(row.strategy) },
  { header: "Matched rule", value: (row) => cellText(row.matched_rule_id) },
  { header: "Candidates", value: (row) => String(row.candidate_count) },
];

const CANDIDATE_COLUMNS: readonly IExaCtlColumn<IJsonRow>[] = [
  { header: ColumnHeader.AGENT, value: (row) => cellText(row.agent_role) },
  { header: "Version", value: (row) => cellText(row.version) },
  { header: "Score", value: (row) => typeof row.score === "number" ? row.score.toFixed(2) : EMPTY_CELL },
];

const VALIDATE_FIELDS: readonly IExaCtlColumn<IJsonRow>[] = [
  { header: "Path", value: (row) => cellText(row.path) },
  { header: "Valid", value: (row) => String(row.valid) },
];

function modelColumns(benchmark: Opt<string, Reason.OptionalInput>): readonly IExaCtlColumn<IJsonRow>[] {
  return benchmark
    ? [...MODEL_BASE_COLUMNS, { header: `Benchmark (${benchmark}, advisory)`, value: (row) => cellText(row.benchmark) }]
    : MODEL_BASE_COLUMNS;
}

/** Prints the registry rows. A benchmark name adds an advisory score column. */
export async function renderModelList(
  renderer: ExaCtlOutputRenderer,
  rows: readonly IModelListRow[],
  benchmark: Opt<string, Reason.OptionalInput>,
): Promise<void> {
  await renderer.list(rows.map(toRow), modelColumns(benchmark), (row) => cellText(row.model));
}

function createListCommand(runtime: IExaCtlRuntime) {
  const { display, modelCommands } = runtime;
  return new Command()
    .option("--model <model:string>", "Only the services that serve this model, as <author>/<model>")
    .option("--benchmark <benchmark:string>", "Show the advisory score column for a tracked benchmark (Team)")
    .action(async (options) => {
      const { renderer } = actionOutput(runtime, options, ExaCtlOutputFormat.TABLE);
      try {
        const rows = await modelCommands.listModels(options);
        if (rows.length === 0 && options.model !== undefined) {
          display.info("cli.model.list", options.model, { message: `No service serves ${options.model}.` });
        }
        await renderModelList(renderer, rows, options.benchmark);
      } catch (error) {
        if (error instanceof ExaCtlError) throw error;
        failCommand(error as Error);
      }
    });
}

function createRefreshCommand(runtime: IExaCtlRuntime) {
  const { display, modelCommands } = runtime;
  return new Command().action(async (options) => {
    const { renderer } = actionOutput(runtime, options, ExaCtlOutputFormat.TEXT);
    try {
      const guidance = await modelCommands.refreshModels();
      display.info("cli.model.refresh", MODEL_REGISTRY_ID, { guidance });
      await renderer.mutation(
        [{ id: MODEL_REGISTRY_ID, action: ExaCtlVerb.REFRESH, status: MutationStatus.DEFERRED, guidance }],
        false,
      );
    } catch (error) {
      failCommand(error as Error);
    }
  });
}

function createUseCommand(runtime: IExaCtlRuntime) {
  const { display, configCommands } = runtime;
  return new Command()
    .arguments("<target:string>")
    .action(async (options, target: string) => {
      const { renderer } = actionOutput(runtime, options, ExaCtlOutputFormat.TEXT);
      const { provider, model } = parseProviderTarget(target);
      try {
        await configCommands.setProvider(provider);
        display.info("config.set-provider", provider, {});
        if (model !== undefined) {
          await configCommands.setModel(DEFAULT_MODEL_NAME, model);
          display.info("config.set-model", DEFAULT_MODEL_NAME, { model });
        }
        await renderer.mutation(
          [{ id: provider, action: ExaCtlVerb.USE, status: MutationStatus.ACTIVE, model: model ?? null }],
          false,
        );
      } catch (error) {
        failCommand(error as Error);
      }
    });
}

function createCandidatesCommand(runtime: IExaCtlRuntime) {
  const { display, modelCommands } = runtime;
  return new Command()
    .option("--size <size:string>", "Capability tier: S|M|L|XL")
    .option("--characteristic <name:string>", "Write a characteristic sub-list instead of the base list")
    .option("--clear", "Reset the size's candidate list to empty")
    .option("--list", "Show curated lists per size with unconfigured flags")
    .arguments("[entries...:string]")
    .action(async (options, ...entries: string[]) => {
      const { renderer } = actionOutput(runtime, options, ExaCtlOutputFormat.TEXT);
      try {
        if (options.list) {
          const lists = await modelCommands.listCandidates();
          if (renderer.machine) {
            await renderer.item(toRow(lists), []);
            return;
          }
          for (const [size, view] of Object.entries(lists)) {
            await renderer.text(`  ${size}:`);
            for (const e of view.entries) {
              await renderer.text(`    ${e.entry}${e.unconfigured ? "  (unconfigured)" : ""}`);
            }
          }
          return;
        }
        if (!options.size) {
          throw new Error("--size <S|M|L|XL> is required (or use --list).");
        }
        if (options.clear) {
          await modelCommands.clearCandidates(options.size);
          display.info("config.model.clear", options.size, {});
          await renderer.mutation(
            [{ id: options.size, action: ExaCtlVerb.CANDIDATES, status: MutationStatus.CLEARED }],
            false,
          );
          return;
        }
        if (options.characteristic) {
          await modelCommands.setCharacteristic(options.size, options.characteristic, entries);
          display.info("config.model.characteristic", options.size, {
            characteristic: options.characteristic,
            count: entries.length,
          });
        } else {
          await modelCommands.setCandidates(options.size, entries);
          display.info("config.model.set", options.size, { count: entries.length });
        }
        await renderer.mutation(
          [{
            id: options.size,
            action: ExaCtlVerb.CANDIDATES,
            status: MutationStatus.SET,
            characteristic: options.characteristic ?? null,
            count: entries.length,
          }],
          false,
        );
      } catch (error) {
        failCommand(error as Error);
      }
    });
}

function createExplainCommand(runtime: IExaCtlRuntime) {
  const { routingCommands } = runtime;
  return new Command()
    .option("--request <request:string>", "Path to a request file")
    .action(async (options) => {
      const { renderer } = actionOutput(runtime, options, ExaCtlOutputFormat.TEXT);
      const requestFile = options.request;
      if (!requestFile) {
        throw new ExaCtlError(ExaCtlExitCode.USAGE, "The --request option is required.");
      }
      try {
        const result = await routingCommands.explainRequest(requestFile);
        const candidates = result.candidates.slice(0, MAX_EXPLAINED_CANDIDATES).map((candidate) =>
          toRow({ agent_role: candidate.agentRole, version: candidate.version, score: candidate.score })
        );
        const summary = toRow({
          selected_agent_role: result.selectedAgentRole,
          selected_version: result.selectedVersion,
          strategy: result.strategy,
          matched_rule_id: result.matchedRuleId ?? null,
          candidate_count: result.candidates.length,
          candidates,
        });
        await renderer.item(summary, EXPLAIN_FIELDS);
        if (!renderer.machine) await renderer.list(candidates, CANDIDATE_COLUMNS, (row) => cellText(row.agent_role));
      } catch (error) {
        failCommand(error as Error);
      }
    });
}

function createValidateCommand(runtime: IExaCtlRuntime) {
  const { display, routingCommands } = runtime;
  return new Command().action(async (options, ...args: string[]) => {
    const { renderer } = actionOutput(runtime, options, ExaCtlOutputFormat.TEXT);
    try {
      const result = await routingCommands.validatePolicy(args[0]);
      await renderer.item(
        toRow({ path: result.path, valid: result.success, errors: result.success ? [] : result.errors }),
        VALIDATE_FIELDS,
      );
      if (!result.success) {
        display.error("routing.policy.invalid", result.path, { errors: result.errors });
        throw new ExaCtlError(ExaCtlExitCode.INVALID, `Routing policy is invalid: ${result.path}`);
      }
    } catch (error) {
      failCommand(error as Error);
    }
  });
}

function createModelCommand(runtime: IExaCtlRuntime) {
  const noun = nounDocFor(ExaCtlCommandName.MODEL);
  const route = new Command()
    .description("Inspect routing policy behavior and candidate ranking")
    .command(ExaCtlVerb.EXPLAIN, createExplainCommand(runtime))
    .command(`${ExaCtlVerb.VALIDATE} [policy-file:string]`, createValidateCommand(runtime));
  const command = documentedNoun(new Command(), noun)
    .command(ExaCtlVerb.LIST, createListCommand(runtime))
    .command(ExaCtlVerb.REFRESH, createRefreshCommand(runtime))
    .command(ExaCtlVerb.USE, createUseCommand(runtime))
    .command(ExaCtlVerb.CANDIDATES, createCandidatesCommand(runtime))
    .command(ExaCtlSubNoun.ROUTE, route);
  documentLeaves(command, [ExaCtlCommandName.MODEL], noun.lifecycle);
  documentLeaves(route, [ExaCtlCommandName.MODEL, ExaCtlSubNoun.ROUTE], noun.lifecycle);
  return command;
}

export function buildModelCommand(runtime: IExaCtlRuntime): ReturnType<typeof createModelCommand> {
  return createModelCommand(runtime);
}
