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
export interface ICliDelegateTurnResult {
  lastText: string;
  isError: boolean;
  tokenStats: { input: number; output: number; total: number };
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
  usage?: { input_tokens?: number; output_tokens?: number };
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

/**
 * Parse the newline-delimited stream-json lines from ONE cold-spawned `claude
 * -p <objective> --output-format stream-json` call, up to and including its
 * `result` event. Unterminated input (no `result` line present) returns the
 * empty turn result with isError left false — callers must treat a missing
 * result as a distinct timeout/protocol failure, not infer it from this parser.
 */
export function parseCliDelegateStreamTurn(lines: string[]): ICliDelegateTurnResult {
  let lastText = "";
  let sessionId: string | undefined;
  const seenPaths = new Set<string>();
  const toolPaths: string[] = [];

  for (const line of lines) {
    const event = tryParseLine(line);
    if (!event) continue;

    if (isSystemEvent(event)) {
      sessionId = event.session_id ?? sessionId;
      continue;
    }

    if (isAssistantEvent(event)) {
      lastText = lastTextFrom(event, lastText);
      collectToolPaths(event, seenPaths, toolPaths);
      continue;
    }

    if (isResultEvent(event)) {
      const resultText = typeof event.result === "string" ? event.result : lastText;
      return {
        lastText: resultText,
        isError: event.is_error === true,
        tokenStats: {
          input: event.usage?.input_tokens ?? 0,
          output: event.usage?.output_tokens ?? 0,
          total: (event.usage?.input_tokens ?? 0) + (event.usage?.output_tokens ?? 0),
        },
        costUsd: event.total_cost_usd,
        toolPaths,
        sessionId,
      };
    }
  }

  return { ...EMPTY_TURN_RESULT, lastText, toolPaths, sessionId };
}
