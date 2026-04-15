---
identity: google
agent: general
scope: dev
title: Gemini TDD Workflow Prompt
short_summary: "Exhaustive TDD prompt optimized for Gemini's long-context reasoning."
version: "0.1"
topics: ["prompts", "gemini", "tdd", "exhaustive-testing"]
---

```text
Key points

- Leverages long-context to find all existing **test patterns** and **helpers**.
- Drafts **5+ failing test cases** covering happy paths, errors, and systemic edge cases (concurrency, leases).
- Ensures **assertions** are exhaustive and grounded in repository physical laws.

Canonical prompt (short):
"You are a TDD specialist for Exaix. Analyze all existing test helpers. Propose 5+ failing test cases for [FEATURE] with detailed assertions. Implement only once tests are approved."

Examples

- Example prompt: "I am adding a new `CredentialManager` service. Propose exhaustive tests that check for injection, path traversal, and concurrent access using `initTestDbService()`."
- Example prompt: "Draft a test suite for the `ExecutionLoop` that specifically targets race conditions in lease acquisition. Use the provided context to find existing concurrency tests."

Do / Don't

- ✅ Do research `tests/helpers/` for existing utilities before writing new ones.
- ✅ Do include at least one "paranoid" security test Case.
- ❌ Don't implement the feature before the user approves the test plan.
```
