/**
 * @module DelegateReturnParser
 * @path packages/session/src/delegate_return_parser.ts
 * @description Phase 123 Step 1 — extracted parsing logic for headless delegate
 *   stdout. Pure parser module (no DI) that handles opencode JSONL events (text,
 *   tool_use, step_finish), claude single-result format, and (Phase 166 Step 1)
 *   codex's `item.completed`/`turn.completed` JSONL events. Returns structured
 *   fields for return synthesis.
 * @architectural-layer Services
 * @dependencies []
 * @related-files [apps/daemon/src/headless_session_launcher.ts, packages/schemas/src/session_delegate.ts]
 */

import type { SessionTool } from "@exaix/schemas/session_delegate.ts";
import type { Opt, Reason } from "@exaix/core/types";

export interface IDelegateParsedReturn {
  lastText: string;
  tokenStats: {
    input: number;
    output: number;
    total: number;
    /** Prompt-cache read tokens. undefined when caching wasn't used on this turn —
     *  never 0 for "unknown". Field shape (part.tokens.cache.read) is best-effort per
     *  opencode's documented step_finish shape — Ledger:LIVE_CACHE_TOKEN_VERIFICATION
     *  pending a live probe with active prompt caching. */
    cacheRead?: number;
    /** Prompt-cache write (creation) tokens, one-time per cache segment. */
    cacheCreation?: number;
    /** Reasoning/thinking tokens (Codex turn.completed.usage.reasoning_output_tokens,
     *  Claude CLI's forwarded output_tokens_details.thinking_tokens). A SUBSET of `output`
     *  (billed as output, not additional) — never 0 for "no reasoning happened"; undefined
     *  when the tool doesn't report a breakdown at all. */
    reasoning?: number;
  };
  costUsd: number | undefined;
  toolPaths: string[];
}

/**
 * Shape of a parsed opencode JSONL event line, as actually emitted by
 * `opencode run --format json` (verified via a live CLI probe, 2026-07-20).
 * The tool name is `part.tool` and the write target is
 * `part.state.input.filePath` — not the `part.tool_use.name` /
 * `part.tool_use.input.file_path` shape this previously assumed.
 */
interface IOpencodeEvent {
  type: string;
  part?: {
    text?: string;
    /** cache: best-effort per opencode's documented step_finish shape — not yet
     *  confirmed against a live probe with active prompt caching
     *  (Ledger:LIVE_CACHE_TOKEN_VERIFICATION). */
    tokens?: { input?: number; output?: number; total?: number; cache?: { read?: number; write?: number } };
    cost?: number;
    tool?: string;
    state?: { input?: { filePath?: string } };
  };
}

interface ICodexFileChange {
  path?: string;
  kind?: string;
}

/**
 * Shape of a parsed `codex exec --json` JSONL event line (OpenAI docs; upstream source
 * codex-rs/exec/src/exec_events.rs re-verified 2026-08-21 during Phase 167 post-gap
 * remediation — GAP-26). JSONL like opencode's stream, but with Codex's own event/field
 * names.
 */
interface ICodexEvent {
  type:
    | "thread.started"
    | "turn.started"
    | "turn.completed"
    | "turn.failed"
    | "item.started"
    | "item.completed"
    | "error";
  thread_id?: string;
  item?: {
    id: string;
    type:
      | "agent_message"
      | "reasoning"
      | "command_execution"
      | "file_change"
      | "mcp_tool_call"
      | "web_search"
      | "todo_list"
      | "collab_tool_call"
      | "error";
    text?: string;
    changes?: ICodexFileChange[];
    status?: string;
  };
  usage?: {
    input_tokens: number;
    cached_input_tokens?: number;
    output_tokens: number;
    reasoning_output_tokens?: number;
  };
  /** error event */
  message?: string;
}

const TOOL_CLAUDE_CODE: SessionTool = "claude-code";
const TOOL_CODEX: SessionTool = "codex";
const OPENCODE_EVENT_TEXT = "text";
const OPENCODE_EVENT_STEP_FINISH = "step_finish";
const OPENCODE_EVENT_TOOL_USE = "tool_use";
const CODEX_EVENT_ITEM_COMPLETED = "item.completed";
const CODEX_EVENT_TURN_COMPLETED = "turn.completed";
const CODEX_ITEM_TYPE_AGENT_MESSAGE = "agent_message";
const CODEX_ITEM_TYPE_FILE_CHANGE = "file_change";

/**
 * Parse a delegate tool's complete stdout and extract structured fields for
 * return synthesis. Supports opencode (newline-delimited JSON events) and
 * claude-code (single JSON result object).
 */
export function parseDelegateStdout(stdout: string, tool: SessionTool): IDelegateParsedReturn {
  if (!stdout.trim()) {
    return { lastText: "", tokenStats: { input: 0, output: 0, total: 0 }, costUsd: undefined, toolPaths: [] };
  }

  if (tool === TOOL_CLAUDE_CODE) {
    return parseClaudeResult(stdout);
  }
  if (tool === TOOL_CODEX) {
    return parseCodexJsonl(stdout);
  }

  return parseOpencodeJsonl(stdout);
}

function parseOpencodeJsonl(stdout: string): IDelegateParsedReturn {
  let lastText = "";
  let tokenStats = { input: 0, output: 0, total: 0 };
  let costUsd: number | undefined;
  const runState = { toolPaths: [] as string[], seenPaths: new Set<string>() };

  for (const line of stdout.trim().split("\n")) {
    const event = tryParseEventLine<IOpencodeEvent>(line);
    if (!event) continue;
    const type = event.type as string;
    if (type === OPENCODE_EVENT_TEXT) {
      lastText = handleTextEvent(event, lastText);
    } else if (type === OPENCODE_EVENT_STEP_FINISH) {
      const result = handleStepFinishEvent(event);
      tokenStats = result.tokenStats;
      if (result.costUsd !== undefined) costUsd = result.costUsd;
    } else if (type === OPENCODE_EVENT_TOOL_USE) {
      handleToolUseEvent(event, runState);
    }
  }

  return { lastText, tokenStats, costUsd, toolPaths: runState.toolPaths };
}

function tryParseEventLine<T extends { type: string }>(line: string): T | null {
  if (!line.trim()) return null;
  try {
    const parsed = JSON.parse(line.trim());
    if (typeof parsed === "object" && parsed && parsed.type) return parsed as T;
    return null;
  } catch {
    return null;
  }
}

function handleTextEvent(event: IOpencodeEvent, currentText: string): string {
  if (event.part && typeof event.part.text === "string") return event.part.text;
  return currentText;
}

function handleStepFinishEvent(event: IOpencodeEvent): {
  tokenStats: IDelegateParsedReturn["tokenStats"];
  costUsd: number | undefined;
} {
  let tokenStats: IDelegateParsedReturn["tokenStats"] = { input: 0, output: 0, total: 0 };
  let costUsd: number | undefined;
  if (event.part?.tokens) {
    const t = event.part.tokens;
    tokenStats = {
      input: t.input ?? 0,
      output: t.output ?? 0,
      total: t.total ?? 0,
      cacheRead: t.cache?.read,
      cacheCreation: t.cache?.write,
    };
  }
  if (event.part && typeof event.part.cost === "number") costUsd = event.part.cost;
  return { tokenStats, costUsd };
}

function handleToolUseEvent(
  event: IOpencodeEvent,
  state: { toolPaths: string[]; seenPaths: Set<string> },
): void {
  const name = event.part?.tool ?? "";
  if (!WRITE_TOOL_NAMES.has(name)) return;
  const fp = event.part?.state?.input?.filePath;
  if (typeof fp !== "string" || !fp || state.seenPaths.has(fp)) return;
  state.seenPaths.add(fp);
  state.toolPaths.push(fp);
}

const WRITE_TOOL_NAMES = new Set(["write", "edit"]);

function parseCodexJsonl(stdout: string): IDelegateParsedReturn {
  let lastText = "";
  let tokenStats: IDelegateParsedReturn["tokenStats"] = { input: 0, output: 0, total: 0 };
  const toolPaths: string[] = [];
  const seenPaths = new Set<string>();

  for (const line of stdout.trim().split("\n")) {
    const event = tryParseEventLine<ICodexEvent>(line);
    if (!event) continue;

    if (event.type === CODEX_EVENT_ITEM_COMPLETED && event.item?.type === CODEX_ITEM_TYPE_AGENT_MESSAGE) {
      if (typeof event.item.text === "string") lastText = event.item.text;
    } else if (event.type === CODEX_EVENT_TURN_COMPLETED && event.usage) {
      const usage = event.usage;
      tokenStats = {
        input: usage.input_tokens ?? 0,
        output: usage.output_tokens ?? 0,
        total: (usage.input_tokens ?? 0) + (usage.output_tokens ?? 0),
        cacheRead: usage.cached_input_tokens,
        reasoning: usage.reasoning_output_tokens,
      };
    }

    if (event.item?.type === CODEX_ITEM_TYPE_FILE_CHANGE) {
      collectCodexFileChangePaths(event.item.changes, seenPaths, toolPaths);
    }
  }

  return { lastText, tokenStats, costUsd: undefined, toolPaths };
}

function collectCodexFileChangePaths(
  changes: Opt<ICodexFileChange[], Reason.OptionalInput>,
  seenPaths: Set<string>,
  toolPaths: string[],
): void {
  if (!Array.isArray(changes)) return;
  for (const change of changes) {
    const path = change?.path;
    if (typeof path !== "string" || !path || seenPaths.has(path)) continue;
    seenPaths.add(path);
    toolPaths.push(path);
  }
}

function parseClaudeResult(stdout: string): IDelegateParsedReturn {
  const trimmed = stdout.trim();
  if (!trimmed.startsWith("{") || !trimmed.endsWith("}")) {
    return { lastText: "", tokenStats: { input: 0, output: 0, total: 0 }, costUsd: undefined, toolPaths: [] };
  }
  try {
    const obj = JSON.parse(trimmed);
    if (obj.type !== "result" || typeof obj.result !== "string") {
      return { lastText: "", tokenStats: { input: 0, output: 0, total: 0 }, costUsd: undefined, toolPaths: [] };
    }
    const usage = obj.usage ?? {};
    const tokenStats = {
      input: usage.input_tokens ?? 0,
      output: usage.output_tokens ?? 0,
      total: (usage.input_tokens ?? 0) + (usage.output_tokens ?? 0),
      reasoning: usage.output_tokens_details?.thinking_tokens,
    };
    const costUsd = typeof obj.total_cost_usd === "number" ? obj.total_cost_usd : 0;
    // When --json-schema is used, claude returns a structured_output field
    // that contains the validated schema-conformant object — prefer it over
    // the free-text result field.
    const lastText = typeof obj.structured_output === "object" && obj.structured_output !== null
      ? JSON.stringify(obj.structured_output)
      : obj.result;
    return { lastText, tokenStats, costUsd, toolPaths: [] };
  } catch {
    return { lastText: "", tokenStats: { input: 0, output: 0, total: 0 }, costUsd: undefined, toolPaths: [] };
  }
}
