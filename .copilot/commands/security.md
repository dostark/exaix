---
agent: general
scope: dev
title: "Security Patch Template (#security)"
description: Plan and implement a security fix with path/input validation, regression tests, and documentation
short_summary: "Template for planning and implementing security fixes with validation and documentation."
version: "0.1"
topics: ["security", "vulnerability", "patch", "validation"]
---

**Purpose:** Plan and implement security fixes, following best practices for validation and documentation.

---

## Instructions for Agent

- Restate the security issue and affected code.
- Plan fix with minimal impact and maximal coverage.
- Add/maintain security tests and regression tests.
- Validate with all tests and linting.
- Document the patch and its rationale.

---

## Template

**Security Issue:**
{RAW_PROMPT}

**Affected Code:**

- ...

**Fix Plan:**

- ...

**Tests:**

- Security
- Regression

**Validation:**

- All tests pass
- Linting clean
- Patch documented
