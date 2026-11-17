# Monitoring and Logs

The activity journal, log queries, live watch and OpenTelemetry export. Part of the [Exaix User Guide](README.md).

## **Log & Journal Commands** - Inspect the Activity Journal and cost reports

```bash
exactl log list                    # Show last 20 events
exactl log list --filter config.updated
exactl log cost                   # Aggregated cost report
```

## **Watch Command** - Live Execution Streaming

The `exactl request watch` command provides real-time, `docker logs -f` style observability for agent executions. It connects to the local SSE stream and tails execution events as they happen, with color-coded output for different event types.

```bash
# Watch a live execution by request id
exactl request watch <request-id>

# Watch a live execution by trace ID
exactl request watch --trace a1b2c3d4-e5f6-7890-abcd-ef1234567890

# Watch with a custom SSE port (if not using default 8765)
EXA_SSE_PORT=9000 exactl request watch --trace a1b2c3d4-e5f6-7890-abcd-ef1234567890
```

**Output format (color-coded):**

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

---

**Example workflow:**

```bash
# Check if daemon is running
$ exactl daemon status
🔧 Daemon Status

Version: 1.0.0
Status: Running ✓
PID: 12345
Uptime: 2:15:30

# View recent logs
$ exactl daemon logs --limit 20

# Follow logs in real-time
$ exactl daemon logs --follow
[2025-11-25 14:30:15] INFO: Daemon started
[2025-11-25 14:30:16] INFO: Watching /Workspace/Requests
[2025-11-25 14:32:45] INFO: New request detected: implement-auth
...
```

## **Log & Journal Commands** - Query the Activity Journal

Every action in Exaix is recorded in the append-only Activity Journal. The `journal`
and `log list` commands let you inspect this audit trail. The `log cost` command
aggregates cost data across runs.

```bash
# Query the journal (default: last 20 events, newest first)
exactl log list
exactl log list

# Filter by action type
exactl log list --filter config.updated
exactl log list --filter config.integrity_mismatch

# Filter by trace id
exactl log list --filter trace_id=<uuid>

# Filter by agent
exactl log list --filter agent_role=my-agent

# Time range queries
exactl log list --filter since=2026-06-01

# Aggregation
exactl log list --filter plan.approved --count

# Display cost reports
exactl log cost
exactl log cost --since 2026-06-01
```

To **wait** for an event instead of querying — a readiness barrier — use the `wait`
subcommand. It polls the journal until the matching event is journalled after a baseline
(or the timeout elapses), printing the matched event and exiting `0` on a match
and `1` on timeout. This is useful in scripts and test harnesses that must block until
the daemon is ready, a flow completes, a plan is approved, and so on.

```bash
# Block until the daemon is ready (default timeout 30s), then exit 0
exactl log wait --event daemon.ready

# Raise the timeout
exactl log wait --event flow.completed --timeout 120

# Only count events timestamped after a given time (ISO datetime) — ignore earlier events
exactl log wait --event plan.approved --since "2026-06-01T12:00:00Z" --timeout 120

# Match only events whose payload contains a substring (SQL LIKE pattern)
exactl log wait --event model.resolved --payload "%preferred_list%"
```

The journal is the primary audit surface — every `config.set`, `plan.approved`,
`tool.confirmed`, and integrity check produces a typed event entry visible here.

---

## Activity Logging

All human actions via CLI are automatically logged to the Activity Journal:

- Plan approvals/rejections → `plan.approved`, `plan.rejected`
- Review approvals/rejections → `review.approved`, `review.rejected`
- All actions tagged with `actor='human'`, `via='cli'`
- User identity captured from git config or OS username

Query activity history:

```bash
# View recent activity history
exactl log list --limit 10

# Filter by trace ID to see complete request lifecycle
TRACE_ID=$(exactl log list --limit 1 -o json | jq -r '.[0].trace_id')
exactl log list --filter trace_id=$TRACE_ID

# Audit all errors across the system
exactl log list --filter action_type=error
```

## Activity Journal

The Activity Journal provides a permanent, searchable audit trail of all agent actions, system events, and errors. It is stored locally in `journal.db` and is essential for debugging, compliance, and understanding system behavior.

**Usage:**

```bash
exactl log list [options]
```

**Core Options:**

| Option                                   | Description                                     | Default |
| ---------------------------------------- | ----------------------------------------------- | ------- |
| `--limit <n>`, `-n <n>`                  | Show the last N entries                         | 50      |
| `--filter <key=value>`, `-f <key=value>` | Filter by criteria (can be used multiple times) | None    |
| `-o, --output <format>`                  | Output format: `text`, `table`, `json`          | `text`  |
| `--distinct <field>`                     | Return distinct values for specified field      | None    |
| `--count`                                | Return count aggregation by action_type         | false   |
| `--payload <pattern>`                    | Filter by payload LIKE pattern                  | None    |
| `--actor <actor>`                        | Filter by actor                                 | None    |
| `--target <target>`                      | Filter by target                                | None    |

**Filter Keys:**

- `trace_id`: Filter by specific operation UUID (e.g., `trace_id=a1b2c3d4-e5f6-7890-abcd-ef1234567890`)
- `action_type`: Filter by event type (e.g., `action_type=request.created`, supports wildcards like `action_type=plan.%`)
- `agent_role`: Filter by agent name (e.g., `agent_role=security-auditor`)
- `since`: Filter by time (e.g., `since=2024-01-01`, `since=2024-01-01T10:00:00`)

### Basic Usage Examples

```bash
# View recent system activity (last 50 entries)
exactl log list

# Show only the last 10 entries
exactl log list --limit 10

# Output in JSON format for scripting
exactl log list -o json

# Display in table format for better readability
exactl log list -o table
```

### Filtering by Trace ID

```bash
# Investigate a specific request's complete lifecycle
exactl log list --filter trace_id=a1b2c3d4-e5f6-7890-abcd-ef1234567890

# Get the trace ID from a recent request and investigate
TRACE_ID=$(exactl log list --limit 1 -o json | jq -r '.[0].trace_id')
exactl log list --filter trace_id=$TRACE_ID
```

### Filtering by Action Type

```bash
# Show only request creation events
exactl log list --filter action_type=request.created

# Show all plan-related events (using wildcard)
exactl log list --filter action_type=plan.%

# Show all errors
exactl log list --filter action_type=error

# Show blueprint operations
exactl log list --filter action_type=blueprint.%
```

### Filtering by Agent

```bash
# Show activity for a specific agent
exactl log list --filter agent_role=security-auditor

# Show activity for mock agents (using wildcard)
exactl log list --filter agent_role=mock-%
```

### Time-Based Filtering

```bash
# Show activity since a specific date
exactl log list --filter since=2024-01-01

# Show activity since a specific datetime
exactl log list --filter since=2024-01-01T10:00:00

# Show recent activity (last hour)
exactl log list --filter since=$(date -d '1 hour ago' +%Y-%m-%dT%H:%M:%S)
```

### Payload Pattern Matching

```bash
# Search for activities containing specific text in payload
exactl log list --payload %security%

# Check for potential credential leaks
exactl log list --payload %password%
exactl log list --payload %api_key%
exactl log list --payload %secret%

# Find token usage information
exactl log list --payload %tokens%

# Search for cost-related activities
exactl log list --payload %cost%
```

### Aggregation and Analysis

```bash
# Count total activities by action type
exactl log list --count

# Get distinct list of all agents that have performed actions
exactl log list --distinct agent_role

# Get distinct list of all action types
exactl log list --distinct action_type

# Get distinct actors (users who performed actions)
exactl log list --distinct actor
```

### Advanced Multi-Filter Queries

```bash
# Combine multiple filters: errors from specific agent since date
exactl log list --filter action_type=error --filter agent_role=security-auditor --filter since=2024-01-01

# Find all failed actions for a specific trace
exactl log list --filter trace_id=$TRACE_ID --filter action_type=action.failed

# Security audit: check for dangerous commands executed
exactl log list --filter action_type=action.executing --payload %rm% --payload %sudo%

# Performance analysis: find slow operations
exactl log list --payload %timeout% --payload %error%
```

### Real-World Use Cases

**Debugging Failed Requests:**

```bash
# Find the trace ID of a failed request
FAILED_TRACE=$(exactl log list --filter action_type=request.failed --limit 1 -o json | jq -r '.[0].trace_id')

# Investigate the complete failure chain
exactl log list --filter trace_id=$FAILED_TRACE
```

For provider request diagnostics, set `log_level = "debug"` in your existing `[system]`
configuration table and restart the daemon. The journal then records parsed request bodies
under `provider.request_debug_dump`. The default info level filters these events. Request
headers are excluded; request bodies can contain prompts and tool results. Providers using
the compatible profile suppress both request and response body dumps.

```bash
exactl log list --filter action_type=provider.request_debug_dump --limit 10 -o json
```

**Security Auditing:**

```bash
# Check for unauthorized file access attempts
exactl log list --payload %permission%denied% --payload %access%denied%

# Audit all portal access
exactl log list --filter action_type=portal.% --limit 100

# Check for sensitive data in logs
exactl log list --payload %password% --payload %key% --payload %secret% | wc -l
```

**Performance Monitoring:**

```bash
# Count requests by agent over time
exactl log list --filter action_type=request.created --distinct agent_role

# Find most active time periods
exactl log list --count --filter since=$(date -d '7 days ago' +%Y-%m-%d)

# Monitor token usage trends
exactl log list --payload %tokens% --limit 100 -o json | jq '.[] | .payload.tokens.total // 0' | paste -sd+ | bc
```

**Compliance and Reporting:**

```bash
# Export all activities for a specific month to JSON
exactl log list --filter since=2024-01-01 --filter since=2024-02-01 -o json > january_activities.json

# Generate audit report for specific agent
exactl log list --filter agent_role=production-agent -o json > production_audit.json

# Count human approvals vs automated actions
exactl log list --filter action_type=plan.approved --count
```

### Power User: Direct SQL Access

For advanced analysis, you can query the SQLite database directly:

```bash
# View the database schema
sqlite3 ~/Exaix/.exa/journal.db ".schema activity"

# Complex queries not available via CLI
sqlite3 ~/Exaix/.exa/journal.db "
  SELECT action_type, COUNT(*) as count,
         MIN(timestamp) as first_seen,
         MAX(timestamp) as last_seen
  FROM activity
  WHERE timestamp >= '2024-01-01'
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

**Database Maintenance:**

```bash
# Check database integrity
sqlite3 ~/Exaix/.exa/journal.db "PRAGMA integrity_check;"

# Vacuum database to reclaim space
sqlite3 ~/Exaix/.exa/journal.db "VACUUM;"

# Backup journal before maintenance
cp ~/Exaix/.exa/journal.db ~/backups/journal_$(date +%Y%m%d).db
```

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
[Exaix_Evaluation.md §20](../Exaix_Evaluation.md#20-opentelemetry-export).
