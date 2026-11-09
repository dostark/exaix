/**
 * @module PlanActionBuilders
 * @path apps/exactl/src/command_builders/plan_actions.ts
 * @description Provides builders and helper functions for defining plan-related CLI actions and subcommands.
 * @architectural-layer CLI
 * @ungrounded
 * @related-files [apps/exactl/src/exactl.ts, "apps/exactl/src/commands/plan_commands.ts"]
 */

import type { PlanCommands } from "../commands/plan_commands.ts";
import type { IExaCtlColumn } from "@exaix/cli";
import {
  cellText,
  ColumnHeader,
  EMPTY_CELL,
  type ExaCtlOutputRenderer,
  type IJsonRow,
  type IMutationResult,
  toRow,
  TRACE_PREFIX_CHARS,
} from "../output/exactl_output.ts";
import { ExaCtlVerb } from "../exactl_constants.ts";
import { PlanStatus } from "@exaix/core/status";
import { addTokenFields } from "@exaix/cli/command_builders/display_helpers.ts";
import type { JSONValue } from "@exaix/core";
import { DEFAULT_UNKNOWN_ERROR_MESSAGE } from "@exaix/core";
import type { IDisplayService } from "@exaix/core/types";
import { type JSONObject, toSafeJson } from "@exaix/core/types";
import type { IPlanAmendmentPatch } from "@exaix/schemas/plan_amendment.ts";

export interface IPlanActionContext {
  planCommands: PlanCommands;
  display: IDisplayService;
  renderer: ExaCtlOutputRenderer;
}

export interface IPlanListOptions {
  status?: PlanStatus;
}

/** One plan as the list prints it: the stored metadata fields, undefined ones dropped. */
interface IPlanRow {
  [key: string]: JSONValue;
  id: string;
  status: string;
}

const SUBJECT_MAX_CHARS = 50;
const TRUNCATION_MARK = "...";

function truncated(value: string, max: number): string {
  return value.length > max ? `${value.substring(0, max - TRUNCATION_MARK.length)}${TRUNCATION_MARK}` : value;
}

const AMENDMENT_COLUMNS: readonly IExaCtlColumn<IJsonRow>[] = [
  { header: ColumnHeader.ID, value: (plan) => cellText(plan.id) },
  { header: ColumnHeader.STATUS, value: (plan) => cellText(plan.status) },
  { header: ColumnHeader.TRACE, value: (plan) => cellText(plan.trace_id).slice(0, TRACE_PREFIX_CHARS) },
];

const PLAN_COLUMNS: readonly IExaCtlColumn<IPlanRow>[] = [
  { header: ColumnHeader.ID, value: (plan) => plan.id },
  { header: ColumnHeader.STATUS, value: (plan) => plan.status },
  {
    header: ColumnHeader.SUBJECT,
    value: (plan) => truncated(cellText(plan.request_subject ?? plan.subject), SUBJECT_MAX_CHARS),
  },
  { header: ColumnHeader.AGENT, value: (plan) => cellText(plan.request_agent_role ?? plan.agent_role) },
  { header: ColumnHeader.PORTAL, value: (plan) => cellText(plan.request_portal) },
  { header: ColumnHeader.PRIORITY, value: (plan) => cellText(plan.request_priority) },
  {
    header: ColumnHeader.TRACE,
    value: (plan) => typeof plan.trace_id === "string" ? plan.trace_id.substring(0, TRACE_PREFIX_CHARS) : EMPTY_CELL,
  },
];

/** Prints the added, updated, and removed steps of an amendment patch. */
/** The ids decided before a failure, for the error line. */
function decidedField(decided: readonly string[]): Record<string, string> {
  return decided.length === 0 ? {} : { decided: decided.join(", ") };
}

function displayAmendmentChanges(display: IDisplayService, patch: IPlanAmendmentPatch): void {
  if (patch.adds.length > 0) {
    display.info("Adds", "", {});
    patch.adds.forEach((a) => display.info(`+ Step ${a.number}`, a.title, { content: a.content }));
  }
  if (patch.updates.length > 0) {
    display.info("Updates", "", {});
    patch.updates.forEach((u) => display.info(`~ Step ${u.number}`, u.title, { content: u.content }));
  }
  if (patch.removes.length > 0) {
    display.info("Removes", "", { steps: patch.removes.join(", ") });
  }
}

/**
 * Handle plan list action
 */
export async function handlePlanList(context: IPlanActionContext, options: IPlanListOptions): Promise<void> {
  const { planCommands, display, renderer } = context;

  try {
    const plans = await planCommands.list(options.status);
    const rows = plans.map((plan) => toSafeJson({ ...plan }) as IPlanRow);
    await renderer.list(rows, PLAN_COLUMNS, (plan) => plan.id);
  } catch (error) {
    display.error("cli.error", "plan list", {
      message: error instanceof Error ? error.message : DEFAULT_UNKNOWN_ERROR_MESSAGE,
    });
    Deno.exit(1);
  }
}

/**
 * Handle plan show action
 */
export async function handlePlanShow(
  context: IPlanActionContext,
  id: string,
): Promise<void> {
  const { planCommands, display, renderer } = context;

  try {
    const { metadata, content } = await planCommands.show(id);
    if (renderer.machine) {
      await renderer.item(toRow({ ...metadata, content }), []);
      return;
    }
    const displayData: JSONObject = {
      status: metadata.status,
      subject: metadata.subject,
      trace: metadata.trace_id,
    };

    // Add request information if available
    if (metadata.request_id) {
      displayData.request = metadata.request_id;
    }
    if (metadata.request_subject) {
      displayData.request_subject = metadata.request_subject;
    }
    if (metadata.request_agent_role) {
      displayData.agent = metadata.request_agent_role;
    }
    if (metadata.request_portal) {
      displayData.portal = metadata.request_portal;
    }
    if (metadata.request_priority) {
      displayData.priority = metadata.request_priority;
    }
    if (metadata.request_created_by) {
      displayData.created_by = metadata.request_created_by;
    }
    addTokenFields(displayData, metadata);

    display.info("plan.show", metadata.id, toSafeJson(displayData) as Record<string, JSONValue>);
    display.info("plan.content", id, { content: content });
  } catch (error) {
    display.error("cli.error", "plan show", {
      message: error instanceof Error ? error.message : DEFAULT_UNKNOWN_ERROR_MESSAGE,
    });
    Deno.exit(1);
  }
}

const AMENDMENT_SHOW_COLUMNS: readonly IExaCtlColumn<IJsonRow>[] = [
  { header: ColumnHeader.ID, value: (amendment) => cellText(amendment.id) },
  { header: "Amendment", value: (amendment) => cellText(amendment.amendmentId) },
  { header: ColumnHeader.SUMMARY, value: (amendment) => cellText(amendment.summary) },
];

async function emitAmendments(renderer: ExaCtlOutputRenderer, rows: readonly IJsonRow[], bulk: boolean): Promise<void> {
  if (bulk) await renderer.list(rows, AMENDMENT_SHOW_COLUMNS, (amendment) => cellText(amendment.id));
  else await renderer.item(rows[0], AMENDMENT_SHOW_COLUMNS);
}

function decision(id: string, action: ExaCtlVerb, status: string): IMutationResult {
  return { id, action, status };
}

/**
 * Approves the ids in order with one decision call each. The first failure prints the ids already decided and exits 1.
 */
async function approveInOrder(
  context: IPlanActionContext,
  label: string,
  ids: readonly string[],
  approveOne: (id: string) => Promise<void>,
): Promise<void> {
  const decided: string[] = [];
  try {
    for (const id of ids) {
      await approveOne(id);
      decided.push(id);
    }
    await context.renderer.mutation(
      decided.map((id) => decision(id, ExaCtlVerb.APPROVE, PlanStatus.APPROVED)),
      ids.length !== 1,
    );
  } catch (error) {
    context.display.error("cli.error", label, {
      message: error instanceof Error ? error.message : DEFAULT_UNKNOWN_ERROR_MESSAGE,
      ...decidedField(decided),
    });
    Deno.exit(1);
  }
}

/**
 * Handle plan approve action. The ids are approved in order and the first failure stops the run.
 */
export function handlePlanApprove(context: IPlanActionContext, ids: readonly string[]): Promise<void> {
  return approveInOrder(context, "plan approve", ids, (id) => context.planCommands.approve(id));
}

/**
 * Handle plan approve all action
 */
export async function handlePlanApproveAll(context: IPlanActionContext): Promise<void> {
  const { planCommands, display, renderer } = context;

  try {
    const inReview = await planCommands.list(PlanStatus.REVIEW);
    await planCommands.approveAll();
    await renderer.mutation(inReview.map((plan) => decision(plan.id, ExaCtlVerb.APPROVE, PlanStatus.APPROVED)), true);
  } catch (error) {
    display.error("cli.error", "plan approve --all", {
      message: error instanceof Error ? error.message : DEFAULT_UNKNOWN_ERROR_MESSAGE,
    });
    Deno.exit(1);
  }
}

/**
 * Handle plan reject action
 */
export async function handlePlanReject(
  context: IPlanActionContext,
  id: string,
  reason: string,
): Promise<void> {
  const { planCommands, display, renderer } = context;

  try {
    await planCommands.reject(id, reason);
    await renderer.mutation([decision(id, ExaCtlVerb.REJECT, PlanStatus.REJECTED)], false);
  } catch (error) {
    display.error("cli.error", "plan reject", {
      message: error instanceof Error ? error.message : DEFAULT_UNKNOWN_ERROR_MESSAGE,
    });
    Deno.exit(1);
  }
}

/**
 * Handle plan revise action
 */
export async function handlePlanRevise(
  context: IPlanActionContext,
  id: string,
  comments: string[],
): Promise<void> {
  const { planCommands, display, renderer } = context;

  try {
    await planCommands.revise(id, comments);
    await renderer.mutation([decision(id, ExaCtlVerb.REVISE, PlanStatus.NEEDS_REVISION)], false);
  } catch (error) {
    display.error("cli.error", "plan revise", {
      message: error instanceof Error ? error.message : DEFAULT_UNKNOWN_ERROR_MESSAGE,
    });
    Deno.exit(1);
  }
}

/**
 * Handle plan amendment list action
 */
export async function handlePlanAmendmentList(
  context: IPlanActionContext,
): Promise<void> {
  const { planCommands, display, renderer } = context;

  try {
    const plans = await planCommands.listAmendments();
    await renderer.list(plans.map((plan) => toRow({ ...plan })), AMENDMENT_COLUMNS, (plan) => String(plan.id));
  } catch (error) {
    display.error("cli.error", "plan amendment list", {
      message: error instanceof Error ? error.message : DEFAULT_UNKNOWN_ERROR_MESSAGE,
    });
    Deno.exit(1);
  }
}

/**
 * Handle plan amendment show action. The ids are shown in order and the first failure stops the run.
 */
export async function handlePlanAmendmentShow(
  context: IPlanActionContext,
  ids: readonly string[],
): Promise<void> {
  const { planCommands, display, renderer } = context;
  const decided: string[] = [];
  const shown: IJsonRow[] = [];

  try {
    for (const id of ids) {
      const patch = await planCommands.getAmendment(id);
      shown.push(toRow({ id, ...patch }));
      display.info("plan.amendment.show", id, {
        amendment_id: patch.amendmentId,
        summary: patch.summary,
        affected_steps: patch.affectedRemainingStepIds.length,
        created_at: patch.createdAt,
      });

      displayAmendmentChanges(display, patch);
      decided.push(id);
    }
    if (renderer.machine) await emitAmendments(renderer, shown, ids.length !== 1);
  } catch (error) {
    display.error("cli.error", "plan amendment show", {
      message: error instanceof Error ? error.message : DEFAULT_UNKNOWN_ERROR_MESSAGE,
      ...decidedField(decided),
    });
    Deno.exit(1);
  }
}

/**
 * Handle plan amendment approve action. The ids are approved in order and the first failure stops the run.
 */
export function handlePlanAmendmentApprove(context: IPlanActionContext, ids: readonly string[]): Promise<void> {
  return approveInOrder(context, "plan amendment approve", ids, async (id) => {
    await context.planCommands.approveAmendment(id);
    context.display.info("plan.amendment.approved", id, {
      message: "Amendment approved and applied. Plan status updated to 'approved'.",
    });
  });
}

/**
 * Handle plan amendment reject action
 */
export async function handlePlanAmendmentReject(
  context: IPlanActionContext,
  id: string,
  reason: string,
): Promise<void> {
  const { planCommands, display, renderer } = context;

  try {
    await planCommands.rejectAmendment(id, reason);
    display.info("plan.amendment.rejected", id, { message: "Amendment rejected and execution aborted." });
    await renderer.mutation([decision(id, ExaCtlVerb.REJECT, PlanStatus.REJECTED)], false);
  } catch (error) {
    display.error("cli.error", "plan amendment reject", {
      message: error instanceof Error ? error.message : DEFAULT_UNKNOWN_ERROR_MESSAGE,
    });
    Deno.exit(1);
  }
}

/**
 * Handle plan amendment approve all action
 */
export async function handlePlanAmendmentApproveAll(
  context: IPlanActionContext,
): Promise<void> {
  const { planCommands, display, renderer } = context;

  try {
    const pending = await planCommands.listAmendments();
    await planCommands.approveAllAmendments();
    await renderer.mutation(pending.map((plan) => decision(plan.id, ExaCtlVerb.APPROVE, PlanStatus.APPROVED)), true);
  } catch (error) {
    display.error("cli.error", "plan amendment approve --all", {
      message: error instanceof Error ? error.message : DEFAULT_UNKNOWN_ERROR_MESSAGE,
    });
    Deno.exit(1);
  }
}

/**
 * Handle plan amendment show all action
 */
export async function handlePlanAmendmentShowAll(
  context: IPlanActionContext,
): Promise<void> {
  const { planCommands, display, renderer } = context;

  try {
    const amendments = await planCommands.getAmendments();
    if (renderer.machine) {
      await emitAmendments(renderer, amendments.map(({ id, patch }) => toRow({ id, ...patch })), true);
      return;
    }
    if (amendments.length === 0) {
      display.info("plan.amendment.show_all", "none", { message: "No pending amendments found" });
      return;
    }

    display.info("plan.amendment.show_all", "starting", { count: amendments.length });
    for (const { id, patch } of amendments) {
      display.info("Proposed Amendment", id, {
        amendment_id: patch.amendmentId,
        summary: patch.summary,
        affected_steps: patch.affectedRemainingStepIds.length,
      });

      displayAmendmentChanges(display, patch);
    }
  } catch (error) {
    display.error("cli.error", "plan amendment show --all", {
      message: error instanceof Error ? error.message : DEFAULT_UNKNOWN_ERROR_MESSAGE,
    });
    Deno.exit(1);
  }
}
