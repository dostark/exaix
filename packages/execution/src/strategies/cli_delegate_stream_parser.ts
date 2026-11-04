/**
 * @module CliDelegateStreamParser
 * @path packages/execution/src/strategies/cli_delegate_stream_parser.ts
 * @description Pure parser for Claude Code's `--output-format stream-json
 * --verbose` protocol: newline-delimited JSON events for one cold-spawned
 * turn (`claude -p <objective> --output-format stream-json`), terminated by a
 * `result` event. Also extracts `session_id` from the leading `system`/init
 * event so CliDelegateStrategy can resume the same conversation on the next
 * turn via `--resume <session_id>` (the officially documented multi-turn
 * mechanism — see cli_delegate_strategy.ts's module doc). Package-pure (no
 * DI, no subprocess).
 * @architectural-layer Services
 * @related-files [packages/execution/src/strategies/cli_delegate_strategy.ts, packages/session/src/delegate_return_parser.ts]
 */

/** One turn's accumulated outcome — mirrors IDelegateParsedReturn's shape for reuse downstream. */
interface ICliDelegateTurnResult {
  lastText: string;
  isError: boolean;
  tokenStats: {
    input: number;
    output: number;
    total: number;
    /** Anthropic prompt-cache read tokens, reported by Claude Code CLI's real `result`
     *  event. undefined when caching wasn't used on this turn — never 0 for "unknown". */
    cacheRead?: number;
    /** Anthropic prompt-cache write (creation) tokens, one-time per cache segment. */
    cacheCreation?: number;
    /** Anthropic thinking tokens, forwarded verbatim by Claude Code CLI's real `result`
     *  event usage.output_tokens_details.thinking_tokens. A SUBSET of `output` (billed as
     *  output, not additional) — undefined when the CLI doesn't report a breakdown. */
    reasoning?: number;
  };
  costUsd: number | undefined;
  toolPaths: string[];
  /** Captured from the turn's `system`/init event; undefined if absent (older CLI or non-stream-json output). */
  sessionId: string | undefined;
}

interface IStreamContentBlock {
  type: string;
  text?: string;
  name?: string;
  input?: { file_path?: string };
}

interface IStreamAssistantEvent {
  type: "assistant";
  message?: { content?: IStreamContentBlock[] };
}

interface IStreamResultEvent {
  type: "result";
  is_error?: boolean;
  result?: string;
  total_cost_usd?: number;
  usage?: {
    input_tokens?: number;
    output_tokens?: number;
    cache_creation_input_tokens?: number;
    cache_read_input_tokens?: number;
    output_tokens_details?: { thinking_tokens?: number };
  };
}

interface IStreamSystemEvent {
  type: "system";
  session_id?: string;
}

interface IStreamOtherEvent {
  type: string;
}

type IStreamEvent = IStreamAssistantEvent | IStreamResultEvent | IStreamSystemEvent | IStreamOtherEvent;

const EVENT_TYPE_ASSISTANT = "assistant";
const EVENT_TYPE_RESULT = "result";
const EVENT_TYPE_SYSTEM = "system";
const CONTENT_TYPE_TEXT = "text";
const CONTENT_TYPE_TOOL_USE = "tool_use";
const WRITE_TOOL_NAMES: ReadonlySet<string> = new Set(["Write", "Edit", "NotebookEdit"]);

const EMPTY_TURN_RESULT: ICliDelegateTurnResult = {
  lastText: "",
  isError: false,
  tokenStats: { input: 0, output: 0, total: 0 },
  costUsd: undefined,
  toolPaths: [],
  sessionId: undefined,
};

function tryParseLine(line: string): IStreamEvent | null {
  if (!line.trim()) return null;
  try {
    const parsed: IStreamEvent = JSON.parse(line.trim());
    if (typeof parsed === "object" && parsed !== null && typeof parsed.type === "string") return parsed;
    return null;
  } catch {
    return null;
  }
}

function isAssistantEvent(event: IStreamEvent): event is IStreamAssistantEvent {
  return event.type === EVENT_TYPE_ASSISTANT;
}

function isResultEvent(event: IStreamEvent): event is IStreamResultEvent {
  return event.type === EVENT_TYPE_RESULT;
}

function isSystemEvent(event: IStreamEvent): event is IStreamSystemEvent {
  return event.type === EVENT_TYPE_SYSTEM;
}

function collectToolPaths(event: IStreamAssistantEvent, seen: Set<string>, out: string[]): void {
  for (const block of event.message?.content ?? []) {
    if (block.type !== CONTENT_TYPE_TOOL_USE) continue;
    if (!block.name || !WRITE_TOOL_NAMES.has(block.name)) continue;
    const path = block.input?.file_path;
    if (typeof path !== "string" || !path || seen.has(path)) continue;
    seen.add(path);
    out.push(path);
  }
}

function lastTextFrom(event: IStreamAssistantEvent, current: string): string {
  for (const block of event.message?.content ?? []) {
    if (block.type === CONTENT_TYPE_TEXT && typeof block.text === "string") return block.text;
  }
  return current;
}

/** What the parser has read so far from the lines of one turn. */
interface ITurnProgress {
  lastText: string;
  sessionId: string | undefined;
  readonly seenPaths: Set<string>;
  readonly toolPaths: string[];
}

/** The token counts that a `result` event reports. A cache or thinking count is undefined when the CLI omits it. */
function tokenStatsOf(event: IStreamResultEvent): ICliDelegateTurnResult["tokenStats"] {
  const input = event.usage?.input_tokens ?? 0;
  const output = event.usage?.output_tokens ?? 0;
  return {
    input,
    output,
    total: input + output,
    cacheRead: event.usage?.cache_read_input_tokens,
    cacheCreation: event.usage?.cache_creation_input_tokens,
    reasoning: event.usage?.output_tokens_details?.thinking_tokens,
  };
}

/** The finished turn that a `result` event ends. A result without text keeps the last assistant text. */
function finishedTurn(event: IStreamResultEvent, progress: ITurnProgress): ICliDelegateTurnResult {
  return {
    lastText: typeof event.result === "string" ? event.result : progress.lastText,
    isError: event.is_error === true,
    tokenStats: tokenStatsOf(event),
    costUsd: event.total_cost_usd,
    toolPaths: progress.toolPaths,
    sessionId: progress.sessionId,
  };
}

/** Folds a system or assistant event into the progress. A result event is left to the caller. */
function absorb(event: IStreamEvent, progress: ITurnProgress): void {
  if (isSystemEvent(event)) {
    progress.sessionId = event.session_id ?? progress.sessionId;
  } else if (isAssistantEvent(event)) {
    progress.lastText = lastTextFrom(event, progress.lastText);
    collectToolPaths(event, progress.seenPaths, progress.toolPaths);
  }
}

/** Unterminated input (no `result` line) returns an empty turn with isError=false —
 *  callers must treat a missing result as a distinct failure, not infer it here. */
export function parseCliDelegateStreamTurn(lines: string[]): ICliDelegateTurnResult {
  const progress: ITurnProgress = { lastText: "", sessionId: undefined, seenPaths: new Set(), toolPaths: [] };
  for (const line of lines) {
    const event = tryParseLine(line);
    if (!event) continue;
    if (isResultEvent(event)) return finishedTurn(event, progress);
    absorb(event, progress);
  }
  return {
    ...EMPTY_TURN_RESULT,
    lastText: progress.lastText,
    toolPaths: progress.toolPaths,
    sessionId: progress.sessionId,
  };
}
