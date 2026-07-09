/**
 * @module ExaCtl
 * @path apps/exactl/src/exactl.ts
 * @description Main entry point for the Exaix CLI (exactl). Orchestrates all commands, subcommands, and service initializations.
 * @architectural-layer Application
 * @related-files [apps/exactl/src/init.ts]
 */

import { Command } from "@cliffy/command";
import { PlanCommands } from "./commands/plan_commands.ts";
import { RequestCommands } from "./commands/request_commands.ts";
import { type IReviewMetadata, ReviewCommands, type ReviewDetails } from "./commands/review_commands.ts";
import { GitCommands } from "./commands/git_commands.ts";
import { DaemonCommands } from "./commands/daemon_commands.ts";
import { ConfigCommands } from "./commands/config_commands.ts";
import { PortalCommands } from "./commands/portal_commands.ts";
import { BlueprintCommands } from "./commands/blueprint_commands.ts";
import { FlowCommands } from "./commands/flow_commands.ts";
import { DashboardCommands } from "./commands/dashboard_commands.ts";
import { MemoryCommands } from "./commands/memory_commands.ts";
import { type IJournalCommandOptions, JournalCommands, normalizeLogsFilter } from "./commands/journal_commands.ts";
import { CostCommands } from "./commands/cost_commands.ts";
import { RoutingCommands } from "./commands/routing_commands.ts";
import { WaitStateCommands } from "./commands/wait_state_commands.ts";
import { ToolCommands } from "./commands/tool_commands.ts";
import {
  FlowInputSource,
  GeneralStatus,
  type MemoryBankSource,
  MemoryScope,
  type PortalAnalysisMode,
  PortalExecutionStrategy,
  PortalStatus,
  RequestKind,
  RequestOperation,
  RequestPriority,
} from "@exaix/core";
import { UIOutputFormat } from "@exaix/tui";
import { AnalysisMode } from "@exaix/core/request";
import { ReviewStatus } from "@exaix/core/status";
import { CLI_DEFAULTS, CLI_OUTPUT_FORMATS } from "@exaix/cli/config.ts";
import { McpCommands } from "./commands/mcp_commands.ts";
import { initializeServices, isTestMode as isTestModeImport } from "./init.ts";
import type { ICliApplicationContext } from "@exaix/cli/types/cli_context.ts";
import { GitService } from "@exaix/git";
import type { OutputFormat } from "@exaix/cli/types/memory_types.ts";
import {
  BINARY_VERSION,
  type BlueprintStatus,
  ConfigOutputFormat,
  DAEMON_IDENTITY_ID,
  DEFAULT_UNKNOWN_ERROR_MESSAGE,
  PORTAL_LABEL,
  WORKSPACE_SCHEMA_VERSION,
} from "@exaix/core";
import type { IReviewStatus } from "@exaix/core/status";
import { GIT_CMD_STATUS } from "@exaix/git";
import { WatchCommand } from "./commands/watch.ts";
import { EvalCommands } from "./commands/eval_commands.ts";

// Extracted action handlers
import {
  handleRequestAnalyze,
  handleRequestCreate,
  handleRequestList,
  handleRequestShow,
  type RequestAnalyzeOptions,
  type RequestCreateOptions,
  type RequestListOptions,
} from "./command_builders/request_actions.ts";
import {
  handlePlanAmendmentApprove,
  handlePlanAmendmentApproveAll,
  handlePlanAmendmentList,
  handlePlanAmendmentReject,
  handlePlanAmendmentShow,
  handlePlanAmendmentShowAll,
  handlePlanApprove,
  handlePlanApproveAll,
  handlePlanList,
  handlePlanReject,
  handlePlanRevise,
  handlePlanShow,
  type PlanApproveOptions,
  type PlanListOptions,
} from "./command_builders/plan_actions.ts";

// Allow tests to run the CLI entrypoint without initializing heavy services
export function isTestMode(): boolean {
  return isTestModeImport();
}

const CLI_OUTPUT_FORMAT_OPTION = "--format <format:string>";
const CLI_OUTPUT_FORMAT_HELP = "Output format: table, json, md";
const CLI_OUTPUT_FORMAT_DEFAULT = { default: UIOutputFormat.TABLE };
const CLI_OPTION_JSON_HELP = "Output in JSON format";
const CONFIG_LABEL = "config";
const CONFIG_DIFF_LABEL = "diff";
const DEFAULT_CAPABILITIES_LABEL = "general";
const CLI_LIMIT_OPTION = "-l, --limit <limit:number>";
const CLI_LIMIT_HELP = "Maximum results";
const DISPLAY_CATEGORY_BLUEPRINTS = "blueprints";
const CLI_CMD_SHOW_ID = "show <id>";
const CLI_CMD_LIST = "list";
const CLI_OPTION_REASON = "-r, --reason <reason:string>";
const CLI_OPTION_MODEL = "-m, --model <model:string>";
const CLI_OPTION_PORTAL = "-p, --portal <portal:string>";
const CLI_OPTION_WAIT_STATUS = "-s, --status <status:string>";
const CLI_OPTION_WAIT_MESSAGE = "-m, --message <message:string>";
const CLI_OPTION_WAIT_MESSAGE_DESC = "Resolution summary";

const services = await initializeServices();
const fullContext: ICliApplicationContext = services;
const context = fullContext;
const { db, provider, display } = services;
const gitService = services.git;
const config = services.config.getAll();

const requestCommands = new RequestCommands(fullContext);
const planCommands = new PlanCommands(fullContext);
const reviewCommands = new ReviewCommands(fullContext);
const gitCommands = new GitCommands(fullContext);
const daemonCommands = new DaemonCommands(fullContext);
const configCommands = new ConfigCommands(fullContext);
const portalCommands = new PortalCommands(fullContext);
const blueprintCommands = new BlueprintCommands(fullContext);
const routingCommands = new RoutingCommands(fullContext);
const toolCommands = new ToolCommands(fullContext);
const flowCommands = new FlowCommands(fullContext);
const dashboardCommands = new DashboardCommands(fullContext);
const memoryCommands = new MemoryCommands(fullContext);
const watchCommandInstance = new WatchCommand(fullContext);
const waitStateCommands = new WaitStateCommands(fullContext);
const evalCommands = new EvalCommands(fullContext);

// Export test helper for unit tests to inspect module-internal context when running in test mode.
export function __test_getContext(): {
  IN_TEST_MODE: boolean;
  config: typeof config;
  db: typeof db;
  gitService: typeof gitService;
  provider: typeof provider;
  display: typeof display;
  context: typeof context;
  requestCommands: typeof requestCommands;
  planCommands: typeof planCommands;
  reviewCommands: typeof reviewCommands;
  gitCommands: typeof gitCommands;
  daemonCommands: typeof daemonCommands;
  portalCommands: typeof portalCommands;
  blueprintCommands: typeof blueprintCommands;
  flowCommands: typeof flowCommands;
  toolCommands: typeof toolCommands;
  dashboardCommands: typeof dashboardCommands;
  memoryCommands: typeof memoryCommands;
  watchCommand: typeof watchCommandInstance;
  waitStateCommands: typeof waitStateCommands;
  evalCommands: typeof evalCommands;
} {
  return {
    IN_TEST_MODE: isTestMode(),
    config,
    db,
    gitService,
    provider,
    display,
    context,
    requestCommands,
    planCommands,
    reviewCommands,
    gitCommands,
    daemonCommands,
    portalCommands,
    blueprintCommands,
    flowCommands,
    toolCommands,
    dashboardCommands,
    memoryCommands,
    watchCommand: watchCommandInstance,
    waitStateCommands,
    evalCommands,
  };
}

export type ExaCtlTestContext = ReturnType<typeof __test_getContext>;

// Test helper: initialize the heavy services path (same logic used in non-test runtime)
// Returns an object describing whether initialization succeeded and the constructed services.
// Test helper: initialize the heavy services path (same logic used in non-test runtime)
// Returns an object describing whether initialization succeeded and the constructed services.
export function __test_initializeServices(
  opts?: { simulateFail?: boolean; instantiateDb?: boolean; configPath?: string },
): ReturnType<typeof initializeServices> {
  return initializeServices(opts);
}

async function handleReviewListAction(options: { status?: string; type?: string }) {
  try {
    const reviews = await reviewCommands.list(options.status, options.type);
    if (reviews.length === 0) {
      display.info("review.list", "reviews", { count: 0, message: "No reviews found" });
      return;
    }

    display.info("review.list", "reviews", { count: reviews.length });
    for (const cs of reviews) {
      logReviewListItem(cs);
    }
  } catch (error) {
    display.error("cli.error", "review list", {
      message: error instanceof Error ? error.message : DEFAULT_UNKNOWN_ERROR_MESSAGE,
    });
    Deno.exit(1);
  }
}

function logReviewListItem(cs: IReviewMetadata) {
  let badge: string | undefined;
  if (cs.anomalySummary) {
    const { high, medium, low, recovered } = cs.anomalySummary;
    const live = high + medium + low;
    if (live > 0) {
      const parts: string[] = [];
      if (high > 0) parts.push(`${high} high`);
      if (medium > 0) parts.push(`${medium} medium`);
      if (low > 0) parts.push(`${low} low`);
      badge = `⚠️ ${live} anomalies (${parts.join(", ")})`;
      if (recovered > 0) badge += ` (+${recovered} recovered)`;
    }
  }
  const statusEmoji = getReviewStatusEmoji(cs.status);
  const requestTitle = cs.request_subject ? `"${cs.request_subject}"` : cs.request_id;
  const planInfo = cs.plan_id ? `plan: ${cs.plan_id} (${cs.plan_status})` : undefined;
  const agentInfo = cs.request_identity || cs.identity_id;
  const portalInfo = cs.request_portal || cs.portal || "workspace";
  const typeInfo = cs.type || "code";
  const trace = formatTraceShort(cs.trace_id);

  const label = cs.subject ? `${statusEmoji} [${cs.subject}] ${cs.request_id}` : `${statusEmoji} ${cs.request_id}`;
  display.info(label, cs.branch, {
    request: requestTitle,
    subject: cs.subject,
    plan: planInfo ?? null,
    agent: agentInfo ?? null,
    portal: portalInfo ?? null,
    type: typeInfo,
    files: cs.files_changed,
    created: new Date(cs.created_at).toLocaleString(),
    trace: trace || null,
    anomalies: badge ?? null,
  });
}

function getReviewStatusEmoji(status: IReviewStatus | undefined): string {
  if (status === ReviewStatus.APPROVED) return "✅";
  if (status === ReviewStatus.REJECTED) return "❌";
  return "📌";
}

function formatTraceShort(traceId: string | undefined): string | null {
  if (!traceId) return null;
  return `${traceId.substring(0, 8)}...`;
}

async function handleReviewShowAction(options: { diff?: boolean }, id: string) {
  try {
    const cs = await reviewCommands.show(id);
    if (options.diff) {
      console.log(cs.diff);
      return;
    }
    renderReviewShow(cs, id);
  } catch (error) {
    display.error("cli.error", "review show", {
      message: error instanceof Error ? error.message : DEFAULT_UNKNOWN_ERROR_MESSAGE,
    });
    Deno.exit(1);
  }
}

function renderReviewShow(cs: ReviewDetails, id: string) {
  renderReviewShowSummary(cs);
  renderReviewShowDecision(cs);
  renderReviewShowAnomalies(cs);
  renderReviewShowCommits(cs);
  display.info("review.diff", id, { diff: cs.diff });
}

function renderReviewShowAnomalies(cs: ReviewDetails) {
  if (!cs.anomalies || cs.anomalies.length === 0) return;

  display.info("review.anomalies", "", { count: cs.anomalies.length });
  for (const finding of cs.anomalies) {
    display.info(
      `  ${finding.severity}`,
      finding.target ?? "(no target)",
      {
        eventType: finding.eventType,
        recovered: finding.recovered,
      },
    );
  }
}

function renderReviewShowSummary(cs: ReviewDetails) {
  const statusEmoji = getReviewStatusEmoji(cs.status);
  const requestTitle = cs.request_subject ? `"${cs.request_subject}"` : "Untitled Request";
  const planInfo = cs.plan_id ? `${cs.plan_id} (${cs.plan_status})` : "unknown";
  const agentInfo = cs.request_identity || cs.identity_id;
  const portalInfo = cs.request_portal || cs.portal || "workspace";

  display.info(`${statusEmoji} review.show`, cs.request_id, {
    branch: cs.branch,
    status: cs.status || ReviewStatus.PENDING,
    subject: cs.subject ?? undefined,
    request: requestTitle,
    plan: planInfo,
    agent: agentInfo ?? null,
    portal: portalInfo ?? null,
    base_branch: cs.base_branch ?? null,
    priority: cs.request_priority || RequestPriority.NORMAL,
    created_by: cs.request_created_by || "unknown",
    files_changed: cs.files_changed,
    commits: cs.commits.length,
    trace: cs.trace_id ?? null,
  });
}

function renderReviewShowDecision(cs: ReviewDetails) {
  if (cs.approved_at) {
    display.info("approved", new Date(cs.approved_at).toLocaleString(), {
      by: cs.approved_by || "unknown",
    });
    return;
  }

  if (cs.rejected_at) {
    display.info("rejected", new Date(cs.rejected_at).toLocaleString(), {
      by: cs.rejected_by || "unknown",
      reason: cs.rejection_reason || "no reason provided",
    });
  }
}

function renderReviewShowCommits(cs: ReviewDetails) {
  display.info("commits", "", {});
  for (const commit of cs.commits) {
    display.info("commit", commit.sha.substring(0, 8), {
      message: commit.message,
      timestamp: new Date(commit.timestamp).toLocaleString(),
    });
  }
}

export const __test_command = new Command()
  .name("exactl")
  .version(BINARY_VERSION)
  .description("Exaix CLI - Human interface for agent orchestration")
  // Request commands (PRIMARY INTERFACE)
  .command(
    FlowInputSource.REQUEST,
    new Command()
      .description("Create requests for Exaix agents or multi-agent flows (PRIMARY INTERFACE)")
      .arguments("[description:string]")
      .option("-i, --identity <identity:string>", "Target identity blueprint", { default: CLI_DEFAULTS.AGENT })
      .option("-p, --priority <priority:string>", "Priority: low, normal, high, critical", {
        default: CLI_DEFAULTS.PRIORITY,
      })
      .option("--portal <portal:string>", "Portal alias for context")
      .option("--target-branch <branch:string>", "Target branch for this request (portal-aware)")
      .option(CLI_OPTION_MODEL, "Named model configuration")
      .option("--model-size <size:string>", "Capability tier: S|M|L|XL (maps to context/cost preset via ModelResolver)")
      .option(
        "--characteristic <value:string>",
        "Soft ranking hint — cheapest|fastest. Scores providers, does not eliminate (repeatable)",
        { collect: true },
      )
      .option("--thinking", "Require extended reasoning model")
      .option("--effort <tier:string>", "Reasoning token budget: low|medium|high (only with --thinking)")
      .option(
        "--preferred-provider <provider:string>",
        "Narrow candidates to specific provider (skips cross-provider scoring)",
      )
      .option("--flow <flow:string>", "Target multi-agent flow (mutually exclusive with --identity)")
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
      .option("--dry-run", "Show what would be created without writing")
      .option("--json", CLI_OPTION_JSON_HELP)
      .option("--analyze", "Trigger immediate intent analysis for the request")
      .option("-e, --engine <engine:string>", "Analysis engine: heuristic, llm, hybrid", {
        default: AnalysisMode.HEURISTIC,
      })
      .action(async (options, description?: string) => {
        await handleRequestCreate({ requestCommands, display }, options as RequestCreateOptions, description);
      })
      .example(
        "Create a request for a specific identity",
        'exactl request "Analyze this code" --identity code-reviewer',
      )
      .example("Create a request for a multi-agent flow", 'exactl request "Build a web app" --flow web-development')
      .example(
        "Create a high-priority request",
        'exactl request "Fix critical bug" --priority critical --identity debugger',
      )
      .command(
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
            await handleRequestList({ requestCommands, display }, options as RequestListOptions);
          }),
      )
      .command(
        CLI_CMD_SHOW_ID,
        new Command()
          .description("Show request details")
          .action(async (_options: void, ...args: string[]) => {
            await handleRequestShow({ requestCommands, display }, args[0]);
          }),
      )
      .command(
        "analyze <id:string>",
        new Command()
          .description("Trigger intent analysis for an existing request by ID or subject")
          .option("-e, --engine <engine:string>", "Analysis engine: heuristic, llm, hybrid", {
            default: AnalysisMode.HEURISTIC,
          })
          .option("--force", "Force fresh analysis even if results are cached")
          .option("--json", CLI_OPTION_JSON_HELP)
          .action(async (options: RequestAnalyzeOptions, ...id: string[]) => {
            await handleRequestAnalyze({ requestCommands, display }, id[0], options);
          }),
      ),
  )
  // Plan commands
  .command(
    RequestOperation.PLAN,
    new Command()
      .description("Manage AI-generated plans")
      .command(
        RequestOperation.LIST,
        new Command()
          .description("List all plans awaiting review")
          .option("-s, --status <status:string>", "Filter by status (review, needs_revision)")
          .action(async (options) => {
            await handlePlanList({ planCommands, display }, options as PlanListOptions);
          }),
      )
      .command(
        CLI_CMD_SHOW_ID,
        new Command()
          .description("Show details of a specific plan")
          .action(async (_options, ...args: string[]) => {
            await handlePlanShow({ planCommands, display }, args[0] as string);
          }),
      )
      .command(
        "approve <id>",
        new Command()
          .description("Approve a plan and move it to Workspace/Active")
          .option("--skills <skills:string>", "Comma-separated list of skills to inject during execution")
          .action(async (options, ...args: string[]) => {
            await handlePlanApprove({ planCommands, display }, args[0] as string, options as PlanApproveOptions);
          }),
      )
      .command(
        "approve-all",
        new Command()
          .description("Approve all plans awaiting review")
          .option("--skills <skills:string>", "Comma-separated list of skills to inject during execution")
          .action(async (options) => {
            await handlePlanApproveAll({ planCommands, display }, options as PlanApproveOptions);
          }),
      )
      .command(
        "reject <id>",
        new Command()
          .description("Reject a plan with a reason")
          .option(CLI_OPTION_REASON, "Rejection reason (required)", { required: true })
          .action(async (options, ...args: string[]) => {
            await handlePlanReject({ planCommands, display }, args[0] as string, options.reason);
          }),
      )
      .command(
        "revise <id>",
        new Command()
          .description("Request revision with review comments")
          .option("-c, --comment <comment:string>", "Review comment (can be specified multiple times)", {
            collect: true,
            required: true,
          })
          .action(async (options, ...args: string[]) => {
            await handlePlanRevise({ planCommands, display }, args[0] as string, options.comment);
          }),
      )
      .command(
        "amendment",
        new Command()
          .description("Manage plan amendments for paused executions")
          .command(
            CLI_CMD_LIST,
            new Command()
              .description("List plans awaiting amendment approval")
              .action(async () => {
                await handlePlanAmendmentList({ planCommands, display });
              }),
          )
          .command(
            CLI_CMD_SHOW_ID,
            new Command()
              .description("Show details of a proposed amendment")
              .action(async (_options, ...args: string[]) => {
                await handlePlanAmendmentShow({ planCommands, display }, args[0] as string);
              }),
          )
          .command(
            "show-all",
            new Command()
              .description("Show details of all proposed amendments")
              .action(async () => {
                await handlePlanAmendmentShowAll({ planCommands, display });
              }),
          )
          .command(
            "approve <id>",
            new Command()
              .description("Approve amendment and resume execution")
              .action(async (_options, ...args: string[]) => {
                await handlePlanAmendmentApprove({ planCommands, display }, args[0] as string);
              }),
          )
          .command(
            "approve-all",
            new Command()
              .description("Approve all pending amendments and resume execution")
              .action(async () => {
                await handlePlanAmendmentApproveAll({ planCommands, display });
              }),
          )
          .command(
            "reject <id>",
            new Command()
              .description("Reject a proposed amendment")
              .option(CLI_OPTION_REASON, "Rejection reason (required)", { required: true })
              .action(async (options, ...args: string[]) => {
                await handlePlanAmendmentReject({ planCommands, display }, args[0] as string, options.reason);
              }),
          ),
      ),
  )
  // Review commands (replaces review commands)
  .command(
    "review",
    new Command()
      .description("Review and manage agent-generated outputs (code changes and artifacts)")
      .command(
        RequestOperation.LIST,
        new Command()
          .description("List all pending reviews")
          .option("-s, --status <status:string>", "Filter by status (pending, approved, rejected)")
          .option("-t, --type <type:string>", "Filter by type (code, artifact, all)", { default: "all" })
          .action(async (options) => await handleReviewListAction(options)),
      )
      .command(
        CLI_CMD_SHOW_ID,
        new Command()
          .description("Show review details including diff")
          .option("-d, --diff", "Show only the diff for the review")
          .action(async (options, ...args: string[]) => await handleReviewShowAction(options, args[0] as string)),
      )
      .command(
        "approve <id>",
        new Command()
          .description("Approve review and merge to main (for code changes) or mark as approved (for artifacts)")
          .action(async (_options, ...args: string[]) => {
            const id = args[0];
            try {
              await reviewCommands.approve(id);
            } catch (error) {
              display.error("cli.error", "review approve", {
                message: error instanceof Error ? error.message : DEFAULT_UNKNOWN_ERROR_MESSAGE,
              });
              Deno.exit(1);
            }
          }),
      )
      .command(
        "reject <id>",
        new Command()
          .description("Reject review and delete branch (for code changes) or mark as rejected (for artifacts)")
          .option(CLI_OPTION_REASON, "Rejection reason (required)", { required: true })
          .action(async (options, ...args: string[]) => {
            const id = args[0];
            try {
              await reviewCommands.reject(id, options.reason);
            } catch (error) {
              display.error("cli.error", "review reject", {
                message: error instanceof Error ? error.message : DEFAULT_UNKNOWN_ERROR_MESSAGE,
              });
              Deno.exit(1);
            }
          }),
      ),
  )
  // Wait state commands (Phase 84)
  .command(
    "wait",
    new Command()
      .description("Manage durable wait states for human-in-the-loop approvals")
      .command(
        CLI_CMD_LIST,
        new Command()
          .description("List pending wait states")
          .option(CLI_OPTION_WAIT_STATUS, "Filter by status")
          .action(async (options) => {
            try {
              const entries = await waitStateCommands.list(options.status);
              if (entries.length === 0) {
                display.info("wait.list", null, { count: 0, message: "No wait states found" });
                return;
              }
              for (const e of entries) {
                display.info("wait.list.entry", e.waitStateId, {
                  kind: e.kind,
                  status: e.status,
                  traceId: e.traceId,
                  createdAt: e.createdAt,
                });
              }
            } catch (error) {
              display.error("cli.error", "wait list", {
                message: error instanceof Error ? error.message : DEFAULT_UNKNOWN_ERROR_MESSAGE,
              });
              Deno.exit(1);
            }
          }),
      )
      .command(
        "approve <token>",
        new Command()
          .description("Approve a pending wait state by resume token")
          .option(CLI_OPTION_WAIT_MESSAGE, CLI_OPTION_WAIT_MESSAGE_DESC)
          .action(async (options, ...args: string[]) => {
            try {
              const updated = await waitStateCommands.approve(args[0], options.message);
              display.info("wait.approve", updated.waitStateId.slice(0, 8), { status: updated.status });
            } catch (error) {
              display.error("cli.error", "wait approve", {
                message: error instanceof Error ? error.message : DEFAULT_UNKNOWN_ERROR_MESSAGE,
              });
              Deno.exit(1);
            }
          }),
      )
      .command(
        "reject <token>",
        new Command()
          .description("Reject a pending wait state by resume token")
          .option(CLI_OPTION_WAIT_MESSAGE, CLI_OPTION_WAIT_MESSAGE_DESC)
          .action(async (options, ...args: string[]) => {
            try {
              const updated = await waitStateCommands.reject(args[0], options.message);
              display.info("wait.reject", updated.waitStateId.slice(0, 8), { status: updated.status });
            } catch (error) {
              display.error("cli.error", "wait reject", {
                message: error instanceof Error ? error.message : DEFAULT_UNKNOWN_ERROR_MESSAGE,
              });
              Deno.exit(1);
            }
          }),
      )
      .command(
        "amend <token>",
        new Command()
          .description("Mark a wait state as amended by resume token")
          .option(CLI_OPTION_WAIT_MESSAGE, CLI_OPTION_WAIT_MESSAGE_DESC)
          .action(async (options, ...args: string[]) => {
            try {
              const updated = await waitStateCommands.amend(args[0], options.message);
              display.info("wait.amend", updated.waitStateId.slice(0, 8), { status: updated.status });
            } catch (error) {
              display.error("cli.error", "wait amend", {
                message: error instanceof Error ? error.message : DEFAULT_UNKNOWN_ERROR_MESSAGE,
              });
              Deno.exit(1);
            }
          }),
      )
      .command(
        "expire <token>",
        new Command()
          .description("Expire a pending wait state by resume token")
          .option(CLI_OPTION_WAIT_MESSAGE, CLI_OPTION_WAIT_MESSAGE_DESC)
          .action(async (options, ...args: string[]) => {
            try {
              const updated = await waitStateCommands.expire(args[0], options.message);
              display.info("wait.expire", updated.waitStateId.slice(0, 8), { status: updated.status });
            } catch (error) {
              display.error("cli.error", "wait expire", {
                message: error instanceof Error ? error.message : DEFAULT_UNKNOWN_ERROR_MESSAGE,
              });
              Deno.exit(1);
            }
          }),
      )
      .command(
        "cancel <token>",
        new Command()
          .description("Cancel a pending wait state by resume token")
          .option(CLI_OPTION_WAIT_MESSAGE, CLI_OPTION_WAIT_MESSAGE_DESC)
          .action(async (options, ...args: string[]) => {
            try {
              const updated = await waitStateCommands.cancel(args[0], options.message);
              display.info("wait.cancel", updated.waitStateId.slice(0, 8), { status: updated.status });
            } catch (error) {
              display.error("cli.error", "wait cancel", {
                message: error instanceof Error ? error.message : DEFAULT_UNKNOWN_ERROR_MESSAGE,
              });
              Deno.exit(1);
            }
          }),
      ),
  )
  // Git commands
  .command(
    "git",
    new Command()
      .description("Git repository operations")
      .command(
        "worktrees",
        new Command()
          .description("Git worktree maintenance")
          .command(
            RequestOperation.LIST,
            new Command()
              .description("List git worktrees")
              .option("--portal <portal:string>", "Target a configured portal repository")
              .option("--repo <repo:string>", "Target a repository path (absolute or relative)")
              .action(async (options) => {
                try {
                  if (options.portal && options.repo) {
                    throw new Error("Use either --portal or --repo (not both)");
                  }

                  let repoPath = config.system.root as string;

                  if (options.portal) {
                    const portal = fullContext.config?.getPortal(options.portal);
                    if (!portal) {
                      throw new Error(`Portal not found in config: ${options.portal}`);
                    }
                    repoPath = portal.target_path;
                  } else if (options.repo) {
                    repoPath = options.repo;
                  }

                  const effectiveGit = new GitService({
                    config,
                    repoPath,
                  });

                  const worktrees = await effectiveGit.listWorktrees();
                  display.info("git.worktrees.list", repoPath, { count: worktrees.length });

                  for (const wt of worktrees) {
                    const branch = wt.branch
                      ? wt.branch.replace(/^refs\/heads\//, "")
                      : wt.detached
                      ? "(detached)"
                      : undefined;

                    display.info(wt.path, branch ?? "(unknown)", {
                      head: wt.head ? `${wt.head.substring(0, 8)}...` : null,
                      locked: wt.locked ? true : null,
                      prunable: wt.prunable ? true : null,
                    });
                  }
                } catch (error) {
                  display.error("cli.error", "git worktrees list", {
                    message: error instanceof Error ? error.message : DEFAULT_UNKNOWN_ERROR_MESSAGE,
                  });
                  Deno.exit(1);
                }
              }),
          )
          .command(
            "prune",
            new Command()
              .description("Prune stale git worktree metadata")
              .option("--portal <portal:string>", "Target a configured portal repository")
              .option("--repo <repo:string>", "Target a repository path (absolute or relative)")
              .option("--dry-run", "Show what would be pruned")
              .option("--verbose", "Verbose output")
              .option("--expire <expire:string>", "Prune entries older than <time> (e.g., 'now', '3.days.ago')")
              .action(async (options) => {
                try {
                  if (options.portal && options.repo) {
                    throw new Error("Use either --portal or --repo (not both)");
                  }

                  let repoPath = config.system.root as string;

                  if (options.portal) {
                    const portal = fullContext.config?.getPortal(options.portal);
                    if (!portal) {
                      throw new Error(`Portal not found in config: ${options.portal}`);
                    }
                    repoPath = portal.target_path;
                  } else if (options.repo) {
                    repoPath = options.repo;
                  }

                  const effectiveGit = new GitService({
                    config,
                    repoPath,
                  });

                  const output = await effectiveGit.pruneWorktrees({
                    dryRun: Boolean(options.dryRun),
                    verbose: Boolean(options.verbose),
                    expire: options.expire,
                  });

                  display.info("git.worktrees.prune", repoPath, {
                    dry_run: options.dryRun ? true : null,
                    verbose: options.verbose ? true : null,
                    expire: options.expire ?? null,
                    output: output.trim().length > 0 ? output.trim() : null,
                  });
                } catch (error) {
                  display.error("cli.error", "git worktrees prune", {
                    message: error instanceof Error ? error.message : DEFAULT_UNKNOWN_ERROR_MESSAGE,
                  });
                  Deno.exit(1);
                }
              }),
          ),
      )
      .command(
        "branches",
        new Command()
          .description("List all branches")
          .option("-p, --pattern <pattern:string>", "Filter by pattern (e.g., 'feat/*')")
          .action(async (options) => {
            try {
              const branches = await gitCommands.listBranches(options.pattern);
              display.info("git.branches", "repository", { count: branches.length });
              for (const branch of branches) {
                const current = branch.is_current ? "* " : "  ";
                display.info(`${current}${branch.name}`, branch.name, {
                  last_commit: `${branch.last_commit} (${new Date(branch.last_commit_date).toLocaleDateString()})`,
                  trace: branch.trace_id ? `${branch.trace_id.substring(0, 8)}...` : null,
                });
              }
            } catch (error) {
              display.error("cli.error", "git branches", {
                message: error instanceof Error ? error.message : DEFAULT_UNKNOWN_ERROR_MESSAGE,
              });
              Deno.exit(1);
            }
          }),
      )
      .command(
        GIT_CMD_STATUS,
        new Command()
          .description("Show repository status")
          .action(async () => {
            try {
              const status = await gitCommands.status();
              display.info("git.status", status.branch, {
                modified: status.modified.length > 0 ? status.modified : null,
                added: status.added.length > 0 ? status.added : null,
                deleted: status.deleted.length > 0 ? status.deleted : null,
                untracked: status.untracked.length > 0 ? status.untracked : null,
                clean: status.modified.length === 0 && status.added.length === 0 &&
                    status.deleted.length === 0 && status.untracked.length === 0
                  ? true
                  : null,
              });
            } catch (error) {
              display.error("cli.error", "git status", {
                message: error instanceof Error ? error.message : DEFAULT_UNKNOWN_ERROR_MESSAGE,
              });
              Deno.exit(1);
            }
          }),
      )
      .command(
        "log",
        new Command()
          .description("Search commit log by trace_id")
          .option("-t, --trace <trace_id:string>", "Filter by trace ID", { required: true })
          .action(async (options) => {
            try {
              const commits = await gitCommands.logByTraceId(options.trace);
              if (commits.length === 0) {
                display.info("git.log", options.trace, { count: 0, message: "No commits found" });
                return;
              }
              display.info("git.log", `${options.trace.substring(0, 8)}...`, { count: commits.length });
              for (const commit of commits) {
                display.info(commit.sha.substring(0, 8), commit.message, {
                  author: commit.author,
                  date: new Date(commit.date).toLocaleString(),
                });
              }
            } catch (error) {
              display.error("cli.error", "git log", {
                message: error instanceof Error ? error.message : DEFAULT_UNKNOWN_ERROR_MESSAGE,
              });
              Deno.exit(1);
            }
          }),
      ),
  )
  // Daemon commands
  .command(
    "daemon",
    new Command()
      .description("Control the Exaix daemon")
      .command(
        "start",
        new Command()
          .description("Start the Exaix daemon")
          .action(async () => {
            try {
              await daemonCommands.start();
            } catch (error) {
              display.error("cli.error", "daemon start", {
                message: error instanceof Error ? error.message : DEFAULT_UNKNOWN_ERROR_MESSAGE,
              });
              Deno.exit(1);
            }
          }),
      )
      .command(
        "stop",
        new Command()
          .description("Stop the Exaix daemon")
          .action(async () => {
            try {
              await daemonCommands.stop();
            } catch (error) {
              display.error("cli.error", "daemon stop", {
                message: error instanceof Error ? error.message : DEFAULT_UNKNOWN_ERROR_MESSAGE,
              });
              Deno.exit(1);
            }
          }),
      )
      .command(
        "restart",
        new Command()
          .description("Restart the Exaix daemon")
          .action(async () => {
            try {
              await daemonCommands.restart();
            } catch (error) {
              display.error("cli.error", "daemon restart", {
                message: error instanceof Error ? error.message : DEFAULT_UNKNOWN_ERROR_MESSAGE,
              });
              Deno.exit(1);
            }
          }),
      )
      .command(
        GIT_CMD_STATUS,
        new Command()
          .description("Check daemon status")
          .option("--json", "Output as JSON")
          .action(async (options) => {
            try {
              const status = await daemonCommands.status();
              if (options.json) {
                console.log(JSON.stringify({
                  status: status.running ? "running" : "stopped",
                  pid: status.pid ?? null,
                  uptime: status.uptime ?? null,
                  binary_version: status.version,
                  workspace_schema_version: status.workspace_schema_version,
                }));
                return;
              }
              display.info("daemon.status", DAEMON_IDENTITY_ID, {
                status: status.running ? "Running ✓" : "Stopped ✗",
                pid: status.pid ?? null,
                uptime: status.uptime ?? null,
                binary: status.version,
                schema: status.workspace_schema_version,
              });
            } catch (error) {
              display.error("cli.error", "daemon status", {
                message: error instanceof Error ? error.message : DEFAULT_UNKNOWN_ERROR_MESSAGE,
              });
              Deno.exit(1);
            }
          }),
      )
      .command(
        "logs",
        new Command()
          .description("Show daemon logs")
          .option("-n, --lines <lines:number>", "Number of lines to show", { default: CLI_DEFAULTS.LOG_LINES })
          .option("-f, --follow", "Follow log output")
          .action(async (options) => {
            try {
              await daemonCommands.logs(options.lines, options.follow);
            } catch (error) {
              display.error("cli.error", "daemon logs", {
                message: error instanceof Error ? error.message : DEFAULT_UNKNOWN_ERROR_MESSAGE,
              });
              Deno.exit(1);
            }
          }),
      ),
  )
  // Portal commands
  .command(
    PORTAL_LABEL,
    new Command()
      .description("Manage external project portals")
      .command(
        "add <target-path> <alias>",
        new Command()
          .description("Add a new portal (symlink to external project)")
          .option("--default-branch <branch:string>", "Default base branch for this portal")
          .option(
            "--execution-strategy <strategy:string>",
            "Execution strategy: branch (default) or worktree",
          )
          .action(async (options, ...args: string[]) => {
            const targetPath = args[0];
            const alias = args[1];
            try {
              const strategy = options.executionStrategy as string | undefined;
              const parsedStrategy = strategy
                ? (strategy === PortalExecutionStrategy.BRANCH
                  ? PortalExecutionStrategy.BRANCH
                  : strategy === PortalExecutionStrategy.WORKTREE
                  ? PortalExecutionStrategy.WORKTREE
                  : undefined)
                : undefined;
              if (strategy && !parsedStrategy) {
                throw new Error(
                  `Invalid execution strategy. Must be one of: ${PortalExecutionStrategy.BRANCH}, ${PortalExecutionStrategy.WORKTREE}`,
                );
              }

              await portalCommands.add(targetPath, alias, {
                defaultBranch: options.defaultBranch,
                executionStrategy: parsedStrategy,
              });
            } catch (error) {
              display.error("cli.error", "portal add", {
                message: error instanceof Error ? error.message : DEFAULT_UNKNOWN_ERROR_MESSAGE,
              });
              Deno.exit(1);
            }
          }),
      )
      .command(
        RequestOperation.LIST,
        new Command()
          .description("List all configured portals")
          .action(async () => {
            try {
              const portals = await portalCommands.list();
              if (portals.length === 0) {
                display.info("portal.list", "portals", {
                  count: 0,
                  hint: "Add a portal with: exactl portal add <path> <alias>",
                });
                return;
              }
              display.info("portal.list", "portals", { count: portals.length });
              for (const portal of portals) {
                display.info(portal.alias, portal.symlinkPath, {
                  status: portal.status === PortalStatus.ACTIVE ? "Active ✓" : "Broken ⚠",
                  target: portal.targetPath + (portal.status === "broken" ? " (not found)" : ""),
                  context: portal.contextCardPath,
                });
              }
            } catch (error) {
              display.error("cli.error", "portal list", {
                message: error instanceof Error ? error.message : DEFAULT_UNKNOWN_ERROR_MESSAGE,
              });
              Deno.exit(1);
            }
          }),
      )
      .command(
        "show <alias>",
        new Command()
          .description("Show detailed information about a portal")
          .action(async (_options, ...args: string[]) => {
            const alias = args[0];
            try {
              const portal = await portalCommands.show(alias);
              display.info("portal.show", portal.alias, {
                target_path: portal.targetPath,
                symlink: portal.symlinkPath,
                status: portal.status === "active" ? "Active ✓" : "Broken ⚠",
                context_card: portal.contextCardPath,
                permissions: portal.permissions ?? null,
                created: portal.created ?? null,
                last_verified: portal.lastVerified ?? null,
                default_branch: portal.defaultBranch ?? null,
                execution_strategy: portal.executionStrategy ?? null,
              });
            } catch (error) {
              display.error("cli.error", "portal show", {
                message: error instanceof Error ? error.message : DEFAULT_UNKNOWN_ERROR_MESSAGE,
              });
              Deno.exit(1);
            }
          }),
      )
      .command(
        "remove <alias>",
        new Command()
          .description("Remove a portal (archives context card)")
          .option("--keep-card", "Keep context card instead of archiving")
          .action(async (options, ...args: string[]) => {
            const alias = args[0];
            try {
              await portalCommands.remove(alias, { keepCard: options.keepCard });
            } catch (error) {
              display.error("cli.error", "portal remove", {
                message: error instanceof Error ? error.message : DEFAULT_UNKNOWN_ERROR_MESSAGE,
              });
              Deno.exit(1);
            }
          }),
      )
      .command(
        "verify",
        new Command()
          .description("Verify portal integrity")
          .arguments("[alias:string]")
          .action(async (_options, alias?: string) => {
            try {
              const results = await portalCommands.verify(alias);
              let healthy = 0;
              let broken = 0;
              for (const result of results) {
                if (result.issues && result.issues.length > 0) {
                  display.warn("portal.verify", result.alias, { status: "FAILED", issues: result.issues });
                  broken++;
                } else {
                  display.info("portal.verify", result.alias, { status: "OK" });
                  healthy++;
                }
              }
              display.info("portal.verify.summary", "portals", { healthy, broken });
            } catch (error) {
              display.error("cli.error", "portal verify", {
                message: error instanceof Error ? error.message : DEFAULT_UNKNOWN_ERROR_MESSAGE,
              });
              Deno.exit(1);
            }
          }),
      )
      .command(
        "refresh <alias>",
        new Command()
          .description("Refresh portal context card (re-scan project)")
          .action(async (_options, ...args: string[]) => {
            const alias = args[0];
            try {
              await portalCommands.refresh(alias);
            } catch (error) {
              display.error("cli.error", "portal refresh", {
                message: error instanceof Error ? error.message : DEFAULT_UNKNOWN_ERROR_MESSAGE,
              });
              Deno.exit(1);
            }
          }),
      )
      .command(
        "analyze <alias>",
        new Command()
          .description("Trigger codebase knowledge analysis for a portal")
          .option("-m, --mode <mode:string>", "Analysis mode: quick, standard, deep")
          .option("-f, --force", "Force re-analysis even if fresh knowledge exists")
          .action(async (options, ...args: string[]) => {
            const alias = args[0];
            try {
              const summary = await portalCommands.analyze(alias, {
                mode: options.mode as PortalAnalysisMode,
                force: options.force,
              });
              console.log(summary);
            } catch (error) {
              display.error("cli.error", "portal analyze", {
                message: error instanceof Error ? error.message : DEFAULT_UNKNOWN_ERROR_MESSAGE,
              });
              Deno.exit(1);
            }
          }),
      )
      .command(
        "knowledge <alias>",
        new Command()
          .description("Display gathered knowledge for a portal")
          .option("--json", CLI_OPTION_JSON_HELP)
          .action(async (options, ...args: string[]) => {
            const alias = args[0];
            try {
              const output = await portalCommands.knowledge(alias, {
                json: options.json,
              });
              console.log(output);
            } catch (error) {
              display.error("cli.error", "portal knowledge", {
                message: error instanceof Error ? error.message : DEFAULT_UNKNOWN_ERROR_MESSAGE,
              });
              Deno.exit(1);
            }
          }),
      ),
  )
  // Config commands
  .command(
    CONFIG_LABEL,
    new Command()
      .description("View and modify Exaix configuration")
      .command(
        "get <path>",
        new Command()
          .description("Print effective value at path")
          .option("--profile <name:string>", "Target a named profile (reads profile.<name>.<path>)")
          .action(async (options, ...args: string[]) => {
            try {
              const value = await configCommands.get(args[0], options.profile);
              display.info("config.get", args[0], { value: String(value), profile: options.profile });
            } catch (error) {
              display.error("cli.error", "config get", {
                message: error instanceof Error ? error.message : DEFAULT_UNKNOWN_ERROR_MESSAGE,
              });
              Deno.exit(1);
            }
          }),
      )
      .command(
        "set <path> <value>",
        new Command()
          .description("Set value, validate, write, reload")
          .option("--profile <name:string>", "Target a named profile (writes profile.<name>.<path>)")
          .action(async (options, ...args: string[]) => {
            try {
              await configCommands.set(args[0], args[1], options.profile);
              display.info("config.set", args[0], { value: args[1], profile: options.profile });
            } catch (error) {
              display.error("cli.error", "config set", {
                message: error instanceof Error ? error.message : DEFAULT_UNKNOWN_ERROR_MESSAGE,
              });
              Deno.exit(1);
            }
          }),
      )
      .command(
        "unset <path>",
        new Command()
          .description("Reset key to default")
          .action(async (_options, ...args: string[]) => {
            try {
              await configCommands.unset(args[0]);
              display.info("config.unset", args[0], {});
            } catch (error) {
              display.error("cli.error", "config unset", {
                message: error instanceof Error ? error.message : DEFAULT_UNKNOWN_ERROR_MESSAGE,
              });
              Deno.exit(1);
            }
          }),
      )
      // Phase 139 Step 2: append-only override history (read-only audit).
      .command(
        "history <path>",
        new Command()
          .description("Show the append-only override history for a key (newest first)")
          .action(async (_options, ...args: string[]) => {
            try {
              const rows = await configCommands.history(args[0]);
              for (const row of rows) {
                display.info("config.history.entry", args[0], {
                  id: row.id,
                  value: row.value,
                  source: row.source,
                  created_at: row.created_at,
                });
              }
              display.info("config.history", args[0], { count: rows.length });
            } catch (error) {
              display.error("cli.error", "config history", {
                message: error instanceof Error ? error.message : DEFAULT_UNKNOWN_ERROR_MESSAGE,
              });
              Deno.exit(1);
            }
          }),
      )
      // Phase 139 Step 3: revert a key to a historical value (append rollback row).
      .command(
        "rollback <path> <id>",
        new Command()
          .description("Revert a key to the value at a history id (appends a rollback row)")
          .action(async (_options, ...args: string[]) => {
            try {
              const id = Number(args[1]);
              const restored = await configCommands.rollback(args[0], id);
              display.info("config.rollback", args[0], { to_id: id, restored_value: restored });
            } catch (error) {
              display.error("cli.error", "config rollback", {
                message: error instanceof Error ? error.message : DEFAULT_UNKNOWN_ERROR_MESSAGE,
              });
              Deno.exit(1);
            }
          }),
      )
      // Phase 139 Step 4: per-key write lock (refused by adapter.set across surfaces).
      .command(
        "lock <path>",
        new Command()
          .description("Lock a config key against all writes (CLI/MCP/daemon)")
          .option("--reason <text:string>", "Optional note for the lock")
          .action(async (options, ...args: string[]) => {
            try {
              await configCommands.lock(args[0], options.reason);
              display.info("config.lock", args[0], { reason: options.reason });
            } catch (error) {
              display.error("cli.error", "config lock", {
                message: error instanceof Error ? error.message : DEFAULT_UNKNOWN_ERROR_MESSAGE,
              });
              Deno.exit(1);
            }
          }),
      )
      .command(
        "unlock <path>",
        new Command()
          .description("Unlock a previously locked config key")
          .action(async (_options, ...args: string[]) => {
            try {
              await configCommands.unlock(args[0]);
              display.info("config.unlock", args[0], {});
            } catch (error) {
              display.error("cli.error", "config unlock", {
                message: error instanceof Error ? error.message : DEFAULT_UNKNOWN_ERROR_MESSAGE,
              });
              Deno.exit(1);
            }
          }),
      )
      .command(
        "lock-list",
        new Command()
          .description("List all locked config keys")
          .action(async () => {
            try {
              const locks = await configCommands.listLocks();
              for (const l of locks) {
                display.info("config.lock.entry", l.key, { locked_by: l.locked_by, reason: l.reason });
              }
              display.info("config.lock.list", CONFIG_LABEL, { count: locks.length });
            } catch (error) {
              display.error("cli.error", "config lock-list", {
                message: error instanceof Error ? error.message : DEFAULT_UNKNOWN_ERROR_MESSAGE,
              });
              Deno.exit(1);
            }
          }),
      )
      // Phase 138 Step 2: MCP deny-permanently blocklist management.
      .command(
        "block",
        new Command()
          .description("Manage the MCP config-write deny-permanently blocklist")
          .command(
            "add <pattern>",
            new Command()
              .description("Block a config path pattern from MCP writes (glob: system.*)")
              .option("--reason <text:string>", "Optional admin note for the block")
              .action(async (options, ...args: string[]) => {
                try {
                  await configCommands.blockAdd(args[0], options.reason);
                  display.info("config.block.add", args[0], { reason: options.reason });
                } catch (error) {
                  display.error("cli.error", "config block add", {
                    message: error instanceof Error ? error.message : DEFAULT_UNKNOWN_ERROR_MESSAGE,
                  });
                  Deno.exit(1);
                }
              }),
          )
          .command(
            "remove <pattern>",
            new Command()
              .description("Remove a blocklist pattern")
              .action(async (_options, ...args: string[]) => {
                try {
                  await configCommands.blockRemove(args[0]);
                  display.info("config.block.remove", args[0], {});
                } catch (error) {
                  display.error("cli.error", "config block remove", {
                    message: error instanceof Error ? error.message : DEFAULT_UNKNOWN_ERROR_MESSAGE,
                  });
                  Deno.exit(1);
                }
              }),
          )
          .command(
            CLI_CMD_LIST,
            new Command()
              .description("List all blocklist patterns")
              .action(async () => {
                try {
                  const blocks = await configCommands.blockList();
                  for (const b of blocks) {
                    console.log(`${b.pattern}${b.reason ? `  (${b.reason})` : ""}`);
                  }
                  display.info("config.block.list", CONFIG_LABEL, { count: blocks.length });
                } catch (error) {
                  display.error("cli.error", "config block list", {
                    message: error instanceof Error ? error.message : DEFAULT_UNKNOWN_ERROR_MESSAGE,
                  });
                  Deno.exit(1);
                }
              }),
          ),
      )
      // Phase 138 Step 3: compaction recovery (hard-limit escape hatch).
      .command(
        "compact",
        new Command()
          .description("Compact config_overrides to one row per key (recovers DB headroom)")
          .action(async () => {
            try {
              const removed = await configCommands.compact();
              display.info("config.compact", CONFIG_LABEL, { removed });
            } catch (error) {
              display.error("cli.error", "config compact", {
                message: error instanceof Error ? error.message : DEFAULT_UNKNOWN_ERROR_MESSAGE,
              });
              Deno.exit(1);
            }
          }),
      )
      .command(
        "validate",
        new Command()
          .description("Validate entire config or specific path")
          .arguments("[path:string]")
          .action(async (_options, path?: string) => {
            try {
              const report = await configCommands.validate(path);
              if (report.valid) {
                display.info("config.validate", "config", { valid: true });
              } else {
                for (const issue of report.issues) {
                  display.warn("config.validate", issue.path, { message: issue.message, code: issue.code });
                }
              }
            } catch (error) {
              display.error("cli.error", "config validate", {
                message: error instanceof Error ? error.message : DEFAULT_UNKNOWN_ERROR_MESSAGE,
              });
              Deno.exit(1);
            }
          }),
      )
      .command(
        "show",
        new Command()
          .description("Show effective config")
          .option("--json", CLI_OPTION_JSON_HELP)
          .option("--sources", "Include provenance source for each key")
          .action(async (options) => {
            try {
              const format = options.json ? ConfigOutputFormat.JSON : ConfigOutputFormat.HUMAN;
              const output = await configCommands.show(format, options.sources);
              console.log(output);
            } catch (error) {
              display.error("cli.error", "config show", {
                message: error instanceof Error ? error.message : DEFAULT_UNKNOWN_ERROR_MESSAGE,
              });
              Deno.exit(1);
            }
          }),
      )
      .command(
        CONFIG_DIFF_LABEL,
        new Command()
          .description("Show uncommitted config changes")
          .action(async () => {
            try {
              console.log(await configCommands.diff());
            } catch (error) {
              display.error("cli.error", "config diff", {
                message: error instanceof Error ? error.message : DEFAULT_UNKNOWN_ERROR_MESSAGE,
              });
              Deno.exit(1);
            }
          }),
      )
      .command(
        "set-model",
        new Command()
          .description("Set model for a named configuration")
          .arguments("<name:string> <model:string>")
          .action(async (_options, ...args) => {
            try {
              await configCommands.setModel(args[0], args[1]);
              display.info("config.set-model", args[0], { model: args[1] });
            } catch (error) {
              display.error("cli.error", "config set-model", {
                message: error instanceof Error ? error.message : DEFAULT_UNKNOWN_ERROR_MESSAGE,
              });
              Deno.exit(1);
            }
          }),
      )
      .command(
        "set-provider",
        new Command()
          .description("Set provider and configure default model")
          .arguments("<provider:string>")
          .action(async (_options, ...args) => {
            try {
              await configCommands.setProvider(args[0]);
              display.info("config.set-provider", args[0], {});
            } catch (error) {
              display.error("cli.error", "config set-provider", {
                message: error instanceof Error ? error.message : DEFAULT_UNKNOWN_ERROR_MESSAGE,
              });
              Deno.exit(1);
            }
          }),
      )
      .command(
        "set-path",
        new Command()
          .description("Set a path configuration")
          .arguments("<key:string> <dir:string>")
          .action(async (_options, ...args) => {
            try {
              await configCommands.setPath(args[0], args[1]);
              display.info("config.set-path", args[0], { dir: args[1] });
            } catch (error) {
              display.error("cli.error", "config set-path", {
                message: error instanceof Error ? error.message : DEFAULT_UNKNOWN_ERROR_MESSAGE,
              });
              Deno.exit(1);
            }
          }),
      )
      .command(
        "use-profile",
        new Command()
          .description("Set active profile")
          .arguments("<name:string>")
          .action(async (_options, ...args) => {
            try {
              await configCommands.useProfile(args[0]);
              display.info("config.use-profile", args[0], {});
            } catch (error) {
              display.error("cli.error", "config use-profile", {
                message: error instanceof Error ? error.message : DEFAULT_UNKNOWN_ERROR_MESSAGE,
              });
              Deno.exit(1);
            }
          }),
      )
      .command(
        "list-profiles",
        new Command()
          .description("List all profiles")
          .action(async () => {
            try {
              const profiles = await configCommands.listProfiles();
              for (const p of profiles) {
                console.log(`  ${p}`);
              }
              if (profiles.length === 0) {
                console.log("  No profiles configured.");
              }
            } catch (error) {
              display.error("cli.error", "config list-profiles", {
                message: error instanceof Error ? error.message : DEFAULT_UNKNOWN_ERROR_MESSAGE,
              });
              Deno.exit(1);
            }
          }),
      ),
  )
  // Blueprint commands
  .command(
    "blueprint",
    new Command()
      .description("Manage agent blueprints")
      .command(
        "create <agent-id>",
        new Command()
          .description("Create a new agent blueprint")
          .option("-n, --name <name:string>", "Agent name (required)")
          .option("-m, --model <model:string>", "Model in provider:model format (required)")
          .option("-d, --description <description:string>", "Brief description")
          .option("-c, --capabilities <capabilities:string>", "Comma-separated capabilities")
          .option("-p, --system-prompt <prompt:string>", "Inline system prompt")
          .option("-f, --system-prompt-file <file:string>", "Load system prompt from file")
          .option(
            "--from <identity-id:string>",
            "Clone an existing identity as a prototype (seeds model, capabilities, and body)",
          )
          .action(async (options, ...args: string[]) => {
            const identityId = args[0];
            try {
              const result = await blueprintCommands.create(identityId, {
                name: options.name,
                model: options.model,
                description: options.description,
                capabilities: options.capabilities,
                systemPrompt: options.systemPrompt,
                systemPromptFile: options.systemPromptFile,
                from: options.from,
              });
              display.info("blueprint.created", result.identity_id, {
                name: result.name,
                model: result.model,
                path: result.path,
              });
            } catch (error) {
              display.error("cli.error", "blueprint create", {
                message: error instanceof Error ? error.message : DEFAULT_UNKNOWN_ERROR_MESSAGE,
              });
              Deno.exit(1);
            }
          }),
      )
      .command(
        RequestOperation.LIST,
        new Command()
          .description("List all agent blueprints")
          .option("--capability <capability:string>", "Only show blueprints that declare this capability")
          .option("--status <status:string>", "Only show blueprints in this lifecycle status (active|deprecated)")
          .action(async (options: { capability?: string; status?: string }) => {
            try {
              const blueprints = await blueprintCommands.list({
                capability: options.capability,
                status: options.status as BlueprintStatus | undefined,
              });
              if (blueprints.length === 0) {
                display.info("blueprint.list", DISPLAY_CATEGORY_BLUEPRINTS, {
                  count: 0,
                  hint:
                    'Create a blueprint with: exactl blueprint create <agent-id> --name "Name" --model "provider:model"',
                });
                return;
              }
              display.info("blueprint.list", DISPLAY_CATEGORY_BLUEPRINTS, { count: blueprints.length });
              for (const blueprint of blueprints) {
                display.info(blueprint.identity_id, blueprint.name, {
                  model: blueprint.model,
                  capabilities: blueprint.capabilities?.join(", ") || DEFAULT_CAPABILITIES_LABEL,
                  status: blueprint.status,
                  created: blueprint.created,
                });
              }
            } catch (error) {
              display.error("cli.error", "blueprint list", {
                message: error instanceof Error ? error.message : DEFAULT_UNKNOWN_ERROR_MESSAGE,
              });
              Deno.exit(1);
            }
          }),
      )
      .command(
        "show <agent-id>",
        new Command()
          .description("Show blueprint details")
          .action(async (_options, ...args: string[]) => {
            const identityId = args[0];
            try {
              const blueprint = await blueprintCommands.show(identityId);
              display.info("blueprint.show", blueprint.identity_id, {
                name: blueprint.name,
                model: blueprint.model,
                capabilities: blueprint.capabilities?.join(", ") || DEFAULT_CAPABILITIES_LABEL,
                version: blueprint.version,
                created: blueprint.created,
                created_by: blueprint.created_by,
                content_preview: blueprint.content.substring(0, 200) + "...",
              });
            } catch (error) {
              display.error("cli.error", "blueprint show", {
                message: error instanceof Error ? error.message : DEFAULT_UNKNOWN_ERROR_MESSAGE,
              });
              Deno.exit(1);
            }
          }),
      )
      .command(
        "validate [agent-id]",
        new Command()
          .description("Validate blueprint format")
          .option("--file <path:string>", "Validate a blueprint file by path")
          .action(async (options: { file?: string }, ...args: string[]) => {
            try {
              if (options.file) {
                const result = await blueprintCommands.validateFile(options.file);
                const label = options.file;
                if (result.valid) {
                  display.info("blueprint.valid", label, {
                    status: "Valid ✓",
                    warnings: result.warnings?.length || 0,
                  });
                } else {
                  display.error("blueprint.invalid", label, {
                    status: "Invalid ✗",
                    errors: result.errors,
                  });
                  Deno.exit(1);
                }
              } else {
                const identityId = args[0];
                if (!identityId) {
                  throw new Error("Either <agent-id> or --file <path> is required");
                }
                const result = await blueprintCommands.validate(identityId);
                if (result.valid) {
                  display.info("blueprint.valid", identityId, {
                    status: "Valid ✓",
                    warnings: result.warnings?.length || 0,
                  });
                } else {
                  display.error("blueprint.invalid", identityId, {
                    status: "Invalid ✗",
                    errors: result.errors,
                  });
                  Deno.exit(1);
                }
              }
            } catch (error) {
              display.error("cli.error", "blueprint validate", {
                message: error instanceof Error ? error.message : DEFAULT_UNKNOWN_ERROR_MESSAGE,
              });
              Deno.exit(1);
            }
          }),
      )
      .command(
        "edit <agent-id>",
        new Command()
          .description("Edit blueprint in $EDITOR")
          .action(async (_options, ...args: string[]) => {
            const identityId = args[0];
            try {
              await blueprintCommands.edit(identityId);
            } catch (error) {
              display.error("cli.error", "blueprint edit", {
                message: error instanceof Error ? error.message : DEFAULT_UNKNOWN_ERROR_MESSAGE,
              });
              Deno.exit(1);
            }
          }),
      )
      .command(
        "remove <agent-id>",
        new Command()
          .description("Remove a blueprint")
          .option("--force", "Skip confirmation")
          .action(async (options, ...args: string[]) => {
            const identityId = args[0];
            try {
              await blueprintCommands.remove(identityId, { force: options.force });
              display.info("blueprint.removed", identityId, { status: "Removed ✓" });
            } catch (error) {
              display.error("cli.error", "blueprint remove", {
                message: error instanceof Error ? error.message : DEFAULT_UNKNOWN_ERROR_MESSAGE,
              });
              Deno.exit(1);
            }
          }),
      )
      .command(
        "deprecate <agent-id>",
        new Command()
          .description("Mark a blueprint as deprecated (retires it without deleting the file)")
          .action(async (_options, ...args: string[]) => {
            const identityId = args[0];
            try {
              await blueprintCommands.deprecate(identityId);
              display.info("blueprint.deprecated", identityId, { status: "Deprecated ✓" });
            } catch (error) {
              display.error("cli.error", "blueprint deprecate", {
                message: error instanceof Error ? error.message : DEFAULT_UNKNOWN_ERROR_MESSAGE,
              });
              Deno.exit(1);
            }
          }),
      )
      .command(
        "ls",
        new Command().description("Alias for 'list'").action(async () => {
          const blueprints = await blueprintCommands.list();
          if (blueprints.length === 0) {
            display.info("blueprint.list", DISPLAY_CATEGORY_BLUEPRINTS, { count: 0 });
            return;
          }
          display.info("blueprint.list", DISPLAY_CATEGORY_BLUEPRINTS, { count: blueprints.length });
          for (const blueprint of blueprints) {
            display.info(blueprint.identity_id, blueprint.name, {
              model: blueprint.model,
              capabilities: blueprint.capabilities?.join(", ") || DEFAULT_CAPABILITIES_LABEL,
            });
          }
        }),
      )
      .command(
        "rm <agent-id>",
        new Command().description("Alias for 'remove'").option("--force", "Skip confirmation").action(
          async (options, ...args: string[]) => {
            const identityId = args[0];
            await blueprintCommands.remove(identityId, { force: options.force });
            display.info("blueprint.removed", identityId, { status: "Removed ✓" });
          },
        ),
      )
      // Phase 53: identity subcommands (canonical) with agent as deprecated aliases
      .command(
        "identity",
        new Command()
          .description("Manage identity blueprints (canonical name)")
          .command(
            "create <identity-id>",
            new Command()
              .description("Create a new identity blueprint")
              .option("-n, --name <name:string>", "Identity name (required)")
              .option("-m, --model <model:string>", "Model in provider:model format (required)")
              .option("-d, --description <description:string>", "Brief description")
              .option("-c, --capabilities <capabilities:string>", "Comma-separated capabilities")
              .option("-p, --system-prompt <prompt:string>", "Inline system prompt")
              .option("-f, --system-prompt-file <file:string>", "Load system prompt from file")
              .option(
                "--from <identity-id:string>",
                "Clone an existing identity as a prototype (seeds model, capabilities, and body)",
              )
              .action(async (options, ...args: string[]) => {
                const identityId = args[0];
                try {
                  const result = await blueprintCommands.create(identityId, {
                    name: options.name,
                    model: options.model,
                    description: options.description,
                    capabilities: options.capabilities,
                    systemPrompt: options.systemPrompt,
                    systemPromptFile: options.systemPromptFile,
                    from: options.from,
                  });
                  display.info("blueprint.created", result.identity_id, {
                    name: result.name,
                    model: result.model,
                    path: result.path,
                  });
                } catch (error) {
                  display.error("cli.error", "blueprint create", {
                    message: error instanceof Error ? error.message : DEFAULT_UNKNOWN_ERROR_MESSAGE,
                  });
                  Deno.exit(1);
                }
              }),
          )
          .command(
            RequestOperation.LIST,
            new Command()
              .description("List all identity blueprints")
              .option("--capability <capability:string>", "Only show blueprints that declare this capability")
              .option(
                "--status <status:string>",
                "Only show blueprints in this lifecycle status (active|deprecated)",
              )
              .action(async (options: { capability?: string; status?: string }) => {
                try {
                  const blueprints = await blueprintCommands.list({
                    capability: options.capability,
                    status: options.status as BlueprintStatus | undefined,
                  });
                  if (blueprints.length === 0) {
                    display.info("blueprint.list", "identities", {
                      count: 0,
                      hint:
                        'Create an identity with: exactl blueprint identity create <identity-id> --name "Name" --model "provider:model"',
                    });
                    return;
                  }
                  display.info("blueprint.list", "identities", { count: blueprints.length });
                  for (const blueprint of blueprints) {
                    display.info(blueprint.identity_id, blueprint.name, {
                      model: blueprint.model,
                      capabilities: blueprint.capabilities?.join(", ") || DEFAULT_CAPABILITIES_LABEL,
                      status: blueprint.status,
                      created: blueprint.created,
                    });
                  }
                } catch (error) {
                  display.error("cli.error", "blueprint list", {
                    message: error instanceof Error ? error.message : DEFAULT_UNKNOWN_ERROR_MESSAGE,
                  });
                  Deno.exit(1);
                }
              }),
          )
          .command(
            "show <identity-id>",
            new Command()
              .description("Show identity blueprint details")
              .action(async (_options, ...args: string[]) => {
                const identityId = args[0];
                try {
                  const blueprint = await blueprintCommands.show(identityId);
                  display.info("blueprint.show", blueprint.identity_id, {
                    name: blueprint.name,
                    model: blueprint.model,
                    capabilities: blueprint.capabilities?.join(", ") || DEFAULT_CAPABILITIES_LABEL,
                    version: blueprint.version,
                    created: blueprint.created,
                    created_by: blueprint.created_by,
                    content_preview: blueprint.content.substring(0, 200) + "...",
                  });
                } catch (error) {
                  display.error("cli.error", "blueprint show", {
                    message: error instanceof Error ? error.message : DEFAULT_UNKNOWN_ERROR_MESSAGE,
                  });
                  Deno.exit(1);
                }
              }),
          )
          .command(
            "validate <identity-id>",
            new Command()
              .description("Validate identity blueprint format")
              .action(async (_options, ...args: string[]) => {
                const identityId = args[0];
                try {
                  const result = await blueprintCommands.validate(identityId);
                  if (result.valid) {
                    display.info("blueprint.valid", identityId, {
                      status: "Valid ✓",
                      warnings: result.warnings?.length || 0,
                    });
                  } else {
                    display.error("blueprint.invalid", identityId, {
                      status: "Invalid ✗",
                      errors: result.errors,
                    });
                    Deno.exit(1);
                  }
                } catch (error) {
                  display.error("cli.error", "blueprint validate", {
                    message: error instanceof Error ? error.message : DEFAULT_UNKNOWN_ERROR_MESSAGE,
                  });
                  Deno.exit(1);
                }
              }),
          )
          .command(
            "edit <identity-id>",
            new Command()
              .description("Edit identity blueprint in $EDITOR")
              .action(async (_options, ...args: string[]) => {
                const identityId = args[0];
                try {
                  await blueprintCommands.edit(identityId);
                } catch (error) {
                  display.error("cli.error", "blueprint edit", {
                    message: error instanceof Error ? error.message : DEFAULT_UNKNOWN_ERROR_MESSAGE,
                  });
                  Deno.exit(1);
                }
              }),
          )
          .command(
            "remove <identity-id>",
            new Command()
              .description("Remove an identity blueprint")
              .option("--force", "Skip confirmation")
              .action(async (options, ...args: string[]) => {
                const identityId = args[0];
                try {
                  await blueprintCommands.remove(identityId, { force: options.force });
                  display.info("blueprint.removed", identityId, { status: "Removed ✓" });
                } catch (error) {
                  display.error("cli.error", "blueprint remove", {
                    message: error instanceof Error ? error.message : DEFAULT_UNKNOWN_ERROR_MESSAGE,
                  });
                  Deno.exit(1);
                }
              }),
          )
          .command(
            "deprecate <identity-id>",
            new Command()
              .description("Mark an identity blueprint as deprecated (retires it without deleting the file)")
              .action(async (_options, ...args: string[]) => {
                const identityId = args[0];
                try {
                  await blueprintCommands.deprecate(identityId);
                  display.info("blueprint.deprecated", identityId, { status: "Deprecated ✓" });
                } catch (error) {
                  display.error("cli.error", "blueprint deprecate", {
                    message: error instanceof Error ? error.message : DEFAULT_UNKNOWN_ERROR_MESSAGE,
                  });
                  Deno.exit(1);
                }
              }),
          ),
      ),
  )
  .command(
    "routing",
    new Command()
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
                selected_identity_id: result.selectedIdentityId,
                selected_version: result.selectedVersion,
                strategy: result.strategy,
                matched_rule_id: result.matchedRuleId ?? null,
                candidate_count: result.candidates.length,
              });
              for (const candidate of result.candidates.slice(0, 5)) {
                console.log(`${candidate.identityId}@${candidate.version} score=${candidate.score.toFixed(2)}`);
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
      ),
  )
  // Flow commands
  .command(
    RequestKind.FLOW,
    new Command()
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
      .command(
        "validate <flowId:string>",
        new Command()
          .description("Validate a flow definition")
          .option("--json", CLI_OPTION_JSON_HELP)
          .action(async (options, ...args: string[]) => {
            const flowId = args[0];
            await flowCommands.validateFlow(flowId, options);
          }),
      ),
  )
  // Memory commands
  .command(
    "memory",
    new Command()
      .description("Manage Memory Banks (project memory, execution history, search)")
      .option(CLI_OUTPUT_FORMAT_OPTION, CLI_OUTPUT_FORMAT_HELP, CLI_OUTPUT_FORMAT_DEFAULT)
      .action(async (options) => {
        // Default action: show summary
        const result = await memoryCommands.list(options.format as OutputFormat);
        console.log(result);
      })
      .command(
        RequestOperation.LIST,
        new Command()
          .description("List all memory banks with summary")
          .option(CLI_OUTPUT_FORMAT_OPTION, CLI_OUTPUT_FORMAT_HELP, CLI_OUTPUT_FORMAT_DEFAULT)
          .action(async (options) => {
            const result = await memoryCommands.list(options.format as OutputFormat);
            console.log(result);
          }),
      )
      .command(
        "search <query:string>",
        new Command()
          .description("Search across all memory banks")
          .option(CLI_OPTION_PORTAL, "Filter by portal")
          .option("-t, --tags <tags:string>", "Filter by tags (comma-separated)")
          .option(CLI_LIMIT_OPTION, CLI_LIMIT_HELP, { default: 20 })
          .option("-e, --use-embeddings", "Use embedding-based semantic search")
          .option(CLI_OUTPUT_FORMAT_OPTION, CLI_OUTPUT_FORMAT_HELP, CLI_OUTPUT_FORMAT_DEFAULT)
          .action(async (options, ...args: string[]) => {
            const query = args[0];
            const tags = options.tags ? options.tags.split(",").map((t: string) => t.trim()) : undefined;
            const result = await memoryCommands.search(query, {
              portal: options.portal,
              tags,
              limit: options.limit,
              format: options.format as OutputFormat,
              useEmbeddings: options.useEmbeddings,
            });
            console.log(result);
          }),
      )
      .command(
        MemoryScope.PROJECT,
        new Command()
          .description("Project memory operations")
          .option(CLI_OUTPUT_FORMAT_OPTION, CLI_OUTPUT_FORMAT_HELP, CLI_OUTPUT_FORMAT_DEFAULT)
          .action(async (options) => {
            // Default: list projects
            const result = await memoryCommands.projectList(options.format as OutputFormat);
            console.log(result);
          })
          .command(
            RequestOperation.LIST,
            new Command()
              .description("List all project memories")
              .option(CLI_OUTPUT_FORMAT_OPTION, CLI_OUTPUT_FORMAT_HELP, CLI_OUTPUT_FORMAT_DEFAULT)
              .action(async (options) => {
                const result = await memoryCommands.projectList(options.format as OutputFormat);
                console.log(result);
              }),
          )
          .command(
            "show <portal:string>",
            new Command()
              .description("Show details of a specific project memory")
              .option(CLI_OUTPUT_FORMAT_OPTION, CLI_OUTPUT_FORMAT_HELP, CLI_OUTPUT_FORMAT_DEFAULT)
              .action(async (options, ...args: string[]) => {
                const portal = args[0];
                const result = await memoryCommands.projectShow(portal, options.format as OutputFormat);
                console.log(result);
              }),
          ),
      )
      .command(
        "execution",
        new Command()
          .description("Execution history operations")
          .option(CLI_OPTION_PORTAL, "Filter by portal")
          .option(CLI_LIMIT_OPTION, CLI_LIMIT_HELP, { default: 20 })
          .option(CLI_OUTPUT_FORMAT_OPTION, CLI_OUTPUT_FORMAT_HELP, CLI_OUTPUT_FORMAT_DEFAULT)
          .action(async (options) => {
            // Default: list executions
            const result = await memoryCommands.executionList({
              portal: options.portal,
              limit: options.limit,
              format: options.format as OutputFormat,
            });
            console.log(result);
          })
          .command(
            RequestOperation.LIST,
            new Command()
              .description("List execution history")
              .option(CLI_OPTION_PORTAL, "Filter by portal")
              .option(CLI_LIMIT_OPTION, CLI_LIMIT_HELP, { default: 20 })
              .option(CLI_OUTPUT_FORMAT_OPTION, CLI_OUTPUT_FORMAT_HELP, CLI_OUTPUT_FORMAT_DEFAULT)
              .action(async (options) => {
                const result = await memoryCommands.executionList({
                  portal: options.portal,
                  limit: options.limit,
                  format: options.format as OutputFormat,
                });
                console.log(result);
              }),
          )
          .command(
            "show <traceId:string>",
            new Command()
              .description("Show details of a specific execution")
              .option(CLI_OUTPUT_FORMAT_OPTION, CLI_OUTPUT_FORMAT_HELP, CLI_OUTPUT_FORMAT_DEFAULT)
              .action(async (options, ...args: string[]) => {
                const traceId = args[0];
                const result = await memoryCommands.executionShow(traceId, options.format as OutputFormat);
                console.log(result);
              }),
          ),
      )
      .command(
        "rebuild-index",
        new Command()
          .description("Rebuild memory bank search indices")
          .option("-e, --include-embeddings", "Regenerate embedding vectors for all learnings")
          .action(async (options) => {
            const result = await memoryCommands.rebuildIndex({
              includeEmbeddings: options.includeEmbeddings,
            });
            console.log(result);
          }),
      )
      .command(
        GeneralStatus.PENDING,
        new Command()
          .description("Manage pending memory update proposals")
          .option(CLI_OUTPUT_FORMAT_OPTION, CLI_OUTPUT_FORMAT_HELP, CLI_OUTPUT_FORMAT_DEFAULT)
          .option("--eligible", "Show only auto-approval eligible pending proposals")
          .action(async (options) => {
            // Default: list pending
            const result = await memoryCommands.pendingList(options.eligible, options.format as OutputFormat);
            console.log(result);
          })
          .command(
            RequestOperation.LIST,
            new Command()
              .description("List all pending proposals")
              .option(CLI_OUTPUT_FORMAT_OPTION, CLI_OUTPUT_FORMAT_HELP, CLI_OUTPUT_FORMAT_DEFAULT)
              .option("--eligible", "Show only auto-approval eligible pending proposals")
              .action(async (options) => {
                const result = await memoryCommands.pendingList(options.eligible, options.format as OutputFormat);
                console.log(result);
              }),
          )
          .command(
            "show <proposalId:string>",
            new Command()
              .description("Show details of a pending proposal")
              .option(CLI_OUTPUT_FORMAT_OPTION, CLI_OUTPUT_FORMAT_HELP, CLI_OUTPUT_FORMAT_DEFAULT)
              .action(async (options, ...args: string[]) => {
                const proposalId = args[0];
                const result = await memoryCommands.pendingShow(proposalId, options.format as OutputFormat);
                console.log(result);
              }),
          )
          .command(
            "approve [proposalId:string]",
            new Command()
              .description("Approve a pending proposal or preview auto-approvals")
              .option("--dry-run", "Preview auto-approvable proposals without changing state")
              .action(async (options, ...args: string[]) => {
                const proposalId = args[0];
                const result = await memoryCommands.pendingApprove(proposalId, !!options.dryRun);
                console.log(result);
              }),
          )
          .command(
            "reject <proposalId:string>",
            new Command()
              .description("Reject a pending proposal")
              .option(CLI_OPTION_REASON, "Rejection reason", { required: true })
              .action(async (options, ...args: string[]) => {
                const proposalId = args[0];
                const result = await memoryCommands.pendingReject(proposalId, options.reason);
                console.log(result);
              }),
          )
          .command(
            "approve-all",
            new Command()
              .description("Approve all pending proposals")
              .action(async () => {
                const result = await memoryCommands.pendingApproveAll();
                console.log(result);
              }),
          ),
      )
      // Phase 17: Skill commands
      .command(
        "skill",
        new Command()
          .description("Manage procedural skills (Phase 17)")
          .option(CLI_OUTPUT_FORMAT_OPTION, CLI_OUTPUT_FORMAT_HELP, CLI_OUTPUT_FORMAT_DEFAULT)
          .action(async (options) => {
            // Default: list skills
            const result = await memoryCommands.skillList({ format: options.format as OutputFormat });
            console.log(result);
          })
          .command(
            RequestOperation.LIST,
            new Command()
              .description("List all skills")
              .option("-c, --category <category:string>", "Filter by category: core, project, learned")
              .option(CLI_OUTPUT_FORMAT_OPTION, CLI_OUTPUT_FORMAT_HELP, CLI_OUTPUT_FORMAT_DEFAULT)
              .action(async (options) => {
                const result = await memoryCommands.skillList({
                  category: options.category as MemoryBankSource | undefined,
                  format: options.format as OutputFormat,
                });
                console.log(result);
              }),
          )
          .command(
            "show <skillId:string>",
            new Command()
              .description("Show details of a specific skill")
              .option(CLI_OUTPUT_FORMAT_OPTION, CLI_OUTPUT_FORMAT_HELP, CLI_OUTPUT_FORMAT_DEFAULT)
              .action(async (options, ...args: string[]) => {
                const skillId = args[0];
                const result = await memoryCommands.skillShow(skillId, options.format as UIOutputFormat);
                console.log(result);
              }),
          )
          .command(
            "match <request:string>",
            new Command()
              .description("Match skills for a given request")
              .option("-t, --task-type <taskType:string>", "Task type filter")
              .option("--tags <tags:string>", "Comma-separated tags filter")
              .option(CLI_LIMIT_OPTION, CLI_LIMIT_HELP, { default: 10 })
              .option(CLI_OUTPUT_FORMAT_OPTION, CLI_OUTPUT_FORMAT_HELP, CLI_OUTPUT_FORMAT_DEFAULT)
              .action(async (options, ...args: string[]) => {
                const request = args[0];
                const tags = options.tags ? options.tags.split(",").map((t: string) => t.trim()) : undefined;
                const result = await memoryCommands.skillMatch(request, {
                  taskType: options.taskType,
                  tags,
                  limit: options.limit,
                  format: options.format as UIOutputFormat,
                });
                console.log(result);
              }),
          )
          .command(
            "derive",
            new Command()
              .description("Derive a new skill from learnings")
              .option("-l, --learning-ids <ids:string>", "Comma-separated learning IDs to derive from", {
                required: true,
              })
              .option("-n, --name <name:string>", "Name for the derived skill", { required: true })
              .option("-d, --description <desc:string>", "Skill description")
              .option("-i, --instructions <instructions:string>", "Skill instructions")
              .option(CLI_OUTPUT_FORMAT_OPTION, CLI_OUTPUT_FORMAT_HELP, CLI_OUTPUT_FORMAT_DEFAULT)
              .action(async (options) => {
                const learningIds = options.learningIds
                  ? options.learningIds.split(",").map((id: string) => id.trim())
                  : undefined;
                const result = await memoryCommands.skillDerive({
                  learningIds,
                  name: options.name,
                  description: options.description,
                  instructions: options.instructions,
                  format: options.format as UIOutputFormat,
                });
                console.log(result);
              }),
          )
          .command(
            "create <name:string>",
            new Command()
              .description("Create a new skill")
              .option("-d, --description <desc:string>", "Skill description")
              .option("-c, --category <category:string>", "Category: core, project, learned", {
                default: MemoryScope.PROJECT,
              })
              .option("-i, --instructions <instructions:string>", "Skill instructions")
              .option("-k, --keywords <keywords:string>", "Comma-separated trigger keywords")
              .option("-t, --task-types <taskTypes:string>", "Comma-separated trigger task types")
              .option(CLI_OUTPUT_FORMAT_OPTION, CLI_OUTPUT_FORMAT_HELP, CLI_OUTPUT_FORMAT_DEFAULT)
              .action(async (options, ...args: string[]) => {
                const name = args[0];
                const keywords = options.keywords
                  ? options.keywords.split(",").map((k: string) => k.trim())
                  : undefined;
                const taskTypes = options.taskTypes
                  ? options.taskTypes.split(",").map((t: string) => t.trim())
                  : undefined;
                const result = await memoryCommands.skillCreate(name, {
                  description: options.description,
                  category: options.category as MemoryBankSource,
                  instructions: options.instructions,
                  triggersKeywords: keywords,
                  triggersTaskTypes: taskTypes,
                  format: options.format as UIOutputFormat,
                });
                console.log(result);
              }),
          ),
      ),
  )
  .command(
    "dashboard",
    new Command()
      .description("Launch the interactive dashboard")
      .action(async () => {
        await dashboardCommands.show();
      }),
  )
  .command(
    "mcp",
    new Command()
      .description("Model Context Protocol server")
      .command(
        "start",
        new Command()
          .description("Start MCP server (stdio transport)")
          .option("--sse", "Use SSE/HTTP transport (default: stdio)")
          .option("--port <port:number>", "Port for SSE transport", { default: 3000 })
          .action(async (options) => {
            const cmd = new McpCommands(context);
            await cmd.start(options);
          }),
      ),
  );

const journalCommand = new Command()
  .description("Query the IActivity Journal")
  .option("-f, --filter <filter:string>", "Filter by key=value (trace_id, action_type, identity_id, since)", {
    collect: true,
  })
  .option("-n, --tail <n:number>", "Show last N entries", { default: 50 })
  .option("--format <format:string>", "Output format (text, table, json)", { default: CLI_OUTPUT_FORMATS.TEXT })
  .option("--distinct <field:string>", "Return distinct values for specified field")
  .option("--count", "Return count aggregation by action_type")
  .option("--payload <pattern:string>", "Filter by payload LIKE pattern")
  .option("--actor <actor:string>", "Filter by actor")
  .option("--target <target:string>", "Filter by target")
  .action(async (options) => {
    const cmd = new JournalCommands(context);
    await cmd.show(options as IJournalCommandOptions);
  });

const costCommand = new Command()
  .description("Display aggregated cost reports")
  .option("-t, --trace-id <id:string>", "Filter by trace ID")
  .option(CLI_OPTION_PORTAL, "Filter by portal alias")
  .option("-s, --since <date:string>", "Filter by date (ISO string)")
  .option(CLI_OPTION_MODEL, "Filter by model")
  .action(async (options) => {
    const cmd = new CostCommands(context);
    await cmd.show(options);
  });

const logCommand = new Command()
  .description("Access system logs, activity journal and cost tracking")
  .command("journal", journalCommand)
  .command("cost", costCommand);

const logsCommand = new Command()
  .description("Query system activity logs (alias for 'log journal')")
  .option("-f, --filter <filter:string>", "Filter by key=value or bare event name (e.g., model_resolved)", {
    collect: true,
  })
  .option("-n, --tail <n:number>", "Show last N entries", { default: 50 })
  .option("--format <format:string>", "Output format (text, table, json)", { default: CLI_OUTPUT_FORMATS.TEXT })
  .option("--payload <pattern:string>", "Filter by payload LIKE pattern")
  .option("--actor <actor:string>", "Filter by actor")
  .option("--target <target:string>", "Filter by target")
  .action(async (options) => {
    if (options.filter) {
      options.filter = normalizeLogsFilter(options.filter);
    }
    const cmd = new JournalCommands(context);
    await cmd.show(options as IJournalCommandOptions);
  });

__test_command.command("log", logCommand);
__test_command.command("logs", logsCommand);
__test_command.command("journal", journalCommand);

// ---------------------------------------------------------------------------
// version subcommand
// ---------------------------------------------------------------------------

const versionCommand = new Command()
  .description("Show Exaix binary and workspace schema version information")
  .option("--json", "Output as JSON")
  .action((options) => {
    const onDiskSchemaVersion = (() => {
      try {
        return services.config.getSchemaVersion();
      } catch {
        return WORKSPACE_SCHEMA_VERSION;
      }
    })();

    const wsv = parseSemVerSegments(WORKSPACE_SCHEMA_VERSION);
    const ondisk = parseSemVerSegments(onDiskSchemaVersion);

    const migrationRequired = wsv.major > ondisk.major ||
      (wsv.major === ondisk.major && wsv.minor > ondisk.minor);
    const binaryTooOld = ondisk.major > wsv.major ||
      (ondisk.major === wsv.major && ondisk.minor > wsv.minor);
    const compatible = !migrationRequired && !binaryTooOld;

    const compatibilityLabel = migrationRequired
      ? "⚠️  Minor migration required"
      : binaryTooOld
      ? "❌ Binary older than workspace — update exactl"
      : "✅ OK";

    if (options.json) {
      const configPath = (() => {
        try {
          return services.config.getConfigPath();
        } catch {
          return "";
        }
      })();
      console.log(
        JSON.stringify({
          binary_version: BINARY_VERSION,
          workspace_schema_version: WORKSPACE_SCHEMA_VERSION,
          on_disk_schema_version: onDiskSchemaVersion,
          compatible,
          migration_required: migrationRequired,
          config_path: configPath,
        }),
      );
      return;
    }

    const configPath = (() => {
      try {
        return services.config.getConfigPath();
      } catch {
        return "(not available)";
      }
    })();

    console.log("Exaix CLI");
    console.log(`  Binary version:             ${BINARY_VERSION}`);
    console.log(`  Workspace schema version:   ${WORKSPACE_SCHEMA_VERSION}`);
    console.log(`  Config path:                ${configPath}`);
    console.log(`  On-disk schema version:     ${onDiskSchemaVersion}`);
    console.log(`  Compatibility:              ${compatibilityLabel}`);
  });

/** Minimal inline SemVer parser (avoids circular import of scripts/check_version.ts) */
function parseSemVerSegments(v: string): { major: number; minor: number; patch: number } {
  const [major, minor, patch] = v.split(".").map(Number);
  return { major: major ?? 0, minor: minor ?? 0, patch: patch ?? 0 };
}

__test_command.command("version", versionCommand);

// ---------------------------------------------------------------------------
// migrate subcommand (Step 6)
// ---------------------------------------------------------------------------

const migrateCommand = new Command()
  .description("Workspace migration utilities")
  .command(
    "check",
    new Command()
      .description("Check binary vs workspace schema compatibility")
      .option("--json", "Output as JSON")
      .action((options) => {
        const exitCode = daemonCommands.migrate({ check: true, json: options.json });
        Deno.exit(exitCode);
      }),
  );

__test_command.command("migrate", migrateCommand);

// ---------------------------------------------------------------------------
// tool subcommand (Phase 79: Tool Confirmation CLI)
// ---------------------------------------------------------------------------

const toolCommand = new Command()
  .description("Manage pending tool confirmations")
  .command(
    "pending",
    new Command()
      .description("List pending tool confirmations")
      .action(async () => {
        await toolCommands.pending();
      }),
  )
  .command(
    "confirm <id:string>",
    new Command()
      .description("Approve a pending tool confirmation")
      .action(async (_options, ...args: string[]) => {
        const id = args[0];
        await toolCommands.confirm(id);
      }),
  )
  .command(
    "deny <id:string>",
    new Command()
      .description("Deny a pending tool confirmation")
      .option(CLI_OPTION_REASON, "Reason for denial", { default: "User declined" })
      .action(async (options: { reason: string }, ...args: string[]) => {
        const id = args[0];
        await toolCommands.deny(id, options.reason as string);
      }),
  );

__test_command.command("tool", toolCommand);

// ---------------------------------------------------------------------------
// skills subcommand alias (Phase 70: Wiring Skills Service)
// ---------------------------------------------------------------------------

const skillsCommand = new Command()
  .description("Manage procedural skills (Alias for 'memory skill')")
  .option(CLI_OUTPUT_FORMAT_OPTION, CLI_OUTPUT_FORMAT_HELP, CLI_OUTPUT_FORMAT_DEFAULT)
  .action(async (options) => {
    const result = await memoryCommands.skillList({ format: options.format as OutputFormat });
    console.log(result);
  })
  .command(
    CLI_CMD_LIST,
    new Command()
      .description("List all skills")
      .option("-c, --category <category:string>", "Filter by category: core, project, learned")
      .option(CLI_OUTPUT_FORMAT_OPTION, CLI_OUTPUT_FORMAT_HELP, CLI_OUTPUT_FORMAT_DEFAULT)
      .action(async (options) => {
        const result = await memoryCommands.skillList({
          category: options.category as MemoryBankSource | undefined,
          format: options.format as OutputFormat,
        });
        console.log(result);
      }),
  )
  .command(
    "show <skillId:string>",
    new Command()
      .description("Show details of a specific skill")
      .option(CLI_OUTPUT_FORMAT_OPTION, CLI_OUTPUT_FORMAT_HELP, CLI_OUTPUT_FORMAT_DEFAULT)
      .action(async (options, ...args: string[]) => {
        const skillId = args[0];
        const result = await memoryCommands.skillShow(skillId, options.format as UIOutputFormat);
        console.log(result);
      }),
  )
  .command(
    "match <request:string>",
    new Command()
      .description("Match skills for a given request")
      .option("-t, --task-type <taskType:string>", "Task type filter")
      .option("--tags <tags:string>", "Comma-separated tags filter")
      .option(CLI_LIMIT_OPTION, CLI_LIMIT_HELP, { default: 10 })
      .option(CLI_OUTPUT_FORMAT_OPTION, CLI_OUTPUT_FORMAT_HELP, CLI_OUTPUT_FORMAT_DEFAULT)
      .action(async (options, ...args: string[]) => {
        const request = args[0];
        const tags = options.tags ? options.tags.split(",").map((t: string) => t.trim()) : undefined;
        const result = await memoryCommands.skillMatch(request, {
          taskType: options.taskType,
          tags,
          limit: options.limit,
          format: options.format as UIOutputFormat,
        });
        console.log(result);
      }),
  );

__test_command.command("skills", skillsCommand);

// ---------------------------------------------------------------------------
// watch subcommand (Phase 67: Live Execution Streaming)
// ---------------------------------------------------------------------------

const watchCommand = new Command()
  .description("Tail live execution events for a trace (SSE stream with historical fallback)")
  .arguments("<trace_id:string>")
  .action(async (_options, traceId: string) => {
    try {
      await watchCommandInstance.watch(traceId);
    } catch (error) {
      display.error("cli.error", "watch", {
        message: error instanceof Error ? error.message : DEFAULT_UNKNOWN_ERROR_MESSAGE,
      });
      Deno.exit(1);
    }
  });

__test_command.command("watch", watchCommand);

// ---------------------------------------------------------------------------
// eval subcommand (Phase 100: Evaluation Framework)
// ---------------------------------------------------------------------------

const evalCommand = new Command()
  .description("Run evaluations and query evaluation history")
  .command(
    "run",
    new Command()
      .description("Run evaluation scenarios")
      .option("-P, --pack <pack:string>", "Run scenarios in a named pack (repeatable)", { collect: true })
      .option("-t, --tag <tag:string>", "Filter by tag (repeatable)", { collect: true })
      .option("-s, --scenario <id:string>", "Run a single named scenario (repeatable)", { collect: true })
      .option("--score-threshold <threshold:number>", "Minimum suite score to pass", { default: 0.5 })
      .option("--trials <n:number>", "Number of trials per scenario", { default: 1 })
      .option("--history-format <format:string>", "History storage: sqlite+jsonl or jsonl", { default: "sqlite+jsonl" })
      .option("-v, --verbose", "Show detailed output")
      .action(async (options) => {
        try {
          await evalCommands.run({
            pack: options.pack,
            tag: options.tag,
            scenario: options.scenario,
            scoreThreshold: options.scoreThreshold,
            trials: options.trials,
            historyFormat: options.historyFormat,
            verbose: options.verbose,
          });
        } catch (error) {
          console.error("eval run failed:", error instanceof Error ? error.message : String(error));
          Deno.exit(1);
        }
      }),
  )
  .command(
    "history",
    new Command()
      .description("Query evaluation history")
      .option("-l, --last <n:number>", "Show last N entries")
      .option("--scenario <id:string>", "Filter by scenario ID")
      .option("--pack <name:string>", "Filter by pack name")
      .option("--since <date:string>", "Filter to runs since date (ISO 8601)")
      .option("--format <format:string>", "Output format: table, json", { default: "table" })
      .action(async (options) => {
        try {
          await evalCommands.history({
            last: options.last,
            scenario: options.scenario,
            pack: options.pack,
            since: options.since,
            format: options.format,
          });
        } catch (error) {
          console.error("eval history failed:", error instanceof Error ? error.message : String(error));
          Deno.exit(1);
        }
      }),
  )
  .command(
    "compare",
    new Command()
      .description("Compare two evaluation runs side-by-side")
      .option("--run-a <id:string>", "First run ID to compare", { required: true })
      .option("--run-b <id:string>", "Second run ID to compare", { required: true })
      .action((options) => {
        try {
          evalCommands.compare(options.runA, options.runB);
        } catch (error) {
          console.error("eval compare failed:", error instanceof Error ? error.message : String(error));
          Deno.exit(1);
        }
      }),
  );

__test_command.command("eval", evalCommand);

export async function run(): Promise<void> {
  await __test_command.parse(Deno.args);
  if (services.db && services.db.close) {
    await services.db.close();
  }
}

if (import.meta.main && !isTestMode()) {
  await run();
}
