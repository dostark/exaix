/**
 * @module ExaCtlModelCommand
 * @path apps/exactl/src/command_builders/model_command.ts
 * @description Builds the exactl model command: the registry listing, provider selection, candidate curation and routing inspection.
 * @architectural-layer CLI
 * @related-files [apps/exactl/src/exactl.ts, apps/exactl/src/commands/model_commands.ts, apps/exactl/src/commands/routing_commands.ts]
 */

import { Command } from "@cliffy/command";
import { DEFAULT_UNKNOWN_ERROR_MESSAGE } from "@exaix/core";
import type { Opt, Reason } from "@exaix/core/types";
import type { IExaCtlRuntime } from "../exactl_runtime.ts";
import { ExaCtlSubNoun, ExaCtlVerb } from "../exactl_constants.ts";
import { ExaCtlError, ExaCtlExitCode } from "../exactl_errors.ts";

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

function createListCommand(runtime: IExaCtlRuntime) {
  const { display, modelCommands } = runtime;
  return new Command()
    .description("List registry models with provenance, verified date and per-Mtok prices")
    .option("--model <model:string>", "Only the services that serve this model, as <author>/<model>")
    .option("--benchmark <benchmark:string>", "Show the advisory score column for a tracked benchmark (Team)")
    .action(async (options) => {
      try {
        await modelCommands.listModels(options);
      } catch (error) {
        if (error instanceof ExaCtlError) throw error;
        display.error("cli.error", "model list", {
          message: error instanceof Error ? error.message : DEFAULT_UNKNOWN_ERROR_MESSAGE,
        });
        Deno.exit(1);
      }
    });
}

function createRefreshCommand(runtime: IExaCtlRuntime) {
  const { display, modelCommands } = runtime;
  return new Command()
    .description("Trigger a Team live-registry catalog refresh (Team + model_registry.enabled only)")
    .action(async () => {
      try {
        await modelCommands.refreshModels();
      } catch (error) {
        display.error("cli.error", "model refresh", {
          message: error instanceof Error ? error.message : DEFAULT_UNKNOWN_ERROR_MESSAGE,
        });
        Deno.exit(1);
      }
    });
}

function createUseCommand(runtime: IExaCtlRuntime) {
  const { display, configCommands } = runtime;
  return new Command()
    .description("Set the provider and its default model")
    .arguments("<target:string>")
    .action(async (_options, target: string) => {
      const { provider, model } = parseProviderTarget(target);
      try {
        await configCommands.setProvider(provider);
        display.info("config.set-provider", provider, {});
        if (model !== undefined) {
          await configCommands.setModel(DEFAULT_MODEL_NAME, model);
          display.info("config.set-model", DEFAULT_MODEL_NAME, { model });
        }
      } catch (error) {
        display.error("cli.error", "model use", {
          message: error instanceof Error ? error.message : DEFAULT_UNKNOWN_ERROR_MESSAGE,
        });
        Deno.exit(1);
      }
    });
}

function createCandidatesCommand(runtime: IExaCtlRuntime) {
  const { display, modelCommands } = runtime;
  return new Command()
    .description("Curate the per-size model candidate list the resolver reads")
    .option("--size <size:string>", "Capability tier: S|M|L|XL")
    .option("--characteristic <name:string>", "Write a characteristic sub-list instead of the base list")
    .option("--clear", "Reset the size's candidate list to empty")
    .option("--list", "Show curated lists per size with unconfigured flags")
    .arguments("[entries...:string]")
    .action(async (options, ...entries: string[]) => {
      try {
        if (options.list) {
          const lists = await modelCommands.listCandidates();
          for (const [size, view] of Object.entries(lists)) {
            console.log(`  ${size}:`);
            for (const e of view.entries) {
              console.log(`    ${e.entry}${e.unconfigured ? "  (unconfigured)" : ""}`);
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
          return;
        }
        if (options.characteristic) {
          await modelCommands.setCharacteristic(options.size, options.characteristic, entries);
          display.info("config.model.characteristic", options.size, {
            characteristic: options.characteristic,
            count: entries.length,
          });
          return;
        }
        await modelCommands.setCandidates(options.size, entries);
        display.info("config.model.set", options.size, { count: entries.length });
      } catch (error) {
        display.error("cli.error", "model candidates", {
          message: error instanceof Error ? error.message : DEFAULT_UNKNOWN_ERROR_MESSAGE,
        });
        Deno.exit(1);
      }
    });
}

function createExplainCommand(runtime: IExaCtlRuntime) {
  const { display, routingCommands } = runtime;
  return new Command()
    .description("Explain dynamic routing for a request without executing it")
    .option("--request <request:string>", "Path to a request file")
    .action(async (options) => {
      const requestFile = options.request;
      if (!requestFile) {
        display.error("cli.error", "model route explain", { message: "The --request option is required." });
        Deno.exit(1);
      }
      try {
        const result = await routingCommands.explainRequest(requestFile);
        display.info("routing.explain", requestFile, {
          selected_agent_role: result.selectedAgentRole,
          selected_version: result.selectedVersion,
          strategy: result.strategy,
          matched_rule_id: result.matchedRuleId ?? null,
          candidate_count: result.candidates.length,
        });
        for (const candidate of result.candidates.slice(0, MAX_EXPLAINED_CANDIDATES)) {
          console.log(`${candidate.agentRole}@${candidate.version} score=${candidate.score.toFixed(2)}`);
        }
      } catch (error) {
        display.error("cli.error", "model route explain", {
          message: error instanceof Error ? error.message : DEFAULT_UNKNOWN_ERROR_MESSAGE,
        });
        Deno.exit(1);
      }
    });
}

function createValidateCommand(runtime: IExaCtlRuntime) {
  const { display, routingCommands } = runtime;
  return new Command()
    .description("Validate a routing policy YAML file")
    .action(async (_options, ...args: string[]) => {
      try {
        const result = await routingCommands.validatePolicy(args[0]);
        if (result.success) {
          display.info("routing.policy.valid", result.path, { status: "valid" });
          return;
        }
        display.error("routing.policy.invalid", result.path, { errors: result.errors });
        Deno.exit(1);
      } catch (error) {
        display.error("cli.error", "model route validate", {
          message: error instanceof Error ? error.message : DEFAULT_UNKNOWN_ERROR_MESSAGE,
        });
        Deno.exit(1);
      }
    });
}

function createRouteCommand(runtime: IExaCtlRuntime) {
  return new Command()
    .description("Inspect routing policy behavior and candidate ranking")
    .command(ExaCtlVerb.EXPLAIN, createExplainCommand(runtime))
    .command(`${ExaCtlVerb.VALIDATE} [policy-file:string]`, createValidateCommand(runtime));
}

function createModelCommand(runtime: IExaCtlRuntime) {
  return new Command()
    .description("Inspect the model registry, select the provider and curate model candidates")
    .command(ExaCtlVerb.LIST, createListCommand(runtime))
    .command(ExaCtlVerb.REFRESH, createRefreshCommand(runtime))
    .command(ExaCtlVerb.USE, createUseCommand(runtime))
    .command(ExaCtlVerb.CANDIDATES, createCandidatesCommand(runtime))
    .command(ExaCtlSubNoun.ROUTE, createRouteCommand(runtime));
}

export function buildModelCommand(runtime: IExaCtlRuntime): ReturnType<typeof createModelCommand> {
  return createModelCommand(runtime);
}
