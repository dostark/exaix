# @exaix/memory

Memory bank and vector memory abstractions for Exaix.

## Role

`@exaix/memory` owns **structured long-term knowledge storage** — project context, execution history, cross-project learnings, and pending memory proposals. It provides both programmatic access (via `MemoryBankService`) and CLI access (via `exactl memory` commands).

For CLI usage, see `docs/Exaix_User_Guide.md` §3.2 (Memory Banks). For schema definitions, see `packages/schemas/src/memory_bank.ts`.

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

| Service                  | Purpose                             | Source                                                       |
| ------------------------ | ----------------------------------- | ------------------------------------------------------------ |
| `MemoryBankService`      | Core memory operations              | `packages/memory/src/bank/memory_bank_service.ts`            |
| `MemoryExtractor`        | Learning extraction from executions | `packages/memory/src/extraction/memory_extractor.ts`         |
| `MemoryEmbeddingService` | Embedding generation                | `packages/memory/src/embeddings/memory_embedding_service.ts` |

## See Also

- [`docs/Exaix_User_Guide.md`](../../docs/Exaix_User_Guide.md) §3.2 — CLI usage and directory structure
- [@exaix/schemas](../../packages/schemas/) — Validation schemas for all memory data types
- [@exaix/portal](../../packages/portal/) — Knowledge gathering pipeline for portals
