/**
 * @module PromptBuilder
 * @path packages/execution/src/prompt_builder.ts
 * @description Builds the execution prompts of every strategy: the ReAct prompt with token budget
 *   enforcement, input sanitization, the portal context block and cache integration, and the CLI delegate objective.
 * @architectural-layer Execution
 * @related-files [packages/execution/src/agent_composer.ts]
 */

import type { IEventLogger } from "@exaix/core/logger";
import { DomainEventType } from "@exaix/core/events";
import type { IAgentExecutionOptions, IExecutionContext } from "@exaix/schemas/agent_composer.ts";
import type { IAgentFileBlueprint } from "./agent_composer.ts";
import { buildPortalContextBlock } from "@exaix/core/func";
import type { ExecutionContextService } from "./execution_context_service.ts";
import { resolveBlueprintModelId } from "./blueprint_service.ts";
import { MAX_USER_INPUT_LENGTH, REACT_STATUS_COMPLETE, REACT_SUMMARY_PREFIX, REACT_THOUGHT_PREFIX } from "@exaix/core";
import { PromptBudgetSection } from "@exaix/schemas/prompt_budget.ts";
import type { INativePromptSection } from "@exaix/ai";
import type { Opt, Reason } from "@exaix/core/types";

/** What the ReAct loop adds to one prompt: its history, tool listing, tool guidance and the native budget sections. */
export interface IReActPromptInputs {
  /** The rendered loop history, or an empty string for the first turn. */
  readonly historyText: string;
  /** Leaves out the tool-call format prose when the provider calls tools natively. */
  readonly skipToolProse: boolean;
  readonly visibleToolIds: readonly string[];
  /** The ACI tool guidance text, when at least one complete fragment fits the budget. */
  readonly aciText?: Opt<string, Reason.OptionalContext>;
  /** Receives the budget sections of the prompt for a native conversation, in prompt order. */
  readonly nativeSections?: Opt<INativePromptSection[], Reason.OptionalInput>;
}

const SANITIZED_MARKER = "[REMOVED]";

const REACT_FORMAT_SPEC = `

FORMAT:
${REACT_THOUGHT_PREFIX}[Your reasoning]
\`\`\`toml
[[actions]]
tool = "[tool_name]"
[actions.params]
[param_name] = [value]
\`\`\`

OR

${REACT_STATUS_COMPLETE}
${REACT_SUMMARY_PREFIX}[What was done]`;

const NATIVE_TOOLS_CLOSING = `

When you are finished, output "${REACT_STATUS_COMPLETE}" followed by "${REACT_SUMMARY_PREFIX}[summary]".
Do not repeat a tool call whose result is already in the history.
The plan step is finished once every file it names has been read. Then stop calling tools and output the status line.`;

/** The five sections of the execution prompt after the token budget. */
interface IBudgetedSections {
  readonly request: string;
  readonly plan: string;
  readonly portal: string;
  readonly system: string;
  readonly skills: string;
}

export class PromptBuilder {
  private portalRoot?: string;

  constructor(
    private logger: IEventLogger,
    private ctx: ExecutionContextService,
  ) {}

  /** Set the portal root for portal context block building. */
  setPortalRoot(root?: Opt<string, Reason.OptionalContext>): void {
    this.portalRoot = root;
  }

  /** Applies the token budget to the five sections of the prompt and marks them stable. */
  private async budgetSections(
    blueprint: IAgentFileBlueprint,
    context: IExecutionContext,
    options: IAgentExecutionOptions,
    modelId: string,
    skillsText: Opt<string, Reason.OptionalContext>,
  ): Promise<IBudgetedSections> {
    const sections = this.ctx.currentPromptBudget?.sections;
    const request = await this.applyTokenBudget(
      this.sanitizeUserInput(context.request),
      sections?.memory,
      "memory",
      modelId,
    );
    const plan = await this.applyTokenBudget(this.sanitizeUserInput(context.plan), sections?.plan, "plan", modelId);
    const portal = await this.applyTokenBudget(
      this.buildPortalContextBlock(options.portal) ?? "",
      sections?.portalKnowledge,
      "portalKnowledge",
      modelId,
    );
    const system = await this.applyTokenBudget(blueprint.systemPrompt, sections?.system, "system", modelId);
    const skills = await this.applyTokenBudget(skillsText ?? "", sections?.skills, "skills", modelId);
    if (this.ctx.currentPromptBudget) {
      this.ctx.markSectionsStable(
        { system, plan, portalKnowledge: portal, memory: request, skills },
        this.ctx.currentPromptBudget.sections,
      );
    }
    return { request, plan, portal, system, skills };
  }

  /** Builds the ReAct prompt of one iteration. Request and plan are sanitized and budgeted. */
  async buildExecutionPrompt(
    blueprint: IAgentFileBlueprint,
    context: IExecutionContext,
    options: IAgentExecutionOptions,
    react: IReActPromptInputs,
    skillsText?: Opt<string, Reason.OptionalContext>,
  ): Promise<string> {
    const sections = await this.budgetSections(
      blueprint,
      context,
      options,
      resolveBlueprintModelId(blueprint),
      skillsText,
    );
    const role = `${sections.system ? `${sections.system}\n\n` : ""}AGENT ROLE: ${blueprint.name}
CAPABILITIES: ${blueprint.capabilities.join(", ")}

CONTEXT:
Portal: ${options.portal}
Trace ID: ${context.trace_id}
`;
    const portal = sections.portal ? `${sections.portal}\n\n` : "";
    const skills = sections.skills ? `${sections.skills}\n\n` : "";
    const plan = `Request: ${sections.request}\nPlan Step: ${sections.plan}\n`;
    const instructions = this.reActInstructions(react);

    react.nativeSections?.push(
      { section: PromptBudgetSection.SYSTEM, text: role },
      ...(portal ? [{ section: PromptBudgetSection.PORTAL_KNOWLEDGE, text: portal }] : []),
      ...(skills ? [{ section: PromptBudgetSection.SKILLS, text: skills }] : []),
      { section: PromptBudgetSection.PLAN, text: plan },
      { section: PromptBudgetSection.SYSTEM, text: instructions },
    );
    return `${role}${portal}${skills}${plan}${instructions}`;
  }

  /** The history, the reasoning rules, the tool listing and guidance, and the response format. */
  private reActInstructions(react: IReActPromptInputs): string {
    let text = `
${react.historyText ? `HISTORY:\n${react.historyText}` : ""}

INSTRUCTIONS:
1. Reason about the current state.
2. If you need more information or need to make changes, output one or more tool calls.
3. If the task is finished, output "${REACT_STATUS_COMPLETE}" and provide a summary of changes.
4. Output your thought process preceded by "${REACT_THOUGHT_PREFIX}".

AVAILABLE TOOLS:
${react.visibleToolIds.join(", ")}`;
    if (react.aciText) text += `\n\nACI TOOL GUIDANCE:\n${react.aciText}`;
    text += `

TOOL SELECTION GUIDELINES:
- For reading files or searching code: use read_file, search_text, or search_files.
- For creating NEW files or overwriting entire files: use write_file.
- For small targeted edits (fixing bugs, null-guard fixes): prefer patch_file over write_file.
- For shell commands: use run_command only when no specialized tool exists for your task.`;
    text += react.skipToolProse ? NATIVE_TOOLS_CLOSING : REACT_FORMAT_SPEC;
    return text;
  }

  private async applyTokenBudget(
    text: string,
    tokenBudget?: Opt<number, Reason.ExecutionConfig>,
    sectionName?: Opt<string, Reason.OptionalContext>,
    modelId?: Opt<string, Reason.ExecutionConfig>,
  ): Promise<string> {
    if (!tokenBudget || tokenBudget <= 0) return text;

    const estimateTokens = (input: string): Promise<number> => this.ctx.estimateTokens(input, modelId);
    const tokenSource = this.ctx.tokenSource(modelId);
    const maxChars = this.ctx.estimateMaxChars(tokenBudget);

    if (text.length <= maxChars) {
      if (sectionName) {
        this.logger.info(DomainEventType.ContextBudgetConsumed, "", {
          section: sectionName,
          allocatedTokens: tokenBudget,
          actualTokens: await estimateTokens(text),
          truncated: false,
          tokenSource,
        });
      }
      return text;
    }

    const truncated = text.slice(0, Math.max(0, maxChars));
    if (sectionName) {
      const actualTokens = await estimateTokens(truncated);
      const rawTokens = await estimateTokens(text);
      this.logger.info(DomainEventType.ContextBudgetConsumed, "", {
        section: sectionName,
        allocatedTokens: tokenBudget,
        actualTokens,
        truncated: true,
        tokenSource,
      });
      this.logger.info(DomainEventType.ContextSectionTruncated, "", {
        section: sectionName,
        allocatedTokens: tokenBudget,
        actualTokens: rawTokens,
        truncatedAtChar: maxChars,
        tokenSource,
      });
    }
    return truncated;
  }

  private buildPortalContextBlock(portalAlias: string): string | null {
    if (!this.portalRoot) return null;
    return buildPortalContextBlock({ portalAlias, portalRoot: this.portalRoot });
  }

  /** Sanitizes user input to prevent prompt injection. */
  sanitizeUserInput(input: string): string {
    return sanitizeUserInput(input);
  }
}

/** Strips injection phrases, neutralizes code fences and caps the length of user-supplied prompt text. */
export function sanitizeUserInput(input: string): string {
  return input
    .replace(/##\s*(system|instructions|ignore|important)/gi, SANITIZED_MARKER)
    .replace(/```/g, "~~~")
    .replace(/ignore (all )?previous instructions/gi, SANITIZED_MARKER)
    .replace(/ignore (all )?system prompts?/gi, SANITIZED_MARKER)
    .replace(/<META>[\s\S]*?<\/META>/gi, SANITIZED_MARKER)
    .replace(/you are now/gi, SANITIZED_MARKER)
    .replace(/new instructions?:/gi, SANITIZED_MARKER)
    .slice(0, MAX_USER_INPUT_LENGTH);
}

/** The objective that a delegated CLI session receives. The first turn leads with the whole plan. */
export function buildDelegateObjective(
  blueprint: IAgentFileBlueprint,
  context: IExecutionContext,
  isFirstTurn: boolean,
  skillsText: Opt<string, Reason.OptionalContext>,
): string {
  const request = sanitizeUserInput(context.request);
  const taskSection = isFirstTurn && context.full_plan
    ? `TASK: ${request}\n\nFULL PLAN:\n${sanitizeUserInput(context.full_plan)}\n\nBEGIN WITH THE FIRST STEP BELOW.`
    : `TASK: ${request}`;
  const skillsSection = skillsText ? `${skillsText}\n\n` : "";
  return `${blueprint.systemPrompt}\n\n${skillsSection}${taskSection}\n\nPLAN STEP: ${sanitizeUserInput(context.plan)}`;
}
