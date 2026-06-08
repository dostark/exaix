# `exactl watch <trace_id>` — Real-Time Execution Tailing

Tails live execution output for a given trace ID via Server-Sent Events (SSE), falling
back to a historical database query for completed or server-unavailable traces.

## Usage

```bash
exactl watch 550e8400-e29b-41d4-a716-446655440000
```

## How It Works

1. The command attempts an SSE connection to `http://127.0.0.1:<port>/api/v1/traces/<trace_id>/stream`.
2. If the SSE server responds within 2 seconds, it streams events live until the trace completes.
3. If the server is unavailable or the trace is already complete, it falls back to querying the
   Activity Journal database for historical events.

## Event Rendering

| Event Type              | Icon | Color       | Description                            |
| ----------------------- | ---- | ----------- | -------------------------------------- |
| `agent.heartbeat`       | ♥    | Dim         | Periodic liveness signal               |
| `milestone`             | ★    | Cyan        | Semantic progress milestone            |
| `milestone` (attention) | ⚠    | Bold Yellow | Milestone requiring operator attention |
| `tool.start`            | ▶    | Cyan        | Tool execution started                 |
| `tool.end`              | ◀    | Cyan        | Tool execution completed               |
| `llm.stream`            | ◈    | White       | LLM response stream chunk              |
| `flow.status`           | ◆    | Green       | General flow status update             |

### Milestone Rendering Details

Milestone events (`type: "milestone"`) display:

- **Stage indicator**: The milestone type string (e.g., `flow.step.started`) and summary.
- **Progress hint**: When `progressHint` is present, a `[N/M label]` suffix shows step
  completion status (e.g., `[2/5 Build feature]`).
- **Attention indicator**: When `requiresAttention` is `true`, the line renders in bold
  yellow with a `⚠ ATTENTION` prefix and the `attentionReason` text.

### Example Output

```
[14:30:00] ★ milestone: flow.started — Flow started
[14:30:01] ★ milestone: flow.step.started — Step 1 started [0/2 Step 1]
[14:30:02] ★ milestone: flow.step.completed — Step 1 completed [1/2 Step 1]
[14:30:03] ⚠ ATTENTION — approval.gate.entered: Operator approval needed [1/2]
[14:30:04] ★ milestone: flow.completed — Flow completed successfully [2/2]
```

## SSE Endpoint

The SSE endpoint is served by `packages/mcp/server/sse_handler.ts` on the MCP HTTP server
(default port `8765`, configurable via `EXA_SSE_PORT`). It binds to `127.0.0.1` only and
validates the trace ID as a UUID before streaming.

## Fallback

When the SSE server is unavailable, the command queries the Activity Journal
(`queryActivity`) for events matching the trace ID and renders them via `JournalFormatter`.

## Source

- Command: `apps/exactl/src/commands/watch.ts`
- SSE handler: `packages/mcp/server/sse_handler.ts`
- Event schema: `packages/schemas/src/streaming_event.ts`
- Milestone schema: `packages/schemas/src/milestone_event.ts`
