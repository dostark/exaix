---
name: self-improvement
agent: general
scope: dev
title: "Self-Improvement Loop (#self-improvement)"
description: "Detect instruction gaps during work, patch .copilot/ docs safely with minimal test-backed updates, and run the terminal phase-loop retrospective (self-improvement-retro) that catches and fixes problematic places in the phase development process — skills, instructions, .copilot structure"
short_summary: "Detect instruction gaps during work and patch .copilot/ docs safely with minimal, test-backed updates; run the terminal phase-loop retro to fix skill, instruction, and .copilot structure gaps."
version: "1.2.0"
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
   - The phase planning doc (`exaix-dev-docs/planning/phase-NN-*.md`): its Pre-Gap Analysis,
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
     (canonical). `.agents`, `.claude`, and `.cursor` are repo-root **symlinks to
     `.copilot`** (`ls -la .` shows `.agents -> .copilot` etc.), so
     `.agents/skills/<name>/SKILL.md` and `.claude/skills/<name>/SKILL.md` ARE
     `.copilot/skills/<name>/SKILL.md` — one edit already updates every mirror, no
     separate copy step needed (verify with `stat -c %i` on all three paths: identical
     inode confirms it). Only fall back to editing a mirror path directly if `ls -la .`
     ever shows one of those top-level entries as a real directory instead of a symlink
     (a genuinely diverged setup) — and even then, edit in place rather than a
     write-new-file-then-rename tool, which would fork the symlink into a real directory.
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
   - **Bump the phase doc's own `**Status**:` header** if every step is now done — see
     "Phase-doc status hygiene" below. This is the single most common gap this retro
     finds: the last step lands its own `✅`/`WIRED` marker, but the doc's top-line
     `**Status**:` field (the first thing anyone reads) never gets bumped and stays
     `🚧 Planning`/`🚧 ... In Progress` indefinitely.
   - Append a short `## Retrospective (self-improvement-retro)` section to the phase
     planning doc: the four answers condensed, a findings table (finding → fix → status),
     and what the next phase should do differently. Keep it to ~15 lines — the fixes live
     in the corpus; this section is the index.

## Phase-doc status hygiene

A phase doc's top-line `**Status**:` header (in `exaix-dev-docs/planning/phase-NN-*.md`)
goes stale far more often than the step-level content: whoever lands the last step or
the last gap-remediation step marks that step `✅`/`WIRED` and moves on without bumping
the header a few lines above it. It then keeps reading `🚧 Planning` or `🚧 Gap
Remediation In Progress` — sometimes for months — while every step underneath is done.
This is a real, repeat-offender pattern: `phase-91-positioning-and-narrative.md`'s own
Step 1 audit independently found and named it in three other phases (67, 71, 82) before
this section existed; a full audit of the 166-file corpus (2026-08-15) found 11 more
(62, 71, 77, 78, 79, 82, 135, 142, 153, 159, 165).

**When**: as part of Phase-loop retro step 4 above (your own just-finished phase), and
periodically as a standalone sweep across the whole `exaix-dev-docs/planning/` corpus.

**Verify at the step level — never trust the header text alone**:

1. Locate every step's own completion marker. The convention differs by document era:
   older docs use `- [ ]` / `- [x]` GFM checkboxes; newer docs (~phase-140+) use prose
   bullets instead — `- ✅ <done text> → \`path\`` / `- ⚠️ deferred <text> → <token>` plus
   a per-step `**Status**: ✅ WIRED`/`✅ IMPLEMENTED` line. Zero `- [ ]` matches is NOT
   proof of completion in a prose-bullet doc — check for `⚠️` instead.
1. A doc can have every step checked and still be honestly not-closeable. Search for
   blocking language that survives past the last checked box — `⏳ PENDING`,
   `GAPS FOUND — NOT READY`, or a stated-but-unexecuted closing ritual (e.g. "the
   Phase-Completion Gate has not yet been run"). Write the corrected header to say
   exactly that (steps done, closure ritual pending), not a flattened `✅ Complete`.
1. An explicit `⚠️ deferred (<reason>)` / `🗄️ Postponed` / `❌ Cancelled` item does not by
   itself block a `✅ Complete` verdict — it is an accepted, ledger-tracked exception.
   Note the caveat in the corrected header instead of hiding it.
1. When a doc uses neither GFM checkboxes nor `### Step N` headings to track completion
   (e.g. `phase-132-model-routing.md` at the time of the 2026-08-15 audit), do not guess
   from indirect signals — leave the header untouched and say so.

**Draft the replacement in the doc's own voice**: cite the concrete evidence you actually
read (step count, test counts, gap counts, key symbols); never invent numbers the
document doesn't state. Match the register already used by correctly-labeled phases in
the same corpus (e.g. `✅ Complete — Steps 1–8 + config follow-ups + post-implementation
remediation Steps 9–12 all implemented and tested (39 passing).`).

**Edit long header lines safely**: some status blocks are a single unwrapped paragraph
1000+ characters long. `read`/`grep` output silently truncates any displayed line past
~512–768 chars, ending it with a literal `…`/`...`. Pasting that *displayed* text into an
edit body replaces the real line with a truncated one — this happened again during the
2026-08-15 audit (`phase-142-subsystem-evaluation-packs.md`) despite prior recorded
lessons about the same trap. Before editing any status line you have not seen in full:
check its real length in an `eval` cell (`len(line)`) rather than trusting a display that
ends in `…`; for a small in-place word swap on a long line, recover the untruncated
original via `git show HEAD:<path>` into a variable, apply a plain string `.replace()`,
and write the file back from that variable instead of retyping the line by hand; then
verify immediately with `git diff -- <path>` that only the intended words changed and the
line length matches expectations.

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
- **Stale phase-doc status headers**: a phase's top-line `**Status**:` says
  🚧/Planning/In Progress while every step below is done — verify at the step level (see
  "Phase-doc status hygiene"), never from the header text alone.

Do / Don't

- ✅ Do keep doc updates minimal and scoped to the current task.
- ✅ Do ask 1–3 clarifying questions if the requirement is ambiguous before changing docs.
- ✅ Do rebuild `.copilot/manifest.json` and chunks after agent doc edits.
- ✅ Do add a regression test when a missing instruction caused a real failure.
- ✅ Do run the retro only at the terminal step of the phase loop, after `#remediate-code-gaps`.
- ✅ Do answer all four retro questions from session evidence — not from memory of "having had a fine session".
- ✅ Do route every retro finding to PATCHED / DEFERRED / REJECTED — findings without a disposition are not findings, they are noise.
- ✅ Do remember `.agents`/`.claude`/`.cursor` are top-level symlinks to `.copilot` — editing `.copilot/skills/<name>/SKILL.md` already updates every mirror; verify with `stat -c %i` (or `ls -la .`) before manually copying anything.
- ❌ Don't broaden scope into "general best practices" unrelated to Exaix.
- ❌ Don't update many docs at once without a clear gap list.
- ❌ Don't rewrite a skill wholesale to fix one friction point — patch the smallest section.
- ❌ Don't declare a retro complete on a summary alone — a retro with zero patches must say why (every finding REJECTED/DEFERRED with rationale).
- ❌ Don't regenerate `.copilot/DOCS.md` and commit wholesale cosmetic table drift — restore it from git when the only diff is formatting (keep content rows).
- ✅ Do verify a phase doc's completion at the step level (checkboxes, per-step Status
  markers, Reachability Ledger rows) before trusting or rewriting its top-line Status
  header — see "Phase-doc status hygiene".
- ❌ Don't copy `read`/`grep` output ending in `…`/`...` into an edit body for a long
  line — it is display-truncated, not the real content; recover the full line (`git
  show`, untruncated re-read) before editing it.

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

- **Example: Phase-doc status hygiene audit**
  - Task: "Update status of all phases which are actually completed" (a standalone
    audit, not tied to a single phase's own retro).
  - Method: bulk-scanned all 166 `exaix-dev-docs/planning/phase-*.md` docs for
    open/closed checkbox counts and header text, then individually verified every
    non-obvious candidate against step-level evidence before touching anything.
  - Findings: 11 confirmed stale headers, including one self-contradicting header
    (`phase-142`: read "🚧 ... In Progress" while its own next sentence said "all twelve
    gaps are now closed") and one nuanced case (`phase-153`: steps done, but the doc
    itself said its Phase-Completion Gate had not yet run — corrected to say exactly
    that, not flattened to `✅ Complete`). Two suspects were left untouched on
    inspection: `phase-133` had a genuinely still-`⏳ PENDING` gap; `phase-132` had no
    reliable step-tracking convention to verify against.
  - Patch: 11 headers corrected in place; caught and repaired one truncation-copy
    mistake mid-task via `git show` + a Python splice, verified via `git diff`.

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
      phase-status,
      status-header,
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
    - "Verify a phase doc's completion at the step level before trusting or rewriting its Status header"
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
