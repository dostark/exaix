/**
 * @module WatchCommand
 * @path apps/exactl/src/commands/watch.ts
 * @description CLI command `exactl watch <trace_id>` that tails live execution
 * SSE streams with color-coded output, falling back to historical DB queries
 * for completed traces.
 * @architectural-layer CLI
 * @dependencies [packages-team/mcp-server/sse_handler.ts, packages/core/src/observability/event_bus_service.ts]
 * @related-files [apps/exactl/src/commands/journal_commands.ts, packages-team/mcp-server/sse_handler.ts]
 */

import { BaseCommand, type ICommandContext } from "@exaix/cli/base.ts";
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
import { JournalFormatter } from "@exaix/cli/formatters/journal_formatter.ts";
import type { IJournalFilterOptions } from "@exaix/core/types";

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
  async watch(traceId: string, _testMode?: boolean): Promise<void> {
    // Validate traceId
    const parseResult = z.string().uuid().safeParse(traceId);
    if (!parseResult.success) {
      const msg = `Invalid traceId: must be a valid UUID. Got: "${traceId}"`;
      if (Deno.env.get("EXA_TEST_CLI_MODE") === "1") {
        throw new Error(msg);
      }
      console.error(colors.red(msg));
      Deno.exit(1);
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
          await this.streamSse(response);
          return;
        }
      } catch {
        clearTimeout(timeoutId);
      }
    } catch {
      // SSE server not available — fall back to historical query
    }

    // Fallback: query historical events from DB
    await this.showHistoricalEvents(traceId);
  }

  /**
   * Stream and pretty-print SSE events from the server.
   */
  private async streamSse(response: Response): Promise<void> {
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
          WatchCommand.printSseEvent(event);
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

  /**
   * Pretty-print a streaming event with color-coded output.
   * - Heartbeats: dim gray
   * - Tool events: cyan
   * - LLM events: white
   * - Flow status: green
   */
  static printSseEvent(event: IStreamingEvent): void {
    const timestamp = colors.dim(new Date(event.timestamp).toISOString().slice(11, 19));
    const type = event.type;

    let formatted: string;

    switch (type) {
      case STREAMING_EVENT_HEARTBEAT:
        formatted = colors.dim(
          `[${timestamp}] ♥ heartbeat step="${event.payload.step}" elapsed=${event.payload.elapsed_ms}ms`,
        );
        break;
      case STREAMING_EVENT_MILESTONE: {
        const payload = event.payload;
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
          `[${timestamp}] ▶ tool.start tool="${event.payload.tool}"`,
        );
        break;
      case STREAMING_EVENT_TOOL_END:
        formatted = colors.cyan(
          `[${timestamp}] ◀ tool.end tool="${event.payload.tool}"`,
        );
        break;
      case STREAMING_EVENT_LLM_STREAM:
        formatted = colors.white(
          `[${timestamp}] ◈ llm.stream ${event.payload.text ?? ""}`,
        );
        break;
      case STREAMING_EVENT_FLOW_STATUS:
        formatted = colors.green(
          `[${timestamp}] ◆ flow.status status="${event.payload.status ?? "unknown"}"`,
        );
        break;
      default:
        formatted = `[${timestamp}] ${type} ${JSON.stringify(event.payload)}`;
    }

    console.log(formatted);
  }

  /**
   * Query and display historical events for a completed trace.
   */
  private async showHistoricalEvents(traceId: string): Promise<void> {
    const { db } = this;
    const filterOptions: IJournalFilterOptions = { traceId };

    const results = await db.queryActivity(filterOptions);

    if (results.length === 0) {
      console.log(colors.yellow(`No events found for trace: ${traceId}`));
      return;
    }

    console.log(colors.bold(colors.cyan(`Historical events for trace: ${traceId}`)));
    console.log(colors.dim("─".repeat(60)));

    JournalFormatter.render(results, { traceId });
  }
}
