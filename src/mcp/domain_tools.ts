/**
 * @module DomainTools
 * @path src/mcp/domain_tools.ts
 * @description Compatibility shim for the package-owned MCP domain tool implementations.
 * @architectural-layer MCP
 * @related-files [packages/mcp/server]
 */

import {
  ApprovePlanTool as ApprovePlanToolBase,
  CreateRequestTool as CreateRequestToolBase,
  ListPlansTool as ListPlansToolBase,
  QueryJournalTool as QueryJournalToolBase,
} from "@exaix/mcp/server";

export class CreateRequestTool extends CreateRequestToolBase {}
export class ListPlansTool extends ListPlansToolBase {}
export class ApprovePlanTool extends ApprovePlanToolBase {}
export class QueryJournalTool extends QueryJournalToolBase {}
