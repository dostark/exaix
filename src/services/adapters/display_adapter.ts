/**
 * @module DisplayAdapter
 * @path src/services/adapters/display_adapter.ts
 * @description Adapter for EventLogger that satisfies the IDisplayService interface.
 * @architectural-layer Services/Adapters * * @related-files [src/shared/interfaces/i_display_service.ts, src/tui/] */

import type { IDisplayService } from "../../shared/interfaces/i_display_service.ts";
import type { EventLogger } from "../core/event_logger.ts";
import type { LogMetadata } from "../../shared/types/json.ts";

export class DisplayAdapter implements IDisplayService {
  constructor(private logger: EventLogger) {}

  async info(action: string, target: string | null = null, payload: LogMetadata = {}, traceId?: string): Promise<void> {
    return await this.logger.info(action, target ?? "system", payload, traceId);
  }

  async warn(action: string, target: string | null = null, payload: LogMetadata = {}, traceId?: string): Promise<void> {
    return await this.logger.warn(action, target ?? "system", payload, traceId);
  }

  async error(
    action: string,
    target: string | null = null,
    payload: LogMetadata = {},
    traceId?: string,
  ): Promise<void> {
    return await this.logger.error(action, target ?? "system", payload, traceId);
  }

  async debug(
    action: string,
    target: string | null = null,
    payload: LogMetadata = {},
    traceId?: string,
  ): Promise<void> {
    return await this.logger.debug(action, target ?? "system", payload, traceId);
  }

  async fatal(
    action: string,
    target: string | null = null,
    payload: LogMetadata = {},
    traceId?: string,
  ): Promise<void> {
    return await this.logger.fatal(action, target ?? "system", payload, traceId);
  }
}
