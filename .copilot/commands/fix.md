---
agent: general
scope: dev
title: "Bug/Test Fix Template (#fix)"
description: Fix a bug or failing test — write regression test first, then implement minimal fix
short_summary: "Template for systematically fixing bugs or failing tests with regression coverage."
version: "0.1"
topics: ["bug-fix", "testing", "regression", "validation"]
---

```text
Key points
- Identify root cause from bug report or test failure
- Write regression test first to prevent recurrence
- Fix the issue minimally, then validate all tests pass
- Ensure linting clean and document the fix

Canonical prompt (short):
"Fix this bug/failing test. Identify root cause, write regression test, implement fix, validate all tests pass and code is clean."

Examples
- Example prompt: "Fix the PathResolver symlink handling bug that's failing tests."
- Example prompt: "The login validation is throwing errors for valid inputs."

Do / Don't
- ✅ Do write regression test before fixing
- ✅ Do identify and fix root cause
- ✅ Do run all affected tests
- ✅ Do ensure linting and formatting clean
- ❌ Don't fix without regression test
- ❌ Don't return until all tests pass
- ❌ Don't skip documentation

Related templates:
- #test — Create additional tests if needed
- #regression — Focus on regression testing
- #security — For security-related fixes
```

- All tests pass
- Linting clean
- Regression test added

**Notes:**

- Document any related code changes.
- Reference affected modules/files.
