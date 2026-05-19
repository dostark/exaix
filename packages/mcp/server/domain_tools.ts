/**
 * @module DomainTools
 * @path packages/mcp/server/domain_tools.ts
 * @description Exposes domain-specific Exaix operations (requests, plans, journal) as strictly typed MCP tools.
 * @architectural-layer MCP
 * @related-files [packages/mcp/server/server.ts, "src/cli/commands/request_commands.ts", "src/cli/commands/plan_commands.ts"]
 */
import {
  ApprovePlanToolArgsSchema,
  CreateRequestToolArgsSchema,
  ListPlansToolArgsSchema,
  type MCPToolResponse,
  QueryJournalToolArgsSchema,
} from "@exaix/schemas/mcp.ts";
import { ToolHandler } from "./tool_handler.ts";
import { RequestCommands } from "../../../src/cli/commands/request_commands.ts";
import { PlanCommands } from "../../../src/cli/commands/plan_commands.ts";
import { type JSONValue, MCP_CONTENT_TYPE_STRUCTURED_DATA, RequestSource, ToolErrorCode } from "@exaix/core";
import { PlanStatus, type PlanStatusType } from "@exaix/core/status";
import { DEFAULT_MCP_IDENTITY_ID } from "@exaix/mcp";

function classifyDomainToolError(error: Error | string | JSONValue): ToolErrorCode {
  const message = error instanceof Error ? error.message.toLowerCase() : String(error).toLowerCase();

  if (message.includes("not found") || message.includes("no such")) {
    return ToolErrorCode.NOT_FOUND;
  }

  if (message.includes("invalid") || message.includes("required") || message.includes("must")) {
    return ToolErrorCode.INVALID_ARGS;
  }

  return ToolErrorCode.EXECUTION_FAILED;
}

function serializeStructuredData(value: object): JSONValue {
  return JSON.parse(JSON.stringify(value)) as JSONValue;
}

/**
 * Tool for creating new Exaix requests
 */
export class CreateRequestTool extends ToolHandler {
  async execute(args: Record<string, JSONValue>): Promise<MCPToolResponse> {
    const validatedArgs = CreateRequestToolArgsSchema.parse(args);
    const { description, agent, identity, identity_id } = validatedArgs;

    try {
      const requestCmd = new RequestCommands(this.context);

      // Phase 54: Use identity (canonical) with agent fallback for backward compatibility
      const identityId = identity ?? agent;

      const result = await requestCmd.create(
        description,
        { identity: identityId },
        RequestSource.MCP,
      );

      this.logToolExecution("create_request", DEFAULT_MCP_IDENTITY_ID, identity_id, {
        description,
        identity: identityId,
        identity_id,
        request_id: result.filename.replace(".md", ""),
        trace_id: result.trace_id,
        success: true,
      });

      const requestRecord = {
        id: result.filename.replace(".md", ""),
        title: result.subject ?? description,
        status: result.status,
        trace_id: result.trace_id,
        filename: result.filename,
        path: result.path,
      };

      return {
        content: [
          {
            type: "text",
            text:
              `Request created successfully.\nID: ${result.filename}\nTrace ID: ${result.trace_id}\nPath: ${result.path}`,
          },
          {
            type: MCP_CONTENT_TYPE_STRUCTURED_DATA,
            data: serializeStructuredData(requestRecord),
          },
        ],
      };
    } catch (error) {
      const classifiedError = error instanceof Error || typeof error === "string" ? error : String(error);
      const message = error instanceof Error ? error.message : String(error);
      return this.formatToolError(
        "create_request",
        DEFAULT_MCP_IDENTITY_ID,
        identity_id,
        classifyDomainToolError(classifiedError),
        message,
        {
          description,
          identity_id: identity_id ?? null,
        },
      );
    }
  }

  getToolDefinition(): { name: string; description: string; inputSchema: Record<string, JSONValue> } {
    return {
      name: "exaix_create_request",
      description:
        "Create a new Exaix request record (a work item to be planned and executed by an agent). Use when a user describes a task that needs agent execution. Mutating — requires human confirmation in Phase 79. Returns the created request record with its assigned ID.",
      inputSchema: {
        type: "object",
        properties: {
          description: {
            type: "string",
            description: "Detailed description of the request",
          },
          identity: {
            type: "string",
            description: "Identity to assign (default: default)",
          },
          agent: {
            type: "string",
            description: "Deprecated: use identity instead",
          },
          identity_id: {
            type: "string",
            description: "Identity identifier for permission checks",
          },
        },
        required: ["description", "identity_id"],
      },
    };
  }
}

/**
 * Tool for listing pending plans
 */
export class ListPlansTool extends ToolHandler {
  async execute(args: Record<string, JSONValue>): Promise<MCPToolResponse> {
    const validatedArgs = ListPlansToolArgsSchema.parse(args);
    const { status, identity_id } = validatedArgs;
    const filterStatus: PlanStatusType = status ?? PlanStatus.PENDING;

    try {
      const planCmd = new PlanCommands(this.context);

      const plans = await planCmd.list(filterStatus);

      this.logToolExecution("list_plans", DEFAULT_MCP_IDENTITY_ID, identity_id, {
        status: filterStatus,
        identity_id,
        count: plans.length,
        success: true,
      });

      return {
        content: [
          {
            type: "text",
            text: JSON.stringify(plans, null, 2),
          },
          {
            type: "exaix_structured_data",
            data: serializeStructuredData(plans),
          },
        ],
      };
    } catch (error) {
      const classifiedError = error instanceof Error || typeof error === "string" ? error : String(error);
      const message = error instanceof Error ? error.message : String(error);
      return this.formatToolError(
        "list_plans",
        DEFAULT_MCP_IDENTITY_ID,
        identity_id,
        classifyDomainToolError(classifiedError),
        message,
        {
          status: status ?? null,
          identity_id: identity_id ?? null,
        },
      );
    }
  }

  getToolDefinition(): { name: string; description: string; inputSchema: Record<string, JSONValue> } {
    return {
      name: "exaix_list_plans",
      description:
        "List all execution plans (active, draft, or completed) tracked in the Exaix workspace. Read-only; safe for dynamic execution. Use to check plan status or find a plan ID before approving or querying. Returns an array of plan summary objects.",
      inputSchema: {
        type: "object",
        properties: {
          status: {
            type: "string",
            enum: [PlanStatus.PENDING, PlanStatus.APPROVED, PlanStatus.REJECTED, PlanStatus.REVIEW],
            description: "Status to filter by",
          },
          identity_id: {
            type: "string",
            description: "Identity identifier for permission checks",
          },
        },
        required: ["identity_id"],
      },
    };
  }
}

/**
 * Tool for approving a plan
 */
export class ApprovePlanTool extends ToolHandler {
  async execute(args: Record<string, JSONValue>): Promise<MCPToolResponse> {
    const validatedArgs = ApprovePlanToolArgsSchema.parse(args);
    const { plan_id, identity_id } = validatedArgs;

    try {
      const planCmd = new PlanCommands(this.context);

      // We don't check existence separately as approve() handles it (or throws)
      await planCmd.approve(plan_id);

      this.logToolExecution("approve_plan", DEFAULT_MCP_IDENTITY_ID, identity_id, {
        plan_id,
        identity_id,
        success: true,
      });

      const approvedPlan = {
        id: plan_id,
        status: PlanStatus.APPROVED,
      };

      return {
        content: [
          {
            type: "text",
            text: `Plan ${plan_id} approved successfully. Execution will proceed.`,
          },
          {
            type: MCP_CONTENT_TYPE_STRUCTURED_DATA,
            data: serializeStructuredData(approvedPlan),
          },
        ],
      };
    } catch (error) {
      const classifiedError = error instanceof Error || typeof error === "string" ? error : String(error);
      const message = error instanceof Error ? error.message : String(error);
      return this.formatToolError(
        "approve_plan",
        DEFAULT_MCP_IDENTITY_ID,
        identity_id,
        classifyDomainToolError(classifiedError),
        message,
        {
          plan_id,
          identity_id: identity_id ?? null,
        },
      );
    }
  }

  getToolDefinition(): { name: string; description: string; inputSchema: Record<string, JSONValue> } {
    return {
      name: "exaix_approve_plan",
      description:
        "Approve or reject an execution plan, advancing it to the next state in the Exaix workflow. Use when a human has reviewed a plan and wants to authorize or cancel agent execution. Mutating — requires human confirmation in Phase 79. Returns the updated plan record.",
      inputSchema: {
        type: "object",
        properties: {
          plan_id: {
            type: "string",
            description: "ID of the plan to approve",
          },
          identity_id: {
            type: "string",
            description: "Identity identifier for permission checks",
          },
        },
        required: ["plan_id", "identity_id"],
      },
    };
  }
}

/**
 * Tool for querying the IActivity Journal
 */
export class QueryJournalTool extends ToolHandler {
  async execute(args: Record<string, JSONValue>): Promise<MCPToolResponse> {
    const validatedArgs = QueryJournalToolArgsSchema.parse(args);
    const { trace_id, limit, identity_id } = validatedArgs;

    try {
      let activities;
      if (trace_id) {
        activities = await this.db.getActivitiesByTraceSafe(trace_id);
      } else {
        activities = await this.db.getRecentActivity(limit);
      }

      this.logToolExecution("query_journal", DEFAULT_MCP_IDENTITY_ID, identity_id, {
        trace_id: trace_id ?? null,
        limit: limit ?? null,
        identity_id: identity_id ?? null,
        count: activities.length,
        success: true,
      });

      return {
        content: [
          {
            type: "text",
            text: JSON.stringify(activities, null, 2),
          },
          {
            type: "exaix_structured_data",
            data: serializeStructuredData(activities),
          },
        ],
      };
    } catch (error) {
      const classifiedError = error instanceof Error || typeof error === "string" ? error : String(error);
      const message = error instanceof Error ? error.message : String(error);
      return this.formatToolError(
        "query_journal",
        DEFAULT_MCP_IDENTITY_ID,
        identity_id,
        classifyDomainToolError(classifiedError),
        message,
        {
          trace_id: trace_id ?? null,
          limit: limit ?? null,
          identity_id: identity_id ?? null,
        },
      );
    }
  }

  getToolDefinition(): { name: string; description: string; inputSchema: Record<string, JSONValue> } {
    return {
      name: "exaix_query_journal",
      description:
        "Query the Exaix activity journal for execution history, tool calls, or agent events. Read-only; safe for dynamic execution. Use to audit what happened or look up recent activity in a flow. Returns an array of matching journal entry records.",
      inputSchema: {
        type: "object",
        properties: {
          trace_id: {
            type: "string",
            description: "Filter by specific trace ID",
          },
          limit: {
            type: "number",
            description: "Max records to return (default: 50)",
          },
          identity_id: {
            type: "string",
            description: "Identity identifier for permission checks",
          },
        },
        required: ["identity_id"],
      },
    };
  }
}
