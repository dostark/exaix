/**
 * @module WatchCommand
 * @path apps/exactl/src/commands/watch.ts
 * @description CLI command `exactl request watch` that tails live execution
 * SSE streams with color-coded output, falling back to historical DB queries
 * for completed traces.
 * @architectural-layer CLI
 * @dependencies [exaix-team/packages/mcp-server/sse_handler.ts, packages/core/src/observability/event_bus_service.ts]
 * @related-files [apps/exactl/src/commands/journal_commands.ts, exaix-team/packages/mcp-server/sse_handler.ts]
 */

import { BaseCommand, type ICommandContext } from "@exaix/cli/base.ts";
import { ExaCtlError, ExaCtlExitCode } from "@exaix/cli/errors/exactl_errors.ts";
import * as colors from "@std/fmt/colors";
import { z } from "zod";
import type { IStreamingEvent } from "@exaix/schemas/streaming_event.ts";
import {
  STREAMING_EVENT_FLOW_STATUS,
  STREAMING_EVENT_HEARTBEAT,
  STREAMING_EVENT_LLM_STREAM,
  STREAMING_EVENT_MILESTONE,
  STREAMING_EVENT_TOOL_END,
  STREAMING_EVENT_TOOL_START,
} from "@exaix/core";
import type { IJournalFilterOptions } from "@exaix/core/types";
import { type ExaCtlOutputRenderer, type IJsonRow, stripTerminalControls, toRow } from "../output/exactl_output.ts";
import type { JSONValue } from "@exaix/core";

const HISTORICAL_RULE_WIDTH = 60;

function cleanJson(value: JSONValue): JSONValue {
  if (typeof value === "string") return stripTerminalControls(value);
  if (Array.isArray(value)) return value.map(cleanJson);
  if (value !== null && typeof value === "object") {
    return Object.fromEntries(Object.entries(value).map(([key, entry]) => [key, cleanJson(entry)]));
  }
  return value;
}

/** The payload with terminal control characters removed from every string. */
function cleanPayload(payload: IStreamingEvent["payload"]): IJsonRow {
  return cleanJson(toRow(payload)) as IJsonRow;
}
const CLOCK_START = 11;
const CLOCK_END = 19;

/**
 * WatchCommand provides real-time execution tailing via SSE or historical fallback.
 */
export class WatchCommand extends BaseCommand {
  constructor(context: ICommandContext) {
    super(context);
  }

  /**
   * Watch a trace by ID. Tries SSE stream first; falls back to DB query.
   */
  async watch(
    traceId: string,
    renderer: ExaCtlOutputRenderer,
  ): Promise<void> {
    // Validate traceId
    const parseResult = z.string().uuid().safeParse(traceId);
    if (!parseResult.success) {
      throw new ExaCtlError(
        ExaCtlExitCode.USAGE,
        `Invalid traceId: must be a valid UUID. Got: "${traceId}"`,
      );
    }

    // Try SSE stream first (with a short timeout to detect if server is running)
    const ssePort = Deno.env.get("EXA_SSE_PORT") ? parseInt(Deno.env.get("EXA_SSE_PORT")!, 10) : 8765;
    const sseUrl = `http://127.0.0.1:${ssePort}/api/v1/traces/${traceId}/stream`;

    try {
      const controller = new AbortController();
      const timeoutId = setTimeout(() => controller.abort(), 2000);

      try {
        const response = await fetch(sseUrl, {
          signal: controller.signal,
          headers: { Accept: "text/event-stream" },
        });
        clearTimeout(timeoutId);

        if (response.ok && response.body) {
          await this.streamSse(response, renderer);
          return;
        }
      } catch {
        clearTimeout(timeoutId);
      }
    } catch {
      // SSE server not available — fall back to historical query
    }

    // Fallback: query historical events from DB
    await this.showHistoricalEvents(traceId, renderer);
  }

  /**
   * Stream and pretty-print SSE events from the server.
   */
  private async streamSse(response: Response, renderer: ExaCtlOutputRenderer): Promise<void> {
    const reader = response.body?.getReader();
    if (!reader) {
      console.error(colors.red("No response body from SSE stream"));
      return;
    }

    const decoder = new TextDecoder();
    let buffer = "";

    while (true) {
      const { done, value } = await reader.read();
      if (done) break;

      buffer += decoder.decode(value, { stream: true });

      // Parse SSE events (separated by double newline)
      const events = buffer.split("\n\n");
      buffer = events.pop() || "";

      for (const eventText of events) {
        const event = this.parseSseEvent(eventText.trim());
        if (event) {
          await WatchCommand.emitSseEvent(event, renderer);
        }
      }
    }
  }

  /**
   * Parse a raw SSE event text into an IStreamingEvent.
   */
  private parseSseEvent(text: string): IStreamingEvent | null {
    const dataMatch = text.match(/^data:\s*(.+)$/m);
    if (!dataMatch) return null;
    try {
      return JSON.parse(dataMatch[1]) as IStreamingEvent;
    } catch {
      return null;
    }
  }

  /** Prints one streaming event: JSON for a machine format, a color-coded line for humans. */
  static async emitSseEvent(event: IStreamingEvent, renderer: ExaCtlOutputRenderer): Promise<void> {
    if (renderer.machine) await renderer.event(toRow(event));
    else await renderer.text(WatchCommand.formatSseEvent(event));
  }

  /** Formats a streaming event as one color-coded line by event category. Untrusted text is stripped of terminal controls. */
  static formatSseEvent(event: IStreamingEvent): string {
    const timestamp = colors.dim(new Date(event.timestamp).toISOString().slice(CLOCK_START, CLOCK_END));
    const type = stripTerminalControls(event.type);
    const clean = cleanPayload(event.payload);

    let formatted: string;

    switch (type) {
      case STREAMING_EVENT_HEARTBEAT:
        formatted = colors.dim(
          `[${timestamp}] ♥ heartbeat step="${clean.step}" elapsed=${clean.elapsed_ms}ms`,
        );
        break;
      case STREAMING_EVENT_MILESTONE: {
        const payload = clean;
        const milestoneType = String(payload.milestoneType ?? "");
        const summary = String(payload.summary ?? "");
        const requiresAttention = payload.requiresAttention === true;
        const progressHint = payload.progressHint as
          | { stepsCompleted?: number; stepsTotal?: number; currentStepLabel?: string }
          | undefined;
        const attentionReason = payload.attentionReason ? String(payload.attentionReason) : undefined;

        let progress = "";
        if (progressHint?.stepsTotal && progressHint?.stepsCompleted !== undefined) {
          progress = ` [${progressHint.stepsCompleted}/${progressHint.stepsTotal}`;
          if (progressHint.currentStepLabel) {
            progress += ` ${progressHint.currentStepLabel}`;
          }
          progress += "]";
        }

        if (requiresAttention) {
          const reason = attentionReason ? `: ${attentionReason}` : "";
          formatted = colors.bold(colors.yellow(
            `[${timestamp}] ⚠ ATTENTION — ${milestoneType}${reason}${progress}`,
          ));
        } else {
          formatted = colors.cyan(
            `[${timestamp}] ★ milestone: ${milestoneType} — ${summary}${progress}`,
          );
        }
        break;
      }
      case STREAMING_EVENT_TOOL_START:
        formatted = colors.cyan(
          `[${timestamp}] ▶ tool.start tool="${clean.tool}"`,
        );
        break;
      case STREAMING_EVENT_TOOL_END:
        formatted = colors.cyan(
          `[${timestamp}] ◀ tool.end tool="${clean.tool}"`,
        );
        break;
      case STREAMING_EVENT_LLM_STREAM:
        formatted = colors.white(
          `[${timestamp}] ◈ llm.stream ${clean.text ?? ""}`,
        );
        break;
      case STREAMING_EVENT_FLOW_STATUS:
        formatted = colors.green(
          `[${timestamp}] ◆ flow.status status="${clean.status ?? "unknown"}"`,
        );
        break;
      default:
        formatted = `[${timestamp}] ${type} ${JSON.stringify(clean)}`;
    }

    return formatted;
  }

  /**
   * Query and display historical events for a completed trace.
   */
  private async showHistoricalEvents(traceId: string, renderer: ExaCtlOutputRenderer): Promise<void> {
    const filterOptions: IJournalFilterOptions = { traceId };
    const results = await this.db.queryActivity(filterOptions);

    if (renderer.machine) {
      for (const row of results) await renderer.event(toRow(row));
      return;
    }
    if (results.length === 0) {
      await renderer.text(colors.yellow(`No events found for trace: ${traceId}`));
      return;
    }
    await renderer.text(colors.bold(colors.cyan(`Historical events for trace: ${traceId}`)));
    await renderer.text(colors.dim("─".repeat(HISTORICAL_RULE_WIDTH)));
    for (const row of results) {
      const clock = new Date(row.timestamp).toISOString().slice(CLOCK_START, CLOCK_END);
      const target = stripTerminalControls(row.target ?? "");
      const payload = stripTerminalControls(row.payload);
      await renderer.text(
        `${colors.dim(clock)} ${stripTerminalControls(row.action_type)} ${target} ${payload}`.trimEnd(),
      );
    }
  }
}
