/**
 * @module RequestCreateHandler
 * @path src/cli/handlers/request_create_handler.ts
 * @description Handles the creation of agent requests, including input validation, unique trace ID generation, and YAML frontmatter serialization.
 * @architectural-layer CLI
 * * @related-files [src/cli/request_commands.ts, src/schemas/request.ts]
 */

import { join } from "@std/path";
import { ensureDir, exists } from "@std/fs";
import { BaseCommand, type ICommandContext } from "../base.ts";
import { RequestPriority, RequestSource } from "../../shared/enums.ts";
import { RequestStatus } from "../../shared/status/request_status.ts";
import { ValidationChain } from "../validation/validation_chain.ts";
import { DefaultErrorStrategy } from "../errors/error_strategy.ts";
import { CommandUtils } from "../helpers/command_utils.ts";
import {
  type IRequestMetadata as RequestMetadata,
  type IRequestOptions as RequestOptions,
} from "../../shared/types/request.ts";
import { resolveSubject } from "../helpers/subject_generator.ts";
import { getWorkspaceRequestsDir } from "./request_paths.ts";
import { AnalysisMode, type IRequestAnalysis } from "../../shared/types/request.ts";
import { DEFAULT_IDENTITY_ID } from "../../shared/constants.ts";

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
    options: RequestOptions = {},
    source: RequestSource = RequestSource.CLI,
  ): Promise<RequestMetadata> {
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

      const frontmatterFields: Record<string, string | boolean> = {
        trace_id,
        created,
        status: initialStatus,
        priority,
        identity: agent,
        source,
        created_by,
        subject,
        subject_is_fallback: !options.subject?.trim(),
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
        error,
      });
      throw error;
    }
  }

  private validateCreateInputs(description: string, options: RequestOptions, priority: RequestPriority): void {
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
        "flow",
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
    options: RequestOptions,
    portal: string | undefined,
  ): void {
    if (portal) {
      frontmatterFields.portal = portal;
    }

    if (options.target_branch) {
      frontmatterFields.target_branch = options.target_branch;
    }

    if (options.model) {
      frontmatterFields.model = options.model;
    }

    if (options.flow) {
      frontmatterFields.flow = options.flow;
    }

    if (options.skills && options.skills.length > 0) {
      frontmatterFields.skills = JSON.stringify(options.skills);
    }

    if (options.acceptanceCriteria && options.acceptanceCriteria.length > 0) {
      frontmatterFields.acceptance_criteria = JSON.stringify(options.acceptanceCriteria);
    }

    if (options.expectedOutcomes && options.expectedOutcomes.length > 0) {
      frontmatterFields.expected_outcomes = JSON.stringify(options.expectedOutcomes);
    }
  }

  async createFromFile(
    filePath: string,
    options: RequestOptions = {},
  ): Promise<RequestMetadata> {
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

      // Create request with file source
      return this.create(trimmed, options, RequestSource.FILE);
    } catch (error) {
      await DefaultErrorStrategy.handle({
        commandName: "RequestCreateHandler.createFromFile",
        args: { filePath, options },
        error,
      });
      throw error;
    }
  }
}
