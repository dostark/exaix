/**
 * @module ExaCtlRequestCreateOptions
 * @path apps/exactl/src/command_builders/request_create_options.ts
 * @description Builds the command with the request creation options that `request create` and `flow run` share.
 * @architectural-layer CLI
 * @dependencies [@cliffy/command]
 * @related-files [apps/exactl/src/command_builders/request_command.ts, apps/exactl/src/command_builders/flow_command.ts]
 */

import { Command } from "@cliffy/command";
import { AnalysisMode } from "@exaix/core/request";
import { CLI_DEFAULTS } from "@exaix/cli/config.ts";
import { CLI_OPTION_JSON_HELP, CLI_OPTION_MODEL, CLI_PORTAL_LONG_OPTION } from "../exactl_constants.ts";

/** A command with every create option except the target (`--agent`, `--flow`) and `--file`. */
function createRequestCreateBase() {
  return new Command()
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
    });
}

export function buildRequestCreateBase(): ReturnType<typeof createRequestCreateBase> {
  return createRequestCreateBase();
}
