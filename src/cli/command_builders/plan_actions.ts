/**
 * @module PlanActionBuilders
 * @path src/cli/command_builders/plan_actions.ts
 * @description Provides builders and helper functions for defining plan-related CLI actions and subcommands.
 * @architectural-layer CLI
 * @related-files [src/cli/exactl.ts, "src/cli/commands/plan_commands.ts"]
 */

import type { PlanCommands } from "../commands/plan_commands.ts";
import { addTokenFields } from "./display_helpers.ts";
import type { JSONValue } from "@exaix/core";
import type { PlanStatus } from "@exaix/core/status";
import { DEFAULT_UNKNOWN_ERROR_MESSAGE } from "@exaix/core";
import type { IDisplayService } from "@exaix/core/types";
import { type JSONObject, toSafeJson } from "@exaix/core/types";

export interface IPlanActionContext {
  planCommands: PlanCommands;
  display: IDisplayService;
}

export interface PlanListOptions {
  status?: PlanStatus;
}

export interface PlanApproveOptions {
  skills?: string;
}

/**
 * Handle plan list action
 */
export async function handlePlanList(
  context: IPlanActionContext,
  options: PlanListOptions,
): Promise<void> {
  const { planCommands, display } = context;

  try {
    const plans = await planCommands.list(options.status);
    if (plans.length === 0) {
      display.info("plan.list", "plans", { count: 0, message: "No plans found" });
      return;
    }
    display.info("plan.list", "plans", { count: plans.length });
    for (const plan of plans) {
      const statusIcon = plan.status === "review" ? "🔍" : "⚠️";
      const displayData: JSONObject = {
        status: plan.status,
        trace: plan.trace_id ? `${plan.trace_id.substring(0, 8)}...` : undefined,
      };

      // Add request information if available
      if (plan.request_subject) {
        displayData.request = plan.request_subject.length > 50
          ? `${plan.request_subject.substring(0, 47)}...`
          : plan.request_subject;
      }
      if (plan.request_identity) {
        displayData.agent = plan.request_identity;
      }
      if (plan.request_portal) {
        displayData.portal = plan.request_portal;
      }
      if (plan.request_priority) {
        displayData.priority = plan.request_priority;
      }

      const subjectTag = plan.subject ? `[${plan.subject}] ` : "";
      display.info(
        `${statusIcon} ${subjectTag}${plan.id}`,
        plan.id,
        toSafeJson(displayData) as Record<string, JSONValue>,
      );
    }
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
    if (metadata.request_identity) {
      displayData.agent = metadata.request_identity;
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
 * Handle plan approve action
 */
export async function handlePlanApprove(
  context: IPlanActionContext,
  id: string,
  options: PlanApproveOptions,
): Promise<void> {
  const { planCommands, display } = context;

  try {
    await planCommands.approve(
      id,
      options.skills ? options.skills.split(",").map((s: string) => s.trim()) : undefined,
    );
  } catch (error) {
    display.error("cli.error", "plan approve", {
      message: error instanceof Error ? error.message : DEFAULT_UNKNOWN_ERROR_MESSAGE,
    });
    Deno.exit(1);
  }
}

/**
 * Handle plan approve all action
 */
export async function handlePlanApproveAll(
  context: IPlanActionContext,
  options: PlanApproveOptions,
): Promise<void> {
  const { planCommands, display } = context;

  try {
    await planCommands.approveAll(
      options.skills ? options.skills.split(",").map((s: string) => s.trim()) : undefined,
    );
  } catch (error) {
    display.error("cli.error", "plan approve-all", {
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
 * Handle plan amendment show action
 */
export async function handlePlanAmendmentShow(
  context: IPlanActionContext,
  id: string,
): Promise<void> {
  const { planCommands, display } = context;

  try {
    const patch = await planCommands.getAmendment(id);
    display.info("plan.amendment.show", id, {
      amendment_id: patch.amendmentId,
      summary: patch.summary,
      affected_steps: patch.affectedRemainingStepIds.length,
      created_at: patch.createdAt,
    });

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
  } catch (error) {
    display.error("cli.error", "plan amendment show", {
      message: error instanceof Error ? error.message : DEFAULT_UNKNOWN_ERROR_MESSAGE,
    });
    Deno.exit(1);
  }
}

/**
 * Handle plan amendment approve action
 */
export async function handlePlanAmendmentApprove(
  context: IPlanActionContext,
  id: string,
): Promise<void> {
  const { planCommands, display } = context;

  try {
    await planCommands.approveAmendment(id);
    display.info("plan.amendment.approved", id, {
      message: "Amendment approved and applied. Plan status updated to 'approved'.",
    });
  } catch (error) {
    display.error("cli.error", "plan amendment approve", {
      message: error instanceof Error ? error.message : DEFAULT_UNKNOWN_ERROR_MESSAGE,
    });
    Deno.exit(1);
  }
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
    display.error("cli.error", "plan amendment approve-all", {
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
  } catch (error) {
    display.error("cli.error", "plan amendment show-all", {
      message: error instanceof Error ? error.message : DEFAULT_UNKNOWN_ERROR_MESSAGE,
    });
    Deno.exit(1);
  }
}
