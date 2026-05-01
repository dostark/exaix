---
agent: general
scope: dev
title: "TDD Workflow Prompt Example (#tdd)"
description: Start a TDD workflow — write failing tests first, then implement minimal passing code
short_summary: "Example prompt for test-driven development following Exaix patterns."
version: "0.1"
topics: ["tdd", "testing", "prompts", "examples"]
---

```text
Key points
- Always write failing tests first, then implement minimal code to pass
- Use initTestDbService() for database tests, include cleanup in try/finally
- Follow patterns from agents/tests/testing.md and test helpers
- Verify coverage maintained after refactoring

Canonical prompt (short):
"I need to [add feature / fix bug / refactor code] for [component]. Follow TDD: write failing test first, implement minimal code, refactor, verify coverage. Use inject_agent_context for 'TDD testing [component]'."

Examples
- Example prompt: "I need to add input validation for Portal configuration files. Follow TDD workflow."
- Example prompt: "Fix the PathResolver symlink bug. Write regression test first."

Do / Don't
- ✅ Do write failing test before implementation
- ✅ Do use test helpers and cleanup patterns
- ✅ Do verify coverage doesn't drop
- ✅ Do update Implementation Plan step when complete
- ❌ Don't implement without tests first
- ❌ Don't skip context injection for complex components
```
