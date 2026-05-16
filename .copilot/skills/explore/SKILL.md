---
agent: general
tools:
  - read_file
  - search_files
  - list_directory
scope: dev
title: "Codebase Exploration (#explore)"
description: Systematically explore a module or flow to answer architectural questions or map dependencies
short_summary: "Explore the Exaix codebase using the manifest, ARCHITECTURE.md AGENT_LOGIC block, and layer-aware search."
version: "1.0"
topics: ["exploration", "architecture", "discovery", "navigation"]
qwen_skill: explore
---

```text
Key points
- Start with ARCHITECTURE.md AGENT_LOGIC YAML block — it describes invariants and data flow
- Use .copilot/manifest.json for the authoritative doc index (short_summary per doc)
- Prefer semantic_search for behavioral questions, rg for exact symbol/string matches
- Module headers (JSDoc @module blocks) declare @architectural-layer and @dependencies —
  read them to understand layer ownership without reading full files
- check:arch groundedness map is the authoritative module-layer registry

Canonical prompt (short):
"Explore {scope: module | flow | service | feature} to answer: {question}.
Map dependencies, data flow, and ownership layer."

Exaix navigation toolkit
  # Find a symbol across the codebase
  rg "symbolName" src/

  # List exported symbols of a module
  deno doc src/<module>.ts

  # Find files by name
  fd <pattern> src/

  # Check which layer a file belongs to
  deno task check:arch   # lists GROUNDED + layer for every file

  # Read the authoritative doc index
  cat .copilot/manifest.json | jq '.[] | {title, short_summary, path}'

Project layer map (from check:arch)
  CLI            →  src/cli/
  Services       →  src/services/
  AI providers   →  src/ai/
  Schemas        →  src/schemas/
  Parsers        →  src/parsers/
  Config         →  @exaix/core/config/
  Entry point    →  src/main.ts
  TUI            →  src/tui/

Key architectural invariants (from ARCHITECTURE.md)
  - File system IS the database: Workspace/Active, Workspace/Requests, Workspace/Plans
  - All side-effects MUST log to Activity Journal via EventLogger
  - PathResolver validates all paths before access
  - MCP tools are the only write path in Hybrid mode (for auditability)

Output format
  1. Scope confirmed (files/modules in scope)
  2. Dependency graph (who depends on what)
  3. Data flow summary
  4. Layer ownership
  5. Gaps or inconsistencies found
  6. Suggested next steps (if any)

Do / Don't
- ✅ Do read ARCHITECTURE.md AGENT_LOGIC block before any architectural conclusion
- ✅ Do use .copilot/manifest.json as the doc index (not just file listing)
- ✅ Do prefer deno doc for public API surface over reading full implementation files
- ❌ Don't draw architectural conclusions from a single file — check the layer map
- ❌ Don't conflate "file exists" with "actively used" — check for dead code paths

Related
- CODE_STYLE.md — authoritative naming, type, import, and layer-boundary rules
```

## Examples

- `#explore How does PlanService write to the Workspace/Active database?`
- `#explore Map all callers of EventLogger.log() across the services layer`
- `#explore What does the MCP execution flow look like end-to-end?`
