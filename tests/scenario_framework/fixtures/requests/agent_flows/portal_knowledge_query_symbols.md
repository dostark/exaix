---
trace_id: "query-symbols-{{timestamp}}"
created: "{{timestamp}}"
status: "pending"
priority: "normal"
source: "cli"
created_by: "scenario-framework"
---

# Inspect Cached Symbols With query_symbols

Inspect the cached AST knowledge for the mounted `todo-app` portal and report its exported
symbols.

Use the `query_symbols` tool to list the exported symbols from the portal's cached knowledge
(e.g. the classes and functions in `src/models.ts` and `src/api.ts`). Call `query_symbols`
directly — do not read files to discover symbols yourself.

Expected outcomes:

- The final response references the exported symbols returned by the tool.
- The response names the specific symbols the tool returned (or states the explicit error it
  produced).
