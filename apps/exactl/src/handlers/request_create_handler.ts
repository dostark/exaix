/**
 * @module RequestCreateHandler
 * @path apps/exactl/src/handlers/request_create_handler.ts
 * @description Handles the creation of agent requests, including input validation, unique trace ID generation, and YAML frontmatter serialization.
 * @architectural-layer CLI
 * @related-files ["apps/exactl/src/commands/request_commands.ts", "packages/schemas/src/request.ts"]
 */

import { join } from "@std/path";
import { ensureDir, exists } from "@std/fs";
import { parse as parseYaml } from "@std/yaml";
import type { IRequestFrontmatter } from "@exaix/core/request";
import { normalizeFrontmatterList } from "@exaix/request";
import { BaseCommand, type ICommandContext } from "@exaix/cli/base.ts";
import { RequestKind, RequestPriority, RequestSource } from "@exaix/core";
import { RequestStatus } from "@exaix/core/status";
import { ValidationChain } from "@exaix/cli/validation/validation_chain.ts";
import { DefaultErrorStrategy } from "@exaix/cli/errors/error_strategy.ts";
import { CommandUtils } from "@exaix/cli/helpers/command_utils.ts";
import type { IRequestMetadata, IRequestOptions } from "@exaix/core/types";
import { resolveSubject } from "@exaix/cli/helpers/subject_generator.ts";
import { getWorkspaceRequestsDir } from "./request_paths.ts";
import { AnalysisMode, type IRequestAnalysis, type Opt, type Reason } from "@exaix/core/types";
import { DEFAULT_IDENTITY_ID } from "@exaix/core";

const VALID_PRIORITIES: RequestPriority[] = [
  RequestPriority.LOW,
  RequestPriority.NORMAL,
  RequestPriority.HIGH,
  RequestPriority.CRITICAL,
];

export class RequestCreateHandler extends BaseCommand {
  private workspaceRequestsDir: string;

  constructor(context: ICommandContext) {
    super(context);
    this.workspaceRequestsDir = getWorkspaceRequestsDir(context);
  }

  async create(
    description: string,
    options: IRequestOptions = {},
    source: RequestSource = RequestSource.CLI,
  ): Promise<IRequestMetadata> {
    try {
      const trimmedDescription = description.trim();
      const priority = options.priority || RequestPriority.NORMAL;

      this.validateCreateInputs(trimmedDescription, options, priority);
      if (options.flow) await this.assertFlowExists(options.flow);

      // Set defaults
      const agent = options.identity || options.agent || DEFAULT_IDENTITY_ID;
      const portal = options.portal;

      // Generate unique trace_id
      const trace_id = crypto.randomUUID();
      const shortId = trace_id.slice(0, 8);
      const filename = `request-${shortId}.md`;
      const path = join(this.workspaceRequestsDir, filename);

      // Get user identity
      const created_by = await this.getUserIdentity();
      const created = new Date().toISOString();

      // Build frontmatter
      const subject = resolveSubject({
        explicit: options.subject,
        description: trimmedDescription,
      });

      const initialStatus = options.analyze ? RequestStatus.ANALYZING : RequestStatus.PENDING;

      // A flow request must carry NO identity: RequestProcessor.getRequestKindOrFail rejects
      // specifying both. `agent` above always resolves via the DEFAULT_IDENTITY_ID fallback,
      // so it must be added conditionally here rather than unconditionally.
      const frontmatterFields: Record<string, string | boolean> = {
        trace_id,
        created,
        status: initialStatus,
        priority,
        ...(options.flow ? {} : { identity_id: agent }),
        source,
        created_by,
        subject,
      };

      this.addOptionalFrontmatterFields(frontmatterFields, options, portal);

      // Build file content with YAML frontmatter
      const frontmatter = this.serializeFrontmatter(frontmatterFields);
      const content = `${frontmatter}\n\n# Request\n\n${trimmedDescription}\n`;

      // Ensure directory exists
      await ensureDir(this.workspaceRequestsDir);

      // Write file
      await Deno.writeTextFile(path, content);

      let analysis: IRequestAnalysis | undefined;

      // Trigger analysis if requested
      if (options.analyze) {
        analysis = await this.requests.analyze(trace_id, {
          mode: options.analysis_engine === AnalysisMode.LLM ? AnalysisMode.LLM : AnalysisMode.HEURISTIC,
          force: true, // Force fresh analysis
        });
        // Move back to PENDING to trigger daemon processing
        await this.requests.updateRequestStatus(trace_id, RequestStatus.PENDING);
      }

      // Log activity using DisplayService
      await this.display.info("request.created", path, {
        trace_id,
        priority,
        identity: agent,
        agent,
        portal: portal || null,
        model: options.model || null,
        flow: options.flow || null,
        source,
        created_by,
        description_length: trimmedDescription.length,
        via: "cli",
        command: this.getCommandLineString(),
      }, trace_id);

      return {
        trace_id,
        filename,
        path,
        status: RequestStatus.PENDING,
        priority,
        identity: agent,
        portal,
        target_branch: options.target_branch,
        model: options.model,
        model_size: options.model_size,
        preferred_provider: options.preferred_provider,
        thinking: options.thinking,
        effort: options.effort,
        characteristics: options.characteristics,
        flow: options.flow,
        skills: options.skills,
        created,
        created_by,
        source,
        subject,
        analysis,
      };
    } catch (error) {
      await DefaultErrorStrategy.handle({
        commandName: "RequestCreateHandler.create",
        args: { description, options, source },
        error: error as Error | string | object | null | undefined,
      });
      throw error;
    }
  }

  private validateCreateInputs(description: string, options: IRequestOptions, priority: RequestPriority): void {
    const validation = new ValidationChain()
      .addRule("description", (val) => (!val) ? "cannot be empty" : null)
      .addRule(
        "priority",
        (val) =>
          (!VALID_PRIORITIES.includes(val as RequestPriority))
            ? `Invalid priority. Must be one of: ${VALID_PRIORITIES.join(", ")}`
            : null,
      )
      .addRule(
        RequestKind.FLOW,
        (val) =>
          (val && (options.agent || options.identity))
            ? "Cannot specify both 'flow' and 'agent'/'identity'. Use 'flow' for multi-agent workflows or 'identity' for single agent requests."
            : null,
      )
      .validate({ description, priority, flow: options.flow });

    if (!validation.isValid) {
      throw new Error(CommandUtils.formatValidationErrors(validation));
    }
  }

  private async assertFlowExists(flowId: string): Promise<void> {
    const flowPath = join(this.config.system.root, "Blueprints", "Flows", `${flowId}.flow.yaml`);
    try {
      await Deno.stat(flowPath);
    } catch {
      throw new Error(`Flow '${flowId}' not found. Check that the flow file exists in Blueprints/Flows/`);
    }
  }

  private addOptionalFrontmatterFields(
    frontmatterFields: Record<string, string | boolean | number>,
    options: IRequestOptions,
    portal?: Opt<string, Reason.OptionalInput>,
  ): void {
    if (portal) frontmatterFields.portal = portal;
    if (options.target_branch) frontmatterFields.target_branch = options.target_branch;
    if (options.model) frontmatterFields.model = options.model;
    if (options.flow) frontmatterFields.flow = options.flow;

    this.addModelIntentFrontmatterFields(frontmatterFields, options);
    this.addArrayFrontmatterFields(frontmatterFields, options);
    this.addCallSiteFrontmatterFields(frontmatterFields);
  }

  /** Stamps scenario_id/step_id from EXA_SCENARIO_ID/EXA_STEP_ID so AgentRunner can key
   * fixture replay by call site instead of prompt hash; absent outside the scenario framework. */
  private addCallSiteFrontmatterFields(frontmatterFields: Record<string, string | boolean | number>): void {
    const scenarioId = Deno.env.get("EXA_SCENARIO_ID");
    const stepId = Deno.env.get("EXA_STEP_ID");
    if (scenarioId) frontmatterFields.scenario_id = scenarioId;
    if (stepId) frontmatterFields.step_id = stepId;
  }

  private addModelIntentFrontmatterFields(
    frontmatterFields: Record<string, string | boolean | number>,
    options: IRequestOptions,
  ): void {
    if (options.model_size) frontmatterFields.model_size = options.model_size;
    if (options.preferred_provider) frontmatterFields.preferred_provider = options.preferred_provider;
    if (options.thinking !== undefined) frontmatterFields.thinking = options.thinking;
    if (options.effort) frontmatterFields.effort = options.effort;
    if (options.characteristics?.length) frontmatterFields.characteristics = JSON.stringify(options.characteristics);
  }

  private addArrayFrontmatterFields(
    frontmatterFields: Record<string, string | boolean | number>,
    options: IRequestOptions,
  ): void {
    if (options.skills?.length) frontmatterFields.skills = JSON.stringify(options.skills);
    if (options.tags?.length) frontmatterFields.tags = JSON.stringify(options.tags);
    if (options.acceptanceCriteria?.length) {
      frontmatterFields.acceptance_criteria = JSON.stringify(options.acceptanceCriteria);
    }
    if (options.expectedOutcomes?.length) {
      frontmatterFields.expected_outcomes = JSON.stringify(options.expectedOutcomes);
    }
  }

  async createFromFile(
    filePath: string,
    options: IRequestOptions = {},
  ): Promise<IRequestMetadata> {
    try {
      // Check file exists
      if (!await exists(filePath)) {
        throw new Error(`File not found: ${filePath}`);
      }

      // Read file content
      const content = await Deno.readTextFile(filePath);
      const trimmed = content.trim();

      // Validate not empty
      if (!trimmed) {
        throw new Error("File is empty");
      }

      // A submitted file may already carry frontmatter; passing it through as free text would
      // paste it into the BODY of a newly generated block, silently dropping its fields. Split
      // it off and fold it into the options instead; the body alone becomes the description.
      const { frontmatter, body } = splitFileFrontmatter(trimmed);
      if (!frontmatter) return this.create(trimmed, options, RequestSource.FILE);

      const merged = mergeFileFrontmatterIntoOptions(frontmatter, options);
      return this.create(body.trim() || trimmed, merged, RequestSource.FILE);
    } catch (error) {
      await DefaultErrorStrategy.handle({
        commandName: "RequestCreateHandler.createFromFile",
        args: { filePath, options },
        error: error as Error | string | object | null | undefined,
      });
      throw error;
    }
  }
}

/** The submitted file's own frontmatter, plus the body below it. */
interface ISplitFile {
  frontmatter: IRequestFrontmatter | null;
  body: string;
}

/** Splits a submitted request file into its frontmatter block and body. Returns a null
 * frontmatter (file treated as plain prose) when there is no block, the YAML is unparseable,
 * or it parses to something other than a mapping — never silently truncated at a stray `---`. */
function splitFileFrontmatter(content: string): ISplitFile {
  const match = content.match(/^---\s*\n([\s\S]*?)\n---\s*\n?([\s\S]*)$/);
  if (!match) return { frontmatter: null, body: content };
  try {
    const parsed = parseYaml(match[1]);
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
      return { frontmatter: null, body: content };
    }
    return {
      frontmatter: parsed as IRequestFrontmatter,
      body: match[2] ?? "",
    };
  } catch {
    return { frontmatter: null, body: content };
  }
}

/** Folds a submitted file's frontmatter into create options; CLI flags always win. Pipeline-owned
 * fields (trace_id, created, status, source, created_by) are never carried over since `create()`
 * mints fresh ones; the flow/identity exclusion is re-applied here since a frontmatter flow bypasses the CLI's own --flow-only guard. */
function mergeFileFrontmatterIntoOptions(
  frontmatter: IRequestFrontmatter,
  options: IRequestOptions,
): IRequestOptions {
  const priority = VALID_PRIORITIES.find((candidate) => candidate === frontmatter.priority);
  const flow = options.flow ?? frontmatter.flow;
  return {
    ...options,
    identity: flow ? undefined : (options.identity ?? options.agent ?? frontmatter.identity_id),
    agent: flow ? undefined : options.agent,
    priority: options.priority ?? priority,
    portal: options.portal ?? frontmatter.portal,
    target_branch: options.target_branch ?? frontmatter.target_branch,
    model: options.model ?? frontmatter.model,
    model_size: options.model_size ?? frontmatter.model_size,
    preferred_provider: options.preferred_provider ?? frontmatter.preferred_provider,
    thinking: options.thinking ?? frontmatter.thinking,
    effort: options.effort ?? frontmatter.effort,
    characteristics: options.characteristics ?? frontmatter.characteristics,
    flow,
    subject: options.subject ?? frontmatter.subject,
    skills: options.skills ?? normalizeFrontmatterList(frontmatter.skills),
    tags: options.tags ?? normalizeFrontmatterList(frontmatter.tags),
    acceptanceCriteria: options.acceptanceCriteria ?? frontmatter.acceptance_criteria,
    expectedOutcomes: options.expectedOutcomes ?? frontmatter.expected_outcomes,
  };
}
