/**
 * @module RequestActionBuilders
 * @path src/cli/command_builders/request_actions.ts
 * @description Provides builders and helper functions for defining request-related CLI actions and subcommands.
 * @architectural-layer CLI
 * @related-files [src/cli/exactl.ts, "src/cli/commands/request_commands.ts"]
 */

import type { RequestCommands } from "../commands/request_commands.ts";
import { addTokenFields } from "@exaix/cli/command_builders/display_helpers.ts";
import {
  DEFAULT_NONE_LABEL,
  DEFAULT_UNKNOWN_ERROR_MESSAGE,
  FlowInputSource,
  type JSONValue,
  type RequestPriority,
} from "@exaix/core";
import { isRequestStatus, REQUEST_STATUS_VALUES } from "@exaix/core/status";
import type { RequestStatus } from "@exaix/core/status";
import { AnalysisMode, type IRequestAnalysis } from "@exaix/core/request";
import { PRIORITY_ICONS } from "@exaix/cli/config.ts";
import type { IDisplayService } from "@exaix/core/types";
import { type JSONObject, toSafeJson } from "@exaix/core";

export interface IRequestActionContext {
  requestCommands: RequestCommands;
  display: IDisplayService;
}

export interface RequestCreateOptions {
  file?: string;
  identity?: string;
  priority?: string | RequestPriority;
  portal?: string;
  targetBranch?: string;
  model?: string;
  flow?: string;
  skills?: string;
  subject?: string;
  json?: boolean;
  dryRun?: boolean;
  analyze?: boolean;
  engine?: string;
  acceptanceCriteria?: string[];
  expectedOutcomes?: string[];
}

export interface RequestListOptions {
  status?: RequestStatus;
  all?: boolean;
  json?: boolean;
}

export interface RequestAnalyzeOptions {
  engine?: string;
  json?: boolean;
  force?: boolean;
}

/**
 * Handle request analyze action
 */
export async function handleRequestAnalyze(
  context: IRequestActionContext,
  id: string,
  options: RequestAnalyzeOptions,
): Promise<void> {
  const { requestCommands, display } = context;

  try {
    const mode = (options.engine as AnalysisMode) ?? AnalysisMode.HYBRID;
    const analysis = await requestCommands.analyze(id, mode, options.force);

    if (options.json) {
      console.log(JSON.stringify(analysis, null, 2));
    } else {
      const analysisData: JSONObject = {
        trace_id: id,
        mode: analysis.metadata.mode,
        complexity: analysis.complexity,
        actionability: `${analysis.actionabilityScore}%`,
        ambiguities: analysis.ambiguities.length,
        goals: analysis.goals.length,
        requirements: analysis.requirements.length,
      };

      display.info("request.analyzed", id, toSafeJson(analysisData) as Record<string, JSONValue>);

      if (analysis.ambiguities.length > 0) {
        display.info("request.ambiguities", id, {
          items: analysis.ambiguities.map((ambiguity) => `[${ambiguity.impact}] ${ambiguity.description}`),
        });
      }
    }
  } catch (error) {
    display.error("cli.error", "request analyze", {
      message: error instanceof Error ? error.message : DEFAULT_UNKNOWN_ERROR_MESSAGE,
    });
    Deno.exit(1);
  }
}

/**
 * Handle request create action
 */
export async function handleRequestCreate(
  context: IRequestActionContext,
  options: RequestCreateOptions,
  description?: string,
): Promise<void> {
  const { requestCommands, display } = context;

  try {
    // Phase 54: Use only identity field (agent field removed)
    const identityId = options.identity;

    const createOptions = {
      identity: options.flow ? undefined : identityId,
      priority: options.priority as RequestPriority,
      portal: options.portal,
      target_branch: options.targetBranch,
      model: options.model,
      flow: options.flow,
      skills: options.skills ? options.skills.split(",").map((s: string) => s.trim()) : undefined,
      subject: options.subject,
      analyze: options.analyze,
      analysis_engine: options.engine as AnalysisMode,
      acceptanceCriteria: options.acceptanceCriteria,
      expectedOutcomes: options.expectedOutcomes,
    };

    // Handle file input
    if (options.file) {
      const result = await requestCommands.createFromFile(options.file, createOptions);
      printRequestResult(context, result, !!options.json, !!options.dryRun);
      return;
    }

    // Require description for inline mode
    if (!description) {
      display.error("cli.error", FlowInputSource.REQUEST, {
        message: 'Description required. Usage: exactl request "<description>" or use --file',
      });
      Deno.exit(1);
    }

    // Create request
    const result = await requestCommands.create(description, createOptions);

    if (options.dryRun) {
      display.info("cli.dry_run", FlowInputSource.REQUEST, { would_create: result.filename });
      return;
    }

    printRequestResult(context, result, !!options.json, false);
  } catch (error) {
    display.error("cli.error", FlowInputSource.REQUEST, {
      message: error instanceof Error ? error.message : DEFAULT_UNKNOWN_ERROR_MESSAGE,
    });
    Deno.exit(1);
  }
}

/**
 * Handle request list action
 */
export async function handleRequestList(
  context: IRequestActionContext,
  options: RequestListOptions,
): Promise<void> {
  const { requestCommands, display } = context;

  if (options.status !== undefined && !isRequestStatus(options.status)) {
    display.error("cli.error", "request list", {
      message: `Invalid status "${options.status}". Valid values: ${REQUEST_STATUS_VALUES.join(", ")}`,
    });
    Deno.exit(1);
  }

  try {
    const requests = await requestCommands.list(options.status, options.all);
    if (options.json) {
      display.info("cli.output", "requests", { data: JSON.stringify(requests, null, 2) });
    } else {
      if (requests.length === 0) {
        display.info("request.list", "requests", { count: 0, message: "No requests found" });
        return;
      }
      display.info("request.list", "requests", { count: requests.length });
      for (const req of requests) {
        const priorityIcon = PRIORITY_ICONS[req.priority] || PRIORITY_ICONS.default;
        const subjectTag = req.subject ? `[${req.subject}] ` : "";
        display.info(
          `${priorityIcon} ${subjectTag}${req.trace_id.slice(0, 8)}`,
          req.trace_id,
          toSafeJson({
            status: req.status,
            subject: req.subject,
            identity: req.flow ? undefined : req.identity,
            flow: req.flow,
            target_branch: req.target_branch,
            created: `${req.created_by} @ ${req.created}`,
          }) as Record<string, JSONValue>,
        );
      }
    }
  } catch (error) {
    display.error("cli.error", "request list", {
      message: error instanceof Error ? error.message : DEFAULT_UNKNOWN_ERROR_MESSAGE,
    });
    Deno.exit(1);
  }
}

/**
 * Handle request show action
 */
export async function handleRequestShow(
  context: IRequestActionContext,
  id: string,
): Promise<void> {
  const { requestCommands, display } = context;

  try {
    const { metadata, content } = await requestCommands.show(id);
    const displayData: JSONObject = {
      trace_id: metadata.trace_id,
      status: metadata.status,
      subject: metadata.subject,
      priority: metadata.priority,
      identity: metadata.flow ? undefined : metadata.identity,
      flow: metadata.flow,
      target_branch: metadata.target_branch,
      created: `${metadata.created_by} @ ${metadata.created}`,
    };

    addTokenFields(displayData, metadata);
    if (metadata.error !== undefined) {
      displayData.error = metadata.error;
    }

    display.info("request.show", metadata.trace_id.slice(0, 8), toSafeJson(displayData) as Record<string, JSONValue>);

    const { analysis } = await requestCommands.show(id);
    if (analysis) {
      const analysisData: JSONObject = {
        complexity: analysis.complexity,
        actionability: `${analysis.actionabilityScore}%`,
        ambiguity: analysis.ambiguities.length > 0 ? `${analysis.ambiguities.length} items` : DEFAULT_NONE_LABEL,
      };
      display.info(
        "request.analysis",
        metadata.trace_id.slice(0, 8),
        toSafeJson(analysisData) as Record<string, JSONValue>,
      );
    }

    display.info("request.content", id, { content });
  } catch (error) {
    display.error("cli.error", "request show", {
      message: error instanceof Error ? error.message : DEFAULT_UNKNOWN_ERROR_MESSAGE,
    });
    Deno.exit(1);
  }
}

/**
 * Print request result (helper function)
 */
function printRequestResult(
  context: IRequestActionContext,
  result: {
    priority: RequestPriority;
    trace_id: string;
    filename: string;
    identity?: string;
    flow?: string;
    status: string;
    subject?: string;
    analysis?: IRequestAnalysis;
  },
  json: boolean,
  _dryRun: boolean,
): void {
  const { display } = context;

  if (json) {
    console.log(JSON.stringify(result, null, 2));
  } else {
    const priorityIcon = PRIORITY_ICONS[result.priority] || PRIORITY_ICONS.default;
    display.info(
      "request.created",
      result.trace_id.slice(0, 8),
      toSafeJson({
        trace_id: result.trace_id,
        filename: result.filename,
        priority: `${priorityIcon} ${result.priority}`,
        subject: result.subject,
        identity: result.flow ? undefined : result.identity,
        flow: result.flow,
        status: result.status,
      }) as Record<string, JSONValue>,
    );

    if (result.analysis) {
      const { analysis } = result;
      const analysisData: JSONObject = {
        complexity: analysis.complexity,
        actionability: `${analysis.actionabilityScore}%`,
        ambiguities: analysis.ambiguities.length,
        goals: analysis.goals.length,
        requirements: analysis.requirements.length,
      };
      display.info(
        "request.analysis",
        result.trace_id.slice(0, 8),
        toSafeJson(analysisData) as Record<string, JSONValue>,
      );
    }
  }
}
