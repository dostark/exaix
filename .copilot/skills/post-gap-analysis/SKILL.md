---
agent: senior-coder
tools:
  - read_file
  - patch_file
  - search_files
  - run_command
scope: dev
title: "Post-Gap Analysis Skill (#post-gap-analysis)"
description: Deep post-implementation review of a phase planning document — verifies what was built against the plan, finds gaps, and writes remediation steps back into the document
short_summary: "Deep review of an existing phase planning document: checks implementation against plan, finds gaps, and writes remediation steps back into the document."
version: "1.2"
topics: ["planning", "gap-analysis", "review", "tdd", "architecture", "quality", "security"]
qwen_skill: post-gap-analysis
---

```text
Key points
- This is a POST-implementation review, not a pre-implementation gap analysis.
  Verify what was actually built against what the plan promised.
- Read the planning document first, then read every source file it references.
- Check every step marked ✅ IMPLEMENTED or [x] against the real code,
  not against the plan's description of the code.
- Any additionally supplied documents (architecture references, prior phase
  plans, design specs) must be used as context — not ignored.
- Gaps must be classified by severity and written INTO the planning document
  itself (appended after existing content), not just reported in chat.
- New remediation steps must follow the exact TDD-First format required by
  .copilot/planning/README.md §F: Actions, Architecture Notes, Planned Tests,
  Success Criteria. They must be numbered sequentially after the last
  existing step.
- A documentation update step (matching §3D of the planning README) must be
  included as the final new step whenever interface, schema, or CLI behaviour
  gaps are remediated.
- Bump the document version (e.g., 1.2 → 1.3) and update the Status line
  to "🚧 Gap Remediation In Progress" after writing gaps into it.
- Run a security gap check (Phase 5) on every step that touches input
  handling, auth, path resolution, secrets, or external data.
- Run a traceability & configurability check (Phase 6) on every step that
  introduces new EventLogger events, thresholds, timeouts, or opt-in features.
- When reviewing more than ~20 source files, work in batches of 5–10: read a batch, record findings, then continue.

Canonical prompt (short):
"Deep-review .copilot/planning/phase-NN-*.md against the actual codebase.
Find all gaps between plan claims and implementation, write them into the
document with remediation steps."

Examples
- "#post-gap-analysis .copilot/planning/phase-63-flow-error-recovery.md"
- "#post-gap-analysis .copilot/planning/phase-64-flow-namespace-blackboard.md
   Additional context: ARCHITECTURE.md, src/flows/flow_runner.ts"

Do / Don't
- ✅ Do read the actual source files — never trust the plan's description alone.
- ✅ Do verify every success criterion by inspecting real code and test files.
- ✅ Do cross-check each step against .copilot/planning/README.md §F
  requirements (Actions / Architecture Notes / Planned Tests / Success Criteria).
- ✅ Do classify every gap with a severity symbol (🔴 Critical / 🔒 Security /
  🟡 Feasibility / 🟠 Testing / 🔵 Conceptual) so the team can triage quickly.
- ✅ Do run Phase 5 security checks on every step touching input handling,
  auth/authorisation, path resolution, secrets, or external payloads.
- ✅ Do include a numbered gap summary table before the detailed gap entries.
- ✅ Do write new remediation steps using the full §F TDD-First template.
- ✅ Do add a documentation update step last (§3D) when interfaces or
  schemas change.
- ✅ Do bump the document version and update the Status field in the frontmatter.
- ✅ Do use any additionally supplied documents as context.
- ✅ Do run Phase 6 traceability & configurability checks on every step that
  introduces new `EventLogger` events, thresholds, timeouts, or opt-in features.
- ✅ Do run Phase 4 scenario framework coverage verification on every step that
  affects the request → plan → execution → review → memory → update flow.
- ❌ Don't mark a plan step as gap-free unless you verified its test files.
- ❌ Don't skip Phase 5 for steps that handle external data or file paths.
- ❌ Don't invent remediation steps for code that already exists and passes.
- ❌ Don't report gaps only in chat — they MUST be written into the document.
- ❌ Don't skip the gap summary table — it is required for agent traceability.
- ❌ Don't renumber existing steps — new steps continue from the last existing
  step number.
- ❌ Don't accept hardcoded threshold or timeout literals — they must be named
  constants in `src/shared/constants.ts` or config-schema fields.
- ❌ Don't skip event payload typing — untyped events block audit chain
  verification and make integration tests fragile.

Related skills:
- #pre-gap-analysis — Pre-implementation gap analysis (no code to check yet)
- #plan         — Draft a new phase planning document from scratch
- #next-steps   — Re-enter the TDD loop to remediate gaps found here
- #commit       — Create a structured commit after remediation

Workflow chain (typical):
  #plan → #pre-gap-analysis → #next-steps → **#post-gap-analysis** → #commit
```

---

## Instructions for Agent

You are performing a **deep post-implementation review** of the phase planning
document provided. Your output has two parts:

1. **A chat summary** — brief findings overview.
1. **Edits written directly into the planning document** — gap table, detailed
   gap entries, and numbered remediation steps appended after the last existing
   section.

---

### Phase 1 — Ingest

Read the planning document in full: version, status, every step and its
completion marker, every file path and symbol. Read all additionally supplied
documents as ground-truth context.

---

### Phase 2 — Implementation Verification

For **every completed step**: verify the actual implementation exists, the
planned tests exist and pass, and every success criterion is met by inspecting
real code.

For **every incomplete step**: check whether it was implemented anyway but the
plan not updated (document gap, 🔵 Conceptual).

---

### Phase 3 — Standards Compliance Check

Check every step for all four §F sub-sections (Actions / Architecture Notes /
Planned Tests / Success Criteria). Check §3D documentation update compliance.

---

### Phase 4 — Scenario Framework Coverage Verification

For every step affecting the request → plan → execution → review → memory → update
flow: verify existing scenarios exercise the behaviour, check scenario assertions,
determine if new scenarios are needed.

---

### Phase 5 — Security Gap Analysis

For every step touching input parsing, file-system access, auth, secrets,
network calls, process execution, or shared mutable state — verify the nine
security checklist items. Each failure is a 🔒 Security gap.

---

### Phase 6 — Traceability & Configurability Check

For every step introducing new behaviour: verify event naming, payload typing,
audit chain completeness, event assertions in tests; verify config-driven vs.
constant-driven values, config schema declaration, feature enable/disable path,
config validation tests.

---

### Phase 7 — Gap Classification

| Symbol         | Meaning                                                            |
| -------------- | ------------------------------------------------------------------ |
| 🔴 Critical    | Blocks correctness — code diverges from plan in a breaking way     |
| 🔒 Security    | Security vulnerability or missing security control (OWASP Top 10)  |
| 🟡 Feasibility | Plan claim is unverifiable or implementation-risky                 |
| 🟠 Testing     | Missing or under-specified test; implementation may ship uncovered |
| 🔵 Conceptual  | Minor mismatch, missing doc marker, or style divergence            |

Build a gap summary table before detailed entries.

---

### Phase 8 — Write Gaps and Remediation Steps Into the Document

Append at end of planning document using the exact format below.

#### Required markdown format

```markdown
---

## Post-Gap Analysis — <ISO date> — Verdict: ⚠️ GAPS FOUND / ✅ IMPLEMENTATION COMPLETE

### Gap Summary

| # | Step   | Severity    | Description            |
| - | ------ | ----------- | ---------------------- |
| 1 | Step N | 🔴 Critical | <one-line description> |
| 2 | Step N | 🔒 Security | <one-line description> |

### Gap Detail

#### GAP-1 — 🔴 Critical — Step N: <title>

**Finding:** <detailed explanation>
**Expected (plan says):** <quoted plan text>
**Actual (code shows):** <what is actually in the code>
**Impact:** <consequence if not fixed>

---

## Gap Remediation Plan

### Step <N+1>: Remediate GAP-1 — <title>

**Actions:**

- <file>: <specific change>

**Architecture Notes:** <DI / pattern rationale>

**Planned Tests:**

- `<test name>` — <what it verifies>

**Success Criteria:**

- <measurable criterion>
```

---

### Phase 9 — Finalize

1. Bump document version in frontmatter.
1. Update Status line to `🚧 Gap Remediation In Progress`.
1. Run markdown lint.

---

## Output format

1. Brief chat summary: total gaps by severity and overall plan health.
1. Gap summary table — one row per gap (step, severity, description).
1. Confirmation that the planning document was updated with remediation steps in §F TDD-First format.
1. Any blocking critical or security gap requiring immediate attention.
1. Commit payload — use `#commit` after all remediation steps are written into the document.
