/**
 * @module ExaCtlRequestCommand
 * @path apps/exactl/src/command_builders/request_command.ts
 * @description Builds the exactl request command tree from the shared runtime services.
 * @architectural-layer CLI
 * @related-files [apps/exactl/src/exactl.ts, apps/exactl/src/exactl_runtime.ts]
 */

import { Command } from "@cliffy/command";
import { DEFAULT_UNKNOWN_ERROR_MESSAGE, RequestOperation } from "@exaix/core";
import { AnalysisMode } from "@exaix/core/request";
import { CLI_DEFAULTS } from "@exaix/cli/config.ts";
import type { Opt, Reason } from "@exaix/core/types";
import {
  handleRequestAnalyze,
  handleRequestCancel,
  handleRequestClarify,
  handleRequestCreate,
  handleRequestInspect,
  handleRequestList,
  handleRequestShow,
  type IRequestAnalyzeOptions,
  type IRequestClarifyOptions,
  type IRequestCreateOptions,
  type IRequestListOptions,
} from "./request_actions.ts";
import type { IInspectCommandOptions } from "../commands/inspect_commands.ts";
import type { IExaCtlRuntime } from "../exactl_runtime.ts";
import { ExaCtlOutputFormat } from "@exaix/cli";
import { actionOutput } from "../output/exactl_output.ts";
import { ExaCtlError, ExaCtlExitCode } from "@exaix/cli/errors/exactl_errors.ts";
import { CLI_OPTION_REASON, CLI_OPTION_WAIT_RESOLVED_BY, ExaCtlCommandName, ExaCtlVerb } from "../exactl_constants.ts";
import { buildRequestCreateBase } from "./request_create_options.ts";
import { documentLeaves } from "./documented_children.ts";
import { documentedNoun } from "../docs/exactl_noun_doc.ts";
import { nounDocFor } from "../command_docs/mod.ts";

function createRequestCreateCommand(runtime: IExaCtlRuntime) {
  const { context, requestCommands } = runtime;
  return buildRequestCreateBase()
    .arguments("[description:string]")
    .option("--agent <agent:string>", "Target agent role blueprint", { default: CLI_DEFAULTS.AGENT })
    .option("--flow <flow:string>", "Target multi-agent flow (mutually exclusive with --agent)")
    .option("--file <file:string>", "Read description from file")
    .action(async (options, description?: Opt<string, Reason.OptionalInput>) => {
      const { renderer, display } = actionOutput(runtime, options, ExaCtlOutputFormat.TEXT);
      await handleRequestCreate(
        { requestCommands, display, renderer, appContext: context },
        options as IRequestCreateOptions,
        description,
      );
    });
}

function createRequestCommand(runtime: IExaCtlRuntime) {
  const noun = nounDocFor(ExaCtlCommandName.REQUEST);
  const command = documentedNoun(new Command(), noun);
  command.command(RequestOperation.CREATE, createRequestCreateCommand(runtime));
  for (const [name, child] of [...addRequestCommands1(runtime)]) command.command(name, child);
  documentLeaves(command, [ExaCtlCommandName.REQUEST], noun.lifecycle);
  return command;
}

function addRequestCommands1(runtime: IExaCtlRuntime) {
  const { fullContext, display, requestCommands, watchCommandInstance } = runtime;
  return [
    [
      RequestOperation.LIST,
      new Command()
        .option(
          "-s, --status <status:string>",
          "Filter by status (pending, planned, in_progress, completed, failed, cancelled, needs_clarification, refining, enriching)",
        )
        .option("--all", "Include archived and rejected requests")
        .action(async (options) => {
          const { renderer, display } = actionOutput(runtime, options, ExaCtlOutputFormat.TABLE);
          await handleRequestList({ requestCommands, display, renderer }, options as IRequestListOptions);
        }),
    ],
    [
      `${ExaCtlVerb.SHOW} <request-id:string>`,
      new Command()
        .action(async (options: void, ...args: string[]) => {
          const { renderer, display } = actionOutput(runtime, options, ExaCtlOutputFormat.TEXT);
          await handleRequestShow({ requestCommands, display, renderer }, args[0]);
        }),
    ],
    [
      `${ExaCtlVerb.WATCH} [request-id:string]`,
      new Command()
        .option("--trace <trace-id:string>", "Watch this trace id instead of a request")
        .action(async (options: { trace?: string }, requestId?: Opt<string, Reason.OptionalInput>) => {
          if ((requestId === undefined) === (options.trace === undefined)) {
            throw new ExaCtlError(ExaCtlExitCode.USAGE, "Pass a request id or --trace <trace-id>, not both.");
          }
          try {
            const { renderer } = actionOutput(runtime, options, ExaCtlOutputFormat.TEXT);
            const traceId = options.trace ?? (await requestCommands.show(requestId as string)).metadata.trace_id;
            await watchCommandInstance.watch(traceId, renderer);
          } catch (error) {
            display.error("cli.error", "watch", {
              message: error instanceof Error ? error.message : DEFAULT_UNKNOWN_ERROR_MESSAGE,
            });
            Deno.exit(1);
          }
        }),
    ],
    [
      "analyze <request-id:string>",
      new Command()
        .option("--engine <engine:string>", "Analysis engine: heuristic, llm, hybrid", {
          default: AnalysisMode.HEURISTIC,
        })
        .option("--force", "Force fresh analysis even if results are cached")
        .action(async (options: IRequestAnalyzeOptions, ...id: string[]) => {
          const { renderer, display } = actionOutput(runtime, options, ExaCtlOutputFormat.TEXT);
          await handleRequestAnalyze({ requestCommands, display, renderer }, id[0], options);
        }),
    ],
    [
      `${ExaCtlVerb.CANCEL} <request-id:string>`,
      new Command()
        .option(CLI_OPTION_REASON, "Why the request is cancelled")
        .action(async (options: { reason?: string }, ...id: string[]) => {
          const { renderer, display } = actionOutput(runtime, options, ExaCtlOutputFormat.TEXT);
          await handleRequestCancel({ requestCommands, display, renderer }, id[0], options.reason);
        }),
    ],
    [
      "clarify <request-id:string>",
      new Command()
        .option("--answer <pair:string>", "Answer in id=text form (repeatable)", { collect: true })
        .option("--proceed", "Force proceed with the current best-effort request body")
        .option("--cancel", "Cancel clarification and re-queue the request as-is")
        .option(CLI_OPTION_WAIT_RESOLVED_BY, "Actor identity resolving the clarification wait state")
        .action(async (options: IRequestClarifyOptions, ...id: string[]) => {
          const { renderer, display } = actionOutput(runtime, options, ExaCtlOutputFormat.TEXT);
          await handleRequestClarify(
            { requestCommands, display, renderer, provider: fullContext.provider },
            id[0],
            options,
          );
        }),
    ],
    [
      RequestOperation.INSPECT,
      new Command()
        .arguments("<trace-id:string>")
        .option("--record <uuid:string>", "Inspect a specific captured record")
        .option(
          "--raw",
          "Export the exact post-redaction bytes (requires --record or a single-record trace; refuses TTY)",
        )
        .action(async (options: IInspectCommandOptions, traceId: string) => {
          await handleRequestInspect(fullContext, traceId, options);
        }),
    ],
  ] as const;
}

export function buildRequestCommand(runtime: IExaCtlRuntime): ReturnType<typeof createRequestCommand> {
  return createRequestCommand(runtime);
}
