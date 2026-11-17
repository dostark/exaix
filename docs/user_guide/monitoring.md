# Monitoring and Logs

The activity journal, log queries, live watch and OpenTelemetry export. Part of the [Exaix User Guide](README.md).

## The Activity Journal

The Activity Journal is a permanent, searchable audit trail of all agent actions, system events, and errors. It is append-only and stored locally in `journal.db`. Use it to debug a run, to audit what happened and to understand system behavior. Every `config.set`, `plan.approved`, `tool.confirmed` and integrity check produces a typed event that you can query.

Human actions through the CLI are logged automatically:

- Plan approvals/rejections → `plan.approved`, `plan.rejected`
- Review approvals/rejections → `review.approved`, `review.rejected`
- All actions tagged with `actor='human'`, `via='cli'`
- User identity captured from git config or OS username

Every other action carries the trace ID of its request, so you can follow one request from creation to review.

## Querying the journal

`exactl log list` lists the journal rows, newest first. It shows 50 rows by default, and `--limit` changes that. Narrow the result with these options:

- `--filter trace_id=<uuid>` shows one operation, for example the complete lifecycle of a request.
- `--filter action_type=<type>` shows one event type. It supports wildcards, for example `action_type=plan.%`. A bare event name such as `--filter plan.approved` does the same.
- `--filter agent_role=<name>` shows the activity of one agent role.
- `--filter since=<date>` shows rows from a date or an ISO datetime onward.
- `--payload <pattern>` matches a SQL LIKE pattern against the payload, and `--actor` and `--target` filter by those fields.
- `--count` counts the rows by action type, and `--distinct <field>` lists the distinct values of a field.
- `-o json` prints machine-readable output for scripts.

Every option is in the [log command reference](../cli/log.md).

### Recipes

- **Debug a failed request.** Find the trace ID of the failure with `exactl log list --filter action_type=request.failed --limit 1 -o json`, then list the whole trace with `--filter trace_id=<trace-id>` to see the failure chain.
- **Audit portal access.** `exactl log list --filter action_type=portal.% --limit 100` lists every portal event. Payload patterns such as `--payload %permission%denied%` find denied accesses.
- **See who does the work.** `exactl log list --filter action_type=request.created --distinct agent_role` lists the agent roles that received requests, and `--count` counts the events by type.
- **Export for a report.** Add `-o json` and redirect the output to a file to keep a filtered slice of the journal, for example the activity of one agent role.
- **Read the cost of the runs.** `exactl log cost` aggregates cost data across runs. [Cost Tracking](cost-tracking.md) explains the report.

For provider request diagnostics, set `log_level = "debug"` in your existing `[system]` configuration table and restart the daemon. The journal then records parsed request bodies under `provider.request_debug_dump`. The default info level filters these events. Request headers are excluded, and request bodies can contain prompts and tool results. Providers that use the compatible profile suppress both request and response body dumps.

### Waiting for an event

To block a script until an event happens, use `exactl log wait --event <type>`. It polls the journal until the matching event is journalled after a baseline, or until the timeout elapses. It prints the matched event and exits `0` on a match and `1` on timeout. Use it in scripts and test harnesses that must wait until the daemon is ready, a flow completes or a plan is approved. For example, `exactl log wait --event daemon.ready` blocks until the daemon is ready, with a default timeout of 30 seconds. `--timeout` raises the timeout, `--since` ignores earlier events, and `--payload` matches a substring of the payload.

### Direct database access

Use direct SQL when `exactl log list` cannot express a query. The journal is a SQLite database, and `SELECT` statements are safe while the daemon runs. Replace `<date>` with an ISO date:

```bash
# View the database schema
sqlite3 ~/Exaix/.exa/journal.db ".schema activity"

# Complex queries not available via CLI
sqlite3 ~/Exaix/.exa/journal.db "
  SELECT action_type, COUNT(*) as count,
         MIN(timestamp) as first_seen,
         MAX(timestamp) as last_seen
  FROM activity
  WHERE timestamp >= '<date>'
  GROUP BY action_type
  ORDER BY count DESC;
"

# Find requests with the most steps
sqlite3 ~/Exaix/.exa/journal.db "
  SELECT trace_id, COUNT(*) as steps
  FROM activity
  WHERE action_type LIKE 'step.%'
  GROUP BY trace_id
  ORDER BY steps DESC
  LIMIT 10;
"
```

**Database maintenance.** The integrity check prints `ok` when the file is sound. Stop the daemon with `exactl daemon stop` before you vacuum:

```bash
# Check database integrity
sqlite3 ~/Exaix/.exa/journal.db "PRAGMA integrity_check;"

# Vacuum database to reclaim space
sqlite3 ~/Exaix/.exa/journal.db "VACUUM;"

# Backup journal before maintenance
cp ~/Exaix/.exa/journal.db ~/backups/journal_$(date +%Y%m%d).db
```

## Watching an execution live

`exactl request watch` follows the events of an agent execution as they happen, like `docker logs -f`. It connects to the local SSE stream and prints color-coded events. Start it with `exactl request watch <request-id>`, or with `--trace <trace-id>`.

**Output format (color-coded).** Each line has a timestamp, a symbol and the event:

- Heartbeat (dim gray): `[14:30:15] ♥ heartbeat step="Step 1" elapsed=5000ms`
- Tool start (cyan): `[14:30:16] ▶ tool.start tool="read_file"`
- Tool end (cyan): `[14:30:17] ◀ tool.end tool="read_file"`
- LLM stream (white): `[14:30:18] ◈ llm.stream Thinking about...`
- Flow status (green): `[14:30:19] ◆ flow.status status="running"`

**How it works:**

1. **Live mode:** If the daemon's SSE server is running, `watch` connects to `http://127.0.0.1:8765/api/v1/traces/:id/stream` and streams events in real time.
1. **Fallback mode:** If the SSE server is unavailable (daemon stopped, execution finished), `watch` queries the Activity Journal database and displays historical events for that trace, then exits.

**Behavior:**

- Heartbeats fire every 5 seconds during long-running LLM calls, confirming the agent is still active.
- Press `Ctrl+C` to stop watching at any time.
- The command validates the trace ID (must be a valid UUID) before connecting.

To use a custom SSE port when the daemon does not use the default 8765, set `EXA_SSE_PORT`, for example `EXA_SSE_PORT=9000 exactl request watch --trace <trace-id>`.

## OpenTelemetry Export

> **This is a Team/Enterprise Edition feature.** The command is present only in Team/Enterprise
> `exactl` builds; a Solo build's compiled help and command graph never mention it.

`exactl log export-otel <trace-id>` projects one journal trace into OTLP/HTTP JSON spans a
Phoenix instance, an OpenTelemetry Collector, or any other `/v1/traces` receiver can consume. It is
explicit and read-only: there is no `enabled` flag, no background exporter, and no change to what
the journal itself records — invoking the command is the only opt-in, and it never writes to the
selected records.

**Usage:**

```bash
exactl log export-otel <trace-id> [--eval-run-id <id>] [--stdout]
```

| Option               | Description                                                        |
| -------------------- | ------------------------------------------------------------------ |
| `--eval-run-id <id>` | Attach one explicit evaluation outcome; fails if its trace differs |
| `--stdout`           | Print canonical OTLP JSON and skip the network call entirely       |

```bash
# Export a trace to the endpoint configured in [otel_export] (default: a local Collector on :4318)
exactl log export-otel a1b2c3d4-e5f6-7890-abcd-ef1234567890

# Attach one specific evaluation outcome
exactl log export-otel a1b2c3d4-e5f6-7890-abcd-ef1234567890 --eval-run-id run-042

# Preview the OTLP payload without sending it anywhere
exactl log export-otel a1b2c3d4-e5f6-7890-abcd-ef1234567890 --stdout
```

Without `--eval-run-id`, the export attaches an evaluation outcome only when exactly one eval run
matches the trace ID — zero matches attaches nothing, and more than one fails with
`AMBIGUOUS_EVAL_OUTCOME` rather than guessing which run applies.

**Configuration (`[otel_export]`, fully defaulted):**

```toml
[otel_export]
endpoint = "http://127.0.0.1:4318/v1/traces"  # Must be HTTPS, or HTTP to a loopback address only
protocol = "http/json"                          # The only supported wire mapping
timeout_ms = 10000
max_request_bytes = 4194304                     # 4 MiB
max_response_bytes = 4194304                    # 4 MiB
headers_env = "OTEL_EXPORTER_OTLP_HEADERS"      # Env var holding "name=value,name2=value2" pairs
```

`http://` endpoints are only accepted for `localhost`/`127.0.0.0/8`/`::1`; any other host must use
`https://`. The exporter never follows a redirect, and only the model, provider, agent role, tool
name, and status fields are ever read from a journal record's payload — prompts, tool arguments and
results, error text, and file paths never leave the export.

**Troubleshooting:**

- `TRACE_NOT_FOUND` — no journal record carries that exact `trace_id`. Check the ID with
  `exactl log list --filter trace_id=<id>` first.
- `AMBIGUOUS_EVAL_OUTCOME` — more than one eval run matched the trace; the error lists the
  candidate run IDs, pass one explicitly with `--eval-run-id`.
- `UNSUPPORTED_ENDPOINT_SCHEME` / `UNSAFE_ENDPOINT_COMPONENT` / `INSECURE_NON_LOOPBACK_ENDPOINT` —
  the configured `endpoint` failed a security check (see above); errors never echo the offending
  credential or query string, only the failure code.
- No output and a non-zero exit after the configured `timeout_ms` — the receiver is unreachable or
  too slow; nothing partially exports, since the request is fully assembled before any network
  call.

Full span mapping, identity derivation, and privacy-attribute allowlist:
the OpenTelemetry export section of the [Evaluation guide](../Exaix_Evaluation.md#20-opentelemetry-export).
