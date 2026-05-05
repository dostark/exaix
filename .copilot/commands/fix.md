---
agent: general
scope: dev
title: "Bug/Test Fix Template (#fix)"
description: Fix a bug or failing test — write regression test first, then implement minimal fix
short_summary: "Template for systematically fixing bugs or failing tests with regression coverage."
version: "0.2"
topics: ["bug-fix", "testing", "regression", "validation"]
---

> **⚠️ REDIRECT** — This command is a thin invocation stub.
> The canonical multi-step workflow lives in **[skills/fix/SKILL.md](../skills/fix/SKILL.md)**.
> Use `#fix` to invoke the full TDD root-cause loop (REPRODUCE → REGRESSION TEST → FIX → CI gates → commit).

```text
Fix this bug/failing test:
{RAW_PROMPT}

Follow the #fix skill: identify root cause, write regression test first,
implement minimal fix, run CI gates, commit.
```

> **See also:** [CODE_STYLE.md](../../CODE_STYLE.md) — authoritative naming, type, import, and constants rules for all code changes.
