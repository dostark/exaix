---
name: self-improvement
agent: general
scope: dev
title: "Self-Improvement Loop (#self-improvement)"
description: "Detect instruction gaps during work and patch .copilot/ docs safely with minimal, test-backed updates"
short_summary: "How to detect instruction gaps during work and patch .copilot/ docs safely with minimal, test-backed updates."
version: "1.0.0"
topics: ["self-improvement", "instruction-adequacy", "agents", "maintenance", "rag"]
---

```text
Key points

- Before non-trivial work, run an **Instruction Adequacy Check**: do we have enough Exaix-specific guidance to act and verify?
- If guidance is missing, do a **Doc Patch Loop**: add the smallest, task-scoped update to `.copilot/`, then rebuild/validate, then continue the primary task.
- Keep updates grounded: add checklists, examples, and commands; avoid speculative "nice-to-have" prose.
- Treat doc changes like code changes: minimal diff, clear success criteria, and a regression test when appropriate.

Canonical prompt (short):
"Before implementing changes, run an Instruction Adequacy Check against .copilot/. If instructions are insufficient, patch .copilot/ with the smallest update needed (doc/template/cross-reference), rebuild/validate artifacts, then proceed with the primary task using the improved instructions."
```

## Instruction adequacy check

Use this at the start of a session or before a multi-step change.

1. **Classify the task**
   - TDD / bugfix / refactor / docs / CI / security / portal permissions / RAG usage

2. **Retrieve relevant instructions**
   - Start with `.copilot/DOCS.md` to find the primary docs.
   - Read the appropriate provider skill for the active model:
     - Claude: `.copilot/prompts/`
     - OpenAI: `.copilot/prompts/`
     - Google: `.copilot/prompts/`
   - Inject additional docs via `scripts/inject_agent_context.ts` when needed.

3. **Adequacy verdict**
   - ✅ Adequate if the docs specify:
     - what files/patterns to use (Exaix-specific)
     - what invariants to preserve
     - what verification to run (tests/lint/CI checks)
   - ❌ Inadequate if any of these are missing or ambiguous.

## Doc patch loop (when inadequate)

1. **List the gaps** (actionable, not vague)
   - Examples:
     - "No guidance on which test helper to use for this subsystem."
     - "No canonical command for validating manifest/chunks after .copilot/ edits."
     - "No example of the required output format for this provider in this scenario."

2. **Choose the smallest fix**
   - Add a section to an existing doc when the topic clearly belongs there.
   - Add a prompt template when the goal is reliable behavior (format/budgets/checklists).
   - Add a cross-reference row/topic when discovery is the main problem.

3. **Apply the doc patch (minimal diff)**
   - Keep changes directly relevant to the current user request.
   - Prefer checklists + examples over long narrative.

4. **Rebuild + validate `.copilot/` artifacts**
   - Rebuild manifest/chunks:
     - `deno run --allow-read --allow-write scripts/build_agents_index.ts`
   - Verify freshness:
     - `deno run --allow-read scripts/verify_manifest_fresh.ts`
   - Validate agent docs:
     - `deno run --allow-read scripts/validate_agents_docs.ts`

5. **Add enforcement (when it prevents recurrence)**
   - If a gap caused real friction, add/extend a focused test under `tests/agents/`.

6. **Resume the primary task**
   - Re-run context injection if needed (docs changed).

## Gap taxonomy (what to look for)

- **Missing examples**: no concrete Exaix-specific snippet for the task.
- **Missing commands**: no "what to run" for verification/build/validation.
- **Missing invariants**: unclear what behavior must not change.
- **Missing cross-links**: docs exist but are hard to discover.
- **Missing provider mapping**: advice exists but doesn't translate to Claude/OpenAI/Gemini workflow.
- **Missing tests**: doc changes not guarded; regressions likely.

Do / Don't

- ✅ Do keep doc updates minimal and scoped to the current task.
- ✅ Do ask 1–3 clarifying questions if the requirement is ambiguous before changing docs.
- ✅ Do rebuild `.copilot/manifest.json` and chunks after agent doc edits.
- ✅ Do add a regression test when a missing instruction caused a real failure.
- ❌ Don't broaden scope into "general best practices" unrelated to Exaix.
- ❌ Don't update many docs at once without a clear gap list.

## Examples

- **Example: Missing test helper guidance**
  - Task: "Add regression tests for a CLI config edge case."
  - Gap: no mention of the correct test context helper.
  - Patch: add a small section to `.copilot/skills/test-development/SKILL.md` pointing to `createCliTestContext()` usage for CLI tests; add one focused test under `tests/agents/` to ensure the section exists.

- **Example: Missing provider-specific output contract**
  - Task: "Perform a multi-file refactor with OpenAI."
  - Gap: provider doc doesn't enforce diff-first structure.
  - Patch: add/update a skill under `.copilot/skills/` requiring Files → Plan → Diffs → Verification, and regenerate the prompt wrapper with `scripts/generate_prompt.ts --skill <name>`.

---
exaix:
  skill_id: self-improvement
  triggers:
    keywords: [self-improvement, instruction-adequacy, doc-patch, gap-detection]
    task_types: [docs, maintenance]
    tags: [self-improvement, documentation]
  constraints:
    - "Run Instruction Adequacy Check before non-trivial work"
    - "Prefer minimal diffs over full rewrites"
    - "Rebuild manifest and chunks after agent doc edits"
    - "Add regression tests when a missing instruction caused real friction"
  output_requirements:
    - "Gap list with actionable fixes"
    - "Minimal doc patch applied"
    - "Rebuilt manifest/chunks validated"
  quality_criteria:
    - name: minimality
      description: Doc changes are scoped to the current task, not speculative
      weight: 40
    - name: testability
      description: Regression tests guard against repeated gaps
      weight: 30
    - name: completeness
      description: Patch covers all identified gaps
      weight: 30
---
