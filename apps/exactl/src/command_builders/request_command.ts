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
import { ExaCtlError, ExaCtlExitCode } from "../exactl_errors.ts";
import { CLI_CMD_SHOW_ID, CLI_OPTION_JSON_HELP, CLI_OPTION_WAIT_RESOLVED_BY, ExaCtlVerb } from "../exactl_constants.ts";
import { buildRequestCreateBase } from "./request_create_options.ts";

function createRequestCreateCommand(runtime: IExaCtlRuntime) {
  const { context, display, requestCommands } = runtime;
  return buildRequestCreateBase()
    .description("Create a request for an Exaix agent or multi-agent flow (PRIMARY INTERFACE)")
    .arguments("[description:string]")
    .option("--agent <agent:string>", "Target agent role blueprint", { default: CLI_DEFAULTS.AGENT })
    .option("--flow <flow:string>", "Target multi-agent flow (mutually exclusive with --agent)")
    .option("-f, --file <file:string>", "Read description from file")
    .action(async (options, description?: Opt<string, Reason.OptionalInput>) => {
      await handleRequestCreate(
        { requestCommands, display, appContext: context },
        options as IRequestCreateOptions,
        description,
      );
    })
    .example(
      "Create a request for a specific agent role",
      'exactl request create "Analyze this code" --agent code-reviewer',
    )
    .example(
      "Create a request for a multi-agent flow",
      'exactl request create "Build a web app" --flow web-development',
    )
    .example(
      "Create a high-priority request",
      'exactl request create "Fix critical bug" --priority critical --agent debugger',
    );
}

function createRequestCommand(runtime: IExaCtlRuntime) {
  const command = new Command().description("Create and manage requests for Exaix agents or multi-agent flows");
  command.command(RequestOperation.CREATE, createRequestCreateCommand(runtime));
  for (const [name, child] of [...addRequestCommands1(runtime)]) command.command(name, child);
  return command;
}

function addRequestCommands1(runtime: IExaCtlRuntime) {
  const { fullContext, display, requestCommands, watchCommandInstance } = runtime;
  return [
    [
      RequestOperation.LIST,
      new Command()
        .description("List pending requests")
        .option(
          "-s, --status <status:string>",
          "Filter by status (pending, planned, in_progress, completed, failed, cancelled, needs_clarification, refining, enriching)",
        )
        .option("-a, --all", "Include archived and rejected requests")
        .option("--json", CLI_OPTION_JSON_HELP)
        .action(async (options) => {
          await handleRequestList({ requestCommands, display }, options as IRequestListOptions);
        }),
    ],
    [
      CLI_CMD_SHOW_ID,
      new Command()
        .description("Show request details")
        .action(async (_options: void, ...args: string[]) => {
          await handleRequestShow({ requestCommands, display }, args[0]);
        }),
    ],
    [
      `${ExaCtlVerb.WATCH} [requestId:string]`,
      new Command()
        .description("Tail live execution events for a request or a trace (SSE stream with historical fallback)")
        .option("--trace <traceId:string>", "Watch this trace id instead of a request")
        .action(async (options: { trace?: string }, requestId?: Opt<string, Reason.OptionalInput>) => {
          if ((requestId === undefined) === (options.trace === undefined)) {
            throw new ExaCtlError(ExaCtlExitCode.USAGE, "Pass a request id or --trace <trace-id>, not both.");
          }
          try {
            const traceId = options.trace ?? (await requestCommands.show(requestId as string)).metadata.trace_id;
            await watchCommandInstance.watch(traceId);
          } catch (error) {
            display.error("cli.error", "watch", {
              message: error instanceof Error ? error.message : DEFAULT_UNKNOWN_ERROR_MESSAGE,
            });
            Deno.exit(1);
          }
        }),
    ],
    [
      "analyze <id:string>",
      new Command()
        .description("Trigger intent analysis for an existing request by ID or subject")
        .option("-e, --engine <engine:string>", "Analysis engine: heuristic, llm, hybrid", {
          default: AnalysisMode.HEURISTIC,
        })
        .option("--force", "Force fresh analysis even if results are cached")
        .option("--json", CLI_OPTION_JSON_HELP)
        .action(async (options: IRequestAnalyzeOptions, ...id: string[]) => {
          await handleRequestAnalyze({ requestCommands, display }, id[0], options);
        }),
    ],
    [
      `${ExaCtlVerb.CANCEL} <requestId:string>`,
      new Command()
        .description("Cancel a pending or needs_clarification request")
        .option("--reason <reason:string>", "Why the request is cancelled")
        .action(async (options: { reason?: string }, ...id: string[]) => {
          await handleRequestCancel({ requestCommands, display }, id[0], options.reason);
        }),
    ],
    [
      "clarify <id:string>",
      new Command()
        .description("Answer pending clarification questions, or force proceed/cancel")
        .option("--answer <pair:string>", "Answer in id=text form (repeatable)", { collect: true })
        .option("--proceed", "Force proceed with the current best-effort request body")
        .option("--cancel", "Cancel clarification and re-queue the request as-is")
        .option(CLI_OPTION_WAIT_RESOLVED_BY, "Actor identity resolving the clarification wait state")
        .option("--json", CLI_OPTION_JSON_HELP)
        .action(async (options: IRequestClarifyOptions, ...id: string[]) => {
          await handleRequestClarify({ requestCommands, display, provider: fullContext.provider }, id[0], options);
        }),
    ],
    [
      RequestOperation.INSPECT,
      new Command()
        .description("Read-only inspection of captured dogfood-context submissions")
        .arguments("<trace_id:string>")
        .option("--record <uuid:string>", "Inspect a specific captured record")
        .option("--json", CLI_OPTION_JSON_HELP)
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
