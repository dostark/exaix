/**
 * @module ExaCtlReviewCommand
 * @path apps/exactl/src/command_builders/review_command.ts
 * @description Builds the exactl review command tree from the shared runtime services.
 * @architectural-layer CLI
 * @related-files [apps/exactl/src/exactl.ts, apps/exactl/src/exactl_runtime.ts]
 */

import { toExaCtlError } from "./command_failure.ts";
import { Command } from "@cliffy/command";
import { formatLintSummary, type IReviewDetails, verificationWarning } from "../commands/review_commands.ts";
import { RequestOperation, RequestPriority } from "@exaix/core";
import { ReviewStatus } from "@exaix/core/status";
import type { Opt, Reason } from "@exaix/core/types";
import type { IReviewStatus } from "@exaix/core/status";
import type { IExaCtlRuntime } from "../exactl_runtime.ts";
import { CLI_OPTION_REASON, ExaCtlCommandName, ExaCtlVerb } from "../exactl_constants.ts";
import { ExaCtlOutputFormat, type IExaCtlColumn } from "@exaix/cli";
import { documentLeaves } from "./documented_children.ts";
import { documentedNoun } from "../docs/exactl_noun_doc.ts";
import { nounDocFor } from "../command_docs/mod.ts";
import {
  actionOutput,
  cellText,
  ColumnHeader,
  type IJsonRow,
  stripTerminalControls,
  toRow,
  TRACE_PREFIX_CHARS,
} from "../output/exactl_output.ts";

const REVIEW_ID_ARGUMENT = "<review-id>";

const REVIEW_COLUMNS: readonly IExaCtlColumn<IJsonRow>[] = [
  { header: ColumnHeader.REQUEST, value: (review) => cellText(review.request_id) },
  { header: ColumnHeader.STATUS, value: (review) => cellText(review.status) },
  { header: ColumnHeader.BRANCH, value: (review) => cellText(review.branch) },
  { header: ColumnHeader.SUBJECT, value: (review) => cellText(review.request_subject ?? review.subject) },
  { header: ColumnHeader.TYPE, value: (review) => cellText(review.type) },
  { header: "Files", value: (review) => String(review.files_changed ?? 0) },
  { header: ColumnHeader.TRACE, value: (review) => cellText(review.trace_id).slice(0, TRACE_PREFIX_CHARS) },
];

function createReviewCommand(runtime: IExaCtlRuntime) {
  const { display, reviewCommands } = runtime;
  async function handleReviewListAction(options: { status?: string; type?: string }) {
    const { renderer } = actionOutput(runtime, options, ExaCtlOutputFormat.TABLE);
    try {
      const reviews = await reviewCommands.list(options.status, options.type);
      await renderer.list(
        reviews.map((review) => toRow({ ...review })),
        REVIEW_COLUMNS,
        (review) => cellText(review.request_id),
      );
    } catch (error) {
      throw toExaCtlError(error);
    }
  }

  async function handleReviewShowAction(options: { diff?: boolean }, id: string) {
    const { renderer } = actionOutput(runtime, options, ExaCtlOutputFormat.TEXT);
    try {
      const cs = await reviewCommands.show(id);
      if (renderer.machine) {
        await renderer.item(toRow(options.diff ? { diff: cs.diff } : { ...cs }), []);
        return;
      }
      if (options.diff) {
        await renderer.text(stripTerminalControls(cs.diff));
        return;
      }
      renderReviewShow(cs, id);
    } catch (error) {
      throw toExaCtlError(error);
    }
  }

  function getReviewStatusEmoji(status: Opt<IReviewStatus, Reason.OptionalInput>): string {
    if (status === ReviewStatus.APPROVED) return "✅";
    if (status === ReviewStatus.REJECTED) return "❌";
    return "📌";
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
  const noun = nounDocFor(ExaCtlCommandName.REVIEW);
  const command = documentedNoun(new Command(), noun)
    .command(
      RequestOperation.LIST,
      new Command()
        .option("-s, --status <status:string>", "Filter by status (pending, approved, rejected)")
        .option("--type <type:string>", "Filter by type (code, artifact, all)", { default: "all" })
        .action(async (options) => await handleReviewListAction(options)),
    )
    .command(
      `${ExaCtlVerb.SHOW} ${REVIEW_ID_ARGUMENT}`,
      new Command()
        .option("--diff", "Show only the diff for the review")
        .action(async (options, ...args: string[]) => await handleReviewShowAction(options, args[0] as string)),
    )
    .command(
      `${ExaCtlVerb.APPROVE} ${REVIEW_ID_ARGUMENT}`,
      new Command()
        .action(async (options, ...args: string[]) => {
          const id = args[0];
          const { renderer } = actionOutput(runtime, options, ExaCtlOutputFormat.TEXT);
          try {
            await reviewCommands.approve(id);
            await renderer.mutation([{ id, action: ExaCtlVerb.APPROVE, status: ReviewStatus.APPROVED }], false);
          } catch (error) {
            throw toExaCtlError(error);
          }
        }),
    )
    .command(
      `${ExaCtlVerb.REJECT} ${REVIEW_ID_ARGUMENT}`,
      new Command()
        .option(CLI_OPTION_REASON, "Rejection reason (required)", { required: true })
        .action(async (options, ...args: string[]) => {
          const id = args[0];
          try {
            await reviewCommands.reject(id, options.reason);
            await actionOutput(runtime, options, ExaCtlOutputFormat.TEXT).renderer.mutation(
              [{ id, action: ExaCtlVerb.REJECT, status: ReviewStatus.REJECTED }],
              false,
            );
          } catch (error) {
            throw toExaCtlError(error);
          }
        }),
    );
  documentLeaves(command, [ExaCtlCommandName.REVIEW], noun.lifecycle);
  return command;
}

export function buildReviewCommand(runtime: IExaCtlRuntime): ReturnType<typeof createReviewCommand> {
  return createReviewCommand(runtime);
}
