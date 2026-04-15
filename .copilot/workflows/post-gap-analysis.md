---
agent: general
scope: dev
title: "Post-Gap Analysis Workflow"
short_summary: "Thin slash-command wrapper for post-gap analysis."
version: "1.0"
topics: ["post-gap", "analysis", "workflow"]
qwen_skill: post-gap-analysis
description: Deep post-implementation review of a phase planning document — verifies what was built against the plan, finds gaps, and writes remediation steps back into the document
---

# Post-gap analysis (post-implementation)

Thin slash-command wrapper for the canonical deep post-implementation review workflow.

## Canonical source of truth

- `.copilot/prompts/post-gap-analysis.md`

## Use this command to

1. Read the supplied planning document (and any additional context documents) in full.
1. Follow the phased review process defined in `.copilot/prompts/post-gap-analysis.md`:
   - Phase 1: Ingest the plan and any additional context documents.
   - Phase 2: For every completed step, verify the real code matches the plan, tests exist and pass, and success criteria are met. Flag silently-implemented but unmarked steps.
   - Phase 3: Check all four §F sub-sections per step and §3D documentation compliance.
   - Phase 3b: Security gap check on every step touching input, auth, paths, secrets, or external data.
   - Phase 3c: Traceability & configurability check on every step introducing new events, thresholds, or opt-in features.
   - Phase 4: Classify every gap (🔴 Critical / 🔒 Security / 🟡 Feasibility / 🟠 Testing / 🔵 Conceptual), build gap summary table.
   - Phase 5: Append Deep Review header, gap entries, summary table, and numbered TDD-First remediation steps into the planning document.
   - Phase 6: Bump document version; update status to "🚧 Gap Remediation In Progress"; run markdown lint.
1. Treat any additionally supplied documents as authoritative context.

## Execution requirements

1. Treat `.copilot/prompts/post-gap-analysis.md` as authoritative if this wrapper conflicts with it.
1. Do not implement remediation steps — write them into the document as a plan for future execution.
1. Write all gaps into the planning document itself, not only in chat.
1. The gap summary table is mandatory before the detailed gap entries.
1. Security Phase 3b is mandatory for every step that touches input handling, file paths, auth, secrets, or external payloads.
1. New steps are numbered sequentially after the last existing step — do not renumber existing steps.
1. A documentation update step (§3D) must be the final new step when interface, schema, or CLI behaviour gaps are remediated.
1. Bump the document version and update the Status line after writing gaps.

## Output format

1. Brief chat summary: total gaps by severity and overall plan health.
1. Confirmation that the planning document was updated with the review sections and remediation steps.
1. Any blocking critical or security gap requiring immediate attention.
