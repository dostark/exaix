/**
 * @module ExaCtlFlowCommand
 * @path apps/exactl/src/command_builders/flow_command.ts
 * @description Builds the exactl flow command tree from the shared runtime services.
 * @architectural-layer CLI
 * @related-files [apps/exactl/src/exactl.ts, apps/exactl/src/exactl_runtime.ts]
 */

import { Command } from "@cliffy/command";
import { RequestOperation } from "@exaix/core";
import type { IExaCtlRuntime } from "../exactl_runtime.ts";
import { CLI_OPTION_JSON_HELP, ExaCtlVerb } from "../exactl_constants.ts";
import { handleRequestCreate, type IRequestCreateOptions } from "./request_actions.ts";
import { buildRequestCreateBase } from "./request_create_options.ts";

function createFlowRunCommand(runtime: IExaCtlRuntime) {
  const { context, display, requestCommands } = runtime;
  return buildRequestCreateBase()
    .description("Create a request that runs a flow")
    .example("Run a flow", 'exactl flow run code-review "Review the auth module"')
    .action(async (options, ...args: string[]) => {
      const [flowId, description] = args;
      await handleRequestCreate(
        { requestCommands, display, appContext: context },
        { ...(options as IRequestCreateOptions), flow: flowId },
        description,
      );
    });
}

function createFlowCommand(runtime: IExaCtlRuntime) {
  const { flowCommands } = runtime;
  return new Command()
    .description("Manage and execute Exaix flows")
    .command(
      RequestOperation.LIST,
      new Command()
        .description("List all available flows")
        .option("--json", CLI_OPTION_JSON_HELP)
        .action(async (options) => {
          await flowCommands.listFlows(options);
        }),
    )
    .command(
      "show <flowId:string>",
      new Command()
        .description("Show details of a specific flow")
        .option("--json", CLI_OPTION_JSON_HELP)
        .action(async (options, ...args: string[]) => {
          const flowId = args[0];
          await flowCommands.showFlow(flowId, options);
        }),
    )
    .command(`${ExaCtlVerb.RUN} <flowId:string> <description:string>`, createFlowRunCommand(runtime))
    .command(
      "validate <flowId:string>",
      new Command()
        .description("Validate a flow definition")
        .option("--json", CLI_OPTION_JSON_HELP)
        .action(async (options, ...args: string[]) => {
          const flowId = args[0];
          await flowCommands.validateFlow(flowId, options);
        }),
    )
    .command(
      "bindings <flowId:string>",
      new Command()
        .description(
          "Resolve this flow's step bindings across all layers (model/service/transport/interface per LLM step)",
        )
        .option("--json", CLI_OPTION_JSON_HELP)
        .option("--overlay <file:string>", "Per-run binding overlay file (repeatable)", { collect: true })
        .option(
          "--bind <spec:string>",
          "Per-run binding entry, e.g. flow:research/step:compose=service=openai (repeatable)",
          { collect: true },
        )
        .action(async (options, ...args: string[]) => {
          const flowId = args[0];
          await flowCommands.bindingsFlow(flowId, options);
        }),
    );
}

export function buildFlowCommand(runtime: IExaCtlRuntime): ReturnType<typeof createFlowCommand> {
  return createFlowCommand(runtime);
}
