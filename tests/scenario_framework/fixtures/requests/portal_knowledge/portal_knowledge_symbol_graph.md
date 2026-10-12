# Portal Knowledge Phase 178 — Enterprise Symbol-Level Dependency Graph

Mount the Go reference fixture as a portal and analyze it in standard mode with
`enable_symbol_level_dependency_graph = true` under the Enterprise edition.

Expected outcomes:

- The analysis persists `relationships` entries of kind `symbol_references_symbol`
- Symbol endpoints are `<file>#<symbolName>` composite keys
- The symbol map still carries the Go declarations the reference pass matched against
