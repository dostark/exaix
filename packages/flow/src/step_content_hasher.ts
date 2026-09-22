/**
 * @module StepContentHasher
 * @path packages/flow/src/step_content_hasher.ts
 * @description Pure content-hashing and side-effect classification helpers for flow steps,
 * extracted from FlowRunner — no flow-execution state, only serialization/digest logic.
 * @architectural-layer Flows
 * @related-files [packages/flow/src/flow_runner.ts, "packages/schemas/src/flow.ts"]
 */

import type { IFlow, IFlowStep } from "@exaix/schemas/flow.ts";
import { encodeHex } from "@std/encoding/hex";
import { FlowStepExecutionMode, FlowStepType, StepSideEffectClass } from "@exaix/core";
import type { IFlowStepRequest } from "./flow_runner.ts";

export class StepContentHasher {
  async computeFlowContentHash(flow: IFlow): Promise<string> {
    const serialized = JSON.stringify(flow, (_key, value) => {
      return typeof value === "function" ? "__function__" : value;
    });
    const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(serialized));
    return encodeHex(digest);
  }

  async computeStepInputHash(stepRequest: IFlowStepRequest): Promise<string> {
    const serialized = JSON.stringify({
      userPrompt: stepRequest.userPrompt,
      context: stepRequest.context,
      skills: stepRequest.skills,
    });
    const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(serialized));
    return encodeHex(digest);
  }

  async computeStringHash(value: string): Promise<string> {
    const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(value));
    return encodeHex(digest);
  }

  computeSideEffectClass(step: IFlowStep): StepSideEffectClass {
    if (step.type === FlowStepType.GATE) {
      return StepSideEffectClass.NONE;
    }

    const hasTools = step.permitted_tools && step.permitted_tools.length > 0;
    const isDynamic = step.execution_mode === FlowStepExecutionMode.DYNAMIC;

    if (isDynamic && hasTools) {
      const hasGitTools = step.permitted_tools!.some((t) => t.startsWith("git_"));
      return hasGitTools ? StepSideEffectClass.GIT : StepSideEffectClass.TOOL;
    }

    if (!isDynamic && !hasTools) {
      return StepSideEffectClass.LLM;
    }

    return StepSideEffectClass.MIXED;
  }
}
