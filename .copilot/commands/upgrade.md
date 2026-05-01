---
agent: general
scope: dev
title: "Dependency/Version Upgrade Template (#upgrade)"
description: Upgrade a dependency or runtime version with compatibility checks and regression validation
short_summary: "Template for planning and executing dependency or version upgrades with stability checks."
version: "0.1"
topics: ["upgrade", "dependencies", "version", "maintenance"]
---

**Purpose:** Plan and execute upgrades of dependencies or versions, ensuring stability and coverage.

---

## Instructions for Agent

- Restate upgrade goal and affected dependencies.
- Plan upgrade steps, including rollback.
- Add/maintain tests for upgraded code.
- Validate with all tests and linting.
- Document upgrade and any breaking changes.

---

## Template

**Upgrade Goal:**
{RAW_PROMPT}

**Affected Dependencies:**

- ...

**Upgrade Plan:**

- ...

**Tests:**

- ...

**Validation:**

- All tests pass
- Linting clean
- Rollback plan ready
- Breaking changes documented
