---
agent: general
scope: dev
title: "TDD Workflow (#tdd-workflow)"
description: Start a TDD workflow — write failing tests first, then implement minimal passing code
short_summary: "Invocation stub for the TDD Workflow skill — write failing tests first, implement minimally, refactor, verify coverage."
version: "0.2"
topics: ["tdd", "testing", "red-green-refactor"]
---

> **⚠️ REDIRECT** — This command is a thin invocation stub.
> The canonical multi-step workflow lives in **[skills/tdd-workflow/SKILL.md](../skills/tdd-workflow/SKILL.md)**.
> Use `#tdd-workflow` to invoke the full CONTEXT → RED → GREEN → REFACTOR → CI gates → coverage check loop.

```text
Apply TDD to the following:
{RAW_PROMPT}

Follow the #tdd-workflow skill: select test helpers, write failing test first,
implement minimally, refactor, run CI gates, verify coverage thresholds.
```

> **See also:** [CODE_STYLE.md](../../CODE_STYLE.md) — authoritative naming, type, import, and constants rules for all code changes.
