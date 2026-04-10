---
description: Deep post-implementation review of a phase planning document — verifies what was built against the plan, finds gaps, and writes remediation steps back into the document
---

# Post-gap analysis (post-implementation)

Thin slash-command wrapper for the canonical deep post-implementation review workflow.

## Canonical source of truth:
- `.copilot/prompts/post-gap-analysis.md`

## Use this command to:
1. Read the supplied planning document (and any additional context documents) in full.
2. Follow the phased review process defined in `.copilot/prompts/post-gap-analysis.md`:
   - Phase 1: Ingest the plan and any additional context documents.
   - Phase 2: For every completed step, verify the real code matches the plan, tests exist and pass, and success criteria are met. Flag silently-implemented but unmarked steps.
   - Phase 3: Check all four §F sub-sections per step and §3D documentation compliance.
   - Phase 3b: Security gap check on every step touching input, auth, paths, secrets, or external data.
   - Phase 3c: Traceability & configurability check on every step introducing new events, thresholds, or opt-in features.
   - Phase 4: Classify every gap (🔴 Critical / 🔒 Security / 🟡 Feasibility / 🟠 Testing / 🔵 Conceptual), build gap summary table.
   - Phase 5: Append Deep Review header, gap entries, summary table, and numbered TDD-First remediation steps into the planning document.
   - Phase 6: Bump document version; update status to "🚧 Gap Remediation In Progress"; run markdown lint.
3. Treat any additionally supplied documents as authoritative context.

## Execution requirements:
1. Treat `.copilot/prompts/post-gap-analysis.md` as authoritative if this wrapper conflicts with it.
2. Do not implement remediation steps — write them into the document as a plan for future execution.
3. Write all gaps into the planning document itself, not only in chat.
4. The gap summary table is mandatory before the detailed gap entries.
5. Security Phase 3b is mandatory for every step that touches input handling, file paths, auth, secrets, or external payloads.
6. New steps are numbered sequentially after the last existing step — do not renumber existing steps.
7. A documentation update step (§3D) must be the final new step when interface, schema, or CLI behaviour gaps are remediated.
8. Bump the document version and update the Status line after writing gaps.

## Output format:
1. Brief chat summary: total gaps by severity and overall plan health.
2. Confirmation that the planning document was updated with the review sections and remediation steps.
3. Any blocking critical or security gap requiring immediate attention.
