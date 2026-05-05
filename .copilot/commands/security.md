---
agent: general
scope: dev
title: "Security Patch Template (#security)"
description: Plan and implement a security fix with path/input validation, regression tests, and documentation
short_summary: "Template for planning and implementing security fixes with validation and documentation."
version: "0.2"
topics: ["security", "vulnerability", "patch", "validation"]
---

> **⚠️ REDIRECT** — This command is a thin invocation stub.
> The canonical multi-step workflow lives in **[skills/security/SKILL.md](../skills/security/SKILL.md)**.
> Use `#security` to invoke the full Phase 3b nine-item OWASP security audit (input validation, path traversal, secrets, injection, auth boundary, error leakage, TOCTOU, dependency trust, security tests).

```text
Fix this security issue:
{RAW_PROMPT}

Follow the #security skill: run Phase 3b checklist, write security regression
tests first, implement minimal fix with OWASP remediation, run CI gates, commit.
```

> **See also:** [CODE_STYLE.md](../../CODE_STYLE.md) — authoritative naming, type, import, and constants rules for all code changes.
