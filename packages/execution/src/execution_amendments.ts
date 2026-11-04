/**
 * @module ExecutionAmendments
 * @path packages/execution/src/execution_amendments.ts
 * @description Plan amendments of the execution loop: pausing a plan for approval and settling the amendments that time out.
 * @architectural-layer Services
 * @related-files [packages/execution/src/execution_loop.ts, packages/execution/tests/execution_loop_amendment_worktree_test.ts]
 */

import { join } from "@std/path";
import { parse as parseYaml, stringify as stringifyYaml } from "@std/yaml";
import type { Config } from "@exaix/schemas/config.ts";
import type { IPlanAmendmentGate } from "@exaix/core/types";
import { DomainEventType, type TDomainEventType } from "@exaix/core/events";
import type { IGitService } from "@exaix/core/types";
import { PlanStatus } from "@exaix/core/status";
import type { PlanAmendmentPendingError } from "@exaix/core/planning";
import { DEFAULT_AMENDMENT_EXPIRY_MS, DEFAULT_AMENDMENT_ON_TIMEOUT } from "@exaix/core";
import type { JSONValue } from "@exaix/core";
import type { Opt, Reason } from "@exaix/core/types";
import type { ExecutionPlanReader } from "./execution_plan_reader.ts";

/** Represents raw YAML frontmatter before validation */
interface RawFrontmatter {
  status?: string;
  amendment_id?: string;
  amendment_proposed_at?: string;
  [key: string]: JSONValue;
}

/** What the amendment handling of one execution loop needs from it. */
interface IExecutionAmendmentsDependencies {
  readonly config: Config;
  readonly plansDir: string;
  readonly amendmentGate: Opt<IPlanAmendmentGate, Reason.OptionalDependency>;
  readonly planReader: Pick<ExecutionPlanReader, "parsePlan">;
  readonly journal: (action: TDomainEventType, traceId: string, payload: Record<string, JSONValue>) => void;
  /** Fails the plan whose amendment request expired. */
  readonly failPlan: (
    planPath: string,
    traceId: string,
    requestId: string,
    message: string,
    cleanup: undefined,
  ) => Promise<void>;
}

/** Pauses a plan for an amendment and settles the amendments whose approval window has passed. */
export class ExecutionAmendments {
  private readonly config: Config;
  private readonly plansDir: string;
  private readonly amendmentGate: IExecutionAmendmentsDependencies["amendmentGate"];
  private readonly planReader: IExecutionAmendmentsDependencies["planReader"];
  private readonly journal: IExecutionAmendmentsDependencies["journal"];
  private readonly failPlan: IExecutionAmendmentsDependencies["failPlan"];

  constructor(dependencies: IExecutionAmendmentsDependencies) {
    this.config = dependencies.config;
    this.plansDir = dependencies.plansDir;
    this.amendmentGate = dependencies.amendmentGate;
    this.planReader = dependencies.planReader;
    this.journal = dependencies.journal;
    this.failPlan = dependencies.failPlan;
  }

  /**
   * Handle plan amendment pending state
   */
  async handleAmendmentPending(
    planPath: string,
    traceId: string,
    requestId: string,
    error: PlanAmendmentPendingError,
    _cleanup?: Opt<{
      portalGitService?: IGitService;
      worktreePath?: string;
    }, Reason.OptionalInput>,
  ): Promise<void> {
    try {
      const content = await Deno.readTextFile(planPath);
      const match = content.match(/^---\n([\s\S]*?)\n---/);
      if (!match) throw new Error("Could not find frontmatter in plan");

      const frontmatter: RawFrontmatter = parseYaml(match[1]) as RawFrontmatter;
      const body = content.substring(match[0].length).trimStart();

      // Update status
      frontmatter.status = PlanStatus.AMENDMENT_PENDING;

      // Inject amendment metadata
      if (!frontmatter.amendment_id) {
        frontmatter.amendment_id = error.amendmentId;
        frontmatter.amendment_proposed_at = new Date().toISOString();
      }

      const updatedContent = `---\n${stringifyYaml(frontmatter)}---\n\n${body}`;
      await Deno.writeTextFile(planPath, updatedContent);
    } catch (e) {
      console.error("Failed to update plan status for amendment:", e);
    }

    // The plan stays paused, but its worktree must not survive the pause.
    // After approval, execution resumes on the same traceId. An orphaned worktree would make `git worktree add` collide.
    // handleFailure does the same cleanup for a rejected plan.
    if (_cleanup?.worktreePath && _cleanup?.portalGitService) {
      try {
        await _cleanup.portalGitService.removeWorktree(_cleanup.worktreePath, {
          force: true,
          deleteBranch: true,
        });
      } catch (removeError) {
        console.warn(`Failed to cleanup worktree at ${_cleanup.worktreePath}:`, removeError);
      }
    }

    this.journal(DomainEventType.ExecutionAmendmentPending, traceId, {
      request_id: requestId,
      amendment_id: error.amendmentId,
    });
  }

  /**
   * Scan for expired amendments and abort their plans
   */
  async checkExpiredAmendments(): Promise<void> {
    try {
      const entries = await Array.fromAsync(Deno.readDir(this.plansDir));
      const planFiles = entries
        .filter((entry) => entry.isFile && entry.name.endsWith(".md"))
        .map((entry) => join(this.plansDir, entry.name));

      const expiryMs = this.config.amendment?.expiryMs ?? DEFAULT_AMENDMENT_EXPIRY_MS;
      const now = Date.now();

      for (const planPath of planFiles) {
        try {
          const frontmatter = await this.planReader.parsePlan(planPath);

          if (frontmatter.status === PlanStatus.AMENDMENT_PENDING) {
            const proposedAtStr = frontmatter.amendment_proposed_at;
            if (proposedAtStr) {
              const proposedAt = new Date(proposedAtStr).getTime();
              if (now - proposedAt > expiryMs) {
                const requestId = frontmatter.request_id ?? "unknown";
                const traceId = frontmatter.trace_id ?? "unknown";
                const amendmentId = frontmatter.amendment_id ?? null;
                const onTimeout = this.config.amendment?.on_timeout ?? DEFAULT_AMENDMENT_ON_TIMEOUT;

                switch (onTimeout) {
                  case "reject": {
                    await this.amendmentGate?.recordDecision({
                      planId: requestId,
                      requestId,
                      amendmentId,
                      decision: PlanStatus.REJECTED,
                      decidedBy: "timeout",
                      rationale: "Amendment rejected due to HITL timeout",
                      traceId,
                    });
                    const content = await Deno.readTextFile(planPath);
                    const updated = content.replace(
                      /status: "?amendment_pending"?/,
                      `status: ${PlanStatus.REJECTED}`,
                    );
                    await Deno.writeTextFile(planPath, updated);
                    break;
                  }
                  case "approve": {
                    await this.amendmentGate?.recordDecision({
                      planId: requestId,
                      requestId,
                      amendmentId,
                      decision: PlanStatus.APPROVED,
                      decidedBy: "timeout",
                      rationale: "Amendment approved due to HITL timeout",
                      traceId,
                    });
                    const content = await Deno.readTextFile(planPath);
                    const updated = content.replace(
                      /status: "?amendment_pending"?/,
                      `status: ${PlanStatus.APPROVED}`,
                    );
                    await Deno.writeTextFile(planPath, updated);
                    break;
                  }
                  default: {
                    await this.amendmentGate?.recordDecision({
                      planId: requestId,
                      requestId,
                      amendmentId,
                      decision: "expired",
                      decidedBy: "timeout",
                      rationale: "Amendment expired due to HITL timeout",
                      traceId,
                    });
                    await this.failPlan(
                      planPath,
                      traceId,
                      requestId,
                      "Plan amendment request expired (timeout).",
                      undefined,
                    );
                  }
                }
              }
            }
          }
        } catch {
          continue;
        }
      }
    } catch (error) {
      console.error("Failed to check for expired amendments:", error);
    }
  }
}
