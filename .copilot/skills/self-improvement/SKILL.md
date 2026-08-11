---
name: self-improvement
agent: general
scope: dev
title: "Self-Improvement Loop (#self-improvement)"
description: "Detect instruction gaps during work, patch .copilot/ docs safely with minimal test-backed updates, and run the terminal phase-loop retrospective (self-improvement-retro) that catches and fixes problematic places in the phase development process — skills, instructions, .copilot structure"
short_summary: "Detect instruction gaps during work and patch .copilot/ docs safely with minimal, test-backed updates; run the terminal phase-loop retro to fix skill, instruction, and .copilot structure gaps."
version: "1.1.0"
topics: ["self-improvement", "instruction-adequacy", "retrospective", "agents", "maintenance", "rag", "process"]
qwen_skill: self-improvement
---

```text
Key points

- Two complementary modes:
  1. **Instruction Adequacy Check** (before or mid-task): do we have enough Exaix-specific guidance to act and verify? If guidance is missing, do a **Doc Patch Loop** — the smallest task-scoped `.copilot/` update, then rebuild/validate, then continue the primary task.
  2. **Phase-loop retro (#self-improvement-retro)** (terminal step of the phase loop): after `#remediate-code-gaps` closes, review the whole loop just completed — plan → pre-gap-analysis → remediate-plan-gaps → next-steps (×N) → post-gap-analysis → remediate-code-gaps — and fix every problematic place it revealed: skill defects, confusing instructions, missing commands, structural gaps in `.copilot/`.
- Keep updates grounded: add checklists, examples, and commands; avoid speculative "nice-to-have" prose.
- Treat doc changes like code changes: minimal diff, clear success criteria, and a regression test when appropriate.
- The retro is what makes the phase loop self-improving: it must close with real patches (or an explicit no-fix rationale per finding) — never with a summary alone.

Canonical prompt (short):
- Mid-task: "Before implementing changes, run an Instruction Adequacy Check against .copilot/. If instructions are insufficient, patch .copilot/ with the smallest update needed (doc/template/cross-reference), rebuild/validate artifacts, then proceed with the primary task using the improved instructions."
- Retro (terminal, phase loop): "Run the self-improvement-retro for phase-NN: review the loop we just ran (plan → pre-gap-analysis → remediate-plan-gaps → next-steps → post-gap-analysis → remediate-code-gaps), answer the four retro questions from the session evidence, list every gap in the skills / instructions / .copilot structure it revealed, patch the smallest fix for each, add regression tests where friction recurred, rebuild/validate .copilot artifacts, and write the Retrospective into the phase doc."
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

## Phase-loop retro (terminal step: self-improvement-retro)

Run this ONCE per phase, after `#remediate-code-gaps` closes and before the phase is
declared done. Its purpose is to make the NEXT phase easier: every friction point of the
loop just completed becomes a concrete improvement to the agent instructions.

Position in the loop — this skill is the terminal step:

```
#plan → #pre-gap-analysis → #remediate-plan-gaps → #next-steps (×N) →
#post-gap-analysis → #remediate-code-gaps → #self-improvement-retro
```

1. **Gather the session evidence**
   - The phase planning doc (`.copilot/planning/phase-NN-*.md`): its Pre-Gap Analysis,
     Post-Gap Analysis, remediation steps, and Reachability Ledger.
   - The session/chat log: every skill invocation, failed tool call, blocked or
     rolled-back commit, CI gate failure, re-read, and "I had to figure this out" moment.
   - `git log` of the phase (commits per step) for what actually happened vs. what the
     docs predicted.

2. **Answer the four retro questions (mandatory — one honest answer each)**
   - **Q1 — Session issues**: Did you run into any issues during this session that could
     be improved? Include failed tool calls, blocked/rolled-back commits, CI gate
     surprises, and wrong assumptions that cost rework.
   - **Q2 — Confusing guidance**: Any confusing docs/prompts or tricky wording that took
     effort to figure out? Name the exact file and the exact wording.
   - **Q3 — Final thoughts**: Anything about the phase process worth raising that the
     other questions missed?
   - **Q4 — Minor items**: Anything minor you didn't mention — small inconsistencies,
     stale cross-links, nits? They count; note them.

3. **Route every finding to a fix** (do not stop at "good to know")
   - Skill defect (wrong or missing guidance) → patch `.copilot/skills/<name>/SKILL.md`
     (canonical), then mirror the edit to the `.agents/skills/` and `.claude/skills/` copies.
   - Discovery or contract defect (missing prompt wrapper, stale prompts table) →
     `.copilot/prompts/` via `deno run -A scripts/generate_prompt.ts --skill <name>`, and
     `.copilot/prompts/README.md`.
   - Catalog or taxonomy defect → regenerate `.copilot/DOCS.md` rows / manifest topics via
     `scripts/build_agents_index.ts` (restore DOCS.md after if it only differs cosmetically).
   - Recurring-friction gap (a missing instruction already caused a real failure) →
     add/extend a focused test under `tests/agents/` so the fix is enforced, not just documented.
   - Process-level gap → note it in the phase doc's Retrospective section with a pointer
     to the patch.
   - Each finding gets one of: **PATCHED** (with the diff), **DEFERRED** (with reason +
     owner), or **REJECTED** (with rationale). No finding dies silently.

4. **Patch, rebuild, validate, then write the Retrospective**
   - Apply the smallest patch per finding (see Doc patch loop below).
   - Rebuild `.copilot/manifest.json` and validate (commands below).
   - Append a short `## Retrospective (self-improvement-retro)` section to the phase
     planning doc: the four answers condensed, a findings table (finding → fix → status),
     and what the next phase should do differently. Keep it to ~15 lines — the fixes live
     in the corpus; this section is the index.

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
- **Stale references**: instructions point to paths that no longer exist (e.g. a moved
  doc, a retired `agents/` tree) — grep the path before trusting it.
- **Loop disconnects**: a skill's workflow chain omits the phase-loop steps that actually
  precede/follow it.

Do / Don't

- ✅ Do keep doc updates minimal and scoped to the current task.
- ✅ Do ask 1–3 clarifying questions if the requirement is ambiguous before changing docs.
- ✅ Do rebuild `.copilot/manifest.json` and chunks after agent doc edits.
- ✅ Do add a regression test when a missing instruction caused a real failure.
- ✅ Do run the retro only at the terminal step of the phase loop, after `#remediate-code-gaps`.
- ✅ Do answer all four retro questions from session evidence — not from memory of "having had a fine session".
- ✅ Do route every retro finding to PATCHED / DEFERRED / REJECTED — findings without a disposition are not findings, they are noise.
- ✅ Do mirror `.copilot/skills/` edits to the `.agents/skills/` and `.claude/skills/` copies (they are untracked mirrors of the canonical tree).
- ❌ Don't broaden scope into "general best practices" unrelated to Exaix.
- ❌ Don't update many docs at once without a clear gap list.
- ❌ Don't rewrite a skill wholesale to fix one friction point — patch the smallest section.
- ❌ Don't declare a retro complete on a summary alone — a retro with zero patches must say why (every finding REJECTED/DEFERRED with rationale).
- ❌ Don't regenerate `.copilot/DOCS.md` and commit wholesale cosmetic table drift — restore it from git when the only diff is formatting (keep content rows).

## Examples

- **Example: Missing test helper guidance**
  - Task: "Add regression tests for a CLI config edge case."
  - Gap: no mention of the correct test context helper.
  - Patch: add a small section to `.copilot/skills/test-development/SKILL.md` pointing to `createCliTestContext()` usage for CLI tests; add one focused test under `tests/agents/` to ensure the section exists.

- **Example: Missing provider-specific output contract**
  - Task: "Perform a multi-file refactor with OpenAI."
  - Gap: provider doc doesn't enforce diff-first structure.
  - Patch: add/update a skill under `.copilot/skills/` requiring Files → Plan → Diffs → Verification, and regenerate the prompt wrapper with `scripts/generate_prompt.ts --skill <name>`.

- **Example: Phase-loop retro finding**
  - Session: during #next-steps the agent twice mis-ran the plan-step commit because the `→`-path rule was buried mid-document; the #post-gap-analysis "re-read every Resolution" rule was also missed once.
  - Q1 answer: "blocked commits twice on the plan-step gate; the commit rule was hard to find."
  - Gaps: (1) next-steps buries the `→`-path staging rule; (2) post-gap-analysis' re-verify rule is easy to skip.
  - Patch: move each rule into its skill's Do/Don't list; add `tests/agents/` assertions that the bullets exist; append the Retrospective section to the phase doc.

---

## Related

- [plan](../plan/SKILL.md) — phase planning documents (precedes the loop)
- [pre-gap-analysis](../pre-gap-analysis/SKILL.md) — plan validation before implementation
- [post-gap-analysis](../post-gap-analysis/SKILL.md) — post-implementation review against plan
- [test-development](../test-development/SKILL.md) — regression-test placement for doc fixes

---
exaix:
  skill_id: self-improvement
  triggers:
    keywords: [
      self-improvement,
      self-improvement-retro,
      retro,
      retrospective,
      instruction-adequacy,
      doc-patch,
      gap-detection,
      phase-loop,
    ]
    task_types: [docs, maintenance, process]
    tags: [self-improvement, documentation, retrospective]
  constraints:
    - "Run Instruction Adequacy Check before non-trivial work"
    - "Run the retro once per phase, after remediate-code-gaps, before declaring the phase done"
    - "Prefer minimal diffs over full rewrites"
    - "Rebuild manifest and chunks after agent doc edits"
    - "Add regression tests when a missing instruction caused real friction"
    - "Route every retro finding to PATCHED, DEFERRED, or REJECTED — none die silently"
  output_requirements:
    - "Gap list with actionable fixes"
    - "Minimal doc patch applied"
    - "Rebuilt manifest/chunks validated"
    - "Retrospective section in the phase planning doc (retro mode, ~15 lines)"
    - "Four retro questions answered from session evidence (retro mode)"
  quality_criteria:
    - name: minimality
      description: Doc changes are scoped to the current task, not speculative
      weight: 30
    - name: testability
      description: Regression tests guard against repeated gaps
      weight: 25
    - name: completeness
      description: Patch covers all identified gaps
      weight: 25
    - name: retro_completeness
      description: All four retro questions answered; every finding routed to PATCHED / DEFERRED / REJECTED
      weight: 20
---
