---
name: fix-bug
description: "Reproduce, isolate the root cause, apply the smallest safe fix, and verify — for fixing bugs, failing tests, crashes, and incorrect behavior"
---

# Bug Fix

Apply this skill when the task is to fix a bug, make a failing test pass, investigate an error, or explain why something is behaving incorrectly.

The goal is **not** to guess a cause and patch code quickly. The goal is to **reproduce, isolate, apply the smallest safe fix, and verify**. This skill is language-agnostic — adapt each step to the project's stack.

## 1. Understand the defect

Before changing anything, establish:

- What is the observed (wrong) behavior, and what is the expected behavior?
- What evidence exists — an error message, stack trace, log, or failing test?
- Under what conditions does it happen (inputs, environment, version)?

If the report is vague and no evidence points at a failing path, gather that first. Do not begin editing on a hunch.

## 2. Reproduce the failure

Do not fix a bug you have not reproduced. **Don't "fix" code that isn't actually broken** — confirm the defect is real first.

- Record the expected result and the exact reported symptom.
- Run one bounded command that asserts that symptom, using the project's own test or run command. Keep the observed failure.
- Record the input, fixture, seed, time, network, and execution limits. Redact secrets.
- Reduce the reproduction while the same failure remains.
- Rank the plausible causes. Give each cause a testable prediction.
- Test one prediction at a time. Record the observation and reject disproved causes.
- For intermittent failures, record attempts and failures. A sample with no failures does not prove the failure is impossible.
- For performance defects, read the metric and acceptance threshold from the requirement. Compare identical workloads in a controlled environment. Record uncertainty instead of asserting causality from an unmatched comparison.

If the symptom cannot be reproduced, record the commands, results, and missing evidence. State what evidence is missing. Do not apply a speculative fix.

## 3. Isolate the root cause

Read the implicated source and name the root cause **specifically** before editing.

- ✅ Specific: "`renderAvatar` reads `user.profile.avatarUrl`, but `user.profile` can be
  null when the account has no profile, so it throws."
- ❌ Vague: "probably a state issue" / "something with null."

Fix the underlying cause, not a surface symptom. Suppressing the symptom (e.g. swallowing
the error, patching the caller) leaves the real fault to resurface elsewhere.

## 4. Regression test (RED)

Add or update a test that **fails before your fix and passes after it**, covering the
exact reported symptom at the real failing boundary. Do not accept a nearby error as
RED. Run the test and confirm it fails for the reported symptom. Do not patch before
this test fails.

## 5. Apply the smallest safe fix

Change as little as possible. Every edited line must be attributable to this bug.

- Prefer `patch_file` — a targeted edit of the specific lines at fault.
- Use `write_file` only when the change genuinely requires rewriting the whole file; when it
  does, use the `TOML_BLOCK:N` pattern from `response-contract` rather than inline JSON.
- Do **not**: rewrite unrelated modules, rename unrelated symbols, reformat untouched
  code, add new abstractions, or fix nearby-but-separate issues in the same change.

## 6. Verify

Run the regression test and the original reproduction. Run the most relevant project
checks available — related tests, type-check, lint, and build as applicable. If a check
cannot be run, state which one and why.

## Anti-Rationalization

Reject these shortcuts — each has produced a wrong or absent fix:

| Rationalization                                 | Reality                                                                                                                   |
| ----------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------- |
| "I already know the cause, I'll just patch it." | Confirm by reproducing first; a confident guess is wrong often enough to break the fix.                                   |
| "The failing test is probably wrong."           | Verify that claim before touching the test; usually the code is wrong, not the test. Never weaken a test to make it pass. |
| "I'll note the fix and mark it done."           | An intended change that was never written is not a fix. Emit the actual patch_file/write_file edit.                       |
| "While I'm here, I'll clean up nearby code."    | Out of scope; a larger diff hides the fix and adds risk. Keep the change minimal.                                         |
| "It's a small change, no test needed."          | Small changes regress too; add the guard test.                                                                            |
| "The command exits zero, so it reproduces."     | Assert the reported symptom; exit zero alone proves nothing.                                                              |
| "A nearby error explains the symptom."          | Preserve the reported symptom and reject the nearby cause when its prediction fails.                                      |
| "I can fix it without reproducing."             | Record the blocker and missing evidence; do not patch on a guess.                                                         |
| "The new run is faster."                        | Compare identical workloads and environments before claiming an improvement.                                              |

## Output

Summarize the outcome:

```text
Reproduction:    <command, observed symptom, controls, bounds>
Rejected causes: <ranked hypotheses and the observations that rejected them>
Root cause:      <specific file/symbol/condition>
Changed:         <files and the minimal edit>
Verified:        <regression, original reproduction, checks, result>
Not verified / risk: <anything unchecked, residual uncertainty>
```

## Guardrails

Stop and ask for human confirmation before applying a fix that touches authentication or
permission logic, payment logic, data migrations, security-sensitive code, public API
behavior, or that would require large-scale refactoring.
