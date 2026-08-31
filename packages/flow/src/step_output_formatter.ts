/**
 * @module StepOutputFormatter
 * @path packages/flow/src/step_output_formatter.ts
 * @description Applies input transforms to step data and aggregates the
 * output of one or more completed steps into the flow's final result string.
 * Extracted from FlowRunner (god-object decomposition,
 * .copilot/skills/refactor/SKILL.md step d) since both operations are pure
 * functions of their parameters — no FlowRunner field dependency.
 * @architectural-layer Flows
 * @related-files ["packages/flow/src/flow_runner.ts"]
 */
import type { IFlow } from "@exaix/schemas/flow.ts";
import { appendToRequest, extractSection, mergeAsContext, passthrough, templateFill } from "@exaix/core/func";
import { jsonExtract } from "@exaix/core/types";
import type { JSONValue } from "@exaix/core";
import type { Opt, Reason } from "@exaix/core/types";
import type { IStepResult } from "./flow_runner.ts";

type IFlowOutput = IFlow["output"];

export interface IStepOutputFormatter {
  applyTransform(
    input: string,
    transform: string | ((input: string) => string),
    transformArgs?: Opt<JSONValue, Reason.OptionalInput>,
    originalRequest?: Opt<string, Reason.OptionalInput>,
  ): string;
  aggregateOutput(output: IFlowOutput, stepResults: Map<string, IStepResult>): string;
}

type BuiltInTransformHandler = (ctx: {
  input: string;
  transformArgs?: JSONValue;
  originalRequest?: string;
}) => string;

function applyMergeAsContextTransform(input: string, transformArgs: Opt<JSONValue, Reason.OptionalInput>): string {
  if (Array.isArray(transformArgs)) {
    // Filter to strings only — mergeAsContext requires string[]
    return mergeAsContext(transformArgs.filter((v): v is string => typeof v === "string"));
  }

  try {
    const parsed = JSON.parse(input);
    if (Array.isArray(parsed)) {
      return mergeAsContext(parsed.filter((v): v is string => typeof v === "string"));
    }
  } catch {
    // Not JSON at all — the text path below handles it, like every other non-array shape.
  }

  // Everything else is treated as text, including a JSON OBJECT (what an agent step
  // actually emits) — that case used to throw while unparseable prose was accepted.
  return mergeAsContext(input.split("\n\n").filter((section) => section.trim()));
}

function applyExtractSectionTransform(
  input: string,
  transformArgs: Opt<JSONValue, Reason.OptionalInput>,
): string {
  if (typeof transformArgs === "string") return extractSection(input, transformArgs);
  throw new Error("extractSection requires a section name as transformArgs");
}

function applyAppendToRequestTransform(
  input: string,
  originalRequest: Opt<string, Reason.OptionalInput>,
): string {
  if (originalRequest) return appendToRequest(originalRequest, input);
  throw new Error("appendToRequest requires original request to be available");
}

function applyJsonExtractTransform(input: string, transformArgs: Opt<JSONValue, Reason.OptionalInput>): string {
  if (typeof transformArgs === "string") return String(jsonExtract(input, transformArgs));
  throw new Error("jsonExtract requires a field path as transformArgs");
}

function applyTemplateFillTransform(input: string, transformArgs: Opt<JSONValue, Reason.OptionalInput>): string {
  if (typeof transformArgs === "object" && transformArgs !== null && !Array.isArray(transformArgs)) {
    return templateFill(input, transformArgs as Record<string, string | number | boolean>);
  }
  throw new Error("templateFill requires a context object as transformArgs");
}

const BUILT_IN_TRANSFORM_HANDLERS: Record<string, BuiltInTransformHandler> = {
  passthrough: ({ input }) => passthrough(input),
  mergeAsContext: ({ input, transformArgs }) => applyMergeAsContextTransform(input, transformArgs),
  extractSection: ({ input, transformArgs }) => applyExtractSectionTransform(input, transformArgs),
  appendToRequest: ({ input, originalRequest }) => applyAppendToRequestTransform(input, originalRequest),
  jsonExtract: ({ input, transformArgs }) => applyJsonExtractTransform(input, transformArgs),
  templateFill: ({ input, transformArgs }) => applyTemplateFillTransform(input, transformArgs),
};

export class StepOutputFormatter implements IStepOutputFormatter {
  /**
   * Apply a transform function to input data
   */
  applyTransform(
    input: string,
    transform: string | ((input: string) => string),
    transformArgs?: Opt<JSONValue, Reason.OptionalInput>,
    originalRequest?: Opt<string, Reason.OptionalInput>,
  ): string {
    // Handle custom transform functions
    if (typeof transform === "function") {
      try {
        return (transform as (input: string) => string)(input);
      } catch (error) {
        throw new Error(`Custom transform failed: ${(error as Error).message}`);
      }
    }

    const handler = BUILT_IN_TRANSFORM_HANDLERS[transform];
    if (!handler) throw new Error(`Unknown transform: ${transform}`);
    return handler({ input, transformArgs, originalRequest });
  }

  /**
   * Aggregate output from the specified steps
   */
  aggregateOutput(output: IFlowOutput, stepResults: Map<string, IStepResult>): string {
    const outputFrom = Array.isArray(output.from) ? output.from : [output.from];
    const format = output.format || "markdown";

    if (outputFrom.length === 0) {
      return "";
    }

    if (outputFrom.length === 1) {
      const stepId = outputFrom[0];
      const result = stepResults.get(stepId);
      return result?.result?.content || "";
    }

    // Multiple outputs - aggregate based on format
    switch (format) {
      case "concat": {
        return outputFrom
          .map((stepId) => stepResults.get(stepId)?.result?.content || "")
          .filter((content) => content.length > 0)
          .join("\n");
      }

      case "json": {
        const jsonObj: Record<string, string> = {};
        for (const stepId of outputFrom) {
          const result = stepResults.get(stepId);
          if (result?.result?.content) {
            jsonObj[stepId] = result.result.content;
          }
        }
        return JSON.stringify(jsonObj);
      }

      case "markdown":
      default:
        return outputFrom
          .map((stepId) => {
            const result = stepResults.get(stepId);
            const content = result?.result?.content || "";
            return `## ${stepId}\n\n${content}`;
          })
          .join("\n\n");
    }
  }
}
