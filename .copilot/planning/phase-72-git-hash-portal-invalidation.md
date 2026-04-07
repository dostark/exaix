---
agent: senior-coder
scope: dev
title: "Phase 72: Git-Hash Portal Knowledge Invalidation"
short_summary: "Replace time-based portal knowledge staleness detection with
  git-commit-hash comparison, reducing redundant re-analysis and ensuring portal
  context is always grounded in the actual current state of the codebase."
version: "1.0"
topics:
  - planning
  - roadmap
  - architecture
  - tdd
  - portal
  - knowledge
  - git
  - caching
  - invalidation
---

> [!TIP]
> This document is a specialized extension of the [root .copilot/ guidelines](../README.md).

## Status & Context

**Status**: 🚧 Planning
**Phase Dependencies**: None
**Risk Level**: L — isolated change to `PortalKnowledgeService` invalidation logic
with no impact on downstream prompt assembly or memory services.

## Executive Summary

- **The Problem**: `PortalKnowledgeService` re-runs the 6-strategy codebase analysis
  pipeline based purely on elapsed time (default staleness threshold: 168 hours). This
  causes two failure modes: re-analysis fires after a large refactor even if the agent
  could use perfectly fresh cached knowledge; re-analysis is skipped when the codebase
  changed significantly within the TTL window (Weakness 11).
- **The Solution**: Store the portal's `HEAD` commit SHA alongside `gatheredAt` in
  `knowledge.json`. At request time, compare the live SHA via `git rev-parse HEAD`
  and trigger re-analysis only on change. Add a `max_files_delta` threshold for
  incremental vs. full pipeline selection.
- **The Goal**: Make portal knowledge invalidation accurate, cost-free for unchanged
  codebases, and faster for small diffs by running only the three cheapest strategies
  when few files changed.

## Current State Analysis

### Key Files

| File                             | Current Role                          | Gap                                                                    |
| -------------------------------- | ------------------------------------- | ---------------------------------------------------------------------- |
| `src/services/portal_knowledge/` | 6-strategy codebase analysis pipeline | Invalidation is purely time-based (`gatheredAt` timestamp)             |
| `knowledge.json`                 | Cached analysis output per portal     | Does not store `HEAD` SHA                                              |
| `src/services/git_service.ts`    | Full Git abstraction (24 KB)          | Already has `git rev-parse HEAD` capability — unused in knowledge path |

### Constraints

- `git rev-parse HEAD` must be treated as a fast, cheap check (typically < 5ms).
- Non-git portals (directories without a `.git` root) must fall back to the existing
  time-based TTL logic unchanged.
- If the git command fails (e.g., a detached HEAD or corrupted repo), fall back
  silently to time-based staleness.

### Interfaces Affected

- `src/services/portal_knowledge/portal_knowledge_service.ts`
- `src/services/portal_knowledge/knowledge_storage.ts` (or equivalent)
- `knowledge.json` schema

## Technical Architecture & Detailed Design

### Schemas

```ts
// Extend knowledge.json stored format
export const ZPortalKnowledgeHeader = z.object({
  version: z.number().int().default(2),
  portalId: z.string(),
  portalPath: z.string(),
  gatheredAt: z.string().datetime(),
  headCommitSha: z.string().length(40).optional(),
  filesAnalyzed: z.number().int().min(0),
  strategiesRun: z.array(z.string()),
  fullAnalysis: z.boolean().describe("true = all 6 strategies; false = incremental"),
});

// Invalidation decision
export const ZKnowledgeValidityCheck = z.object({
  isValid: z.boolean(),
  reason: z.enum(["sha_match", "sha_mismatch", "no_git", "time_ttl", "error_fallback"]),
  currentSha: z.string().optional(),
  cachedSha: z.string().optional(),
  filesDelta: z.number().int().optional(),
  analysisMode: z.enum(["skip", "incremental", "full"]),
});
```

### Interfaces

```ts
export interface IKnowledgeInvalidationStrategy {
  check(
    portalPath: string,
    cached: IPortalKnowledgeHeader,
  ): Promise<IKnowledgeValidityCheck>;
}

export interface IGitHeadResolver {
  resolve(portalPath: string): Promise<string | null>;
  changedFilesSince(portalPath: string, fromSha: string): Promise<string[]>;
}
```

### Logic Flow

```mermaid
flowchart TD
    A[Request arrives at portal] --> B[Load knowledge.json header]
    B --> C{Is portal a git repo?}
    C -- No --> D[Time-based TTL check - existing logic]
    C -- Yes --> E[git rev-parse HEAD]
    E --> F{SHA matches cached?}
    F -- Yes --> G[analysisMode = skip]
    F -- No --> H[git diff --name-only cachedSha HEAD]
    H --> I{filesDelta <= max_files_delta?}
    I -- Yes --> J[analysisMode = incremental - strategies 1..3 only]
    I -- No --> K[analysisMode = full - all 6 strategies]
    G --> L[Serve cached knowledge]
    J --> M[Run incremental analysis - update knowledge.json]
    K --> N[Run full analysis - update knowledge.json]
    M --> O[Persist new SHA in knowledge.json]
    N --> O
```

### Analysis Mode Strategy Map

| Mode          | Strategies Executed                                 | Typical Use Case                                                    |
| ------------- | --------------------------------------------------- | ------------------------------------------------------------------- |
| `skip`        | None                                                | Codebase unchanged since last analysis                              |
| `incremental` | 1 Directory Census, 2 Key File ID, 3 Config Parsing | Small commits: docs, comments, minor config tweaks                  |
| `full`        | All 6 strategies                                    | Structural changes: new modules, renamed files, architecture shifts |

### Config Extension

```toml
[portal.knowledge]
max_files_delta         = 20      # files changed below this: incremental mode
git_check_enabled       = true    # set false for non-git portals
fallback_ttl_hours      = 168     # TTL for non-git portals (unchanged)
log_invalidation_reason = true    # emit portal.knowledge.validity_check to journal
```

### Design Decisions

- **SHA comparison is the primary gate**: TTL is demoted to a secondary fallback only
  for non-git environments.
- **`git diff --name-only`** is used instead of `git status` to count changed files
  between the cached SHA and current HEAD. This is accurate even after branch switches.
- **Incremental strategies**: strategies 1–3 (Directory Census, Key File ID, Config
  Parsing) do not require full symbol extraction and complete in under 1 second for
  typical project sizes.
- **Atomic knowledge.json update**: write to a temp file and rename to prevent
  partially-written cache files being read mid-update.

## Implementation Plan (Step-by-Step)

### Step 72.1: Schema & Storage Migration

1. **Actions**

   - Extend `ZPortalKnowledgeHeader` with `headCommitSha` and `fullAnalysis` fields.
   - Write a one-time migration in `KnowledgeStorage` that adds `headCommitSha: null`
     to existing `knowledge.json` files (treated as cache miss on next request).

1. **Architecture Notes**

   - Keep schema version as integer. Old `knowledge.json` with no `version` field
     is treated as version 1 and will be re-analyzed in full on next request.

1. **Planned Tests**

   - `tests/unit/services/portal_knowledge/knowledge_header_schema_test.ts`
   - `tests/unit/services/portal_knowledge/knowledge_storage_migration_test.ts`

1. **Success Criteria**

   - Old `knowledge.json` files parse without error; migration runs once.
   - New files include `headCommitSha` and `fullAnalysis` fields.

---

### Step 72.2: GitHeadResolver

1. **Actions**

   - Create `src/services/portal_knowledge/git_head_resolver.ts`.
   - Implement `resolve()` using `GitService` to call `git rev-parse HEAD`.
   - Implement `changedFilesSince()` using `git diff --name-only <sha> HEAD`.

1. **Architecture Notes**

   - Both calls use `GitService`'s existing subprocess abstraction — no raw shell calls.
   - Return `null` on any git error; do not throw.

1. **Planned Tests**

   - `tests/unit/services/portal_knowledge/git_head_resolver_test.ts`
   - `tests/integration/services/portal_knowledge/git_head_resolver_integration_test.ts`

1. **Success Criteria**

   - Returns a valid 40-char SHA on a normal git repository.
   - Returns `null` for non-git directories without throwing.
   - `changedFilesSince` returns empty array on no changes.

---

### Step 72.3: Invalidation Strategy Implementation

1. **Actions**

   - Create `src/services/portal_knowledge/knowledge_invalidation_strategy.ts`.
   - Implement `check()` as specified in the logic flow above, returning
     `IKnowledgeValidityCheck`.
   - Wire into `PortalKnowledgeService.analyze()` as the entry decision.

1. **Architecture Notes**

   - `check()` must complete in < 50ms for the `skip` and `sha_match` paths.
   - Emit `portal.knowledge.validity_check` journal event with the full
     `IKnowledgeValidityCheck` payload.

1. **Planned Tests**

   - `tests/unit/services/portal_knowledge/invalidation_strategy_test.ts`

1. **Success Criteria**

   - `sha_match` → `analysisMode: skip` with no re-analysis triggered.
   - `sha_mismatch + filesDelta <= threshold` → `analysisMode: incremental`.
   - `sha_mismatch + filesDelta > threshold` → `analysisMode: full`.
   - Non-git portal → `analysisMode` derived from TTL as before.

---

### Step 72.4: Incremental Pipeline Execution

1. **Actions**

   - Update `PortalKnowledgeService` to accept `IKnowledgeValidityCheck.analysisMode`
     and conditionally skip strategies 4–6 in incremental mode.
   - After analysis, write new `headCommitSha` and `fullAnalysis` flag to
     `knowledge.json`.

1. **Architecture Notes**

   - Strategies 4–6 (Pattern Detection, Architecture Inference, Symbol Extraction)
     are expensive — skipping them in incremental mode is the primary performance gain.
   - Incremental mode must still update directory census and key file list to reflect
     new/renamed files.

1. **Planned Tests**

   - `tests/integration/services/portal_knowledge/incremental_analysis_test.ts`
   - `tests/integration/services/portal_knowledge/full_vs_incremental_accuracy_test.ts`

1. **Success Criteria**

   - Incremental analysis completes in < 1 second on a 1 000-file project.
   - `fullAnalysis: false` is written to `knowledge.json` after incremental run.
   - Full analysis still runs when `filesDelta > max_files_delta`.

---

### Step 72.5: Logging & Observability

1. **Actions**

   - Emit `portal.knowledge.skipped` event when cache is valid.
   - Emit `portal.knowledge.incremental` and `portal.knowledge.full` events on analysis
     runs, including `filesDelta` and `elapsedMs`.

1. **Planned Tests**

   - `tests/unit/services/portal_knowledge/knowledge_journal_events_test.ts`

1. **Success Criteria**

   - Every validity check produces exactly one journal event.
   - Skip events include `cachedSha` and `currentSha` confirming equality.

## Risks & Mitigations

| Risk                                                         | Impact | Likelihood | Mitigation Strategy                                                |
| ------------------------------------------------------------ | ------ | ---------: | ------------------------------------------------------------------ |
| R1: Git command fails silently during analysis               | Medium |        Low | Return `null` from resolver; fall back to TTL                      |
| R2: SHA changes on every rebase even without semantic change | Low    |     Medium | Acceptable: full analysis is cheap; this is an edge case           |
| R3: `knowledge.json` corruption on concurrent access         | High   |        Low | Atomic write (temp + rename) + existing daemon lease               |
| R4: Incremental misses structural changes                    | Medium |        Low | `max_files_delta = 20` default; reduce for safety-critical portals |

## Success Metrics (Quantitative)

- SHA validity check + skip decision executes in < 30ms P99.
- Incremental analysis completes in < 1 000ms for a project with 1 000 files.
- 100% of analysis runs produce a corresponding journal event.
- Re-analysis rate drops by > 70% on portals with low commit frequency during standard
  usage.

## Backward Compatibility

- Existing `knowledge.json` files without `headCommitSha` are treated as cache miss;
  one full analysis runs on first upgrade.
- Non-git portals continue to use TTL logic unchanged.
- All 6-strategy pipeline outputs remain identical to before when `full` mode runs.
