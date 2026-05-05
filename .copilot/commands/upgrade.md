---
agent: general
scope: dev
title: "Dependency/Version Upgrade (#upgrade)"
description: Upgrade a dependency or runtime version with compatibility checks and regression validation
short_summary: "Invocation stub for the Upgrade skill — semver audit, regression net, apply, full CI, document."
version: "0.2"
topics: ["upgrade", "dependencies", "version", "maintenance"]
---

> **⚠️ REDIRECT** — This command is a thin invocation stub.
> The canonical multi-step workflow lives in **[skills/upgrade/SKILL.md](../skills/upgrade/SKILL.md)**.
> Use `#upgrade` to invoke the full Audit → Regression net → Apply → Full validation → Document → Commit loop.

```text
Upgrade the following dependency/runtime:
{RAW_PROMPT}

Follow the #upgrade skill: read changelog, identify breaking changes,
write regression tests on current version first, apply upgrade, run full CI,
document migration steps, commit.
```

> **See also:** [CODE_STYLE.md](../../CODE_STYLE.md) — authoritative naming, type, import, and constants rules for all code changes.
