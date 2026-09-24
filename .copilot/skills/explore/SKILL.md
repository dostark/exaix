---
name: explore
agent: general
tools:
  - read_file
  - search_files
  - list_directory
scope: dev
title: "Codebase Exploration (#explore)"
description: Systematically explore a module or flow to answer architectural questions or map dependencies
short_summary: "Explore the Exaix codebase using the manifest, ARCHITECTURE.md AGENT_LOGIC block, and layer-aware search."
version: "1.0.0"
topics: ["exploration", "architecture", "discovery", "navigation"]
qwen_skill: explore
---

```text
Key points

- Start with the ARCHITECTURE.md AGENT_LOGIC YAML block: it carries the invariants and data flow.
- Use .copilot/manifest.json as the authoritative doc index (short_summary per doc).
- Prefer semantic_search for behavior questions; rg for exact symbol/string matches.
- Read module-header @module blocks first: they declare @architectural-layer and @dependencies without a full-file read.
- check:arch groundedness map is the authoritative module-layer registry.

Canonical prompt (short):
"Explore {scope: module | flow | service | feature} to answer: {question}.
Map dependencies, data flow, and ownership layer."

Navigation toolkit
  rg "symbolName" packages/ apps/                          # find a symbol
  deno doc packages/<package>/src/<module>.ts             # exported symbols
  fd <pattern> packages/ apps/                            # files by name
  deno task check:arch                                    # layer + GROUNDED per file
  cat .copilot/manifest.json | jq '.[] | {title, short_summary, path}'

Layer map (from check:arch)
  CLI base     → packages/cli/src/     Services → packages/*/src/
  CLI app      → apps/exactl/src/      AI       → packages/ai/src/, packages/ai-*/src/
  Schemas      → packages/schemas/src/ Parsers  → packages/core/src/parsing/
  Config       → packages/core/src/config/       Entry   → apps/daemon/main.ts
  TUI base     → packages/tui/src/     TUI app  → apps/tui/src/

Architectural invariants (from ARCHITECTURE.md)
  - File system IS the database: Workspace/Active, Workspace/Requests, Workspace/Plans
  - All side-effects log to the Activity Journal via EventLogger
  - PathResolver validates all paths before access
  - MCP tools are the only Hybrid-mode write path — keeps the audit trail

Output format
  1. Scope confirmed (files/modules in scope)
  2. Dependency graph (who depends on what)
  3. Data flow summary
  4. Layer ownership
  5. Gaps or inconsistencies found
  6. Suggested next steps (if any)

Do / Don't
- ✅ Read the ARCHITECTURE.md AGENT_LOGIC block before any architectural conclusion.
- ✅ Use .copilot/manifest.json as the doc index, not a file listing.
- ✅ Prefer deno doc for public API surface over full implementation files.
- ❌ Draw architectural conclusions from a single file — check the layer map.
- ❌ Conflate "file exists" with "actively used" — check for dead code paths.

Related
- CODE_STYLE.md — authoritative naming, type, import, and layer-boundary rules
```

## Examples

- `#explore How does PlanService write to the Workspace/Active database?`
- `#explore Map all callers of EventLogger.log() across the services layer`
- `#explore What does the MCP execution flow look like end-to-end?`

---
exaix:
  skill_id: explore
  triggers:
    keywords: [explore, investigate, understand, map, trace, research]
    task_types: [research]
    tags: [exploration, research]
  constraints:
    - "Read ARCHITECTURE.md AGENT_LOGIC block before any architectural conclusion"
    - "Use .copilot/manifest.json as the doc index (not just file listing)"
    - "Prefer deno doc for public API surface over reading full implementation files"
    - "Do not draw architectural conclusions from a single file — check the layer map"
    - "Do not conflate file exists with actively used — check for dead code paths"
  output_requirements:
    - "Architectural map or dependency flow"
    - "Key files and their roles identified"
    - "Suggested next steps for further investigation"
  quality_criteria:
    - name: depth
      description: Exploration covers multiple layers and files, not just one
      weight: 40
    - name: accuracy
      description: Conclusions verified against actual code, not assumptions
      weight: 30
    - name: actionability
      description: Output includes actionable next steps or findings
      weight: 30
---
