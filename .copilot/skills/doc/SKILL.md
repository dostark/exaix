---
name: doc
agent: general
tools:
  - read_file
  - write_file
  - patch_file
  - search_files
  - run_command
scope: docs
title: "Documentation Skill (#doc)"
description: Create or update documentation ensuring accuracy, code examples, and usage coverage
short_summary: "Create or update Exaix docs with the correct target file, structure, and sync commands."
version: "1.0"
topics: ["documentation", "writing", "clarity"]
qwen_skill: doc
---

```text
Key points
- Write for the intended audience: user-facing docs in docs/, agent guidance in .copilot/
- After modifying MCP tool handlers in packages/mcp/src/handlers/, always run
  deno task docs-sync-schemas to keep TOOLS.md in sync
- exaix-dev-docs is a git submodule — follow .copilot/skills/submodule-workflow/SKILL.md
  for any changes that span the parent repo and the submodule
- Consult .copilot/guidelines/documentation.md for full structure and publishing protocol

Canonical prompt (short):
"Create/update documentation for {component/feature}.
Target file: {see map below}. Include: purpose, usage, code examples, edge cases."

Doc target map
  User-facing feature docs     →  docs/Exaix_User_Guide.md
  Architecture / design        →  ARCHITECTURE.md  (update AGENT_LOGIC YAML block)
  Agent patterns + field guide →  docs/Building_with_AI_Agents.md
  Developer setup              →  docs/dev/Exaix_Developer_Setup.md
  Tool quick-reference         →  TOOLS.md  (MCP section auto-managed by docs-sync-schemas)
  API / implementation plan    →  docs/Exaix_Implementation_Plan.md
  Agent guidance               →  .copilot/guidelines/<topic>.md
  Submodule docs               →  exaix-dev-docs/ (see submodule-workflow skill)

Special sync commands
  # After changing MCP handler schemas in packages/mcp/src/handlers/
  deno task docs-sync-schemas

  # After adding/changing .copilot/ files
  deno run --allow-read --allow-write scripts/build_agents_index.ts

  # Verify all .copilot/ docs meet schema requirements (frontmatter, Canonical prompt, Examples)
  deno run -A scripts/validate_agents_docs.ts

Doc quality checklist
  [ ] Purpose is clearly stated in the first paragraph
  [ ] Each feature has at least one code example
  [ ] Edge cases and error behavior are covered
  [ ] Links to related docs/commands are included
  [ ] Runs deno fmt --check (for .md files with embedded code blocks where applicable)
  [ ] No dead links

Do / Don't
- ✅ Do run deno task docs-sync-schemas after MCP handler changes
- ✅ Do follow submodule-workflow skill for exaix-dev-docs changes
- ✅ Do link back to the implementation plan step the doc covers
- ❌ Don't edit TOOLS.md MCP section manually — it is auto-generated
- ❌ Don't create new docs/ files without matching entries in the implementation plan
```

## Examples

- `#doc Document the new PlanService.createPlan() API in ARCHITECTURE.md`
- `#doc Update Building_with_AI_Agents.md with Phase 13 TUI patterns`
- `#doc Sync TOOLS.md after adding the new mcp/handlers/memory.ts handler`
