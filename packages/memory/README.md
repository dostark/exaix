# @exaix/memory

Memory bank and vector memory abstractions for Exaix.

## Role

`@exaix/memory` owns **structured long-term knowledge storage** — project context, execution history, cross-project learnings, and pending memory proposals. It provides both programmatic access (via `MemoryBankService`) and CLI access (via `exactl memory` commands).

## Directory Structure

```
Memory/
├── Projects/{portal-name}/    # Project-specific knowledge banks
│   ├── overview.md            # Project summary and context
│   ├── patterns.md            # Code patterns and conventions
│   ├── decisions.md           # Architectural decisions
│   └── references.md          # Key files, APIs, documentation links
│
├── Execution/{trace-id}/      # Execution history
│   ├── summary.md             # Human-readable execution summary
│   ├── context.json           # Structured execution metadata
│   └── changes.diff           # Git diff of changes made
│
├── Global/                    # Cross-project learnings
│   ├── learnings.json         # Structured learnings
│   └── learnings.md           # Human-readable learnings
│
├── Pending/                   # Memory update proposals awaiting approval
│   └── {proposal-id}.json
│
├── Tasks/                     # Active and historical tasks
│   ├── active/
│   ├── completed/
│   └── failed/
│
└── Index/                     # Searchable indices (generated)
    ├── files.json
    ├── patterns.json
    ├── tags.json
    └── embeddings/
```

## Data Schemas

Schemas are defined in `@exaix/schemas`:

| Schema                       | File                                                              | Purpose                            |
| ---------------------------- | ----------------------------------------------------------------- | ---------------------------------- |
| `ProjectMemorySchema`        | `packages/schemas/src/memory_bank.ts::ProjectMemorySchema`        | Portal-specific knowledge          |
| `ExecutionMemorySchema`      | `packages/schemas/src/memory_bank.ts::ExecutionMemorySchema`      | Execution trace records            |
| `GlobalMemorySchema`         | `packages/schemas/src/memory_bank.ts::GlobalMemorySchema`         | Cross-project learnings            |
| `LearningSchema`             | `packages/schemas/src/memory_bank.ts::LearningSchema`             | Individual learned knowledge items |
| `MemoryUpdateProposalSchema` | `packages/schemas/src/memory_bank.ts::MemoryUpdateProposalSchema` | Pending approval workflow          |

## CLI Commands

```text
# Project memory
exactl memory projects
exactl memory project <portal>

# Execution history
exactl memory executions [--portal <portal>] [--limit 10]
exactl memory execution <trace-id>

# Global learnings
exactl memory list [--format table|json]
exactl memory promote <learning-id>

# Pending proposals
exactl memory pending [--format table|json]
exactl memory approve <proposal-id>
exactl memory reject <proposal-id> --reason "..."
exactl memory approve-all

# Search
exactl memory search <query> [--format table|json]
exactl memory search <query> --semantic

# Index management
exactl memory rebuild-index
exactl memory regenerate-embeddings
```

## Key Services

| Service                  | Purpose                             | Source                                           |
| ------------------------ | ----------------------------------- | ------------------------------------------------ |
| `MemoryBankService`      | Core memory operations              | `packages/core/src/services/memory_bank.ts`      |
| `MemoryExtractor`        | Learning extraction from executions | `packages/core/src/services/memory_extractor.ts` |
| `MemoryEmbeddingService` | Embedding generation                | `packages/core/src/services/memory_embedding.ts` |

## See Also

- [@exaix/schemas](../../packages/schemas/) — Validation schemas for all memory data types
- [@exaix/portal](../../packages/portal/) — Knowledge gathering pipeline for portals
