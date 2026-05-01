---
agent: openai
scope: dev
title: OpenAI adaptation notes
short_summary: "OpenAI usage guide with quick-start, RAG steps, prompt templates, and tool-use guardrails for gpt-4o family."
version: "0.2"
topics: ["provider-adaptations", "prompts", "rag", "tooling", "thinking-protocol"]
---

## OpenAI provider adaptation notes

```text
Key points
- Default model: gpt-4o (128k). If constrained, use gpt-4o-mini for drafting then verify with gpt-4o.
- Retrieve context before coding: inject 3-6 chunks from .copilot/ with `inject_agent_context.ts --agent openai`.
- Keep responses within explicit budgets: simple 500 tokens, standard 900, complex 1500; summarize aggressively.
- Prefer tool-aware answers: propose file + line edits, then show minimal diff or apply_patch-ready snippets.
- Always cite which doc(s) you used (by path) to reinforce reuse.

Quick start (3 steps)
1) Discover: `deno run --allow-read scripts/inject_agent_context.ts openai "<query>" 4`
2) Plan: outline steps + token budget + files to touch; include a stop-and-ask decision.
3) Execute: respond with minimal diff blocks; close with verification steps (tests or lint).

Canonical prompt (short)
"You are an OpenAI coding assistant for the Exaix monorepo. Before acting, retrieve context from .copilot/ with inject_agent_context. Respect token budgets (simple 500, standard 900, complex 1500). Propose diffs, then give apply_patch-ready snippets. Always cite the docs you used."

Canonical prompt (with context injection)
"You are an OpenAI coding assistant for Exaix. You will be given retrieved context from .copilot/ (manifest summaries and top chunks). Use it before reasoning. Keep answers within the declared budget (simple 500, standard 900, complex 1500). Prefer diffs over prose. Cite the docs you used by path."

Thinking protocol (fast 5)
- Orient: restate the task + budget + files.
- Retrieve: list the context chunks/doc paths provided; note gaps.
- Plan: 3-6 bullet steps (include a check/ask step if ambiguity remains).
- Act: apply minimal diffs; keep code blocks small and scoped.
- Verify: state which tests/linters to run; call out residual risks.

Output format (required)
- Start with **Files**: list the exact files you will touch.
- Then **Plan**: 3–6 bullets, include at least one verification step.
- Then **Diffs**: small, file-scoped patches (apply_patch-ready when possible).
- End with **Verification**: concrete commands (tests/lint) + any residual risks.

Ask-when-ambiguous rule
- If requirements are unclear, ask 1–3 clarifying questions before changing code.
- If .copilot/ context is missing/stale, request rebuild of manifest/chunks/embeddings before proceeding.

Self-improvement loop
- If you discover an instruction gap mid-task (missing examples, missing commands, missing invariants), patch `.copilot/` as part of the work:
- Process: `.copilot/guidelines/self-improvement.md`
- Template: `.copilot/guidelines/self-improvement.md#template`
- Keep the patch minimal and task-scoped; rebuild/validate `.copilot/` artifacts before continuing.

RAG usage for OpenAI
- Retrieval: `inject_agent_context.ts openai "<topic>" 4` (2-3 chunks simple, 4-6 standard, 8+ complex only if necessary).
- Preview before injection (optional): `inspect_embeddings.ts --agent openai --query "<topic>" --top 8`.
- Cite sources: e.g., "Used .copilot/providers/openai.md (chunks 0-1), .copilot/cross-reference.md (chunk 2)."
- When context is stale or missing, ask for a rebuild of manifest + embeddings before proceeding.

Examples (by level)

- Junior (simple, ~500 tokens):
 "Inject .copilot/ context for 'ConfigLoader TOML errors'. Propose 2 failing unit tests with explicit assertions, then provide a single file-scoped diff to make them pass. Output must follow: Files → Plan → Diffs → Verification. Cite the docs used by path."

- Mid-level (standard, ~900 tokens):
 "Using injected context (include doc paths + chunk ids), produce a refactor plan for plan executor parsing. Provide: Files → Plan → Diffs (2–3 minimal diffs) → Verification. Ask up to 2 clarifying questions if needed."

- Senior (complex, ~1500 tokens):
 "Given injected context (chunks 0–7), draft apply_patch-ready diffs for a multi-file change. Requirements: keep diffs minimal, separate by file, and cite which doc paths informed each decision. Finish with a verification checklist and any risks."

Do / Don't
- ✅ Do inject .copilot/ context before proposing code.
- ✅ Do respect budgets and shrink answers if over budget.
- ✅ Do propose diffs with file paths and small, scoped code blocks.
- ✅ Do ask a clarifying question if requirements are ambiguous.
- ❌ Don't write long speculative prose; keep answers actionable.
- ❌ Don't edit multiple files in one block without separation.
- ❌ Don't omit citations to docs used.

Token guidance
- gpt-4o: 128k context; use for final answers and validation.
- gpt-4o-mini: faster/cheaper drafting; re-run critical reasoning with gpt-4o.
- text-embedding-3-small: 1536 dims, default for scripts/build_agents_embeddings.ts --mode openai.

Maintenance
- After updating this doc: rebuild manifest, regenerate chunks/embeddings (mock or openai), then run `validate_agents_docs.ts`.
```

---

## Provider-Specific Workflow Notes

### Quickstart (OpenAI)

Before acting, retrieve context from `.copilot/` using `inject_agent_context.ts --agent openai`.
Output format is mandatory: **Files → Plan → Diffs → Verification**. Cite agent doc paths used.
Ask 1–3 clarifying questions if requirements are ambiguous.

```
"You are an OpenAI coding assistant for Exaix. Before acting, retrieve context from .copilot/
with inject_agent_context. Output format: Files → Plan → Diffs → Verification. Cite docs used."
```

### TDD Workflow (OpenAI)

Start by proposing failing tests with explicit assertions. Use existing Exaix test helpers
(retrieve guidance from `.copilot/` first). Only then implement the minimal change to pass tests.

```
"You are implementing a change in Exaix using TDD. Inject .copilot/ context for testing patterns.
Propose 2–4 failing tests with explicit assertions, then provide minimal file-scoped diffs.
End with verification commands. Cite agent doc paths used."
```

### Debugging (OpenAI)

Reproduce first (tests or exact commands). Diagnose with evidence. Fix minimally. Verify and add
regression coverage. Output format: **Files → Plan → Diffs → Verification**.

```
"You are debugging Exaix. First, retrieve .copilot/ context relevant to the failing area.
Then: (1) reproduce, (2) diagnose root cause, (3) propose minimal diffs, (4) verify with commands."
```
