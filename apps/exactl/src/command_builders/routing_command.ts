/**
 * @module ExaCtlRoutingCommand
 * @path apps/exactl/src/command_builders/routing_command.ts
 * @description Builds the exactl routing command tree from the shared runtime services.
 * @architectural-layer CLI
 * @related-files [apps/exactl/src/exactl.ts, apps/exactl/src/exactl_runtime.ts]
 */

import { Command } from "@cliffy/command";
import { DEFAULT_UNKNOWN_ERROR_MESSAGE } from "@exaix/core";
import type { IExaCtlRuntime } from "../exactl_runtime.ts";

function createRoutingCommand(runtime: IExaCtlRuntime) {
  const { display, routingCommands } = runtime;
  return new Command()
    .description("Inspect routing policy behavior and candidate ranking")
    .command(
      "explain",
      new Command()
        .description("Explain dynamic routing for a request without executing it")
        .option("--request <request:string>", "Path to a request file")
        .action(async (options) => {
          const requestFile = options.request;
          if (!requestFile) {
            display.error("cli.error", "routing explain", {
              message: "The --request option is required.",
            });
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
            for (const candidate of result.candidates.slice(0, 5)) {
              console.log(`${candidate.agentRole}@${candidate.version} score=${candidate.score.toFixed(2)}`);
            }
          } catch (error) {
            display.error("cli.error", "routing explain", {
              message: error instanceof Error ? error.message : DEFAULT_UNKNOWN_ERROR_MESSAGE,
            });
            Deno.exit(1);
          }
        }),
    )
    .command(
      "policy",
      new Command()
        .description("Routing policy helpers")
        .command(
          "validate [policy-file:string]",
          new Command()
            .description("Validate a routing policy YAML file")
            .action(async (_options, ...args: string[]) => {
              const policyFile = args[0];
              try {
                const result = await routingCommands.validatePolicy(policyFile);
                if (result.success) {
                  display.info("routing.policy.valid", result.path, { status: "valid" });
                  return;
                }

                display.error("routing.policy.invalid", result.path, {
                  errors: result.errors,
                });
                Deno.exit(1);
              } catch (error) {
                display.error("cli.error", "routing policy validate", {
                  message: error instanceof Error ? error.message : DEFAULT_UNKNOWN_ERROR_MESSAGE,
                });
                Deno.exit(1);
              }
            }),
        ),
    );
}

export function buildRoutingCommand(runtime: IExaCtlRuntime): ReturnType<typeof createRoutingCommand> {
  return createRoutingCommand(runtime);
}
