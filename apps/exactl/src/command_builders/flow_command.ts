/**
 * @module ExaCtlFlowCommand
 * @path apps/exactl/src/command_builders/flow_command.ts
 * @description Builds the exactl flow command tree from the shared runtime services.
 * @architectural-layer CLI
 * @related-files [apps/exactl/src/exactl.ts, apps/exactl/src/exactl_runtime.ts]
 */

import { Command } from "@cliffy/command";
import type { IExaCtlRuntime } from "../exactl_runtime.ts";
import { ExaCtlCommandName, ExaCtlVerb } from "../exactl_constants.ts";
import { actionOutput } from "../output/exactl_output.ts";
import { ExaCtlOutputFormat } from "@exaix/cli";
import { handleRequestCreate, type IRequestCreateOptions } from "./request_actions.ts";
import { buildRequestCreateBase } from "./request_create_options.ts";
import { documentLeaves } from "./documented_children.ts";
import { documentedNoun } from "../docs/exactl_noun_doc.ts";
import { nounDocFor } from "../command_docs/mod.ts";

const FLOW_ID_ARGUMENT = "<flow-id:string>";

function createFlowRunCommand(runtime: IExaCtlRuntime) {
  const { context, requestCommands } = runtime;
  return buildRequestCreateBase()
    .action(async (options, ...args: string[]) => {
      const [flowId, description] = args;
      const { renderer, display } = actionOutput(runtime, options, ExaCtlOutputFormat.TEXT);
      await handleRequestCreate(
        { requestCommands, display, renderer, appContext: context },
        { ...(options as IRequestCreateOptions), flow: flowId },
        description,
      );
    });
}

function createFlowCommand(runtime: IExaCtlRuntime) {
  const { flowCommands } = runtime;
  const noun = nounDocFor(ExaCtlCommandName.FLOW);
  const command = documentedNoun(new Command(), noun)
    .command(
      ExaCtlVerb.LIST,
      new Command().action(async (options) => {
        await flowCommands.listFlows(actionOutput(runtime, options, ExaCtlOutputFormat.TABLE).renderer);
      }),
    )
    .command(
      `${ExaCtlVerb.SHOW} ${FLOW_ID_ARGUMENT}`,
      new Command().action(async (options, ...args: string[]) => {
        await flowCommands.showFlow(args[0], actionOutput(runtime, options, ExaCtlOutputFormat.TEXT).renderer);
      }),
    )
    .command(`${ExaCtlVerb.RUN} ${FLOW_ID_ARGUMENT} <description:string>`, createFlowRunCommand(runtime))
    .command(
      `${ExaCtlVerb.VALIDATE} ${FLOW_ID_ARGUMENT}`,
      new Command().action(async (options, ...args: string[]) => {
        await flowCommands.validateFlow(args[0], actionOutput(runtime, options, ExaCtlOutputFormat.TEXT).renderer);
      }),
    )
    .command(
      `${ExaCtlVerb.BINDINGS} ${FLOW_ID_ARGUMENT}`,
      new Command()
        .option("--overlay <file:string>", "Per-run binding overlay file (repeatable)", { collect: true })
        .option(
          "--bind <spec:string>",
          "Per-run binding entry, e.g. flow:research/step:compose=service=openai (repeatable)",
          { collect: true },
        )
        .action(async (options, ...args: string[]) => {
          await flowCommands.bindingsFlow(
            args[0],
            options,
            actionOutput(runtime, options, ExaCtlOutputFormat.TEXT).renderer,
          );
        }),
    );
  documentLeaves(command, [ExaCtlCommandName.FLOW], noun.lifecycle);
  return command;
}

export function buildFlowCommand(runtime: IExaCtlRuntime): ReturnType<typeof createFlowCommand> {
  return createFlowCommand(runtime);
}
