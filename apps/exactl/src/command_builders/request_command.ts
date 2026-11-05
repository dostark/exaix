/**
 * @module ExaCtlRequestCommand
 * @path apps/exactl/src/command_builders/request_command.ts
 * @description Builds the exactl request command tree from the shared runtime services.
 * @architectural-layer CLI
 * @related-files [apps/exactl/src/exactl.ts, apps/exactl/src/exactl_runtime.ts]
 */

import { Command } from "@cliffy/command";
import { RequestOperation } from "@exaix/core";
import { AnalysisMode } from "@exaix/core/request";
import { CLI_DEFAULTS } from "@exaix/cli/config.ts";
import type { Opt, Reason } from "@exaix/core/types";
import {
  handleRequestAnalyze,
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
import {
  CLI_CMD_SHOW_ID,
  CLI_OPTION_JSON_HELP,
  CLI_OPTION_MODEL,
  CLI_OPTION_WAIT_RESOLVED_BY,
  CLI_PORTAL_LONG_OPTION,
} from "../exactl_constants.ts";

function createRequestCommand(runtime: IExaCtlRuntime) {
  const { context, display, requestCommands } = runtime;
  const command = new Command()
    .description("Create requests for Exaix agents or multi-agent flows (PRIMARY INTERFACE)")
    .arguments("[description:string]")
    .option("-a, --agent-role <agent-role:string>", "Target agent role blueprint", { default: CLI_DEFAULTS.AGENT })
    .option("-p, --priority <priority:string>", "Priority: low, normal, high, critical", {
      default: CLI_DEFAULTS.PRIORITY,
    })
    .option(CLI_PORTAL_LONG_OPTION, "Portal alias for context")
    .option("--target-branch <branch:string>", "Target branch for this request (portal-aware)")
    .option(CLI_OPTION_MODEL, "Named model configuration")
    .option("--model-size <size:string>", "Capability tier: S|M|L|XL (maps to context/cost preset via ModelResolver)")
    .option(
      "--characteristic <value:string>",
      "Soft ranking hint — cheapest|fastest. Scores providers, does not eliminate (repeatable)",
      { collect: true },
    )
    .option(
      "--thinking [mode:string]",
      "Extended thinking: bare --thinking means true; accepts true|false|auto",
    )
    .option(
      "--effort <tier:string>",
      "Reasoning token budget: low|medium|high|auto (auto asks the system to decide)",
    )
    .option(
      "--preferred-provider <provider:string>",
      "Narrow candidates to specific provider (skips cross-provider scoring)",
    )
    .option("--flow <flow:string>", "Target multi-agent flow (mutually exclusive with --agent-role)")
    .option("--skills <skills:string>", "Comma-separated list of skills to inject")
    .option("-s, --subject <subject:string>", "Human-readable subject for the request")
    .option(
      "--acceptance-criteria <criteria:string>",
      "Acceptance criterion (repeatable: --acceptance-criteria 'A' --acceptance-criteria 'B')",
      { collect: true },
    )
    .option(
      "--expected-outcome <outcome:string>",
      "Expected outcome (repeatable: --expected-outcome 'A' --expected-outcome 'B')",
      { collect: true },
    )
    .option("-f, --file <file:string>", "Read description from file")
    .option(
      "--overlay <file:string>",
      "Per-run binding overlay file (repeatable: --overlay a.json --overlay b.toml)",
      { collect: true },
    )
    .option(
      "--bind <spec:string>",
      "Per-run binding (repeatable), e.g. flow:research/step:compose=service=openai",
      { collect: true },
    )
    .option("--locked <file:string>", "Replay a prior run's binding lock file")
    .option("--dry-run", "Show what would be created without writing")
    .option(
      "--dry-run-context",
      "Print a projected input-token breakdown without writing a request file or calling a real LLM",
    )
    .option("--json", CLI_OPTION_JSON_HELP)
    .option("--analyze", "Trigger immediate intent analysis for the request")
    .option("-e, --engine <engine:string>", "Analysis engine: heuristic, llm, hybrid", {
      default: AnalysisMode.HEURISTIC,
    })
    .action(async (options, description?: Opt<string, Reason.OptionalInput>) => {
      await handleRequestCreate(
        { requestCommands, display, appContext: context },
        options as IRequestCreateOptions,
        description,
      );
    })
    .example(
      "Create a request for a specific agent role",
      'exactl request "Analyze this code" --agent-role code-reviewer',
    )
    .example("Create a request for a multi-agent flow", 'exactl request "Build a web app" --flow web-development')
    .example(
      "Create a high-priority request",
      'exactl request "Fix critical bug" --priority critical --agent-role debugger',
    );
  for (const [name, child] of [...addRequestCommands1(runtime)]) command.command(name, child);
  return command;
}

function addRequestCommands1(runtime: IExaCtlRuntime) {
  const { fullContext, display, requestCommands } = runtime;
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
