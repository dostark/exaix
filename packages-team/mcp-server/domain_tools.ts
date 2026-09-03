/**
 * @module DomainTools
 * @path packages-team/mcp-server/domain_tools.ts
 * @description Exposes domain-specific Exaix operations (requests, plans, journal) as strictly typed MCP tools.
 * @architectural-layer MCP
 * @related-files [packages-team/mcp-server/server.ts, "apps/exactl/src/commands/request_commands.ts", "apps/exactl/src/commands/plan_commands.ts"]
 */
import {
  ApprovePlanToolArgsSchema,
  CreateRequestToolArgsSchema,
  ListPlansToolArgsSchema,
  type MCPToolResponse,
  QueryJournalToolArgsSchema,
} from "@exaix/schemas/mcp.ts";
import { ToolHandler } from "@exaix/mcp/server";
import { RequestCommands } from "../../apps/exactl/src/commands/request_commands.ts";
import { PlanCommands } from "../../apps/exactl/src/commands/plan_commands.ts";
import { type JSONValue, MCP_CONTENT_TYPE_STRUCTURED_DATA, RequestSource, ToolErrorCode } from "@exaix/core";
import { PlanStatus, type PlanStatusType } from "@exaix/core/status";
import { DEFAULT_MCP_AGENT_ROLE_ID } from "@exaix/mcp";

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
    const { description, agent, assigned_agent_role, agent_role } = validatedArgs;

    try {
      const requestCmd = new RequestCommands(this.context);

      // Use assigned_agent_role (canonical) with agent fallback for backward compatibility
      const resolvedAgentRole = assigned_agent_role ?? agent;

      const result = await requestCmd.create(
        description,
        { agent_role: resolvedAgentRole },
        RequestSource.MCP,
      );

      this.logToolExecution("create_request", DEFAULT_MCP_AGENT_ROLE_ID, agent_role, {
        description,
        assigned_agent_role: resolvedAgentRole,
        agent_role,
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
        DEFAULT_MCP_AGENT_ROLE_ID,
        agent_role,
        classifyDomainToolError(classifiedError),
        message,
        {
          description,
          agent_role: agent_role ?? null,
        },
      );
    }
  }

  getToolDefinition(): { name: string; description: string; inputSchema: Record<string, JSONValue> } {
    return {
      name: "exaix_create_request",
      description:
        "Create a new Exaix request record (a work item to be planned and executed by an agent). Use when a user describes a task that needs agent execution. Mutating — requires human confirmation before execution. Returns the created request record with its assigned ID.",
      inputSchema: {
        type: "object",
        properties: {
          description: {
            type: "string",
            description: "Detailed description of the request",
          },
          assigned_agent_role: {
            type: "string",
            description: "Agent role to assign (default: default)",
          },
          agent: {
            type: "string",
            description: "Deprecated: use assigned_agent_role instead",
          },
          agent_role: {
            type: "string",
            description: "Agent role identifier for permission checks",
          },
        },
        required: ["description", "agent_role"],
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
    const { status, agent_role } = validatedArgs;
    const filterStatus: PlanStatusType = status ?? PlanStatus.PENDING;

    try {
      const planCmd = new PlanCommands(this.context);

      const plans = await planCmd.list(filterStatus);

      this.logToolExecution("list_plans", DEFAULT_MCP_AGENT_ROLE_ID, agent_role, {
        status: filterStatus,
        agent_role,
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
        DEFAULT_MCP_AGENT_ROLE_ID,
        agent_role,
        classifyDomainToolError(classifiedError),
        message,
        {
          status: status ?? null,
          agent_role: agent_role ?? null,
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
          agent_role: {
            type: "string",
            description: "Identity identifier for permission checks",
          },
        },
        required: ["agent_role"],
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
    const { plan_id, agent_role } = validatedArgs;

    try {
      const planCmd = new PlanCommands(this.context);

      // We don't check existence separately as approve() handles it (or throws)
      await planCmd.approve(plan_id);

      this.logToolExecution("approve_plan", DEFAULT_MCP_AGENT_ROLE_ID, agent_role, {
        plan_id,
        agent_role,
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
        DEFAULT_MCP_AGENT_ROLE_ID,
        agent_role,
        classifyDomainToolError(classifiedError),
        message,
        {
          plan_id,
          agent_role: agent_role ?? null,
        },
      );
    }
  }

  getToolDefinition(): { name: string; description: string; inputSchema: Record<string, JSONValue> } {
    return {
      name: "exaix_approve_plan",
      description:
        "Approve or reject an execution plan, advancing it to the next state in the Exaix workflow. Use when a human has reviewed a plan and wants to authorize or cancel agent execution. Mutating — requires human confirmation before execution. Returns the updated plan record.",
      inputSchema: {
        type: "object",
        properties: {
          plan_id: {
            type: "string",
            description: "ID of the plan to approve",
          },
          agent_role: {
            type: "string",
            description: "Identity identifier for permission checks",
          },
        },
        required: ["plan_id", "agent_role"],
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
    const { trace_id, limit, agent_role } = validatedArgs;

    try {
      const reader = this.getJournalReader();
      let activities;
      if (trace_id) {
        activities = await reader.getActivitiesByTraceSafe(trace_id);
      } else {
        activities = await reader.getRecentActivity(limit);
      }

      this.logToolExecution("query_journal", DEFAULT_MCP_AGENT_ROLE_ID, agent_role, {
        trace_id: trace_id ?? null,
        limit: limit ?? null,
        agent_role: agent_role ?? null,
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
        DEFAULT_MCP_AGENT_ROLE_ID,
        agent_role,
        classifyDomainToolError(classifiedError),
        message,
        {
          trace_id: trace_id ?? null,
          limit: limit ?? null,
          agent_role: agent_role ?? null,
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
          agent_role: {
            type: "string",
            description: "Identity identifier for permission checks",
          },
        },
        required: ["agent_role"],
      },
    };
  }
}
