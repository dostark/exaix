/**
 * @module DisplayAdapter
 * @path src/services/adapters/display_adapter.ts
 * @description Adapter for EventLogger that satisfies the IDisplayService interface.
 * @architectural-layer Services/Adapters * @related-files [@exaix/core/types/i_display_service.ts, src/tui/] */

import type { IDisplayService } from "@exaix/core/types/i_display_service.ts";
import type { EventLogger } from "../core/event_logger.ts";
import type { LogMetadata } from "@exaix/core/types/json.ts";
import { DEFAULT_MCP_IDENTITY_ID } from "@exaix/mcp";

export class DisplayAdapter implements IDisplayService {
  constructor(private logger: EventLogger) {}

  async info(action: string, target: string | null = null, payload: LogMetadata = {}, traceId?: string): Promise<void> {
    return await this.logger.info(action, target ?? DEFAULT_MCP_IDENTITY_ID, payload, traceId);
  }

  async warn(action: string, target: string | null = null, payload: LogMetadata = {}, traceId?: string): Promise<void> {
    return await this.logger.warn(action, target ?? DEFAULT_MCP_IDENTITY_ID, payload, traceId);
  }

  async error(
    action: string,
    target: string | null = null,
    payload: LogMetadata = {},
    traceId?: string,
  ): Promise<void> {
    return await this.logger.error(action, target ?? DEFAULT_MCP_IDENTITY_ID, payload, traceId);
  }

  async debug(
    action: string,
    target: string | null = null,
    payload: LogMetadata = {},
    traceId?: string,
  ): Promise<void> {
    return await this.logger.debug(action, target ?? DEFAULT_MCP_IDENTITY_ID, payload, traceId);
  }

  async fatal(
    action: string,
    target: string | null = null,
    payload: LogMetadata = {},
    traceId?: string,
  ): Promise<void> {
    return await this.logger.fatal(action, target ?? DEFAULT_MCP_IDENTITY_ID, payload, traceId);
  }
}
