# Workspace and Memory

The workspace layout, memory banks and the file formats of the workspace. Part of the [Exaix User Guide](README.md).

## Workspace Overview

### Directory Structure

- **Workspace/**: Drop requests here.
- **Memory/**: Memory Banks for execution history and project knowledge.
- **.exa/**: Database and logs (do not touch manually).
- **Portals/**: Symlinks to your projects.

### Memory Banks

Memory Banks provide structured storage for Exaix's execution history, project context, and cross-project learnings. This system offers CLI-based access to your workspace's knowledge with automatic learning extraction.

#### Directory Structure

```text
Memory/
├── Global/             # Cross-project learnings
│   ├── learnings.json  # Global insights and patterns
│   └── learnings.md    # Human-readable learnings
├── Pending/            # Memory updates awaiting approval
│   └── {proposal-id}.json
├── Execution/          # Execution history (agent runs)
│   ├── {trace-id}/
│   │   ├── summary.md
│   │   ├── context.json
│   │   └── changes.diff
├── Projects/           # Project-specific knowledge
│   ├── {portal-name}/
│   │   ├── overview.md
│   │   ├── patterns.md
│   │   ├── decisions.md
│   │   └── references.md
├── Tasks/              # Active and historical tasks
│   ├── active/         # Currently executing (symlinks to Workspace/Active/)
│   ├── completed/      # Successfully completed tasks
│   └── failed/         # Failed tasks with error analysis
└── Index/              # Search indices (generated)
    ├── files.json
    ├── patterns.json
    ├── tags.json
    └── embeddings/     # Semantic search vectors
```

#### Working with memory

The `exactl memory` commands read the banks and decide pending updates. Every option is in the generated [memory reference](../cli/memory.md).

- **Browse:** `exactl memory list` shows the global learnings. `exactl memory project list` and `exactl memory project show <portal>` show project knowledge. `exactl memory execution list` and `exactl memory execution show <trace-id>` show the history of agent runs.
- **Search:** `exactl memory search "<query>"` searches all banks by keyword. Narrow it with `--tags` or `--portal <alias>`, or add `--use-embeddings` for semantic search.
- **Review:** `exactl memory proposal list` shows the pending updates. `exactl memory proposal approve <proposal-id>` moves one into its bank. `exactl memory proposal reject <proposal-id> --reason "<text>"` drops it.
- **Repair:** `exactl memory index rebuild` regenerates the search indices under `Memory/Index/`.

If `memory.auto_approve.enabled` is on, the daemon can promote eligible pending proposals by itself. It may also emit a daily digest notification while proposals wait for review.

#### What memory gives you

Every agent run stores its history with full context, and insights from the run become proposed learnings. A learning is global or project-specific. Each one keeps JSON metadata beside a human-readable markdown file. Keyword search ranks by frequency. `--use-embeddings` adds semantic similarity through the embedding service.

#### Pending Workflow

When an agent execution completes, Exaix automatically extracts learnings:

1. **Extract**: Insights from `lessons_learned`, the execution summary, and the run's
   scratchpad notes (see `remember_fact` below)

1. **Approve**: Approved learnings are moved to their respective Global or Project banks.

This ensures quality control over what enters the knowledge base. Extraction and
consolidation are guided by a content-curation policy that deprioritizes structural
facts (import graphs and the like) in favor of actionable, non-derivable insights — so
Memory stays distinct from Portal Knowledge.

#### In-the-Moment Capture (`remember_fact`)

Solo-tier agents can call the `remember_fact` tool mid-execution to capture a
"worth remembering" note the moment they notice it (a gotcha, a constraint, a debugging
insight), instead of reconstructing it in the final summary:

- Notes land in the run's execution scratchpad (`memory.scratchpad.max_entries_per_execution`
  bounds the count per run; over-cap notes are rejected, never truncated).
- Scratchpad notes feed the same extraction pass as `lessons_learned` — an insight jotted
  mid-run and restated in the summary is extracted once, not twice.
- **Every scratchpad-derived candidate goes through the same Pending → approval workflow
  as any other learning.** There is no direct-to-global shortcut.

#### Multi-Hop Link Expansion

Related learnings are connected with typed links (topical/supersession). Request-time
retrieval follows one hop of these links only when you opt in via
`memory.session.expand_links = true` (default `false`); linked learnings surface at a
reduced relevance score and never displace directly-matched ones. See
[Exaix_Memory.md](../Exaix_Memory.md) §2.3.

#### Memory Lifecycle

Memory moves through a full lifecycle — born (capture + extraction), reviewed (Pending →
approval, manual or opt-in auto-approval), retrieved (hybrid keyword + embedding search,
temporally ranked), consolidated (dedup, supersession, reflection), and retired
(superseded with audit trail). The closed self-learning loop, the local-first/cost-gated
posture, deterministic fallbacks, and the full configuration reference are covered in
the dedicated guide: [Exaix_Memory.md](../Exaix_Memory.md).

## File Format Reference

Exaix uses **YAML frontmatter** for all markdown files (requests, plans, reports). This format provides structured metadata for processing and search.

### YAML Frontmatter Format

Request, plan, and report files use `---` delimiters with YAML syntax:

```markdown
---
trace_id: "550e8400-e29b-41d4-a716-446655440000"
created: 2025-11-28T10:30:00.000Z
status: pending
priority: normal
agent_role: default
source: cli
created_by: user@example.com
tags: [feature, api]
---

# Request

Implement user authentication for the API...
```

### Why YAML Frontmatter

| Benefit                 | Description                                                      |
| ----------------------- | ---------------------------------------------------------------- |
| **Memory Banks search** | Structured metadata enables powerful search and filtering        |
| **CLI commands work**   | CLI can filter/sort by status, priority, agent_role              |
| **Standard format**     | Most markdown tools expect YAML (`---` delimiters)               |
| **Auto-generated**      | `exactl request create` creates proper frontmatter automatically |

### Frontmatter Fields Reference

**Request Files** (`Workspace/Requests/request-*.md`):

| Field                 | Type     | Required | Example                                                                     |
| --------------------- | -------- | -------- | --------------------------------------------------------------------------- |
| `trace_id`            | string   | ✓        | `"550e8400-e29b-41d4-a716-446655440000"`                                    |
| `created`             | datetime | ✓        | `2025-11-28T10:30:00.000Z`                                                  |
| `status`              | string   | ✓        | `pending`, `processing`, `completed`                                        |
| `priority`            | string   | ✓        | `low`, `normal`, `high`, `critical`                                         |
| `agent_role`          | string   | ✓        | `default`, `senior-coder`, `architect`                                      |
| `source`              | string   | ✓        | `cli`, `file`, `interactive`                                                |
| `created_by`          | string   | ✓        | `user@example.com`                                                          |
| `portal`              | string   |          | `MyProject` (optional project context)                                      |
| `target_branch`       | string   |          | `main` (review base branch for portal work)                                 |
| `acceptance_criteria` | array    |          | `[`"All tests pass"`,`"Endpoint returns 200"`]`                             |
| `expected_outcomes`   | array    |          | `[`"API docs updated"`]`                                                    |
| `scope`               | object   |          | `{ include: ["packages/api/src/"], exclude: ["packages/api/src/legacy/"] }` |
| `tags`                | array    |          | `[feature, api]` (optional tags)                                            |

### Structured Request Quality Fields

When you already know what "done" means, put it in frontmatter instead of burying it in prose. Exaix treats these fields as explicit, high-confidence signals during analysis and evaluation.

```yaml
---
trace_id: "550e8400-e29b-41d4-a716-446655440000"
created: 2025-11-28T10:30:00.000Z
status: pending
priority: high
agent_role: senior-coder
source: cli
created_by: user@example.com
acceptance_criteria:
  - All existing tests pass
  - Input validation rejects payloads larger than 1MB
expected_outcomes:
  - Upload endpoint available at /api/v2/upload
scope:
  include: ["packages/api/src/", "tests/api/"]
  exclude: ["packages/api/src/legacy/"]
---
```

CLI flags map directly to these fields:

- `--acceptance-criteria` → `acceptance_criteria`
- `--expected-outcome` → `expected_outcomes`

Use them when you want fewer clarification rounds and more reliable evaluation against your actual requirements.

**Plan Files** (`Workspace/Plans/*.md`):

| Field        | Type     | Required | Example                                  |
| ------------ | -------- | -------- | ---------------------------------------- |
| `trace_id`   | string   | ✓        | `"550e8400-e29b-41d4-a716-446655440000"` |
| `request_id` | string   | ✓        | `"implement-auth"`                       |
| `status`     | string   | ✓        | `review`, `approved`, `rejected`         |
| `created_at` | datetime | ✓        | `2025-11-28T10:35:00.000Z`               |
| `agent_role` | string   | ✓        | `senior_coder`                           |

**Report Files** (`Memory/Reports/*.md`):

| Field          | Type     | Required | Example                                  |
| -------------- | -------- | -------- | ---------------------------------------- |
| `trace_id`     | string   | ✓        | `"550e8400-e29b-41d4-a716-446655440000"` |
| `request_id`   | string   | ✓        | `"implement-auth"`                       |
| `status`       | string   | ✓        | `completed`, `failed`                    |
| `completed_at` | datetime | ✓        | `2025-11-28T11:00:00.000Z`               |
| `agent_role`   | string   | ✓        | `senior_coder`                           |
| `branch`       | string   |          | `feat/implement-auth-550e8400`           |

### YAML Syntax Quick Reference

```yaml
# Strings (quotes optional for simple values)
status: pending
agent_role: default

# Strings with special characters (quotes required)
trace_id: "550e8400-e29b-41d4-a716-446655440000"
created_by: "user@example.com"

# Dates (ISO 8601 format)
created: 2025-11-28T10:30:00.000Z

# Arrays (inline format)
tags: [feature, api, urgent]

# Arrays (block format)
acceptance_criteria:
  - All tests pass
  - Endpoint returns 200

# Nested objects
scope:
  include: [packages/api/src/, tests/api/]
  exclude: [packages/api/src/legacy/]

# Booleans
approved: true
```

> **💡 TIP:** Use `exactl request create` to create requests with proper frontmatter automatically. Manual file creation is error-prone.
