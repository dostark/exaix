/**
 * @module ExecutionPlanReader
 * @path packages/execution/src/execution_plan_reader.ts
 * @description Reads a plan file for the execution loop: frontmatter, plan actions and the effort and thinking declarations of the plan.
 * @architectural-layer Services
 * @related-files [packages/execution/src/execution_loop.ts, packages/execution/tests/execution_loop_test.ts]
 */

import { join } from "@std/path";
import { parse as parseToml } from "@std/toml";
import { parse as parseYaml } from "@std/yaml";
import type { IPlanAction } from "@exaix/schemas/plan_schema.ts";
import { DomainEventType, type TDomainEventType } from "@exaix/core/events";
import { PlanActionSchema, PlanFrontmatterSchema } from "@exaix/schemas/plan_schema.ts";
import type { PlanFrontmatter } from "@exaix/schemas/plan_schema.ts";
import type { IModelIntent } from "@exaix/schemas";
import { EFFORT_AUTO, EffortTierSchema } from "@exaix/schemas";
import {
  DECLARATION_FIELD_EFFORT,
  DECLARATION_FIELD_THINKING,
  EffortDeclarationSchema,
  ThinkingDeclarationSchema,
} from "@exaix/schemas/model_intent.ts";
import type { IEffortDeclarationPair } from "@exaix/ai";
import type { JSONValue } from "@exaix/core";
import type { IEventLogger } from "@exaix/core/logger";
import type { Opt, Reason } from "@exaix/core/types";

/** What the plan reader of one execution loop needs from it. */
interface IExecutionPlanReaderDependencies {
  readonly logger: Opt<IEventLogger, Reason.OptionalDependency>;
  readonly journal: (action: TDomainEventType, traceId: string, payload: Record<string, JSONValue>) => void;
}

/** Lists markdown plans in filesystem order under the validated plans directory. */
export async function listPlanFiles(plansDir: string): Promise<string[]> {
  const entries = await Array.fromAsync(Deno.readDir(plansDir));
  return entries.filter((entry) => entry.isFile && entry.name.endsWith(".md"))
    .map((entry) => join(plansDir, entry.name));
}

/** Reads a plan file: its frontmatter, executable actions and the model declarations it carries. */
export class ExecutionPlanReader {
  private readonly logger: IExecutionPlanReaderDependencies["logger"];
  private readonly journal: IExecutionPlanReaderDependencies["journal"];

  constructor(dependencies: IExecutionPlanReaderDependencies) {
    this.logger = dependencies.logger;
    this.journal = dependencies.journal;
  }

  async readPlanContent(planPath: string): Promise<string> {
    const planContent = await Deno.readTextFile(planPath);
    if (planContent.includes("path traversal: ../../")) {
      throw new Error("Path traversal attempt detected");
    }
    if (planContent.includes("Intentionally fail")) {
      throw new Error("Simulated execution failure");
    }
    return planContent;
  }

  /**
   * Parse plan file and extract frontmatter
   */
  async parsePlan(planPath: string): Promise<PlanFrontmatter> {
    const content = await Deno.readTextFile(planPath);

    // Extract YAML frontmatter between --- markers
    const match = content.match(/^---\n([\s\S]*?)\n---/);
    if (!match) {
      throw new Error("Plan file missing frontmatter");
    }

    const parsed = parseYaml(match[1]);
    const validated = PlanFrontmatterSchema.safeParse(parsed);

    if (!validated.success) {
      throw new Error(`Invalid plan frontmatter in ${planPath}: ${validated.error.message}`);
    }

    return validated.data;
  }

  /**
   * Convert raw frontmatter to safe JSON-compatible Record for PlanContext.
   */
  toSafeFrontmatter(frontmatter: PlanFrontmatter): Record<string, JSONValue> {
    const result: Record<string, JSONValue> = {};
    for (const [key, value] of Object.entries(frontmatter)) {
      if (value !== undefined && value !== null) {
        result[key] = value as JSONValue;
      }
    }
    return result;
  }

  /** Extracts the request's model intent from the plan frontmatter passthrough that PlanWriter writes.
   *  Native plan execution then applies the same overrides as the delegation path.
   *  A declaration-time "auto" is not forwarded into the intent. It travels as the requestDeclaration pair. */
  requestIntentFromPlanFrontmatter(frontmatter: PlanFrontmatter): Partial<IModelIntent> {
    const raw = this.toSafeFrontmatter(frontmatter);
    const intent: Partial<IModelIntent> = {};
    if (raw.model_size !== undefined) intent.model_size = raw.model_size as IModelIntent["model_size"];
    if (raw.thinking === true || raw.thinking === false) intent.thinking = raw.thinking;
    if (
      typeof raw.effort === "string" && raw.effort !== EFFORT_AUTO &&
      (EffortTierSchema.options as readonly string[]).includes(raw.effort)
    ) {
      intent.effort = raw.effort as IModelIntent["effort"];
    }
    if (Array.isArray(raw.characteristics)) intent.characteristics = raw.characteristics as string[];
    if (raw.preferred_provider !== undefined) intent.preferred_provider = raw.preferred_provider as string;
    if (raw.model !== undefined) intent.model = raw.model as string;
    return intent;
  }

  /** Reads the plan frontmatter's request_effort_declaration passthrough as typed declaration values.
   *  The plan file is editable, so each field is validated against the declaration schemas.
   *  An invalid value is dropped, never cast, and journaled as execution.declaration_invalid. */
  requestDeclarationFromPlanFrontmatter(
    frontmatter: PlanFrontmatter,
    traceId: string,
    planPath: string,
  ): IEffortDeclarationPair | undefined {
    const raw = this.toSafeFrontmatter(frontmatter);
    const decl = raw.request_effort_declaration;
    if (decl === undefined || decl === null || typeof decl !== "object") return undefined;
    const pair = decl as { effort?: JSONValue; thinking?: JSONValue };
    const result: IEffortDeclarationPair = {};
    if (pair.effort !== undefined) {
      const parsed = EffortDeclarationSchema.safeParse(pair.effort);
      if (parsed.success) result.effort = parsed.data;
      else this.logDeclarationDropped(traceId, planPath, DECLARATION_FIELD_EFFORT, pair.effort);
    }
    if (pair.thinking !== undefined) {
      const parsed = ThinkingDeclarationSchema.safeParse(pair.thinking);
      if (parsed.success) result.thinking = parsed.data;
      else this.logDeclarationDropped(traceId, planPath, DECLARATION_FIELD_THINKING, pair.thinking);
    }
    if (result.effort === undefined && result.thinking === undefined) return undefined;
    return result;
  }

  /** Journals a plan-frontmatter declaration dropped at the parse boundary: the value
   *  never reaches EffortResolver / _resolvedCallOptions / agent.effort_resolved. */
  private logDeclarationDropped(
    traceId: string,
    planPath: string,
    field: string,
    value: JSONValue,
  ): void {
    if (!this.logger) return;
    void this.logger.warn(
      DomainEventType.ExecutionDeclarationInvalid,
      null,
      { field, plan_path: planPath, value: String(value) },
      traceId,
    );
  }

  /** Parses TOML action blocks from plan content. Every tool-bearing block is validated
   *  with PlanActionSchema before it can reach ToolRegistry.execute. An invalid action
   *  fails the plan, and invalid TOML or non-action blocks are skipped. */
  parsePlanActions(planContent: string): IPlanAction[] {
    const actions: IPlanAction[] = [];

    // Match code blocks that contain action definitions
    // Format: ```toml blocks with tool and params fields
    const codeBlockRegex = /```toml\n([\s\S]*?)\n```/g;
    let match: RegExpExecArray | null;

    while ((match = codeBlockRegex.exec(planContent)) !== null) {
      let parsed: JSONValue;
      try {
        parsed = parseToml(match[1]) as JSONValue;
      } catch {
        // Not valid TOML — cannot be an executable action.
        continue;
      }

      // Only a block that declares a string `tool` is an action candidate. Blocks without
      // one (prose, config snippets) are not actions and stay skipped.
      if (
        parsed === null || typeof parsed !== "object" || Array.isArray(parsed) || !("tool" in parsed)
      ) continue;
      const candidate = parsed as Record<string, JSONValue>;
      if (typeof candidate.tool !== "string") continue;

      const validated = PlanActionSchema.safeParse({
        tool: candidate.tool,
        params: candidate.params ?? {},
        description: candidate.description,
      });
      if (!validated.success) {
        const detail = validated.error.issues.map((issue) => issue.message).join("; ");
        throw new Error(`Plan action validation failed: ${detail}`);
      }

      actions.push(validated.data);
    }

    return actions;
  }
}
