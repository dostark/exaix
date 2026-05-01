---
agent: general
scope: dev
title: "Refactoring Template (#refactor)"
description: Systematically refactor code for clarity, performance, or maintainability without changing behavior
short_summary: "Template for systematic code refactoring maintaining behavior while improving clarity or performance."
version: "0.1"
topics: ["refactoring", "code-quality", "maintenance"]
---

**Purpose:** Systematically refactor code for clarity, performance, or maintainability.

---

## Instructions for Agent

- Restate the refactoring goal and affected code.
- Ensure no change in external behavior (unless specified).
- Add/maintain tests to cover refactored code.
- Run all tests and linting after refactor.
- Document changes and rationale.

---

## Template

**Refactoring Goal:**
{RAW_PROMPT}

**Affected Code:**

- ...

**Tests:**

- ...

**Validation:**

- All tests pass
- Linting clean

**Notes:**

- Document rationale and any improvements.
