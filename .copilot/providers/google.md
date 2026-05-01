---
identity: google
agent: general
scope: dev
title: Google Gemini Provider Adaptation Guide
short_summary: "Optimized guidance for Google Gemini 1.5 Pro, focusing on 2M context window usage and parallel tool calls."
version: "0.2"
topics: ["provider-adaptations", "prompts", "parallel-tool-calls", "long-context"]
---

## Google Gemini Provider Adaptation Guide

Key points

- Gemini 1.5 Pro supports a **2M token context window**, ideal for whole-repository analysis.
- Leverage **parallel function calling** to execute multiple searches or file reads in one turn.
- Use **Long-Chain Reasoning** to analyze systemic impacts across multiple modules.
- Prefer explicit "Citation Required" prompts to ground responses in the provided long context.

## Self-improvement loop

If the current `.copilot/` instructions are insufficient for the task, patch them during execution (minimal, grounded), then rebuild/validate artifacts before continuing.

- Process: `.copilot/guidelines/self-improvement.md`
- Template: `.copilot/guidelines/self-improvement.md#template`
- Gemini-specific agent: general
  to include the relevant `agents/` docs + the exact gap list, then propose a small doc patch (examples/checklists) and continue.

## Task-Specific Prompts

### TDD Workflow (Global View)

"You are an SDET for Exaix. Analyze the entire `src/` and `tests/` structure to ensure new tests match existing patterns. Propose 3-5 failing tests with explicit assertions, covering happy paths and edge cases."

### Refactoring (Systemic Impact)

"Analyze how changing [Module] affects all dependencies. Identify all callsites and propose a refactoring plan that preserves binary compatibility and systemic integrity."

Canonical prompt (short):
"You are a Gemini-based assistant for Exaix. Leverage your 2M context window to analyze repository-wide patterns. Before acting, check `.copilot/manifest.json` and include all relevant docs."

Examples

- Example prompt: "Using the full provided context, identify all modules that use `initTestDbService()` and refactor them to use the new `DatabaseService` singleton pattern."
- Example prompt: "Perform a security audit of the entire `src/services/` directory, looking specifically for direct file system access that bypasses `PathResolver`."

Do / Don't

- ✅ Do load ALL relevant primary and secondary docs for complex reasoning tasks.
- ✅ Do use parallel function calling to speed up context gathering.
- ✅ Do ask for citations (line numbers) to verify grounding in long context.
- ❌ Don't rely solely on RAG chunks if the task requires holistic architectural understanding.

---

## Provider-Specific Workflow Notes

### Quickstart (Gemini)

Optimize for **broad reasoning** across module boundaries using the 2M token window.
Use **Long-Chain Reasoning** to identify systemic dependencies. Prefer **minimal diffs**
for architectural changes.

```
"You are a Gemini developer. Saturate on all provided context. Analyze the global impact
of [TASK] and propose a minimal, high-integrity implementation plan."
```

Examples:
- "Review all services in `src/services/`. Design a global error reporting pattern and show how 2 representative services implement it."
- "Check the entire Implementation Plan and all current source files. Identify modules missing tests for Step 10.7."

### TDD Workflow (Gemini)

Leverage long-context to find all existing **test patterns** and **helpers**.
Draft **5+ failing test cases** covering happy paths, errors, and systemic edge cases.

```
"You are a TDD specialist for Exaix. Analyze all existing test helpers.
Propose 5+ failing test cases for [FEATURE] with detailed assertions.
Implement only once tests are approved."
```

Do / Don't
- ✅ Do research `tests/helpers/` for existing utilities before writing new ones.
- ✅ Do include at least one "paranoid" security test case.
- ❌ Don't implement before the user approves the test plan.
