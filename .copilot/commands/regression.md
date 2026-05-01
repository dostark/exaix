---
agent: general
scope: dev
title: "Regression Test Template (#regression)"
description: Add regression tests to lock in a bug fix and prevent future recurrence
short_summary: "Template for adding regression tests to prevent bug recurrence."
version: "0.1"
topics: ["regression", "testing", "bug-prevention"]
---

**Purpose:** Add or update regression tests to prevent recurrence of bugs and failures.

---

## Instructions for Agent

- Restate the bug/failure scenario.
- Write a regression test that reproduces the issue.
- Validate that the test fails before the fix and passes after.
- Document the regression test and its coverage.

---

## Template

**Bug/Failure Scenario:**
{RAW_PROMPT}

**Regression Test:**

- ...

**Validation:**

- Test fails before fix
- Test passes after fix
- Documented coverage
