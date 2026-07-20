/**
 * @module DelegateReturnParser
 * @path packages/session/src/delegate_return_parser.ts
 * @description Phase 123 Step 1 — extracted parsing logic for headless delegate
 *   stdout. Pure parser module (no DI) that handles both opencode JSONL events
 *   (text, tool_use, step_finish) and claude single-result format. Returns
 *   structured fields for return synthesis.
 * @architectural-layer Services
 * @dependencies []
 * @related-files [apps/daemon/src/headless_session_launcher.ts, packages/schemas/src/session_delegate.ts]
 */

import type { SessionTool } from "@exaix/schemas/session_delegate.ts";

export interface IDelegateParsedReturn {
  lastText: string;
  tokenStats: { input: number; output: number; total: number };
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
    tokens?: { input?: number; output?: number; total?: number };
    cost?: number;
    tool?: string;
    state?: { input?: { filePath?: string } };
  };
}

const TOOL_CLAUDE_CODE: SessionTool = "claude-code";
const OPENCODE_EVENT_TEXT = "text";
const OPENCODE_EVENT_STEP_FINISH = "step_finish";
const OPENCODE_EVENT_TOOL_USE = "tool_use";

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

  return parseOpencodeJsonl(stdout);
}

function parseOpencodeJsonl(stdout: string): IDelegateParsedReturn {
  let lastText = "";
  let tokenStats = { input: 0, output: 0, total: 0 };
  let costUsd: number | undefined;
  const runState = { toolPaths: [] as string[], seenPaths: new Set<string>() };

  for (const line of stdout.trim().split("\n")) {
    const event = tryParseLine(line);
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

function tryParseLine(line: string): IOpencodeEvent | null {
  if (!line.trim()) return null;
  try {
    const parsed = JSON.parse(line.trim());
    if (typeof parsed === "object" && parsed && parsed.type) return parsed as IOpencodeEvent;
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
  tokenStats: { input: number; output: number; total: number };
  costUsd: number | undefined;
} {
  let tokenStats = { input: 0, output: 0, total: 0 };
  let costUsd: number | undefined;
  if (event.part?.tokens) {
    const t = event.part.tokens;
    tokenStats = { input: t.input ?? 0, output: t.output ?? 0, total: t.total ?? 0 };
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
    };
    const costUsd = typeof obj.total_cost_usd === "number" ? obj.total_cost_usd : 0;
    return { lastText: obj.result, tokenStats, costUsd, toolPaths: [] };
  } catch {
    return { lastText: "", tokenStats: { input: 0, output: 0, total: 0 }, costUsd: undefined, toolPaths: [] };
  }
}
