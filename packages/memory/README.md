# @exaix/memory

Memory bank and vector memory abstractions for Exaix.

## Role

`@exaix/memory` owns **structured long-term knowledge storage** — project context, execution history, cross-project learnings, and pending memory proposals. It provides both programmatic access (via `MemoryBankService`) and CLI access (via `exactl memory` commands).

For the full directory structure, schemas, CLI commands, and usage guide, see [`docs/Memory_Banks.md`](../../docs/Memory_Banks.md).

## Data Schemas

Schemas are defined in `@exaix/schemas`:

| Schema                       | File                                                              | Purpose                            |
| ---------------------------- | ----------------------------------------------------------------- | ---------------------------------- |
| `ProjectMemorySchema`        | `packages/schemas/src/memory_bank.ts::ProjectMemorySchema`        | Portal-specific knowledge          |
| `ExecutionMemorySchema`      | `packages/schemas/src/memory_bank.ts::ExecutionMemorySchema`      | Execution trace records            |
| `GlobalMemorySchema`         | `packages/schemas/src/memory_bank.ts::GlobalMemorySchema`         | Cross-project learnings            |
| `LearningSchema`             | `packages/schemas/src/memory_bank.ts::LearningSchema`             | Individual learned knowledge items |
| `MemoryUpdateProposalSchema` | `packages/schemas/src/memory_bank.ts::MemoryUpdateProposalSchema` | Pending approval workflow          |

## Key Services

| Service                  | Purpose                             | Source                                           |
| ------------------------ | ----------------------------------- | ------------------------------------------------ |
| `MemoryBankService`      | Core memory operations              | `packages/core/src/services/memory_bank.ts`      |
| `MemoryExtractor`        | Learning extraction from executions | `packages/core/src/services/memory_extractor.ts` |
| `MemoryEmbeddingService` | Embedding generation                | `packages/core/src/services/memory_embedding.ts` |

## See Also

- [`docs/Memory_Banks.md`](../../docs/Memory_Banks.md) — Comprehensive architecture, usage, and migration guide
- [@exaix/schemas](../../packages/schemas/) — Validation schemas for all memory data types
- [@exaix/portal](../../packages/portal/) — Knowledge gathering pipeline for portals
