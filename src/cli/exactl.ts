/**
 * @module ExaCtl
 * @path src/cli/exactl.ts
 * @description Main entry point for the Exaix CLI (exactl). Orchestrates all commands, subcommands, and service initializations.
 * @architectural-layer CLI
 * * @related-files [src/cli/init.ts, src/cli/cli.config.ts]
 */

import { Command } from "@cliffy/command";
import { PlanCommands } from "./commands/plan_commands.ts";
import { RequestCommands } from "./commands/request_commands.ts";
import { type IReviewMetadata, ReviewCommands, type ReviewDetails } from "./commands/review_commands.ts";
import { GitCommands } from "./commands/git_commands.ts";
import { DaemonCommands } from "./commands/daemon_commands.ts";
import { PortalCommands } from "./commands/portal_commands.ts";
import { BlueprintCommands } from "./commands/blueprint_commands.ts";
import { FlowCommands } from "./commands/flow_commands.ts";
import { DashboardCommands } from "./commands/dashboard_commands.ts";
import { MemoryCommands } from "./commands/memory_commands.ts";
import { IJournalCommandOptions, JournalCommands } from "./commands/journal_commands.ts";
import {
  FlowInputSource,
  MemoryBankSource,
  MemoryScope,
  PortalAnalysisMode,
  PortalExecutionStrategy,
  PortalStatus,
  RequestKind,
  RequestOperation,
  RequestPriority,
  UIOutputFormat,
} from "../shared/enums.ts";
import { AnalysisMode } from "../shared/types/request.ts";
import { IReviewStatus, ReviewStatus } from "../reviews/review_status.ts";
import { CLI_DEFAULTS } from "./cli.config.ts";
import { McpCommands } from "./commands/mcp_commands.ts";
import { initializeServices, isTestMode as isTestModeImport } from "./init.ts";
import { ICliApplicationContext } from "./cli_context.ts";
import { GitService } from "../services/core/git_service.ts";
import { OutputFormat } from "./memory_types.ts";
import { BINARY_VERSION, WORKSPACE_SCHEMA_VERSION } from "../shared/version.ts";
import {
  DAEMON_IDENTITY_ID,
  DEFAULT_UNKNOWN_ERROR_MESSAGE,
  GIT_CMD_STATUS,
  PORTAL_LABEL,
} from "../shared/constants.ts";

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
  handlePlanApprove,
  handlePlanList,
  handlePlanReject,
  handlePlanRevise,
  handlePlanShow,
  type PlanApproveOptions,
  type PlanListOptions,
} from "./command_builders/plan_actions.ts";

// Allow tests to run the CLI entrypoint without initializing heavy services
export function isTestMode() {
  return isTestModeImport();
}

const CLI_OUTPUT_FORMAT_OPTION = "--format <format:string>";
const CLI_OUTPUT_FORMAT_HELP = "Output format: table, json, md";
const CLI_OUTPUT_FORMAT_DEFAULT = { default: UIOutputFormat.TABLE };
const CLI_OPTION_JSON_HELP = "Output in JSON format";
const DEFAULT_CAPABILITIES_LABEL = "general";
const CLI_LIMIT_OPTION = "-l, --limit <limit:number>";
const CLI_LIMIT_HELP = "Maximum results";
const DISPLAY_CATEGORY_BLUEPRINTS = "blueprints";

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
const portalCommands = new PortalCommands(fullContext);
const blueprintCommands = new BlueprintCommands(fullContext);
const flowCommands = new FlowCommands(fullContext);
const dashboardCommands = new DashboardCommands(fullContext);
const memoryCommands = new MemoryCommands(fullContext);

// Export test helper for unit tests to inspect module-internal context when running in test mode.
export function __test_getContext() {
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
    dashboardCommands,
    memoryCommands,
  };
}

export type ExaCtlTestContext = ReturnType<typeof __test_getContext>;

// Test helper: initialize the heavy services path (same logic used in non-test runtime)
// Returns an object describing whether initialization succeeded and the constructed services.
// Test helper: initialize the heavy services path (same logic used in non-test runtime)
// Returns an object describing whether initialization succeeded and the constructed services.
export function __test_initializeServices(
  opts?: { simulateFail?: boolean; instantiateDb?: boolean; configPath?: string },
) {
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
  renderReviewShowCommits(cs);
  display.info("review.diff", id, { diff: cs.diff });
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
      .option("-m, --model <model:string>", "Named model configuration")
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
        "show <id>",
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
        "show <id>",
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
        "reject <id>",
        new Command()
          .description("Reject a plan with a reason")
          .option("-r, --reason <reason:string>", "Rejection reason (required)", { required: true })
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
        "show <id>",
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
          .option("-r, --reason <reason:string>", "Rejection reason (required)", { required: true })
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
                    db,
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
                    db,
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
            "-t, --template <template:string>",
            "Template (default, coder, reviewer, architect, researcher, gemini, mock)",
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
                template: options.template,
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
          .action(async () => {
            try {
              const blueprints = await blueprintCommands.list();
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
        "validate <agent-id>",
        new Command()
          .description("Validate blueprint format")
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
                "-t, --template <template:string>",
                "Template (default, coder, reviewer, architect, researcher, gemini, mock)",
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
                    template: options.template,
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
              .action(async () => {
                try {
                  const blueprints = await blueprintCommands.list();
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
          .option("-p, --portal <portal:string>", "Filter by portal")
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
          .option("-p, --portal <portal:string>", "Filter by portal")
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
              .option("-p, --portal <portal:string>", "Filter by portal")
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
        "pending",
        new Command()
          .description("Manage pending memory update proposals")
          .option(CLI_OUTPUT_FORMAT_OPTION, CLI_OUTPUT_FORMAT_HELP, CLI_OUTPUT_FORMAT_DEFAULT)
          .action(async (options) => {
            // Default: list pending
            const result = await memoryCommands.pendingList(options.format as OutputFormat);
            console.log(result);
          })
          .command(
            RequestOperation.LIST,
            new Command()
              .description("List all pending proposals")
              .option(CLI_OUTPUT_FORMAT_OPTION, CLI_OUTPUT_FORMAT_HELP, CLI_OUTPUT_FORMAT_DEFAULT)
              .action(async (options) => {
                const result = await memoryCommands.pendingList(options.format as OutputFormat);
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
            "approve <proposalId:string>",
            new Command()
              .description("Approve a pending proposal")
              .action(async (_options, ...args: string[]) => {
                const proposalId = args[0];
                const result = await memoryCommands.pendingApprove(proposalId);
                console.log(result);
              }),
          )
          .command(
            "reject <proposalId:string>",
            new Command()
              .description("Reject a pending proposal")
              .option("-r, --reason <reason:string>", "Rejection reason", { required: true })
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
  .option("--format <format:string>", "Output format (text, table, json)", { default: "text" })
  .option("--distinct <field:string>", "Return distinct values for specified field")
  .option("--count", "Return count aggregation by action_type")
  .option("--payload <pattern:string>", "Filter by payload LIKE pattern")
  .option("--actor <actor:string>", "Filter by actor")
  .option("--target <target:string>", "Filter by target")
  .action(async (options) => {
    const cmd = new JournalCommands(context);
    await cmd.show(options as IJournalCommandOptions);
  });

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

if (!isTestMode()) {
  await __test_command.parse(Deno.args);
  if (services.db && services.db.close) {
    await services.db.close();
  }
}
