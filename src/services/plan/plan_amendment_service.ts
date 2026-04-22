/**
 * @module PlanAmendmentService
 * @path src/services/plan/plan_amendment_service.ts
 * @description Core service for managing mid-execution plan amendment proposals, approvals, and application.
 * @architectural-layer Services
 * @related-files [src/services/plan/plan_executor.ts, src/shared/schemas/plan_amendment.ts]
 */

import type { IPlanStep } from "./plan_executor.ts";
import type {
  IPlanAmendmentDecision,
  IPlanAmendmentPatch,
  IPlanAmendmentTrigger,
} from "@exaix/schemas/plan_amendment.ts";
import type { Config } from "@exaix/schemas/config.ts";
import { DEFAULT_AMENDMENT_THRESHOLD } from "../../shared/constants.ts";
import type { IModelProvider } from "../../ai/types.ts";
import { AgentExecutor } from "../agent/agent_executor.ts";
import { ZPlanAmendmentPatch } from "@exaix/schemas/plan_amendment.ts";
import type { JSONObject } from "../../shared/types/json.ts";
import { type IStructuredPlanStep, parseStructuredPlanFromMarkdown } from "./structured_plan_parser.ts";
import type { IPlanAmendmentService } from "../../shared/interfaces/i_plan_amendment_service.ts";
import { PlanStatus } from "../../shared/status/plan_status.ts";
import { parse as parseYaml, stringify as stringifyYaml } from "@std/yaml";

/** Raw YAML frontmatter before validation */
interface RawFrontmatter {
  status?: string;
  [key: string]: unknown;
}

/**
 * Interface for adapters that request human-in-loop decisions on amendments
 */
export interface IAmendmentApprovalAdapter {
  /**
   * Present an amendment proposal to the user and await a decision
   */
  requestDecision(patch: IPlanAmendmentPatch): Promise<IPlanAmendmentDecision>;
}

/**
 * Implementation of IPlanAmendmentService
 */
export class PlanAmendmentService implements IPlanAmendmentService {
  constructor(
    private readonly config: Config,
    private readonly llm: IModelProvider,
  ) {}

  shouldAmend(trigger: IPlanAmendmentTrigger): Promise<boolean> {
    const settings = this.config.amendment;
    if (!settings?.enabled) {
      return Promise.resolve(false);
    }

    if (trigger.source === "tool_error" || trigger.source === "manual_request") {
      return Promise.resolve(true);
    }

    if (trigger.source === "low_confidence" && trigger.confidenceScore !== undefined) {
      const threshold = settings.threshold ?? DEFAULT_AMENDMENT_THRESHOLD;
      return Promise.resolve(trigger.confidenceScore < threshold);
    }

    return Promise.resolve(false);
  }

  async proposeAmendment(input: {
    planId: string;
    remainingSteps: IPlanStep[];
    trigger: IPlanAmendmentTrigger;
    sharedContext?: JSONObject;
  }): Promise<IPlanAmendmentPatch> {
    const stepsText = input.remainingSteps.map((s) => `Step ${s.number}: ${s.title}\n${s.content}`).join("\n\n");

    const prompt = `
You are the ExaIx Plan Amendment specialist.
The current plan execution encountered a trigger that requires adjusting the remaining steps.

TRIGGER:
Source: ${input.trigger.source}
Reason: ${input.trigger.reason}
Step ID: ${input.trigger.stepId}
${input.trigger.confidenceScore ? `Confidence Score: ${input.trigger.confidenceScore}` : ""}

REMAINING STEPS:
${stepsText}

TASK:
Propose a minimal, targeted amendment to the remaining steps to address the trigger.
You can add, update, or remove steps.

RESPONSE FORMAT (JSON):
{
  "summary": "Concise human-readable explanation of why these changes are needed",
  "affectedRemainingStepIds": ["list of step numbers (as strings) that are being updated or removed"],
  "adds": [{"number": number, "title": "title", "content": "content"}],
  "updates": [{"number": number, "title": "title", "content": "content"}],
  "removes": ["step numbers (as strings) to remove"]
}
`;

    const result = await this.llm.generate(prompt);
    const response = result.content;
    let patch;
    try {
      // Find JSON block if LLM returned markdown
      const jsonStr = response.match(/\{[\s\S]*\}/)?.[0] || response;
      patch = JSON.parse(jsonStr);
    } catch (e) {
      throw new Error(`Failed to parse amendment proposal: ${e instanceof Error ? e.message : String(e)}`);
    }

    return ZPlanAmendmentPatch.parse({
      ...patch,
      amendmentId: crypto.randomUUID(),
      planId: input.planId,
      summary: AgentExecutor.sanitizePrompt(patch?.summary || "No summary provided.").slice(0, 500),
      createdAt: new Date().toISOString(),
    });
  }

  applyApprovedAmendment(planContent: string, patch: IPlanAmendmentPatch): string {
    const frontmatter = { trace_id: "unknown", request_id: "unknown" };
    const plan = parseStructuredPlanFromMarkdown(planContent, frontmatter);
    if (!plan || plan.steps.length === 0) {
      throw new Error("Could not parse structured plan steps from markdown");
    }

    const stepsMap = new Map<number, IStructuredPlanStep>();
    plan.steps.forEach((s) => stepsMap.set(s.number, s));

    // Apply removes
    patch.removes.forEach((numStr) => stepsMap.delete(parseInt(numStr, 10)));

    // Apply updates
    patch.updates.forEach((u) => {
      stepsMap.set(u.number, {
        number: u.number,
        title: u.title,
        content: u.content,
      });
    });

    // Apply adds
    patch.adds.forEach((a) => {
      stepsMap.set(a.number, {
        number: a.number,
        title: a.title,
        content: a.content,
      });
    });

    const sortedSteps = Array.from(stepsMap.values()).sort((a, b) => a.number - b.number);

    // Reconstruct Execution Steps section
    const newStepsMarkdown = sortedSteps.map((s) => `## Step ${s.number}: ${s.title}\n\n${s.content}`).join("\n\n");

    // Replace in original content
    const stepRegex = /^## Step (\d+): (.+)$/m;
    const firstStepMatch = planContent.match(stepRegex);
    if (!firstStepMatch) {
      throw new Error("Could not find step markers in plan content");
    }

    const startIndex = firstStepMatch.index!;

    // Find the end of the steps section
    const lastStep = plan.steps[plan.steps.length - 1];
    const lastStepHeader = `## Step ${lastStep.number}: ${lastStep.title}`;
    const lastStepHeaderIndex = planContent.indexOf(lastStepHeader);

    // Find next header after last step
    const nextHeaderMatch = planContent.substring(lastStepHeaderIndex + lastStepHeader.length).match(/^## (?!Step )/m);
    const endIndex = nextHeaderMatch
      ? lastStepHeaderIndex + lastStepHeader.length + nextHeaderMatch.index!
      : planContent.length;

    // Use parse/stringify for the final frontmatter/body assembly to ensure valid YAML
    const fmMatch = planContent.match(/^---\n([\s\S]*?)\n---/);
    if (!fmMatch) throw new Error("Could not find frontmatter in plan");

    const frontmatterObj: RawFrontmatter = parseYaml(fmMatch[1]) as RawFrontmatter;
    const bodyPrefix = planContent.substring(0, startIndex);
    const bodySuffix = planContent.substring(endIndex).trimStart();

    // Update status to approved
    frontmatterObj.status = PlanStatus.APPROVED;

    // Reconstrct final content
    const updatedBody = bodyPrefix.substring(fmMatch[0].length) + newStepsMarkdown + "\n\n" + bodySuffix;
    const updatedContent = `---\n${stringifyYaml(frontmatterObj)}---\n\n${updatedBody.trimStart()}`;

    return updatedContent;
  }
}
