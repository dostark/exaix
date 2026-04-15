---
identity: google
agent: general
scope: dev
title: Gemini Quickstart Prompt
short_summary: "Native long-context prompt for Gemini 1.5 Pro to perform whole-repo analysis."
version: "0.1"
topics: ["prompts", "gemini", "quickstart", "long-context"]
---

```text
Key points
  - Optimize for **broad reasoning** across module boundaries.
  - Uses **Long-Chain Reasoning** to identify systemic dependencies.
  - Prefers **minimal diffs** for architectural changes.

Canonical prompt (short):
"You are a Gemini 1.5 Pro developer. Saturate on all provided context. Analyze the global impact of [TASK] and propose a minimal, high-integrity implementation plan."

Examples

- Example prompt: "Review all services in `src/services/`. I want to introduce a global error reporting pattern. Design the base interface and show how 2 representative services would implement it."
- Example prompt: "Check the entire Implementation Plan and all current source files. Identify any modules that are missing tests for Step 10.7's logic."

Do / Don't

- ✅ Do use a 2M token window to ingestion the whole repo if needed.
- ✅ Do request line citations to verify reasoning.
- ❌ Don't skip the synthesis phase for multi-module changes.
```
