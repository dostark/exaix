/**
 * @module PlanExecutor
 * @path src/services/plan_executor.ts
 * @description Orchestrates the Step-by-Step execution of approved plans.
 * Managing the ReAct loop: prompting LLM for actions, executing tools, and committing results.
 * @architectural-layer Services
 * @dependencies [ToolRegistry, GitService, EventLogger, DatabaseService]
 * @related-files [src/services/tool_registry.ts, src/services/execution_loop.ts]
 */

import { parse as parseToml } from "@std/toml";
import type { Config } from "../../shared/schemas/config.ts";
import type { DatabaseService } from "../core/db.ts";
import { IModelProvider } from "../../ai/types.ts";
import { ToolRegistry } from "../tool/tool_registry.ts";
import { GitNothingToCommitError, GitService, type IGitService } from "../core/git_service.ts";
import { EventLogger } from "../core/event_logger.ts";
import { ExecutionStatus } from "../../shared/enums.ts";
import { JSONObject, JSONValue } from "../../shared/types/json.ts";
import {
  EXECUTION_REPORT_MAX_TOKENS,
  EXECUTION_REPORT_PROMPT_MAX_CHARS,
  EXECUTION_REPORT_TEMPERATURE,
  EXECUTION_REPORT_TOOL_OUTPUT_MAX_CHARS,
} from "../../shared/constants.ts";

export interface IPlanStep {
  number: number;
  title: string;
  content: string;
}

export interface IPlanContext {
  trace_id: string;
  request_id: string;
  identity: string;
  frontmatter: Record<string, JSONValue>;
  steps: IPlanStep[];
}

export interface IPlanExecutionResult {
  lastCommitSha: string | null;
  report?: string;
}

export interface IPlanExecutorOptions {
  enableGit?: boolean;
  generateReport?: boolean;
}

export interface IPlanActionReport {
  stepNumber: number;
  stepTitle: string;
  tool: string;
  params: Record<string, JSONValue>;
  success: boolean;
  output?: string;
  error?: string;
}

export interface IPlanAction {
  tool: string;
  params: Record<string, JSONValue>;
  description?: string;
}

export class PlanExecutor {
  private logger: EventLogger;
  private enableGit: boolean;
  private generateReport: boolean;

  constructor(
    private config: Config,
    private llmProvider: IModelProvider,
    private db: DatabaseService,
    private repoPath: string,
    options: IPlanExecutorOptions = {},
  ) {
    this.logger = new EventLogger({
      db,
      defaultActor: "system",
    });
    this.enableGit = options.enableGit ?? true;
    this.generateReport = options.generateReport ?? false;
  }

  /**
   * Execute a plan
   */
  async execute(planPath: string, context: IPlanContext): Promise<IPlanExecutionResult> {
    const traceId = context.trace_id;
    const requestId = context.request_id;
    const identityId = context.identity;
    const actionReports: IPlanActionReport[] = [];

    await this.logger.info("plan.execution_started", planPath, {
      trace_id: traceId,
      request_id: requestId,
      step_count: context.steps.length,
    });

    try {
      const git = this.enableGit
        ? new GitService({
          config: this.config,
          db: this.db,
          repoPath: this.repoPath,
          traceId,
          identityId,
        })
        : null;

      if (git) {
        await git.ensureRepository();
        await git.ensureIdentity();

        // Ensure feature branch exists
        await git.createBranch({
          requestId,
          traceId,
        });
      }

      // Determine baseDir for ToolRegistry
      let baseDir: string = this.repoPath;
      const portalName = context.frontmatter.portal as string | undefined;

      if (portalName) {
        const portal = this.config.portals.find((p) => p.alias === portalName);
        if (portal) {
          baseDir = portal.target_path;
          await this.logger.info("plan.portal_context_detected", planPath, {
            portal: portalName,
            base_dir: baseDir,
            trace_id: traceId,
          });
        } else {
          await this.logger.warn("plan.portal_not_found", planPath, {
            portal: portalName,
            trace_id: traceId,
          });
        }
      }

      // Initialize ToolRegistry
      const toolRegistry = new ToolRegistry({
        config: this.config,
        db: this.db,
        traceId,
        identityId,
        baseDir,
      });

      // Execute each step
      let lastCommitSha: string | null = null;
      for (const step of context.steps) {
        const stepResult = await this.executeStep(step, context, toolRegistry, git, actionReports);
        if (stepResult) {
          lastCommitSha = stepResult;
        }
      }

      // Final commit if any changes pending
      if (git) {
        try {
          const sha = await git.commit({
            message: `Complete plan: ${requestId}`,
            description: `Executed by identity ${identityId}`,
            traceId,
          });

          await this.logger.info("plan.execution_completed", planPath, {
            trace_id: traceId,
            commit_sha: sha,
          });

          lastCommitSha = sha;
        } catch (error) {
          if (error instanceof Error && error.message.includes("nothing to commit")) {
            await this.logger.info("plan.execution_completed", planPath, {
              trace_id: traceId,
              status: ExecutionStatus.COMPLETED,
              last_commit: lastCommitSha,
            });
          } else {
            throw error;
          }
        }
      }

      const report = (this.generateReport || context.steps.length === 0)
        ? await this.generateExecutionReport(context, actionReports)
        : undefined;

      return { lastCommitSha, report };
    } catch (error) {
      await this.logger.error("plan.execution_failed", planPath, {
        error: error instanceof Error ? error.message : String(error),
        trace_id: traceId,
      });
      throw error;
    }
  }

  /**
   * Execute a single step
   */
  private async executeStep(
    step: IPlanStep,
    context: IPlanContext,
    toolRegistry: ToolRegistry,
    git: IGitService | null,
    actionReports: IPlanActionReport[],
  ): Promise<string | null> {
    await this.logger.info("step.started", `Step ${step.number}`, {
      title: step.title,
      trace_id: context.trace_id,
    });

    // Construct prompt for the agent
    const prompt = this.constructStepPrompt(step, context);

    // Ask LLM for actions
    const response = await this.llmProvider.generate(prompt, {
      temperature: 0.2, // Low temperature for deterministic tool usage
      max_tokens: 2000,
    });

    // Parse actions
    const actions = this.parseActions(response);

    if (actions.length === 0) {
      await this.logger.warn("step.no_actions", `Step ${step.number}`, {
        trace_id: context.trace_id,
        response_preview: response.slice(0, 100),
      });
      return null;
    }

    // Execute actions
    for (const action of actions) {
      try {
        // await this.logger.debug("action.executing", action.tool, {
        //   params: action.params,
        //   trace_id: context.trace_id,
        // });

        const result = await toolRegistry.execute(action.tool, action.params);

        actionReports.push({
          stepNumber: step.number,
          stepTitle: step.title,
          tool: action.tool,
          params: action.params,
          success: result.success,
          output: this.formatToolOutput(result.data ?? result.error ?? ""),
          error: result.error,
        });

        if (!result.success) {
          throw new Error(result.error || "Tool execution failed");
        }

        // await this.logger.debug("action.completed", action.tool, {
        //   result_preview: JSON.stringify(result).slice(0, 100),
        //   trace_id: context.trace_id,
        // });
      } catch (error) {
        actionReports.push({
          stepNumber: step.number,
          stepTitle: step.title,
          tool: action.tool,
          params: action.params,
          success: false,
          error: error instanceof Error ? error.message : String(error),
        });
        await this.logger.error("action.failed", action.tool, {
          error: error instanceof Error ? error.message : String(error),
          trace_id: context.trace_id,
        });
        throw error; // Fail the step if an action fails
      }
    }

    // Commit after each step
    if (!git) {
      await this.logger.info("step.completed", `Step ${step.number}`, {
        trace_id: context.trace_id,
      });
      return null;
    }

    try {
      const sha = await git.commit({
        message: `Step ${step.number}: ${step.title}`,
        description: step.content,
        traceId: context.trace_id,
      });

      await this.logger.info("step.completed", `Step ${step.number}`, {
        trace_id: context.trace_id,
      });

      return sha;
    } catch (error) {
      if (error instanceof GitNothingToCommitError) {
        // Ignore "nothing to commit" between steps
        await this.logger.info("step.completed_no_changes", `Step ${step.number}`, {
          trace_id: context.trace_id,
        });
        return null;
      }
      // Rethrow other git errors (e.g. security violations, lock errors)
      throw error;
    }
  }

  private formatToolOutput(output: unknown): string {
    if (output === null || output === undefined) return "";
    const text = typeof output === "string" ? output : JSON.stringify(output, null, 2);
    if (text.length <= EXECUTION_REPORT_TOOL_OUTPUT_MAX_CHARS) return text;
    return `${text.slice(0, EXECUTION_REPORT_TOOL_OUTPUT_MAX_CHARS)}...`;
  }

  private async generateExecutionReport(
    context: IPlanContext,
    actionReports: IPlanActionReport[],
  ): Promise<string> {
    const reportInputs = actionReports.map((entry) => {
      const header = `Step ${entry.stepNumber}: ${entry.stepTitle}\nTool: ${entry.tool}`;
      const params = `Params: ${JSON.stringify(entry.params)}`;
      const outcome = entry.success ? "Result" : "Error";
      const body = entry.success ? entry.output ?? "" : entry.error ?? "";
      return `${header}\n${params}\n${outcome}: ${body}`;
    });

    const stepsSummary = context.steps.map((step) => `- Step ${step.number}: ${step.title}`).join("\n");
    const rawPrompt = `EXECUTION REPORT\n\n` +
      `You are producing the final analysis report for an approved plan execution.\n` +
      `Only use the tool outputs below. If data is missing, call it out.\n\n` +
      `Plan Summary:\n${stepsSummary}\n\n` +
      `Tool Outputs:\n${reportInputs.join("\n\n")}\n\n` +
      `Write a concise, no-nonsense analysis report in Markdown with sections:\n` +
      `- Summary\n- Findings\n- Evidence (cite file paths or tool outputs)\n- Recommendations\n`;

    const prompt = rawPrompt.length > EXECUTION_REPORT_PROMPT_MAX_CHARS
      ? `${rawPrompt.slice(0, EXECUTION_REPORT_PROMPT_MAX_CHARS)}...`
      : rawPrompt;

    return await this.llmProvider.generate(prompt, {
      temperature: EXECUTION_REPORT_TEMPERATURE,
      max_tokens: EXECUTION_REPORT_MAX_TOKENS,
    });
  }

  /**
   * Build skills context from plan frontmatter
   */
  private buildSkillsContext(frontmatter: JSONObject): string {
    const skillsJson = frontmatter.skills as string | undefined;
    if (!skillsJson) return "";

    try {
      const skills = JSON.parse(skillsJson) as string[];
      if (!skills || skills.length === 0) return "";

      return `INJECTED SKILLS:
The following skills have been explicitly requested for this execution:
${skills.map((s) => `- ${s}`).join("\n")}
You should apply the principles and constraints from these skills during execution.

`;
    } catch {
      return "";
    }
  }

  /**
   * Construct the prompt used to turn a plan step into tool actions.
   */
  private constructStepPrompt(step: IPlanStep, context: IPlanContext): string {
    return `PLAN EXECUTION CONTEXT
Trace ID: ${context.trace_id}
Request ID: ${context.request_id}
Identity: ${context.identity}

CURRENT TASK:
Step ${step.number}: ${step.title}
${step.content}

${this.buildSkillsContext(context.frontmatter)}INSTRUCTIONS:
1. Analyze the current task.
2. Determine which tools to use. Available tools:
   - read_file(path)
   - write_file(path, content)
   - run_command(command, args)
   - list_directory(path)
   - search_files(query, path)
3. Output the tool calls in TOML format within \`\`\`toml\`\`\` blocks.

EXAMPLE OUTPUT:
\`\`\`toml
[[actions]]
tool = "write_file"
[actions.params]
path = "src/hello.ts"
content = "console.log('Hello');"

[[actions]]
tool = "run_command"
[actions.params]
command = "deno"
args = ["check", "src/hello.ts"]
\`\`\`

Generate the TOML actions now.`;
  }

  /**
   * Parse TOML actions from response
   */
  private parseActions(response: string): IPlanAction[] {
    const actions: IPlanAction[] = [];
    const codeBlockRegex = /```toml\s*([\s\S]*?)```/g;
    let match;

    const parseActionObject = (act: Record<string, JSONValue>): IPlanAction | null => {
      if (
        typeof act.tool === "string" && act.params && typeof act.params === "object" && !Array.isArray(act.params)
      ) {
        return {
          tool: act.tool,
          params: act.params as Record<string, JSONValue>,
          description: typeof act.description === "string" ? act.description : undefined,
        };
      }
      return null;
    };

    while ((match = codeBlockRegex.exec(response)) !== null) {
      try {
        const block = match[1].trim();
        const parsed = parseToml(block) as Record<string, JSONValue>;

        if (parsed.actions && Array.isArray(parsed.actions)) {
          parsed.actions.forEach((action) => {
            const act = action as Record<string, JSONValue>;
            const parsedAction = parseActionObject(act);
            if (parsedAction) actions.push(parsedAction);
          });
        } else {
          const parsedAction = parseActionObject(parsed);
          if (parsedAction) actions.push(parsedAction);
        }
      } catch (e) {
        console.error("Failed to parse TOML block:", e);
      }
    }

    return actions;
  }
}
