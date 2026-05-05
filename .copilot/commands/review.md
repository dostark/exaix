---
agent: general
scope: dev
title: "Code Review Template (#review)"
description: Systematically review code changes for correctness, style, test coverage, and regression risk
short_summary: "Template for systematic code review checking correctness, style, and completeness."
version: "0.2"
topics: ["code-review", "quality-assurance", "best-practices"]
---

> **⚠️ REDIRECT** — This command is a thin invocation stub.
> The canonical multi-step workflow lives in **[skills/review/SKILL.md](../skills/review/SKILL.md)**.
> Use `#review` to invoke the full 7-phase autonomous review (Ingest → Correctness → Security → Architecture → Tests → Docs → Classify).

```text
Review the following code changes:
{RAW_PROMPT}

Follow the #review skill: ingest scope, check correctness/security/architecture/
test-coverage/doc-compliance, output findings table with severity classification.
```

> **See also:** [CODE_STYLE.md](../../CODE_STYLE.md) — authoritative naming, type, import, and constants rules used during review.

**

- All tests pass
- Linting clean
