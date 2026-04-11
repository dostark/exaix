---
agent: claude
scope: dev
title: "Implementation Plan Driven Development Prompt"
short_summary: "Example prompt for working from Implementation Plan steps."
version: "0.1"
topics: ["implementation-plan", "workflow", "prompts", "examples"]
---

## Prompt Template

```text
I want to work on [feature/fix].

Implementation Plan workflow:

1. READ PLAN:
   - Open docs/Exaix_Implementation_Plan.md
   - Find relevant Phase and Step
   - If no step exists, create one following existing format

1. UNDERSTAND REQUIREMENTS:
   - Read step's "Action" section
   - Review "Success Criteria"
   - Check any referenced docs or examples

1. INJECT CONTEXT:
   deno run --allow-read scripts/inject_agent_context.ts claude "[step topic] [component]" 6

1. IMPLEMENT:
   - Follow TDD if code changes
   - Update docs if needed
   - Follow patterns from agents/

1. VERIFY:
   - Check all success criteria met [x]
   - Run tests
   - Update step status

1. MARK COMPLETE:
   - Update Implementation Plan step checkboxes
   - Note any deviations or learnings

Phase: [number]
Step: [number]
Feature: [description]
```

## Example Usage (Existing Step)

**User:**

```text
I want to work on Flow parameter validation (Phase 8, Step 8.3).

Implementation Plan workflow:

1. READ PLAN:
   - Open docs/Exaix_Implementation_Plan.md
   - Find Phase 8, Step 8.3
   - Read the full step definition

1. UNDERSTAND REQUIREMENTS:
   Action: Add Zod schema for Flow parameter validation
   Success Criteria:
   - [ ] Schema validates required/optional parameters
   - [ ] Schema validates parameter types
   - [ ] Tests cover invalid parameter cases
   - [ ] Error messages are user-friendly

1. INJECT CONTEXT:
   deno run --allow-read scripts/inject_agent_context.ts claude "Zod schema validation Flow parameters" 6

1. IMPLEMENT:
   - Write failing tests first (invalid parameters should fail)
   - Create Zod schema in src/schemas/flow.ts
   - Implement validation in Flow executor
   - Verify tests pass

1. VERIFY:
   - All success criteria met
   - Run: deno test tests/flows/
   - Coverage maintained

1. MARK COMPLETE:
   - Update Implementation Plan with [x] for all criteria
   - Note: Schema follows existing pattern from src/schemas/

Phase: 8
Step: 8.3
Feature: Flow parameter validation
```

## Example Usage (Creating New Step)

**User:**

```text
I want to add a new feature: Export activity logs to JSON.

Implementation Plan workflow:

1. READ PLAN:
   - Open docs/Exaix_Implementation_Plan.md
   - Find appropriate Phase (Phase 7: Activity Logging)
   - No existing step for export feature

1. CREATE NEW STEP:
   Add Step 7.5 between 7.4 and 7.6:

   #### Step 7.5: Activity Log Export

   **Action:** Add JSON export functionality for activity logs

   **Files:**
   - `src/services/EventLogger.ts` — Add export() method
   - `src/cli/commands/export.ts` — New CLI command
   - `tests/event_logger_test.ts` — Export functionality tests

   **Success Criteria:**
   - [ ] export() method returns JSON array of events
   - [ ] CLI command `exa export-activity --format json` works
   - [ ] Tests verify export format matches schema
   - [ ] Large logs handled efficiently (streaming)

1. INJECT CONTEXT:
   deno run --allow-read scripts/inject_agent_context.ts claude "activity logging export JSON EventLogger" 6

1. IMPLEMENT:
   - Write tests for export functionality
   - Add export() method to EventLogger
   - Create CLI command
   - Verify tests pass

1. VERIFY:
   - All success criteria met
   - Run: deno test tests/event_logger_test.ts
   - Manual test: exactl export-activity --format json

1. MARK COMPLETE:
   - Update Implementation Plan step 7.5 checkboxes
   - Note: Used streaming for memory efficiency

Phase: 7
Step: 7.5 (NEW)
Feature: Activity log export
```

## Example Usage (Multi-Step Feature)

**User:**

```text
I want to add comprehensive security testing for Portal permissions.

Implementation Plan workflow:

1. READ PLAN:
   - Find Phase 6 (Portal)
   - Look for security testing step
   - Found Step 6.7: Portal Security Testing

1. UNDERSTAND REQUIREMENTS:
   Step 6.7 has multiple success criteria:
   - [ ] Path traversal tests (../)
   - [ ] Symlink escape tests
   - [ ] Absolute path restriction tests
   - [ ] Cross-portal access tests
   - [ ] All tests pass

1. INJECT CONTEXT (per test type):
   # For path traversal:
   deno run --allow-read scripts/inject_agent_context.ts claude "security testing path traversal Portal" 4

   # For symlink escape:
   deno run --allow-read scripts/inject_agent_context.ts claude "security testing symlink escape Portal" 4

1. IMPLEMENT (one criterion at a time):
   FIRST: Path traversal tests
   - Write test for ../ attempts
   - Verify PathResolver blocks them
   - Mark [ ] → [x]

   SECOND: Symlink escape tests
   - Write test for symlink detection
   - Verify Portal config validates
   - Mark [ ] → [x]

   (Continue for each criterion...)

1. VERIFY:
   After each criterion:
   - Run: deno test tests/portal_permissions_test.ts
   - Check that specific test passes

   After all criteria:
   - Run full test suite
   - Verify coverage ≥80%

1. MARK COMPLETE:
   - Update all checkboxes in Step 6.7
   - Note: Added helper assertPathBlocked() for reuse

Phase: 6
Step: 6.7
Feature: Portal security testing
```

## Expected Response Pattern

```text
Claude should:
1. Open and read Implementation Plan
1. Navigate to specific Phase and Step
1. Quote the success criteria
1. Inject context related to the step
1. Implement following TDD
1. Verify each success criterion met
1. Update Implementation Plan with [x] marks
1. Note any deviations or learnings
1. Reference Implementation Plan step number in commit message
```
