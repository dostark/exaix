---
identity: google
agent: general
scope: dev
title: Gemini Long-Context Reasoning Guide
short_summary: "Strategies for utilizing Gemini's 1.5 Pro's 2M context window for holistic repository reasoning."
version: "0.1"
topics: ["long-context", "reasoning", "gemini", "context-saturation"]
---

## Gemini Long-Context Reasoning Guide

Key points

- **Saturation Strategy**: Load all relevant documentation and source code to provide a "complete picture" for reasoning.
- **MEC (Maximum Effective Context)**: Aim for 50k-500k tokens for architectural work to maintain high instruction following.
- **RAG-as-a-Filter**: Use semantic search to identify which _files_ to load in full, rather than just using chunks.
- **Structural Delimiters**: Use clear headers (e.g., `# FILE: src/main.ts`) to help the agent navigate the large window.

## Long-Context Thinking Protocol

1. **Saturate**: Identify and load all primary and secondary docs related to the task.

1.
1.

```text
Canonical prompt (short):
"You are a long-context specialist. Analyze all provided files and documentation to find architecture-wide inconsistencies before proposing a fix."

Examples

- Example prompt: "I am refactoring the `EventLogger`. Analyze all services in `src/services/` to ensure the new logging interface satisfies all existing usage patterns."
- Example prompt: "Read the entire `Implementation Plan` and all `agent/` docs. Identify any gaps in Step 11 coverage relative to the core architecture."

Do / Don't

- ✅ Do use `inspect_embeddings.ts` to find the most relevant modules to load in full.
- ✅ Do provide the full Implementation Plan for context on current progress.
- ❌ Don't exceed 1M tokens unless performing a repository-wide security or architecture audit.
```
