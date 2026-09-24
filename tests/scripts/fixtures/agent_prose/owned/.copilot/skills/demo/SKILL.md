---
name: demo skill
description: "Use exactl config set to tune a portal limit, then verify with exactl config get."
tags: [demo, ste]
---

# Demo Skill

## Guidance

Use exactl config set to change the portal limit.
Preserve the trace ID from the request journal.
Keep the command exact: `exactl mcp connect --args '{"x":1}' --help` verifies a live endpoint.
Run `set b; echo ok` in the shell to show that a literal atom keeps its own semicolon.
I think this is the clearest approach for a short fixture.

## Example

```text
use demo clean example
```

## Documentation

Reference material does not apply STE counting to its own wording.
This documentation section is exempt from confirmed checks.
