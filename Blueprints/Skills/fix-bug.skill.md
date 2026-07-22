---
id: "b4e5209e-3599-4626-9abf-abecb98d9c27"
created_at: "2026-07-18T00:00:00.000Z"
source: "user"
scope: "global"
status: "active"
skill_id: "fix-bug"
name: "Bug Fix"
version: "1.0.0"
description: "Reproduce, isolate the root cause, apply the smallest safe fix, and verify — for fixing bugs, failing tests, crashes, and incorrect behavior"

triggers:
  keywords:
    - fix
    - bug
    - bugs
    - bugfix
    - defect
    - crash
    - crashes
    - crashing
    - error
    - fails
    - failing
    - regression
    - broken
    - reproduce
  task_types:
    - bugfix
  tags:
    - bugfix
    - debugging

tools:
  - read_file
  - search_files
  - list_directory
  - patch_file
  - write_file

constraints:
  - "Confirm the defect is real and reproduced (or clearly reasoned) before editing any code"
  - "State the specific root cause before making a change — name the file, symbol, and why it fails"
  - "Fix the root cause, not the symptom"
  - "Make the smallest safe change; every edited line must relate to this bug"
  - "Prefer patch_file for the targeted change; use write_file only when a full-file rewrite is genuinely required"
  - "Do not refactor, rename, or reformat code unrelated to the bug"
  - "Add or update a test that fails before the fix and passes after it (guard against recurrence)"
  - "Verify with the most relevant checks available before declaring the fix done"

output_requirements:
  - "Root cause: the specific reason the bug occurs (file, symbol, condition)"
  - "Changed: the files and the minimal edit made"
  - "Verified: which checks/tests were run and their result"
  - "Not verified / risk: anything left unchecked and residual risk"

quality_criteria:
  - name: "Root Cause Identified"
    description: "The specific cause is named before editing, not guessed after"
    weight: 30
  - name: "Minimal Fix"
    description: "Only the code required to fix the bug changed; no unrelated edits"
    weight: 30
  - name: "Regression Guard"
    description: "A test now covers the fixed behavior and would catch the bug again"
    weight: 25
  - name: "Verified"
    description: "The fix was checked with the most relevant available tests/checks"
    weight: 15

compatible_with:
  agents:
    - "*"

usage_count: 0
---

# Bug Fix

Apply this skill when the task is to fix a bug, make a failing test pass, investigate an
error, or explain why something is behaving incorrectly.

The goal is **not** to guess a cause and patch code quickly. The goal is to **reproduce,
isolate, apply the smallest safe fix, and verify**. This skill is language-agnostic —
adapt each step to the project's stack.

## 1. Understand the defect

Before changing anything, establish:

- What is the observed (wrong) behavior, and what is the expected behavior?
- What evidence exists — an error message, stack trace, log, or failing test?
- Under what conditions does it happen (inputs, environment, version)?

If the report is vague and no evidence points at a failing path, gather that first.
Do not begin editing on a hunch.

## 2. Reproduce or clearly reason about the failure

Do not fix a bug you have not reproduced or cannot clearly explain. **Don't "fix" code
that isn't actually broken** — confirm the defect is real first. Prefer, in order:

- A failing test (unit or integration) that captures the wrong behavior.
- A minimal manual reproduction.
- A stack trace or log that unambiguously identifies the failing path.

If reproduction is genuinely impossible in this environment, say so explicitly and base
the fix on the strongest available evidence.

## 3. Isolate the root cause

Read the implicated source and name the root cause **specifically** before editing.

- ✅ Specific: "`renderAvatar` reads `user.profile.avatarUrl`, but `user.profile` can be
  null when the account has no profile, so it throws."
- ❌ Vague: "probably a state issue" / "something with null."

Fix the underlying cause, not a surface symptom. Suppressing the symptom (e.g. swallowing
the error, patching the caller) leaves the real fault to resurface elsewhere.

## 4. Apply the smallest safe fix

Change as little as possible. Every edited line must be attributable to this bug.

- Prefer `patch_file` — a targeted edit of the specific lines at fault.
- Use `write_file` only when the change genuinely requires rewriting the whole file; when it
  does, use the `TOML_BLOCK:N` pattern from `response-contract` rather than inline JSON.
- Do **not**: rewrite unrelated modules, rename unrelated symbols, reformat untouched
  code, add new abstractions, or fix nearby-but-separate issues in the same change.

## 5. Guard against recurrence

Add or update a test that **fails before your fix and passes after it**, covering the
exact behavior that was wrong. This is the guard that keeps the bug from silently
returning; where the project follows TDD, write this test before the fix (Red → Green).

## 6. Verify

Run the most relevant checks available and confirm they pass — the failing test now
passing, related tests, type-check, lint, and build as applicable. If a check cannot be
run, state which one and why.

## Anti-Rationalization

Reject these shortcuts — each has produced a wrong or absent fix:

| Rationalization                                 | Reality                                                                                                                   |
| ----------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------- |
| "I already know the cause, I'll just patch it." | Confirm by reproducing first; a confident guess is wrong often enough to break the fix.                                   |
| "The failing test is probably wrong."           | Verify that claim before touching the test; usually the code is wrong, not the test. Never weaken a test to make it pass. |
| "I'll note the fix and mark it done."           | An intended change that was never written is not a fix. Emit the actual patch_file/write_file edit.                       |
| "While I'm here, I'll clean up nearby code."    | Out of scope; a larger diff hides the fix and adds risk. Keep the change minimal.                                         |
| "It's a small change, no test needed."          | Small changes regress too; add the guard test.                                                                            |

## Output

Summarize the outcome:

```text
Root cause: <specific file/symbol/condition>
Changed:    <files and the minimal edit>
Verified:   <checks/tests run and their result>
Not verified / risk: <anything left unchecked>
```

## Guardrails

Stop and ask for human confirmation before applying a fix that touches authentication or
permission logic, payment logic, data migrations, security-sensitive code, public API
behavior, or that would require large-scale refactoring.
