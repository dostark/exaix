/**
 * @module ExaCtlReviewCommand
 * @path apps/exactl/src/command_builders/review_command.ts
 * @description Builds the exactl review command tree from the shared runtime services.
 * @architectural-layer CLI
 * @related-files [apps/exactl/src/exactl.ts, apps/exactl/src/exactl_runtime.ts]
 */

import { Command } from "@cliffy/command";
import {
  formatLintSummary,
  type IReviewDetails,
  type IReviewMetadata,
  verificationWarning,
} from "../commands/review_commands.ts";
import { DEFAULT_UNKNOWN_ERROR_MESSAGE, RequestOperation, RequestPriority } from "@exaix/core";
import { ReviewStatus } from "@exaix/core/status";
import type { Opt, Reason } from "@exaix/core/types";
import type { IReviewStatus } from "@exaix/core/status";
import type { IExaCtlRuntime } from "../exactl_runtime.ts";
import { CLI_CMD_SHOW_ID, CLI_OPTION_REASON } from "../exactl_constants.ts";

function createReviewCommand(runtime: IExaCtlRuntime) {
  const { display, reviewCommands } = runtime;
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
    const agentInfo = cs.request_agent_role || cs.agent_role;
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

  function getReviewStatusEmoji(status: Opt<IReviewStatus, Reason.OptionalInput>): string {
    if (status === ReviewStatus.APPROVED) return "✅";
    if (status === ReviewStatus.REJECTED) return "❌";
    return "📌";
  }

  function formatTraceShort(traceId: Opt<string, Reason.TraceAbsent>): string | null {
    if (!traceId) return null;
    return `${traceId.substring(0, 8)}...`;
  }

  function renderReviewShow(cs: IReviewDetails, id: string) {
    renderReviewShowSummary(cs);
    renderReviewShowVerificationWarning(cs, id);
    renderReviewShowLint(cs, id);
    renderReviewShowDecision(cs);
    renderReviewShowAnomalies(cs);
    renderReviewShowCommits(cs);
    display.info("review.diff", id, { diff: cs.diff });
  }

  function renderReviewShowVerificationWarning(cs: IReviewDetails, id: string) {
    const warning = verificationWarning(cs.verification_status);
    if (!warning) return;
    display.warn("review.verification", id, { verification_status: cs.verification_status ?? null, message: warning });
  }

  function renderReviewShowLint(cs: IReviewDetails, id: string) {
    if (cs.lint === undefined) return;
    for (const line of formatLintSummary(cs.lint)) {
      display.info("review.lint", id, { line });
    }
  }

  function renderReviewShowAnomalies(cs: IReviewDetails) {
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

  function renderReviewShowSummary(cs: IReviewDetails) {
    const statusEmoji = getReviewStatusEmoji(cs.status);
    const requestTitle = cs.request_subject ? `"${cs.request_subject}"` : "Untitled Request";
    const planInfo = cs.plan_id ? `${cs.plan_id} (${cs.plan_status})` : "unknown";
    const agentInfo = cs.request_agent_role || cs.agent_role;
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
      verification: cs.verification_status ?? null,
    });
  }

  function renderReviewShowDecision(cs: IReviewDetails) {
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

  function renderReviewShowCommits(cs: IReviewDetails) {
    display.info("commits", "", {});
    for (const commit of cs.commits) {
      display.info("commit", commit.sha.substring(0, 8), {
        message: commit.message,
        timestamp: new Date(commit.timestamp).toLocaleString(),
      });
    }
  }
  return new Command()
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
    );
}

export function buildReviewCommand(runtime: IExaCtlRuntime): ReturnType<typeof createReviewCommand> {
  return createReviewCommand(runtime);
}
