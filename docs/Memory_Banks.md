# Memory Banks Architecture

**Version:** 2.0.0
**Date:** 2026-01-04
**Status:** Active (v1.1+)
**Replaces:** Knowledge/ directory (deprecated in Phase 12)

---

## Overview

Memory Banks is Exaix's structured storage system for long-term project knowledge, execution history, and lessons learned. It replaces the Obsidian-centric Knowledge/ directory with a programmatic, CLI-accessible architecture optimized for agent and developer use.

**Key Principles:**

- **Structured + Unstructured:** JSON for programmatic access, Markdown for humans
- **Taxonomy-Driven:** Clear separation between Projects, Execution, Global, and Pending
- **TUI-Ready:** Designed for future TUI dashboard integration
- **Migration-Friendly:** Clean migration path from Knowledge/ structure
- **Learning-Centric:** Automatic learning extraction from executions with pending approval workflow

---

## Directory Structure

```text
Memory/
├── Projects/              # Project-specific knowledge banks
│   ├── {portal-name}/
│   │   ├── overview.md    # Project summary and context
│   │   ├── patterns.md    # Code patterns and conventions
│   │   ├── decisions.md   # Architectural decisions
│   │   └── references.md  # Key files, APIs, documentation links
│
├── Execution/             # Execution history (formerly Reports/)
│   ├── {trace-id}/
│   │   ├── summary.md     # Human-readable execution summary
│   │   ├── context.json   # Structured context (files, portals, config)
│   │   └── changes.diff   # Git diff of changes made
│
├── Global/                # Global learnings across all projects
│   ├── learnings.json     # Cross-project learnings and insights
│   └── learnings.md       # Human-readable learnings
│
├── Pending/               # Memory update proposals awaiting approval
│   └── {proposal-id}.json # Proposed learning from execution
│
├── Tasks/                 # Active and historical tasks
│   ├── active/            # Currently executing (symlinks to Workspace/Active/)
│   ├── completed/         # Successfully completed tasks
│   └── failed/            # Failed tasks with error analysis
│
└── Index/                 # Searchable indices (generated)
    ├── files.json         # File-to-project mapping
    ├── patterns.json      # Pattern-to-usage mapping
    ├── tags.json          # Tag-based categorization
    └── embeddings/        # Embedding vectors for semantic search
        ├── manifest.json  # Embedding index
        └── {id}.json      # Individual embedding files
```

---

## Data Schemas

### Project Memory

Stores long-term knowledge about a specific portal (codebase).

**Schema:** [`packages/schemas/src/memory_bank.ts::ProjectMemorySchema`](../packages/schemas/src/memory_bank.ts)

```typescript
interface ProjectMemory {
  portal: string; // Portal name
  overview: string; // High-level project summary
  patterns: Pattern[]; // Code patterns learned
  decisions: Decision[]; // Architectural decisions
  references: Reference[]; // Key files, docs, APIs
}

interface Pattern {
  name: string; // e.g., "Repository Pattern"
  description: string; // What it does and why
  examples: string[]; // File paths demonstrating pattern
  tags?: string[]; // Optional tags
}

interface Decision {
  date: string; // ISO date (YYYY-MM-DD)
  decision: string; // What was decided
  rationale: string; // Why this decision was made
  alternatives?: string[]; // Other options considered
  tags?: string[]; // Optional tags
}

interface Reference {
  type: "file" | "api" | "doc" | "url";
  path: string; // Path or URL
  description: string; // What this reference is about
}
```

**File Format:**

- `overview.md` — Plain markdown
- `patterns.md` — Markdown with structured sections
- `decisions.md` — Markdown with structured sections
- `references.md` — Markdown list with links

#### Example: Memory/Projects/my-app/overview.md

```markdown
# My App — Project Overview

A task management web application built with React and Express.

## Key Characteristics

- Frontend: React 18 with TypeScript
- Backend: Express with PostgreSQL
- Authentication: JWT-based
- Deployment: Docker on AWS ECS

## Current Focus

Adding real-time collaboration features using WebSockets.
```

---

### Execution Memory

Records what was done during each agent execution.

**Schema:** [`packages/schemas/src/memory_bank.ts::ExecutionMemorySchema`](../packages/schemas/src/memory_bank.ts)

```typescript
interface ExecutionMemory {
  trace_id: string; // UUID
  request_id: string; // Request that triggered execution
  started_at: string; // ISO timestamp
  completed_at?: string; // ISO timestamp (if finished)
  status: "running" | "completed" | "failed";

  portal: string; // Portal executed against
  agent: string; // Agent name
  summary: string; // What was done

  context_files: string[]; // Files provided as context
  context_portals: string[]; // Portals used

  changes: {
    files_created: string[];
    files_modified: string[];
    files_deleted: string[];
  };

  lessons_learned?: string[]; // Insights from execution
  error_message?: string; // Error if failed
}
```

**File Format:**

- `summary.md` — Human-readable markdown report
- `context.json` — Structured execution metadata
- `changes.diff` — Git diff output

#### Portal worktree pointer (optional)

Some portal executions use an isolated Git worktree checkout. In those cases, Exaix may record a discoverability pointer at:

- `Memory/Execution/{trace-id}/worktree`

This is typically a symlink (preferred) or a small directory containing `PATH.txt`, and it points to the actual worktree directory (commonly under `.exa/worktrees/...`).

You can also inspect worktrees directly with `exactl git worktrees list --portal <alias>` (or `--repo <path>`).

**Cleanup:** After the corresponding review is resolved (approved/rejected) the worktree checkout and this pointer are removed to avoid accumulating stale worktrees.

#### Example: Memory/Execution/{trace-id}/summary.md

```markdown
# Execution Summary

**Trace ID:** 550e8400-e29b-41d4-a716-446655440000
**Request:** REQ-123
**Status:** ✅ Completed
**Agent:** senior-coder
**Duration:** 15 minutes

## What Was Done

Added JWT authentication middleware to the Express application.

## Changes

- Created: `src/middleware/auth.ts`
- Modified: `src/app.ts`, `package.json`

## Lessons Learned

- Always validate JWT expiration explicitly
- Use environment variables for secrets, never hardcode
```

---

### Global Memory

Stores cross-project learnings that apply universally.

**Schema:** [`packages/schemas/src/memory_bank.ts::GlobalMemorySchema`](../packages/schemas/src/memory_bank.ts)

```typescript
interface GlobalMemory {
  version: string; // Schema version (e.g., "2.0.0")
  created_at: string; // ISO timestamp
  updated_at: string; // ISO timestamp
  learnings: Learning[]; // Global learnings
  statistics: GlobalMemoryStats;
}

interface GlobalMemoryStats {
  total_learnings: number;
  by_category: Record<string, number>; // Count per category
  by_project: Record<string, number>; // Count per source project
  last_activity: string; // ISO timestamp
}
```

---

### Learning

Represents a single piece of learned knowledge.

**Schema:** [`packages/schemas/src/memory_bank.ts::LearningSchema`](../packages/schemas/src/memory_bank.ts)

```typescript
interface Learning {
  id: string; // UUID
  created_at: string; // ISO timestamp
  source: "agent" | "execution" | "user";
  source_id?: string; // Execution trace_id if from execution
  scope: "global" | "project";
  project?: string; // Portal name if project-scoped
  title: string; // Short description (max 100 chars)
  description: string; // Full description
  category: LearningCategory;
  tags: string[]; // For search/filtering
  confidence: "low" | "medium" | "high";
  references?: LearningReference[];
  status: "pending" | "approved" | "rejected" | "archived";
  approved_at?: string; // ISO timestamp
  archived_at?: string; // ISO timestamp
}

type LearningCategory =
  | "pattern" // Code pattern or design pattern
  | "decision" // Architectural decision
  | "anti-pattern" // What to avoid
  | "insight" // General insight
  | "troubleshooting"; // Error resolution knowledge
```

---

### Memory Update Proposal

Represents a pending memory update awaiting approval.

**Schema:** [`packages/schemas/src/memory_bank.ts::MemoryUpdateProposalSchema`](../packages/schemas/src/memory_bank.ts)

```typescript
interface MemoryUpdateProposal {
  id: string; // UUID
  created_at: string; // ISO timestamp
  operation: "add" | "update" | "remove";
  target_scope: "global" | "project";
  target_project?: string; // Portal name if project-scoped
  learning: ProposalLearning; // Learning without status field
  reason: string; // Why this proposal was created
  agent: string; // Agent that created the proposal
  execution_id?: string; // Source execution trace_id
  status: "pending" | "approved" | "rejected";
  reviewed_at?: string; // ISO timestamp
  reviewed_by?: string; // Who reviewed (user or auto)
  rejection_reason?: string;
}
```

---

## CLI Commands

### Project Memory

```bash
# List all project memory banks
exactl memory projects

# View project memory for a specific portal
exactl memory project <portal>

# Add a pattern to project memory
exactl memory add-pattern <portal> \
  --name "Repository Pattern" \
  --description "All database access goes through repository classes" \
  --examples "src/repositories/task_repository.ts,src/repositories/user_repository.ts"

# Add an architectural decision
exactl memory add-decision <portal> \
  --date "2026-01-03" \
  --decision "Use PostgreSQL instead of SQLite" \
  --rationale "Need better concurrency support" \
  --alternatives "SQLite,MySQL"
```

### Execution Memory

```bash
# View execution history (most recent first)
exactl memory executions [--portal <portal>] [--limit 10]

# View specific execution details
exactl memory execution <trace-id>
```

### Global Memory

```bash
# List all global learnings
exactl memory list [--format table|json]

# Add a global learning manually
exactl memory add-learning \
  --title "Always handle async errors" \
  --description "Use try-catch blocks around all async operations" \
  --category "pattern" \
  --tags "error-handling,async" \
  --confidence "high"

# Promote a project learning to global
exactl memory promote <learning-id>
```

### Pending Proposals

```bash
# List all pending proposals
exactl memory pending [--format table|json]

# Show details of a specific proposal
exactl memory pending <proposal-id>

# Approve a pending proposal
exactl memory approve <proposal-id>

# Reject a pending proposal with reason
exactl memory reject <proposal-id> --reason "Duplicate of existing pattern"

# Approve all pending proposals
exactl memory approve-all
```

### Search

```bash
# Keyword search across all memory
exactl memory search <query> [--format table|json]

# Search by tags
exactl memory search --tags "database,performance"

# Advanced search with filters
exactl memory search "error handling" \
  --tags "async" \
  --portal "my-app" \
  --category "troubleshooting"

# Semantic search (embedding-based)
exactl memory search "how to handle authentication" --semantic
```

### Index Management

```bash
# Rebuild search indices
exactl memory rebuild-index

# Regenerate embeddings for all learnings
exactl memory regenerate-embeddings
```

### Migration

```bash
# Migrate Knowledge/ to Memory/ (dry-run)
exactl migrate-memory --dry-run

# Perform actual migration
exactl migrate-memory

# Output:
# ✓ Migrated 42 mission reports → Memory/Execution/
# ✓ Migrated 5 portal cards → Memory/Projects/
# ✓ Generated memory indices
```

---

## Usage Patterns

### For Developers

**Viewing Execution History:**

```bash
# What did the agent do in the last 10 executions?
exactl memory executions --limit 10

# What changed in a specific execution?
exactl memory execution 550e8400-e29b-41d4-a716-446655440000
```

**Understanding Project Patterns:**

## 1. Core Philosophy

> [!NOTE]
> **Concurrency & Safety:**
> Access to Memory Banks is protected by a file-locking mechanism (`.lock` files). This ensures that concurrent agents or CLI processes do not corrupt memory files during write operations. The system automatically handles retries and backoff.

Memory Banks act as the "Long-Term Memory" for the project.

```bash
# What patterns has the agent learned for this project?
exactl memory project my-app

# Search for authentication-related knowledge
exactl memory search "authentication"
```

### For Agents

Agents can programmatically access memory banks through the MemoryBankService:

```typescript
import { MemoryBankService } from "./services/memory_bank.ts";

const memoryBank = new MemoryBankService(config, logger, git);

// Retrieve project knowledge before making changes
const projectMem = await memoryBank.getProjectMemory("my-app");
console.log("Known patterns:", projectMem.patterns);

// Record execution after completion
await memoryBank.createExecutionRecord({
  trace_id: crypto.randomUUID(),
  request_id: "REQ-123",
  started_at: new Date().toISOString(),
  completed_at: new Date().toISOString(),
  status: "completed",
  portal: "my-app",
  agent: "senior-coder",
  summary: "Added authentication middleware",
  context_files: ["src/middleware/auth.ts"],
  context_portals: ["my-app"],
  changes: {
    files_created: ["src/middleware/auth.ts"],
    files_modified: ["src/app.ts"],
    files_deleted: [],
  },
  lessons_learned: ["Always validate JWT expiration"],
});
```

---

## Migration from Knowledge/

### What Gets Migrated

| Old Structure                   | New Structure                  | Notes                          |
| ------------------------------- | ------------------------------ | ------------------------------ |
| `Knowledge/Reports/{file}.md`   | `Memory/Execution/{trace-id}/` | Frontmatter → context.json     |
| `Knowledge/Portals/{portal}.md` | `Memory/Projects/{portal}/`    | Context card → overview.md     |
| `Knowledge/Context/`            | `Memory/Projects/{portal}/`    | Folded into references.md      |
| `Knowledge/Dashboard.md`        | ❌ Removed                     | Replaced by TUI (future phase) |

### Migration Process

The migration script (`scripts/migrate_to_memory_banks.ts`):

1. **Scan Knowledge/Reports/**
   - Parse frontmatter (trace_id, portal, agent, etc.)
   - Extract summary from markdown body
   - Create `Memory/Execution/{trace-id}/` structure
   - Write `summary.md`, `context.json`, `changes.diff`

1.
   - Copy portal context cards to `Memory/Projects/{portal}/overview.md`
   - Create empty `patterns.md`, `decisions.md`, `references.md`

1.
   - Rename `Knowledge/` → `Knowledge.backup-{timestamp}/`
   - Preserve for rollback

1.
   - Scan all Memory/ files
   - Build `Index/*.json` for fast search

### Rollback

If migration fails or needs reversal:

```bash
# Restore from backup
mv Knowledge.backup-1704283200/ Knowledge/
rm -rf Memory/
```

---

## Performance Considerations

### File I/O

- **Lazy Loading:** Only load memory when explicitly requested
- **Caching:** Cache project memory in-memory during execution
- **Indices:** Use pre-built indices for search (avoid full scan)
- **Embedding Storage:** Store embeddings as individual files for parallel loading

### Benchmarks

Validated performance (Phase 12.11):

| Operation        | Target  | Actual     |
| ---------------- | ------- | ---------- |
| Memory read      | < 100ms | ✅ < 50ms  |
| Keyword search   | < 100ms | ✅ < 30ms  |
| Tag-based search | < 100ms | ✅ < 30ms  |
| Embedding search | < 500ms | ✅ < 100ms |
| Memory write     | < 200ms | ✅ < 100ms |
| Index rebuild    | < 5s    | ✅ < 2s    |

### Index Regeneration

Indices are regenerated:

- After migration
- On-demand: `exactl memory rebuild-index`
- After learning approval/rejection
- When embedding manifest is missing

### Embedding Strategy

The embedding system uses deterministic mock vectors for demonstration:

- **Dimension:** 64 (lightweight but sufficient for similarity)
- **Storage:** Individual JSON files per learning
- **Manifest:** Central index for fast lookup
- **Similarity:** Cosine similarity with configurable threshold

---

## Future Work

### TUI Integration (Post-v1.1)

Memory Banks will be integrated into the TUI dashboard in a future phase:

- **Memory Banks view** (keyboard shortcut `m`)
- **Projects tab:** Browse project memory, view patterns/decisions
- **Execution tab:** Browse execution history, filter by portal/agent
- **Search tab:** Query across all memory banks
- **Pending tab:** Review and approve/reject proposals

### Advanced Features (Post-v1.1)

- **Real Embeddings:** Integration with OpenAI/local embedding models
- **Pattern Detection:** Auto-detect patterns from code changes
- **Decision Tracking:** Link decisions to execution history
- **Export/Import:** Share memory banks between Exaix instances
- **Auto-Approve Config:** `memory.auto_approve: true` to skip pending workflow
- **Auto-Approve Sources:** `memory.auto_approve.sources_allowed: ["AGENT"]` includes agent-derived proposals from `EXECUTION`, `LLM`, and `LEARNED`
- **Pending Digest:** The daemon emits a `memory_update_pending_digest` notification when there are pending proposals and no digest has been sent in the last 24 hours
- **Retention Policies:** Automatic archival of old learnings

---

## Comparison to Knowledge/

| Feature                    | Knowledge/ (v1.0)             | Memory/ (v1.1+)                           |
| -------------------------- | ----------------------------- | ----------------------------------------- |
| **Directory Name**         | Knowledge/                    | Memory/                                   |
| **Primary UI**             | Obsidian (external)           | CLI + TUI (native, future)                |
| **Structure**              | Flat (Reports/, Portals/)     | Taxonomy (Projects/, Execution/, Global/) |
| **Format**                 | Markdown + YAML frontmatter   | Markdown + JSON                           |
| **Wikilinks**              | ✅ Generated                  | ❌ Not needed                             |
| **Dataview Compatibility** | ✅ Required                   | ❌ Not needed                             |
| **Programmatic Access**    | Parse markdown + frontmatter  | Direct JSON access                        |
| **Search**                 | Obsidian search               | CLI + indices + embeddings                |
| **Learnings**              | ❌ Manual only                | ✅ Auto-extracted from executions         |
| **Pending Workflow**       | ❌ Not available              | ✅ Propose → Approve/Reject               |
| **Tests**                  | 5 Obsidian-specific tests     | 32+ memory bank tests                     |
| **Maintenance Burden**     | High (~500 LOC Obsidian code) | Low (~800 LOC memory services)            |

---

## Related Documentation

- **Implementation:** [Phase 12 Planning](../.copilot/planning/phase-12-obsidian-retirement.md)
- **Schemas:** [packages/schemas/src/memory_bank.ts](../packages/schemas/src/memory_bank.ts)
- **Migration:** [scripts/migrate_to_memory_banks.ts](../scripts/migrate_to_memory_banks.ts) (Phase 12.5)
- **Services:**
  - [packages/core/src/services/memory_bank.ts](../packages/core/src/services/memory_bank.ts) — Core memory operations
  - [packages/core/src/services/memory_extractor.ts](../packages/core/src/services/memory_extractor.ts) — Learning extraction
  - [packages/core/src/services/memory_embedding.ts](../packages/core/src/services/memory_embedding.ts) — Embedding generation
- **CLI Commands:** [apps/exactl/src/commands/memory_commands.ts](../apps/exactl/src/commands/memory_commands.ts)
- **Integration Tests:** [tests/integration/memory_integration_test.ts](../tests/integration/memory_integration_test.ts)

---

**Version History:**

- **v2.0.0 (2026-01-04):** Added Global Memory, Learnings, Pending workflow, Embeddings (Phase 12.8-12.11)
- **v1.0.0 (2026-01-03):** Initial architecture definition (Phase 12.1)
