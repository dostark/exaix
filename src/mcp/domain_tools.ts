/**
 * @module DomainTools
 * @path src/mcp/domain_tools.ts
 * @description Exposes domain-specific Exaix operations (requests, plans, journal) as strictly typed MCP tools.
 * @architectural-layer MCP
 * * @related-files [src/mcp/server.ts, src/cli/request_commands.ts, src/cli/plan_commands.ts]
 */
import {
  ApprovePlanToolArgsSchema,
  CreateRequestToolArgsSchema,
  ListPlansToolArgsSchema,
  type MCPToolResponse,
  QueryJournalToolArgsSchema,
} from "../shared/schemas/mcp.ts";
import { JSONValue } from "../shared/types/json.ts";
import { ToolHandler } from "./tool_handler.ts";
import { RequestCommands } from "../cli/commands/request_commands.ts";
import { PlanCommands } from "../cli/commands/plan_commands.ts";
import { PlanStatus, type PlanStatusType } from "../shared/status/plan_status.ts";
import { RequestSource } from "../shared/enums.ts";

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

      this.logToolExecution("create_request", "system", identity_id, {
        description,
        identity: identityId,
        identity_id,
        request_id: result.filename.replace(".md", ""),
        trace_id: result.trace_id,
        success: true,
      });

      return {
        content: [
          {
            type: "text",
            text:
              `Request created successfully.\nID: ${result.filename}\nTrace ID: ${result.trace_id}\nPath: ${result.path}`,
          },
        ],
      };
    } catch (error) {
      this.formatError("create_request", "system", identity_id, error, {
        description,
        identity_id: identity_id ?? null,
      });
    }
  }

  getToolDefinition() {
    return {
      name: "exaix_create_request",
      description: "Create a new generic request for Exaix",
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

      this.logToolExecution("list_plans", "system", identity_id, {
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
        ],
      };
    } catch (error) {
      this.formatError("list_plans", "system", identity_id, error, {
        status: status ?? null,
        identity_id: identity_id ?? null,
      });
    }
  }

  getToolDefinition() {
    return {
      name: "exaix_list_plans",
      description: "List plans matching a status (default: pending)",
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

      this.logToolExecution("approve_plan", "system", identity_id, {
        plan_id,
        identity_id,
        success: true,
      });

      return {
        content: [
          {
            type: "text",
            text: `Plan ${plan_id} approved successfully. Execution will proceed.`,
          },
        ],
      };
    } catch (error) {
      this.formatError("approve_plan", "system", identity_id, error, { plan_id, identity_id: identity_id ?? null });
    }
  }

  getToolDefinition() {
    return {
      name: "exaix_approve_plan",
      description: "Approve a pending plan for execution",
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

      this.logToolExecution("query_journal", "system", identity_id, {
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
        ],
      };
    } catch (error) {
      this.formatError("query_journal", "system", identity_id, error, {
        trace_id: trace_id ?? null,
        limit: limit ?? null,
        identity_id: identity_id ?? null,
      });
    }
  }

  getToolDefinition() {
    return {
      name: "exaix_query_journal",
      description: "Query the IActivity Journal for events",
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
