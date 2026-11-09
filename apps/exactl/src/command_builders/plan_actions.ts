/**
 * @module PlanActionBuilders
 * @path apps/exactl/src/command_builders/plan_actions.ts
 * @description Provides builders and helper functions for defining plan-related CLI actions and subcommands.
 * @architectural-layer CLI
 * @ungrounded
 * @related-files [apps/exactl/src/exactl.ts, "apps/exactl/src/commands/plan_commands.ts"]
 */

import type { PlanCommands } from "../commands/plan_commands.ts";
import type { IExaCtlColumn, IExaCtlOutputRenderer } from "@exaix/cli";
import { EMPTY_CELL } from "../output/exactl_output.ts";
import { addTokenFields } from "@exaix/cli/command_builders/display_helpers.ts";
import type { JSONValue } from "@exaix/core";
import type { PlanStatus } from "@exaix/core/status";
import { DEFAULT_UNKNOWN_ERROR_MESSAGE } from "@exaix/core";
import type { IDisplayService, Opt, Reason } from "@exaix/core/types";
import { type JSONObject, toSafeJson } from "@exaix/core/types";
import type { IPlanAmendmentPatch } from "@exaix/schemas/plan_amendment.ts";

export interface IPlanActionContext {
  planCommands: PlanCommands;
  display: IDisplayService;
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

const TRACE_PREFIX_CHARS = 8;
const SUBJECT_MAX_CHARS = 50;
const TRUNCATION_MARK = "...";

function text(value: Opt<JSONValue, Reason.OptionalInput>): string {
  return typeof value === "string" && value !== "" ? value : EMPTY_CELL;
}

function truncated(value: string, max: number): string {
  return value.length > max ? `${value.substring(0, max - TRUNCATION_MARK.length)}${TRUNCATION_MARK}` : value;
}

const PLAN_COLUMNS: readonly IExaCtlColumn<IPlanRow>[] = [
  { header: "ID", value: (plan) => plan.id },
  { header: "Status", value: (plan) => plan.status },
  { header: "Subject", value: (plan) => truncated(text(plan.request_subject ?? plan.subject), SUBJECT_MAX_CHARS) },
  { header: "Agent", value: (plan) => text(plan.request_agent_role ?? plan.agent_role) },
  { header: "Portal", value: (plan) => text(plan.request_portal) },
  { header: "Priority", value: (plan) => text(plan.request_priority) },
  {
    header: "Trace",
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
export async function handlePlanList(
  context: IPlanActionContext,
  options: IPlanListOptions,
  renderer: IExaCtlOutputRenderer,
): Promise<void> {
  const { planCommands, display } = context;

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
  const { planCommands, display } = context;

  try {
    const { metadata, content } = await planCommands.show(id);
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
  const { planCommands, display } = context;

  try {
    await planCommands.approveAll();
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
  const { planCommands, display } = context;

  try {
    await planCommands.reject(id, reason);
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
  const { planCommands, display } = context;

  try {
    await planCommands.revise(id, comments);
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
  const { planCommands, display } = context;

  try {
    const plans = await planCommands.listAmendments();
    if (plans.length === 0) {
      display.info("plan.amendment.list", "amendments", { count: 0, message: "No pending amendments found" });
      return;
    }
    display.info("plan.amendment.list", "amendments", { count: plans.length });
    for (const plan of plans) {
      display.info(`⚠️ amendment_pending: ${plan.id}`, plan.id, {
        trace: plan.trace_id ? `${plan.trace_id.substring(0, 8)}...` : undefined,
      });
    }
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
  const { planCommands, display } = context;
  const decided: string[] = [];

  try {
    for (const id of ids) {
      const patch = await planCommands.getAmendment(id);
      display.info("plan.amendment.show", id, {
        amendment_id: patch.amendmentId,
        summary: patch.summary,
        affected_steps: patch.affectedRemainingStepIds.length,
        created_at: patch.createdAt,
      });

      displayAmendmentChanges(display, patch);
      decided.push(id);
    }
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
  const { planCommands, display } = context;

  try {
    await planCommands.rejectAmendment(id, reason);
    display.info("plan.amendment.rejected", id, { message: "Amendment rejected and execution aborted." });
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
  const { planCommands, display } = context;

  try {
    await planCommands.approveAllAmendments();
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
  const { planCommands, display } = context;

  try {
    const amendments = await planCommands.getAmendments();
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
