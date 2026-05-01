---
agent: general
scope: dev
title: "Code Review Template (#review)"
description: Systematically review code changes for correctness, style, test coverage, and regression risk
short_summary: "Template for systematic code review checking correctness, style, and completeness."
version: "0.1"
topics: ["code-review", "quality-assurance", "best-practices"]
---

**Purpose:** Systematically review code changes for correctness, style, and completeness.

---

## Instructions for Agent

- Restate review scope and files/changes to review.
- Check for:
  - Correctness
  - Style and formatting
  - Test coverage
  - Regression risk
  - Documentation
- Suggest improvements and flag issues.
- Validate that all tests and linting pass.

---

## Template

**Review Scope:**
{RAW_PROMPT}

**Files/Changes:**

- ...

**Checklist:**

- Correctness
- Style/formatting
- Test coverage
- Regression risk
- Documentation

**Suggestions/Issues:**

- ...

**Validation:**

- All tests pass
- Linting clean
