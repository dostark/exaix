---
agent: senior-coder
scope: dev
title: "Phase 68: Local Embedding & Semantic Memory Search"
short_summary: "Introduce a provider-agnostic embedding layer with Ollama as the first implementation, enabling zero-cost semantic vector search for the Solo edition and a pluggable interface for cloud providers (OpenAI, Google) and local alternatives (llama.cpp)."
version: "2.0"
topics: ["planning", "roadmap", "architecture", "tdd", "memory", "embeddings", "search", "ollama", "openai", "llamacpp", "solo-tier", "provider-agnostic"]
---

> [!TIP]
> This document is a specialized extension of the [root .copilot/ guidelines](../README.md).

## Status & Context

**Status**: 🚧 Planning (Generalized from Ollama-only → Provider-Agnostic)
**Phase Dependencies**: None
**Risk Level**: M — introduces a new `IEmbeddingProvider` abstraction and first concrete implementation.

## Executive Summary

- **The Problem**: In the Solo edition, `MemoryBank` falls back to frequency-based keyword scoring (TF-IDF) because vector embeddings are gated to Team+ (Weakness 1). As memory grows, keyword search produces noisy, irrelevant context, degrading agent performance.
- **The Solution**: Introduce a provider-agnostic `IEmbeddingProvider` interface with Ollama as the first implementation. Any provider that supports embeddings (Ollama, OpenAI, llama.cpp, Google) can be wired in via configuration.
- **The Goal**: Provide high-quality semantic memory matching for all editions, with a pluggable architecture that avoids future "Phase 68.5 generalize embeddings" refactors.

## Current State Analysis

### Key Files

| File | Current Role | Gap |
| ---------------------------------- | --------------------------------- | ------------------------------------------------------------ |
| `src/services/memory/memory_embedding.ts` | Defines `IMemoryEmbeddingService` (mock/deterministic) | No live LLM embedding backend |
| `src/services/memory/memory_bank.ts` | Searches memory via `MemoryBankService` | Falls back to TF-IDF when no embedding service bound |
| `src/ai/providers.ts` | LLM text-generation providers | No embedding-specific interface |
| `src/shared/interfaces/i_memory_embedding_service.ts` | `IMemoryEmbeddingService` contract | Provider-agnostic — correct abstraction, needs concrete implementations |
| `src/config/exa.config.toml` | System config | Lacks `[memory.embedding]` provider definitions |

### Constraints

- Must fail gracefully if the embedding provider is offline or the model is not available.
- Must chunk large documents before embedding to respect model context limits.
- Cloud providers (OpenAI, Google) require API keys and incur per-token costs; local providers (Ollama, llama.cpp) are free but require local infrastructure.

### Interfaces Affected

- `src/shared/interfaces/i_memory_embedding_service.ts:IMemoryEmbeddingService` (existing, provider-agnostic — **DO NOT CHANGE**)
- `src/services/memory/memory_embedding.ts:MemoryEmbeddingService` (existing mock — **EXTEND**, don't replace)
- `src/ai/providers.ts` — new `IEmbeddingProvider` interface to be added here or in a new `src/ai/embeddings/` module

## Technical Architecture & Detailed Design

### Embedding Provider Interface

```ts
// src/ai/embeddings/embedding_provider.ts
export interface IEmbeddingProvider {
  /**
   * Generate embedding vectors for one or more input texts.
   * Returns an array of vectors, one per input text.
   */
  embed(texts: string[]): Promise<number[][]>;

  /**
   * Provider identifier (e.g., "ollama", "openai", "llamacpp").
   */
  readonly providerId: string;

  /**
   * Embedding dimension for the configured model.
   */
  readonly dimension: number;
}
```

### Memory Embedding Service (Provider-Agnostic)

```ts
// src/services/memory/ollama_embedding_service.ts (first implementation)
export class OllamaEmbeddingService implements IMemoryEmbeddingService {
  constructor(
    private config: Config,
    private db: IDatabaseService,
    private provider: IEmbeddingProvider,
    private cache: LruCache<string, number[]>,
  ) {}

  // --- Implements IMemoryEmbeddingService ---
  async initializeManifest(): Promise<void>;
  async embedLearning(learning: ILearning): Promise<void>;
  async searchByEmbedding(
    query: string,
    options?: { limit?: number; threshold?: number },
  ): Promise<IEmbeddingSearchResult[]>;
  async getEmbedding(id: string): Promise<number[] | null>;
  async deleteEmbedding(id: string): Promise<void>;
  async getStats(): Promise<{ total: number; generated_at: string }>;

  // --- Private helpers ---
  private async embedText(text: string): Promise<number[]>;
  private async embedBatch(texts: string[]): Promise<number[][]>;
}
```

**Key design decision**: The service is **not** hardcoded to Ollama. It accepts an `IEmbeddingProvider` via constructor DI. `OllamaEmbeddingService` is the first concrete instantiation; `OpenAIEmbeddingService` and `LlamaCppEmbeddingService` can reuse the same class with different providers.

### Embedding Provider Factory

```ts
// src/ai/embeddings/embedding_provider_factory.ts
export function createEmbeddingProvider(config: IEmbeddingProviderConfig): IEmbeddingProvider {
  switch (config.provider) {
    case "ollama":
      return new OllamaEmbeddingClient(config);
    case "openai":
      return new OpenAIEmbeddingClient(config);
    case "llamacpp":
      return new LlamaCppEmbeddingClient(config);
    default:
      throw new Error(`Unknown embedding provider: ${config.provider}`);
  }
}
```

### Schemas

```ts
// Discriminated union for embedding provider configs
export const ZEmbeddingProviderConfig = z.discriminatedUnion("provider", [
  // Local: Ollama — localhost only (SSRF mitigation — OWASP A10)
  z.object({
    provider: z.literal("ollama"),
    model: z.string().default("nomic-embed-text"),
    baseUrl: z.string().url()
      .refine(
        (url) => {
          const host = new URL(url).hostname;
          return host === "localhost" || host === "127.0.0.1" || host === "::1";
        },
        { message: "Ollama baseUrl must resolve to localhost only (SSRF mitigation)" },
      )
      .default(DEFAULT_OLLAMA_BASE_URL),
    chunkSize: z.number().int().default(DEFAULT_OLLAMA_EMBED_CHUNK_SIZE),
  }),
  // Cloud: OpenAI — API key required
  z.object({
    provider: z.literal("openai"),
    model: z.string().default("text-embedding-3-small"),
    apiKey: z.string().min(1, "OpenAI API key is required"),
    baseUrl: z.string().url().default(DEFAULT_OPENAI_EMBED_BASE_URL),
    chunkSize: z.number().int().default(DEFAULT_OPENAI_EMBED_CHUNK_SIZE),
  }),
  // Local: llama.cpp — can be localhost or remote
  z.object({
    provider: z.literal("llamacpp"),
    model: z.string().default("nomic-embed-text"),
    baseUrl: z.string().url().default(DEFAULT_LLAMACPP_EMBED_BASE_URL),
    chunkSize: z.number().int().default(DEFAULT_LLAMACPP_EMBED_CHUNK_SIZE),
  }),
]);

export type IEmbeddingProviderConfig = z.infer<typeof ZEmbeddingProviderConfig>;

// Validates Ollama /api/embed response (OWASP A08)
export const ZOllamaEmbedResponse = z.object({
  embeddings: z.array(z.array(z.number())),
});

// Validates OpenAI /v1/embeddings response
export const ZOpenAIEmbedResponse = z.object({
  data: z.array(z.object({
    embedding: z.array(z.number()),
    index: z.number(),
  })),
  model: z.string(),
  usage: z.object({
    prompt_tokens: z.number(),
    total_tokens: z.number(),
  }),
});
```

### Logic Flow

```mermaid
flowchart TD
    A[Memory Extractor saves new Learning] --> B[MemoryBankService.addGlobalLearning]
    B --> C{Embedding Configured?}
    C -- Yes --> D[EmbeddingFactory.createProvider(config)]
    D --> E[OllamaEmbeddingService.embedLearning]
    E --> F[IEmbeddingProvider.embed(texts)]
    F --> G{Provider}
    G --> G1[Ollama /api/embed]
    G --> G2[OpenAI /v1/embeddings]
    G --> G3[llama.cpp /embedding]
    G1 --> H[Validate response with Zod schema]
    G2 --> H
    G3 --> H
    H --> I[Save vector to SQLite-vss / Memory JSON]
    C -- No --> J[Save text only — TF-IDF fallback]
```

### Design Decisions

| Decision | Rationale |
|----------|-----------|
| **Single `MemoryEmbeddingService` class with DI** | Avoids duplicating storage/caching/search logic across `OllamaEmbeddingService`, `OpenAIEmbeddingService`, etc. The provider handles HTTP specifics; the service handles persistence. |
| **Ollama localhost-only validation** | Ollama is a local daemon — SSRF risk if `baseUrl` is user-configurable. Cloud providers (OpenAI, Google) use fixed endpoints with API key auth instead. |
| **LLM providers without embeddings (Anthropic)** | Anthropic has no embedding API. Users pairing Claude with Exaix should configure `embedding.provider: "ollama"` alongside `llm.provider: "anthropic"`. This is already supported by `IApplicationContext.embeddings` being a separate optional field. |
| **Vercel AI SDK not used** | Exaix already has its own provider abstraction. Adding Vercel AI SDK would create a third abstraction layer — unnecessary complexity for this phase. |
| **Cosine similarity reused from `memory_embedding.ts`** | Standard cosine similarity is vector-agnostic — works with embeddings from any provider. |
| **LRU cache bounded by `OLLAMA_EMBED_CACHE_MAX_ENTRIES` (512)** | Prevents unbounded memory growth in long-running daemons. Evicts oldest entry when limit is exceeded. |

### Config Schema (exa.config.toml)

```toml
[memory.embedding]
provider = "ollama"
model = "nomic-embed-text"
base_url = "http://127.0.0.1:11434"
chunk_size = 1000

# Alternative: OpenAI cloud embedding
# [memory.embedding]
# provider = "openai"
# model = "text-embedding-3-small"
# api_key = "${OPENAI_API_KEY}"
```

## Implementation Plan (Step-by-Step)

### Step 68.0: Define Embedding Constants

1. **Actions**

- Add the following constants to `src/shared/constants.ts`:
  - `DEFAULT_OLLAMA_EMBED_CHUNK_SIZE = 1000`
  - `DEFAULT_OPENAI_EMBED_CHUNK_SIZE = 8000` (OpenAI handles up to 8191 tokens)
  - `DEFAULT_LLAMACPP_EMBED_CHUNK_SIZE = 1000`
  - `OLLAMA_EMBED_CACHE_MAX_ENTRIES = 512`
  - `DEFAULT_OPENAI_EMBED_BASE_URL = "https://api.openai.com/v1"`
  - `DEFAULT_LLAMACPP_EMBED_BASE_URL = "http://127.0.0.1:8080"`

1. **Architecture Notes**

- `DEFAULT_OLLAMA_BASE_URL` already exists in `src/shared/constants.ts` — no duplication needed.
- All subsequent steps must import these constants rather than using inline numeric literals.

1. **Planned Tests**

- No dedicated test file; constants are exercised by tests in Steps 68.1–68.4.

1. **Success Criteria**

- [x] `src/shared/constants.ts` exports all new constants without compile errors.
- [x] No inline numeric literals for chunk sizes or cache bounds in implementation files.

1. **Planned Tests**

- No dedicated test file; constants are exercised by tests in Steps 68.1–68.4.

1. **✅ IMPLEMENTED** — `src/shared/constants.ts`, 6 new constants added

### Step 68.1: Create IEmbeddingProvider Interface & Factory

1. **Actions**

- Create `src/ai/embeddings/embedding_provider.ts` with `IEmbeddingProvider` interface.
- Create `src/ai/embeddings/embedding_provider_factory.ts` with `createEmbeddingProvider()` factory function (starts with Ollama case, scaffold for OpenAI and llama.cpp).
- Create `src/ai/embeddings/embedding_errors.ts` with `EmbeddingError` class and error codes.

1. **Architecture Notes**

- The factory returns `IEmbeddingProvider`, not a concrete class. This enables swapping providers without changing service code.
- `EmbeddingError` extends `Error` with a `code` field: `"PROVIDER_UNAVAILABLE"`, `"MODEL_NOT_FOUND"`, `"EMBEDDING_FAILED"`, `"TIMEOUT"`.

1. **Planned Tests**

- `tests/ai/embeddings/embedding_provider_factory_test.ts` — factory returns correct provider type for each config; throws on unknown provider.
- `tests/ai/embeddings/embedding_errors_test.ts` — error codes and messages.

1. **Success Criteria**

- Factory creates `IEmbeddingProvider` instances from discriminated config.
- Unknown provider throws `EmbeddingError` with `"UNKNOWN_PROVIDER"` code.
- TypeScript compiles with strict mode — no `any` types.

### Step 68.2: Implement Ollama Embedding Client

1. **Actions**

- Create `src/ai/providers/ollama_embedding_client.ts` — implements `IEmbeddingProvider` by calling Ollama's `/api/embed` endpoint.
- Validate every HTTP response with `ZOllamaEmbedResponse.parse(body)` before returning embeddings (OWASP A08).
- Handle batching if the texts array exceeds the model context limit.
- `baseUrl` validated at construction time against localhost-only allowlist (OWASP A10 — SSRF).

1. **Architecture Notes**

- Ollama's `/api/embed` accepts `input: string | string[]` — use batch mode when possible.
- Timeout: 30s per batch (configurable via `chunkSize`).
- If Ollama returns `{"error":"model not found"}`, throw `EmbeddingError` with `"MODEL_NOT_FOUND"` code.

1. **Planned Tests**

- `tests/ai/providers/ollama_embedding_client_test.ts` — include:
  - Positive test: returns `number[][]` for input texts.
  - Negative test: typed error thrown when mock Ollama returns `{"error":"model not found"}`.
  - Negative test: non-conforming response (missing `embeddings` field) throws typed error.
  - Batch test: large text array split into multiple API calls.

1. **Success Criteria**

- Provider successfully returns `number[][]` for input texts.
- Non-conforming Ollama responses throw a typed error before vectors are used.
- Localhost validation rejects non-localhost URLs at construction.

### Step 68.3: Implement Ollama Embedding Service

1. **Actions**

- Create `src/services/memory/ollama_embedding_service.ts` implementing the full `IMemoryEmbeddingService` contract: `initializeManifest`, `embedLearning`, `searchByEmbedding`, `getEmbedding`, `deleteEmbedding`, `getStats`.
- Constructor accepts `IEmbeddingProvider` (not hardcoded to Ollama), `Config`, `IDatabaseService`, and LRU cache.
- Use `embedText`/`embedBatch` as private helpers calling `IEmbeddingProvider.embed()`.
- Reuse `cosineSimilarity` from `src/services/memory/memory_embedding.ts` — do not reimplement it.

1. **Architecture Notes**

- LRU caching for duplicate embedding inputs bounded by `OLLAMA_EMBED_CACHE_MAX_ENTRIES` from `src/shared/constants.ts`; evict oldest entry when limit reached.
- Embeddings stored in a separate `.embeddings.json` adjacent to the memory file (per Risk R2) until SQLite-vss migration in Phase 78.

1. **Planned Tests**

- `tests/services/memory/ollama_embedding_service_test.ts` — cover all six `IMemoryEmbeddingService` methods:
  - `embedLearning` stores vector and caches result.
  - `searchByEmbedding` returns results ordered by cosine similarity.
  - Cache-eviction boundary test: entries beyond `OLLAMA_EMBED_CACHE_MAX_ENTRIES` are evicted without error.
  - Graceful degradation test: provider failure falls back to empty result (not a crash).

1. **Success Criteria**

- Embeddings are generated correctly and stored persistently.
- Similarity scores correlate with semantic similarity.
- Cache prevents redundant API calls for duplicate inputs.

### Step 68.4: MemoryBank Integration & Config Binding

1. **Actions**

- Update `src/services/memory/memory_bank.ts` (`MemoryBankService`) to accept an optional `IMemoryEmbeddingService` in its constructor or via setter.
- When `memoryBank.searchMemory()` is called, embed the query via the service and calculate cosine similarity against stored vectors.
- Add `[memory.embedding]` section to `src/config/exa.config.toml` schema and loader.
- Wire `createEmbeddingProvider()` → `OllamaEmbeddingService` → `MemoryBankService` in `src/cli/init.ts`.

1. **Architecture Notes**

- If an embedding call fails (Ollama offline, model not found, timeout), catch the error, log a warning, and fall back to the existing `calculateRelevance` TF-IDF logic seamlessly.
- `MemoryBankService.searchMemory()` should try embedding first; on failure, gracefully degrade to keyword search.

1. **Planned Tests**

- `tests/integration/services/memory_bank_semantic_search_test.ts` — end-to-end test:
  - Add learnings with embeddings.
  - Search with a query that shares no keywords but is semantically related.
  - Assert semantically relevant results rank higher than keyword-only matches.
  - Stop Ollama mock, verify fallback to TF-IDF without crash.

1. **Success Criteria**

- Semantic search surfaces conceptually relevant memories that share no exact keywords.
- Graceful degradation works when Ollama is stopped.
- Config `[memory.embedding]` section loads correctly from TOML.

### Step 68.5: *(Future)* OpenAI Embedding Client

> **NOT IN SCOPE for initial implementation.** This step is planned for when Team-tier cloud embedding support is needed.

1. **Actions**

- Create `src/ai/providers/openai_embedding_client.ts` — implements `IEmbeddingProvider` via OpenAI `/v1/embeddings`.
- Validate responses with `ZOpenAIEmbedResponse`.
- API key sourced from `OPENAI_API_KEY` env var or config.

1. **Planned Tests**

- `tests/ai/providers/openai_embedding_client_test.ts`

1. **Success Criteria**

- Returns `number[][]` with correct dimensions for `text-embedding-3-small`.
- Invalid API key returns typed `EmbeddingError`.

### Step 68.6: *(Future)* llama.cpp Embedding Client

> **NOT IN SCOPE for initial implementation.** This step is planned as a local alternative to Ollama for users who prefer llama.cpp's GGUF ecosystem.

1. **Actions**

- Create `src/ai/providers/llamacpp_embedding_client.ts` — implements `IEmbeddingProvider` via llama.cpp server `/embedding` endpoint.
- Note: llama.cpp also supports OpenAI-compatible `/v1/embeddings`, so this client can reuse much of the OpenAI client logic with a different `baseUrl`.

1. **Planned Tests**

- `tests/ai/providers/llamacpp_embedding_client_test.ts`

## Provider Roadmap

| Phase | Provider | Tier | Cost | Status |
| ----- | -------- | ---- | ---- | ------ |
| **68.2–68.4** | Ollama (`nomic-embed-text`) | Solo | Free (local) | **This phase** |
| **68.5** | OpenAI (`text-embedding-3-small`) | Team | $0.02/1M tokens | Future |
| **68.6** | llama.cpp (any GGUF embedding model) | Solo | Free (local) | Future |
| **68.7** | Google (`text-embedding-004`) | Team | Freemium | Future |

## Risks & Mitigations

| Risk | Impact | Likelihood | Mitigation Strategy |
| ---------------------------------------------- | ------ | ---------: | ----------------------------------------------------------------------------------------------------- |
| R1: Embedding provider latency blocks memory retrieval | Medium | Medium | Set strict timeouts (e.g., 2000ms) on embedding calls; fallback to keywords if exceeded |
| R2: Memory bank JSON bloats with vectors | High | High | Store vectors in a separate `.embeddings.json` adjacent to the memory file until SQLite-vss migration |
| R3: Ollama model not pulled | Medium | High | Log warning suggesting `ollama pull nomic-embed-text`; gracefully fallback to keyword search |
| R4: Cloud provider API key exposed | Critical | Low | API key sourced from env var, never stored in config file; redact in logs |

## Success Metrics (Quantitative)

- Semantic search precision (Top-3 retrieval) on test fixtures increases from baseline TF-IDF by ≥ 30%.
- Embedding generation latency is < 150ms per query (Ollama local).
- Zero crashes if embedding provider daemon is absent.
- Switching providers via config requires zero code changes — only config update.

## Backward Compatibility

- Fully transparent. Existing memory banks without vectors will trigger asynchronous backfilling or gracefully rely on keyword search until embedded.
- If no `[memory.embedding]` section exists in config, behavior is identical to current (TF-IDF only).

---

## Pre-Implementation Gap Notes

> This section will be populated by a `#pre-gap-analysis` run once the plan is finalized.

### Anticipated Gaps (from Phase 68 v1.2 pre-gap analysis, carried forward)

| ID | Gap | Status | Notes |
| --- | --- | ------ | ----- |
| G1 | `src/services/memory_embedding.ts` wrong path | ✅ RESOLVED in v2.0 | Corrected to `src/services/memory/memory_embedding.ts` |
| G2 | `src/services/memory_bank.ts` wrong path | ✅ RESOLVED in v2.0 | Corrected to `src/services/memory/memory_bank.ts` |
| G3 | Ollama provider path wrong | ✅ RESOLVED in v2.0 | Now `src/ai/providers/ollama_embedding_client.ts` |
| G4 | Interface doesn't satisfy `IMemoryEmbeddingService` | ✅ RESOLVED in v2.0 | Service implements all 6 required methods |
| G5 | Logic flow shows wrong embedding trigger | ✅ RESOLVED in v2.0 | Flow now shows `embedLearning(ILearning)` |
| G6 | Cache design unspecified | ✅ RESOLVED in v2.0 | LRU with `OLLAMA_EMBED_CACHE_MAX_ENTRIES = 512` |
| G7 | No Zod validation of embedding response | ✅ RESOLVED in v2.0 | `ZOllamaEmbedResponse` + `ZOpenAIEmbedResponse` |
| G8 | `baseUrl` SSRF risk | ✅ RESOLVED in v2.0 | Localhost-only `.refine()` for Ollama |
| G9 | Duplicate cosine similarity test | ✅ RESOLVED in v2.0 | Reuse existing `cosineSimilarity` tests |
| G10 | Inline literals for chunk sizes | ✅ RESOLVED in v2.0 | Constants defined in Step 68.0 |
