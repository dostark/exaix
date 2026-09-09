/**
 * @module InspectCommands
 * @path apps/exactl/src/commands/inspect_commands.ts
 * @description Read-only CLI access to immutable dogfood-context capture records
 *   (`exactl request inspect`). Every field displayed is a direct projection of what
 *   `IContextInspectionReader` already has on disk — this command never invokes a
 *   retriever, provider, analyzer, or prompt builder, and `--raw` exports the exact
 *   post-redaction bytes actually sent to the child, never a reconstruction.
 * @architectural-layer CLI
 * @dependencies [@exaix/session, @exaix/core, @exaix/portal]
 * @related-files [packages/session/src/context_record_store.ts, packages/core/src/types/i_dogfood_context.ts]
 */

import { BaseCommand, type ICommandContext } from "@exaix/cli/base.ts";
import * as colors from "@std/fmt/colors";
import { ContextRecordStore, isValidUuid } from "@exaix/session";
import { PathResolver } from "@exaix/portal";
import { ContextInspectExitCode, ContextInspectionResult } from "@exaix/core";
import { DomainEventType } from "@exaix/core/events";
import type { IContextInspectedPayload, IContextInspectionFailedPayload } from "@exaix/core/events";
import type { IContextInspectionReader } from "@exaix/core/types";
import type { Opt, Reason } from "@exaix/core/types";
import type { ContextRecord, ContextRecordSummary } from "@exaix/schemas/dogfood_context.ts";
import { stripTerminalControlBytes } from "@exaix/core/func";

export interface IInspectCommandOptions {
  record?: string;
  json?: boolean;
  raw?: boolean;
}

export interface IInspectCommandsDeps {
  /** Defaults to a real `ContextRecordStore` over this context's own `PathResolver`. */
  store?: IContextInspectionReader;
  /** Defaults to a real `Deno.stdout` writer. Injectable so `--raw` output is testable
   *  without capturing the process's real stdout. */
  writeRaw?: (text: string) => Promise<void>;
  /** Defaults to `Deno.stdout.isTerminal()`. */
  isStdoutTty?: () => boolean;
}

/** A record with its display-ready `launchStatusHint` — the only field this command adds
 *  that is not a direct `ContextRecord` projection, and it is never persisted. */
interface IDetailView extends ContextRecord {
  launchStatusHint: string;
}

/** Chars of `promptText` shown in a non-raw, non-JSON detail preview. */
const DETAIL_PREVIEW_MAX_CHARS = 2000;
const EMPTY_TOOL_LIST_LABEL = "(none)";
/** Recent journal rows consulted for a best-effort launch-status hint — never used to
 *  reconstruct prompt/response text, only to surface the last known event type. */
const LAUNCH_STATUS_HINT_LIMIT = 5;

export class InspectCommands extends BaseCommand {
  private readonly store: IContextInspectionReader;
  private readonly writeRaw: (text: string) => Promise<void>;
  private readonly isStdoutTty: () => boolean;

  constructor(context: ICommandContext, deps: Opt<IInspectCommandsDeps, Reason.OptionalDependency> = {}) {
    super(context);
    this.store = deps.store ?? new ContextRecordStore(new PathResolver(this.config));
    this.writeRaw = deps.writeRaw ?? ((text) => Deno.stdout.write(new TextEncoder().encode(text)).then(() => {}));
    this.isStdoutTty = deps.isStdoutTty ?? (() => Deno.stdout.isTerminal());
  }

  async inspect(traceId: string, options: Opt<IInspectCommandOptions, Reason.OptionalInput> = {}): Promise<void> {
    if (!isValidUuid(traceId)) {
      return await this.failInvalidInput(traceId, `Invalid trace_id: "${traceId}" — must be a full UUID`);
    }
    if (options.record !== undefined && !isValidUuid(options.record)) {
      return await this.failInvalidInput(
        traceId,
        `Invalid --record: "${options.record}" — must be a full UUID`,
        options.record,
      );
    }
    if (options.json && options.raw) {
      return await this.failInvalidInput(traceId, "Cannot combine --json and --raw", options.record);
    }
    if (options.raw && this.isStdoutTty()) {
      return await this.failInvalidInput(
        traceId,
        "Refusing --raw output to a TTY — redirect to a file or pipe",
        options.record,
      );
    }

    if (options.record) {
      const record = await this.readOrExit(traceId, options.record);
      await this.emitInspected(traceId, record.recordId, ContextInspectionResult.DETAIL, 1, options.raw);
      return options.raw ? await this.writeRaw(record.promptText) : await this.renderDetail(record, options.json);
    }

    const summaries = await this.resolveSummaries(traceId);
    if (summaries.length === 0) {
      await this.emitInspected(traceId, undefined, ContextInspectionResult.NO_CAPTURE, 0);
      console.error(colors.yellow(`No captured context found for trace ${traceId}.`));
      Deno.exit(ContextInspectExitCode.NO_CAPTURE);
    }
    if (summaries.length === 1) {
      const only = summaries[0];
      const record = await this.readOrExit(only.executionTraceId, only.recordId);
      await this.emitInspected(traceId, record.recordId, ContextInspectionResult.DETAIL, 1, options.raw);
      return options.raw ? await this.writeRaw(record.promptText) : await this.renderDetail(record, options.json);
    }
    if (options.raw) {
      return await this.failInvalidInput(
        traceId,
        `${summaries.length} records found — pass --record <uuid> to select one for --raw export`,
      );
    }
    await this.emitInspected(traceId, undefined, ContextInspectionResult.LIST, summaries.length);
    this.renderList(summaries, options.json);
  }

  /** Direct child-trace records first; falls back to the bounded parent-lineage lookup
   *  only when the caller's id is not itself a known execution trace. */
  private async resolveSummaries(traceId: string): Promise<readonly ContextRecordSummary[]> {
    const direct = await this.store.list(traceId);
    if (direct.length > 0) return direct;
    return await this.store.listByParentTrace(traceId);
  }

  /** Classifies a store read failure: a genuinely missing record is `no_capture` (exit 3,
   *  never reconstructed); anything else (corrupt JSON, permission denied, a refused
   *  symlink) is a read failure (exit 1). */
  private async readOrExit(traceId: string, recordId: string): Promise<ContextRecord> {
    try {
      return await this.store.read(traceId, recordId);
    } catch (error) {
      if (error instanceof Deno.errors.NotFound) {
        await this.emitInspected(traceId, recordId, ContextInspectionResult.NO_CAPTURE, 0);
        console.error(colors.yellow(`No captured context found for trace ${traceId}, record ${recordId}.`));
        Deno.exit(ContextInspectExitCode.NO_CAPTURE);
      }
      const reason = error instanceof Error ? error.message : String(error);
      await this.emitInspectionFailed(traceId, recordId, reason);
      console.error(colors.red(`Failed to read captured context: ${reason}`));
      Deno.exit(ContextInspectExitCode.READ_FAILURE);
    }
  }

  private async failInvalidInput(
    traceId: string,
    message: string,
    recordId?: Opt<string, Reason.OptionalInput>,
  ): Promise<void> {
    await this.emitInspectionFailed(traceId, recordId, message);
    console.error(colors.red(message));
    Deno.exit(ContextInspectExitCode.INVALID_INPUT);
  }

  private async renderDetail(record: ContextRecord, json?: Opt<boolean, Reason.OptionalInput>): Promise<void> {
    const launchStatusHint = await this.lookupLaunchStatusHint(record);
    const view: IDetailView = { ...record, launchStatusHint };
    if (json) {
      console.log(JSON.stringify(view, null, 2));
      return;
    }
    const preview = stripTerminalControlBytes(record.promptText).slice(0, DETAIL_PREVIEW_MAX_CHARS);
    const lines = [
      `Record:        ${record.recordId}`,
      `Trace:         ${record.executionTraceId} (parent ${record.parentTraceId})`,
      `Step:          ${record.stepId} — sequence ${record.sequence}, turn ${record.turn}, attempt ${record.attempt}`,
      `Surface:       ${record.surface}`,
      `Model:         ${record.model}`,
      `Timestamp:     ${record.timestamp}`,
      `Tokens:        ${record.originalTokenCount} original -> ${record.finalTokenCount} final (${record.tokenSource}, limit ${record.effectiveInputLimit}, reserve ${record.effectiveReserveLimit})`,
      `Native visibility: prompt=${record.nativePrompt}, tools=${record.nativeTools}, history=${record.nativeHistory}`,
      `Granted tools: ${record.tools.map((t) => t.name).join(", ") || EMPTY_TOOL_LIST_LABEL}`,
      `Launch status (journal hint, informational only): ${launchStatusHint}`,
      "",
      "Sections:",
      ...record.sections.map((s) =>
        `  ${s.label} [${s.allocatorSection}] allocated=${s.allocatedTokens} actual=${s.actualTokens} ` +
        `selected=${s.selectedSourceIds.length} omitted=${s.omittedIds.length} truncated=${s.truncated}` +
        (s.unavailableReason ? ` unavailable=${s.unavailableReason}` : "")
      ),
      "",
      `Prompt preview (post-redaction, first ${DETAIL_PREVIEW_MAX_CHARS} chars):`,
      preview,
    ];
    console.log(lines.join("\n"));
  }

  private renderList(summaries: readonly ContextRecordSummary[], json?: Opt<boolean, Reason.OptionalInput>): void {
    if (json) {
      console.log(JSON.stringify(summaries, null, 2));
      return;
    }
    const lines = summaries.map((s) =>
      `${s.recordId}  seq=${s.sequence} turn=${s.turn} attempt=${s.attempt}  ${s.surface}  ${s.model}  ${s.timestamp}`
    );
    console.log(lines.join("\n"));
  }

  /** Best-effort: the last journalled activity for this record's execution trace. Never
   *  reconstructs prompt/response text — only surfaces the most recent event's name. */
  private async lookupLaunchStatusHint(record: ContextRecord): Promise<string> {
    try {
      const rows = await this.db.queryActivity({
        traceId: record.executionTraceId,
        limit: LAUNCH_STATUS_HINT_LIMIT,
      });
      return rows.length > 0 ? rows[rows.length - 1].action_type : "unknown";
    } catch {
      return "unknown";
    }
  }

  /** `suppressConsoleEcho` keeps the audit journal write but silences its console banner —
   *  `--raw`'s contract is byte-exact redirected stdout, which a banner would corrupt. */
  private async emitInspected(
    traceId: string,
    recordId: Opt<string, Reason.OptionalInput>,
    result: ContextInspectionResult,
    recordCount: number,
    suppressConsoleEcho: Opt<boolean, Reason.OptionalInput> = false,
  ): Promise<void> {
    const payload: IContextInspectedPayload = {
      trace_id: traceId,
      ...(recordId ? { record_id: recordId } : {}),
      result,
      record_count: recordCount,
    };
    await this.withConsoleLogSuppressed(
      suppressConsoleEcho === true,
      () => this.display.info(DomainEventType.ContextInspected, recordId ?? traceId, { ...payload }, traceId),
    );
  }

  private async withConsoleLogSuppressed(suppress: boolean, fn: () => Promise<void>): Promise<void> {
    if (!suppress) return await fn();
    const originalLog = console.log;
    console.log = () => {};
    try {
      await fn();
    } finally {
      console.log = originalLog;
    }
  }

  private async emitInspectionFailed(
    traceId: string,
    recordId: Opt<string, Reason.OptionalInput>,
    reason: string,
  ): Promise<void> {
    const payload: IContextInspectionFailedPayload = {
      trace_id: traceId,
      ...(recordId ? { record_id: recordId } : {}),
      reason,
    };
    await this.display.info(DomainEventType.ContextInspectionFailed, recordId ?? traceId, { ...payload }, traceId);
  }
}
