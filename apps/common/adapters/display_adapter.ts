/**
 * @module DisplayAdapter
 * @path apps/common/adapters/display_adapter.ts
 * @description Adapter for EventLogger that satisfies the IDisplayService interface.
 * @architectural-layer Services/Adapters * @related-files [@exaix/core/types, apps/tui/src/tui_dashboard.ts] */

import type { IDisplayService } from "@exaix/core/types";
import type { EventLogger } from "@exaix/core/logger";
import type { LogMetadata } from "@exaix/core/types";
import type { Opt, Reason } from "@exaix/core/types";
import { DEFAULT_MCP_AGENT_ROLE_ID } from "@exaix/mcp";

export class DisplayAdapter implements IDisplayService {
  constructor(private logger: EventLogger) {}

  async info(
    action: string,
    target: string | null = null,
    payload: LogMetadata = {},
    traceId?: Opt<string, Reason.TraceAbsent>,
  ): Promise<void> {
    return await this.logger.info(action, target ?? DEFAULT_MCP_AGENT_ROLE_ID, payload, traceId);
  }

  async warn(
    action: string,
    target: string | null = null,
    payload: LogMetadata = {},
    traceId?: Opt<string, Reason.TraceAbsent>,
  ): Promise<void> {
    return await this.logger.warn(action, target ?? DEFAULT_MCP_AGENT_ROLE_ID, payload, traceId);
  }

  async error(
    action: string,
    target: string | null = null,
    payload: LogMetadata = {},
    traceId?: Opt<string, Reason.TraceAbsent>,
  ): Promise<void> {
    return await this.logger.error(action, target ?? DEFAULT_MCP_AGENT_ROLE_ID, payload, traceId);
  }

  async debug(
    action: string,
    target: string | null = null,
    payload: LogMetadata = {},
    traceId?: Opt<string, Reason.TraceAbsent>,
  ): Promise<void> {
    return await this.logger.debug(action, target ?? DEFAULT_MCP_AGENT_ROLE_ID, payload, traceId);
  }

  async fatal(
    action: string,
    target: string | null = null,
    payload: LogMetadata = {},
    traceId?: Opt<string, Reason.TraceAbsent>,
  ): Promise<void> {
    return await this.logger.fatal(action, target ?? DEFAULT_MCP_AGENT_ROLE_ID, payload, traceId);
  }
}
