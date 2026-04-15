---
agent: general
scope: dev
title: "Pre-Gap Analysis Workflow"
short_summary: "Thin slash-command wrapper for pre-gap analysis."
version: "1.0"
topics: ["pre-gap", "analysis", "workflow"]
qwen_skill: pre-gap-analysis
description: Pre-implementation gap analysis of a phase planning document — finds ambiguities, missing contracts, and security risks before coding starts
---

# Pre-gap analysis (pre-implementation)

Thin slash-command wrapper for the canonical pre-implementation gap analysis workflow.

## Canonical source of truth

- `.copilot/prompts/pre-gap-analysis.md`

## Use this command to

1. Read the supplied planning document and every source file it references.
1. Follow the phased analysis process defined in `.copilot/prompts/pre-gap-analysis.md`:
   - Phase 1: Ingest the plan and any additional context documents.
   - Phase 2: Verify source file existence, data-flow chains, constructor contracts, schema compat, algorithm completeness, cross-component ownership.
   - Phase 3: Check §F sub-section completeness, test coverage spec, §3D documentation compliance, export paths, missing constants.
   - Phase 3b: Security feasibility check on every step touching input, auth, paths, secrets, or external data.
   - Phase 3c: Traceability & configurability check on every step introducing new events, thresholds, or opt-in features.
   - Phase 4: Classify every gap (🔴 Critical / 🔒 Security / 🟡 Feasibility / 🟠 Testing / 🔵 Conceptual), build gap summary table.
   - Phase 5: Write gap entries, summary table, and Pre-Implementation Actions list into the planning document.
   - Phase 6: Bump document version; run markdown lint.
1. Treat any additionally supplied documents as authoritative context.

## Execution requirements

1. Treat `.copilot/prompts/pre-gap-analysis.md` as authoritative if this wrapper conflicts with it.
1. Do not begin implementing anything — output is a gap report and document amendments only.
1. Write gaps into the planning document itself, not only in chat.
1. The gap summary table is mandatory and must appear before the detailed gap entries.
1. Security Phase 3b is mandatory for every step that touches input handling, file paths, auth, secrets, or external payloads — even if the plan does not mention security.
1. Bump the document version after writing gaps in.

## Output format

1. Brief chat summary: total gaps by severity and whether the plan is safe to implement.
1. Confirmation that the planning document was updated with the gap sections.
1. Any blocking issue that must be resolved before implementation can begin.
