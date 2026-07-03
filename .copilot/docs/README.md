---
agent: general
scope: dev
title: "Agent Reference Corpus"
short_summary: "On-demand reference documents for agents — the Claude Code `docs/` convention, reachable as `.agents/references/`."
version: "1.0"
topics: ["reference", "docs", "corpus", "agents"]
---

This directory is the unified agent reference home. Files here are **on-demand references** — loaded only when a skill, task, or agent pulls them in, not injected into every prompt.

The directory mirrors the Claude Code `docs/` convention and is reachable as `.agents/references/` — see the symlink at `.copilot/references → docs`.

## Contents

- [TOOLS.md](TOOLS.md): MCP tool index (moved from root).
- [GLOSSARY.md](GLOSSARY.md): Developer glossary — implementation-level definitions, journal field maps, code identifiers, naming conventions (moved from `docs/`).
- [agent-thought-standardization.md](agent-thought-standardization.md): Agent reasoning structure guidance.
- [exaix-development.md](exaix-development.md): Exaix source development patterns and service architecture.
- [documentation.md](documentation.md): Documentation guidelines and update protocol.
- [testing.md](testing.md): Testing conventions and best practices.
- [specification-driven-development.md](specification-driven-development.md): Specification-driven development methodology.

### Symlinked root docs

These files stay canonical at the repo root but are discoverable here via symlink:

- [ARCHITECTURE.md](../../ARCHITECTURE.md): System architecture.
- [CODE_STYLE.md](../../CODE_STYLE.md): Coding standards.
- [GLOSSARY.md](../../GLOSSARY.md): Concept-level glossary (customer-facing).
