/**
 * @module ApprovalSources
 * @path apps/exactl/src/commands/approval_sources.ts
 * @description One source per kind of pending human decision. Each source reads its owner command and maps the items to approval rows.
 * @architectural-layer CLI
 * @dependencies [apps/exactl/src/commands/approval_id.ts, apps/exactl/src/commands/plan_commands.ts, apps/exactl/src/commands/review_commands.ts, apps/exactl/src/commands/request_commands.ts, apps/exactl/src/commands/memory_approval_reader.ts]
 * @related-files [apps/exactl/src/commands/approval_commands.ts, apps/exactl/src/exactl.ts]
 */

import { PlanStatus, RequestStatus, ReviewStatus } from "@exaix/core/status";
import type { Opt, Reason } from "@exaix/core/types";
import type { MemoryApprovalReader } from "./memory_approval_reader.ts";
import type { PlanCommands } from "./plan_commands.ts";
import type { RequestCommands } from "./request_commands.ts";
import type { ReviewCommands } from "./review_commands.ts";
import type { ToolCommands } from "./tool_commands.ts";
import type { WaitStateCommands } from "./wait_state_commands.ts";
import { quoteArgument } from "../exactl_shell.ts";
import { ApprovalKind } from "./approval_id.ts";

export interface IApprovalListEntry {
  readonly kind: ApprovalKind;
  /** Typed id printed to the user: `${kind}:${id}`. */
  readonly ref: string;
  readonly summary: string;
  /** ISO timestamp. Empty when the item records none. */
  readonly created_at: string;
  readonly trace_id: Opt<string, Reason.TraceAbsent>;
  /** Exact command that decides this item. */
  readonly act: string;
  /** The schema kind of a wait row. Other rows leave it unset. */
  readonly wait_kind?: Opt<string, Reason.OptionalContext>;
}

export interface IApprovalSource {
  readonly kind: ApprovalKind;
  /** Rows in `status`. Every source except `wait` lists nothing for a status other than pending. */
  list(status: string): Promise<IApprovalListEntry[]>;
}

/** The plan reads that the plan and amendment sources need. */
export interface IPlanApprovalReader {
  list: PlanCommands["list"];
  listAmendments: PlanCommands["listAmendments"];
}

/** The memory reads that the proposal and skill sources need. */
export interface IMemoryApprovalReader {
  listPendingProposals: MemoryApprovalReader["listPendingProposals"];
  listDraftSkills: MemoryApprovalReader["listDraftSkills"];
}

/** The commands that own each pending decision. */
export interface IApprovalReaders {
  readonly plans: IPlanApprovalReader;
  readonly reviews: Pick<ReviewCommands, "list">;
  readonly requests: Pick<RequestCommands, "list">;
  readonly memory: IMemoryApprovalReader;
  readonly waitStates: Pick<WaitStateCommands, "list">;
  readonly tools: Pick<ToolCommands, "listPending">;
}

export const APPROVAL_PENDING_STATUS = "pending";
export const WAIT_KIND_CLARIFICATION = "clarification";

const ACT_PREFIX = "exactl";
const APPROVE_WAIT_OR_TOOL = `${ACT_PREFIX} approval approve`;
const REQUEST_FILE_SUFFIX = /\.md$/;
const WHITESPACE = /\s+/g;

function oneLine(text: string): string {
  return text.replace(WHITESPACE, " ").trim();
}

function pendingOnly(kind: ApprovalKind, load: () => Promise<IApprovalListEntry[]>): IApprovalSource {
  return {
    kind,
    list: (status) => status === APPROVAL_PENDING_STATUS ? load() : Promise.resolve([]),
  };
}

export function waitApprovalSource(waitStates: IApprovalReaders["waitStates"]): IApprovalSource {
  return {
    kind: ApprovalKind.WAIT,
    list: async (status) =>
      (await waitStates.list(status)).map((wait) => ({
        kind: ApprovalKind.WAIT,
        ref: `${ApprovalKind.WAIT}:${wait.resumeToken}`,
        summary: `${wait.kind} ${wait.status}`,
        created_at: wait.createdAt,
        trace_id: wait.traceId,
        act: `${APPROVE_WAIT_OR_TOOL} ${ApprovalKind.WAIT}:${wait.resumeToken}`,
        wait_kind: wait.kind,
      })),
  };
}

export function toolApprovalSource(tools: IApprovalReaders["tools"]): IApprovalSource {
  return pendingOnly(ApprovalKind.TOOL, async () =>
    (await tools.listPending()).map((tool) => ({
      kind: ApprovalKind.TOOL,
      ref: `${ApprovalKind.TOOL}:${tool.id}`,
      summary: oneLine(`${tool.toolName} ${tool.stepId ?? ""}`),
      created_at: tool.requestedAt,
      trace_id: tool.traceId,
      act: `${APPROVE_WAIT_OR_TOOL} ${ApprovalKind.TOOL}:${tool.id}`,
    })));
}

function planSource(plans: IApprovalReaders["plans"]): IApprovalSource {
  return pendingOnly(ApprovalKind.PLAN, async () =>
    (await plans.list(PlanStatus.REVIEW)).map((plan) => ({
      kind: ApprovalKind.PLAN,
      ref: `${ApprovalKind.PLAN}:${plan.id}`,
      summary: oneLine(plan.subject ?? plan.request_subject ?? plan.id),
      created_at: plan.created_at ?? "",
      trace_id: plan.trace_id,
      act: `${ACT_PREFIX} plan approve ${quoteArgument(plan.id)}`,
    })));
}

function amendmentSource(plans: IApprovalReaders["plans"]): IApprovalSource {
  return pendingOnly(ApprovalKind.AMENDMENT, async () =>
    (await plans.listAmendments()).map((plan) => ({
      kind: ApprovalKind.AMENDMENT,
      ref: `${ApprovalKind.AMENDMENT}:${plan.id}`,
      summary: oneLine(plan.subject ?? plan.request_subject ?? plan.id),
      created_at: plan.created_at ?? "",
      trace_id: plan.trace_id,
      act: `${ACT_PREFIX} plan amendment approve ${quoteArgument(plan.id)}`,
    })));
}

function reviewSource(reviews: IApprovalReaders["reviews"]): IApprovalSource {
  return pendingOnly(ApprovalKind.REVIEW, async () =>
    (await reviews.list(ReviewStatus.PENDING)).map((review) => ({
      kind: ApprovalKind.REVIEW,
      ref: `${ApprovalKind.REVIEW}:${review.branch}`,
      summary: oneLine(review.request_subject ?? review.subject ?? review.branch),
      created_at: review.created_at,
      trace_id: review.trace_id,
      act: `${ACT_PREFIX} review approve ${quoteArgument(review.branch)}`,
    })));
}

/** The ref of a clarification is the request filename without `.md`, the id `request clarify` accepts. */
function clarificationSource(requests: IApprovalReaders["requests"]): IApprovalSource {
  return pendingOnly(ApprovalKind.CLARIFICATION, async () =>
    (await requests.list(RequestStatus.NEEDS_CLARIFICATION))
      .filter((request) => request.error === undefined)
      .map((request) => {
        const stem = request.filename.replace(REQUEST_FILE_SUFFIX, "");
        return {
          kind: ApprovalKind.CLARIFICATION,
          ref: `${ApprovalKind.CLARIFICATION}:${stem}`,
          summary: oneLine(request.subject ?? stem),
          created_at: request.created,
          trace_id: request.trace_id,
          act: `${ACT_PREFIX} request clarify ${quoteArgument(stem)}`,
        };
      }));
}

function proposalSource(memory: IApprovalReaders["memory"]): IApprovalSource {
  return pendingOnly(ApprovalKind.PROPOSAL, async () =>
    (await memory.listPendingProposals()).map((proposal) => ({
      kind: ApprovalKind.PROPOSAL,
      ref: `${ApprovalKind.PROPOSAL}:${proposal.id}`,
      summary: oneLine(`${proposal.operation} ${proposal.learning.title}`),
      created_at: proposal.created_at,
      trace_id: proposal.execution_id,
      act: `${ACT_PREFIX} memory proposal approve ${quoteArgument(proposal.id)}`,
    })));
}

/** Draft skills visible with no portal context. A portal-scoped draft appears through `skill list --portal`. */
function skillSource(memory: IApprovalReaders["memory"]): IApprovalSource {
  return pendingOnly(ApprovalKind.SKILL, async () =>
    (await memory.listDraftSkills(undefined)).map((skill) => ({
      kind: ApprovalKind.SKILL,
      ref: `${ApprovalKind.SKILL}:${skill.skill_id}`,
      summary: oneLine(skill.title),
      created_at: "",
      trace_id: undefined,
      act: `${ACT_PREFIX} skill approve ${quoteArgument(skill.skill_id)} --revision ${quoteArgument(skill.id)}`,
    })));
}

/** All eight sources of pending human decisions. */
export function createApprovalSources(readers: IApprovalReaders): IApprovalSource[] {
  return [
    planSource(readers.plans),
    amendmentSource(readers.plans),
    reviewSource(readers.reviews),
    clarificationSource(readers.requests),
    proposalSource(readers.memory),
    skillSource(readers.memory),
    waitApprovalSource(readers.waitStates),
    toolApprovalSource(readers.tools),
  ];
}
