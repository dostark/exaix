/**
 * @module RejectedPlanHandler
 * @path packages/request/src/rejected_plan_handler.ts
 * @description Handles plan-processing errors: on PlanValidationError, persists
 * a rejected-plan artifact to Workspace/Rejected/ for debugging and records its
 * path in the request frontmatter; for all errors, marks the request FAILED.
 * Extracted from RequestProcessor (god-object decomposition,
 * .copilot/skills/refactor/SKILL.md step d) since this logic depends only on
 * config and statusManager — no other RequestProcessor field.
 * @architectural-layer Services
 * @related-files ["packages/request/src/processor.ts"]
 */
import { join } from "@std/path";
import type { Config } from "@exaix/schemas/config.ts";
import { PlanValidationError } from "@exaix/core/planning";
import { RequestStatus } from "@exaix/core/status";
import { PlanStatus } from "@exaix/core/status";
import { DomainEventType } from "@exaix/core/events";
import type { IEventLogger } from "@exaix/core/logger";
import type { IRequestFrontmatter } from "@exaix/core/request";
import type { Opt, Reason } from "@exaix/core/types";
import type { StatusManager } from "./processing/status.ts";

export interface IRejectedPlanHandlerDeps {
  config: Config;
  statusManager: StatusManager;
}

export interface IRejectedPlanHandler {
  handleError(
    error: Error | string | unknown,
    filePath: string,
    requestId: string,
    traceLogger: IEventLogger,
    frontmatter?: Opt<IRequestFrontmatter, Reason.OptionalInput>,
  ): Promise<void>;
}

export class RejectedPlanHandler implements IRejectedPlanHandler {
  private readonly config: Config;
  private readonly statusManager: StatusManager;

  constructor(deps: IRejectedPlanHandlerDeps) {
    this.config = deps.config;
    this.statusManager = deps.statusManager;
  }

  async handleError(
    error: Error | string | unknown,
    filePath: string,
    requestId: string,
    traceLogger: IEventLogger,
    frontmatter?: Opt<IRequestFrontmatter, Reason.OptionalInput>,
  ): Promise<void> {
    const errorMessage = error instanceof Error ? error.message : String(error);

    let persistedRejectedPath = false;
    if (error instanceof PlanValidationError) {
      const validationError = error;
      const rawDetails = validationError.details?.rawContent;
      const fullRawResponse = validationError.details?.fullRawResponse;

      traceLogger.info(DomainEventType.RequestValidationErrorDetected, requestId, {
        error_message: errorMessage,
        hasDetails: !!validationError.details,
        detailsKeys: validationError.details ? Object.keys(validationError.details) : [],
        hasRawDetails: typeof rawDetails === "string" && rawDetails.length > 0,
        rawDetailsLength: typeof rawDetails === "string" ? rawDetails.length : "not-string",
        hasFullRawResponse: typeof fullRawResponse === "string" && fullRawResponse.length > 0,
        fullRawResponseLength: typeof fullRawResponse === "string" ? fullRawResponse.length : "not-string",
      });

      // Always attempt to save rejected plan for debugging, even if raw content is missing
      try {
        const rejectedDir = join(
          this.config.system.root,
          this.config.paths.workspace,
          this.config.paths.rejected,
        );
        await Deno.mkdir(rejectedDir, { recursive: true });

        const rejectedPath = join(rejectedDir, `${requestId}_rejected.md`);

        // Use fullRawResponse as fallback if rawDetails is empty or missing
        const rawToSave = (typeof rawDetails === "string" && rawDetails.trim())
          ? rawDetails
          : (typeof fullRawResponse === "string" && fullRawResponse.trim())
          ? fullRawResponse
          : "No raw content available";

        const rejectedContent = this.formatRejectedPlan({
          frontmatter,
          requestId,
          traceId: frontmatter?.trace_id,
          errorMessage,
          rawDetails: rawToSave,
          validationError,
        });
        await Deno.writeTextFile(rejectedPath, rejectedContent);

        // Log the saved path for debugging, but keep the original error message
        // unchanged for storage in the request frontmatter (tests expect the
        // raw error string without appended path info).
        traceLogger.info(DomainEventType.RequestSavedRejected, rejectedPath, { reason: "validation_failed" });

        // Persist rejected_path into the request frontmatter so CLI/TUI can
        // expose the location to users for manual review. Use workspace-relative
        // path (e.g. Workspace/Rejected/...) for portability.
        const rejectedRelative = join(
          this.config.paths.workspace,
          this.config.paths.rejected,
          `${requestId}_rejected.md`,
        );
        await this.statusManager.updateStatus(Deno.realPathSync(filePath), RequestStatus.FAILED, errorMessage, {
          rejected_path: rejectedRelative,
        });
        persistedRejectedPath = true;
      } catch (writeErr) {
        traceLogger.warn(DomainEventType.RequestPlanSaveRejectedFailed, filePath, { error: String(writeErr) });
      }
    }

    traceLogger.error(DomainEventType.RequestFailed, filePath, {
      error: errorMessage,
    });

    // If we didn't already persist rejected_path above (e.g. non-validation errors),
    // persist the original error message without path metadata.
    if (!persistedRejectedPath) {
      await this.statusManager.updateStatus(Deno.realPathSync(filePath), RequestStatus.FAILED, errorMessage);
    }
  }

  private formatRejectedPlan(args: {
    frontmatter?: IRequestFrontmatter;
    requestId: string;
    traceId?: string;
    errorMessage: string;
    rawDetails: string;
    validationError: PlanValidationError;
  }): string {
    // Record the agent role that produced this rejected draft so it has the same
    // attribution an accepted plan carries (agent_role) — reviewers and the
    // agent-role e2e can trace the draft back to its persona.
    const agentRoleLine = args.frontmatter?.agent_role ? `agent_role: ${args.frontmatter.agent_role}\n` : "";
    return `---
trace_id: "${args.traceId ?? "unknown"}"
request_id: "${args.requestId}"
${agentRoleLine}status: ${PlanStatus.REJECTED}
error: "${args.errorMessage.replace(/"/g, '\\"')}"
---

Rejected Plan: ${args.errorMessage}
Raw Details: ${args.rawDetails}
`;
  }
}
