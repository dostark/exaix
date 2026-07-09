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
version: "1.0.0"
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
- ARCHITECTURE.md is a strategic document — describe what and why, not where.
  Never include implementation-specific file paths or module locations there.
  Move those details into the relevant package README (e.g.,
  packages/<name>/README.md) and reference the package from ARCHITECTURE.md.
- docs/CHANGELOG.md is for user-facing changes only (CLI flags, config, deprecations, behavior changes). Never list internal refactors, test additions, or internal file paths. Each entry must be a single sentence, no internal module paths. Follow Keep a Changelog conventions. See the header in docs/CHANGELOG.md for the full format guide.

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
  Agent guidance               →  .copilot/docs/<topic>.md
  Submodule docs               →  exaix-dev-docs/ (see submodule-workflow skill)

Doc update gate: BEFORE declaring any step complete that adds a user-visible CLI flag, config
key, or behavioural change, grep `docs/Exaix_User_Guide.md` for the command or feature name.
If absent, the User Guide MUST be updated in the same step's commit — "not documented yet" is a
blocking gap. This affects CLI subcommands, config keys, env vars, flag changes, and any output
format change a user might rely on.

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

## Structure & Role

- **`docs/`** — Source of Truth for Humans. User guides, architecture docs, API references, security policies.
- **`.copilot/`** — Source of Truth for Agents. Context, prompts, workflows, manifests, schemas.
- **`exaix-dev-docs/`** — Git submodule for planning docs and dev-only content. Follow [submodule-workflow](../submodule-workflow/SKILL.md) for changes.

> Agents should read `.copilot/` for coding patterns and prompts, `docs/` for architectural understanding. If a conflict exists between `docs/` and source code, follow `docs/` but verify with the user.

## ARCHITECTURE.md vs Package READMEs

**ARCHITECTURE.md** is a strategic document — describe what and why, not where. Never include implementation-specific file paths or module locations. Reference packages by name (e.g. "the `@exaix-team/voting` package") and point to ARCHITECTURE.md sections by anchor.

**Package READMEs** (`packages/<name>/README.md`) are the home for implementation details: key files, module paths, contracts, and wiring diagrams. Reference the corresponding ARCHITECTURE.md section from the README so readers can find the strategic context.

## Style Guide

- Headers must include version, release date, status, and references
- Use fenced code blocks with language identifiers
- Use consistent table formatting
- Use relative paths for internal links; include file paths when referencing code
- Keep documentation changes minimal and tied to Implementation Plan steps
- Maintain consistent capitalization; add new terms to the Terminology Reference

## Version Synchronization

Documents that share version numbers MUST be updated together. Add a checklist for updating versions and release dates.

## Output Format

1. **Target file** — which file was created or updated.
1. **Summary** — what was added or changed.
1. **Sync commands run** — docs-sync-schemas, build_agents_index, etc.
1. **Quality checklist results** — code examples, edge cases, links, formatting.
1. **Commit payload** — use `#commit` to generate the final structured message.

## Examples

- `#doc Document the new PlanService.createPlan() API in ARCHITECTURE.md`
- `#doc Update Building_with_AI_Agents.md with Phase 13 TUI patterns`
- `#doc Sync TOOLS.md after adding a new MCP handler`

## See also

- [exaix-development](../exaix-development/SKILL.md) — service patterns, code conventions for docs
- [submodule-workflow](../submodule-workflow/SKILL.md) — exaix-dev-docs submodule changes

---
exaix:
  skill_id: doc
  triggers:
    keywords: [doc, documentation, docs, readme, guide]
    task_types: [docs]
    tags: [documentation]
  constraints:
    - "Ensure accuracy — verify code examples against real source"
    - "Cover edge cases, not just happy paths"
    - "Include usage examples for every public API surface"
    - "Sync schemas and tool indexes after doc changes"
    - "Do not create documentation files unless explicitly requested"
  output_requirements:
    - "Target file identified and read before editing"
    - "Summary of what was changed or added"
    - "Sync commands run (docs-sync-schemas, build_agents_index)"
    - "Quality checklist passed (code examples, edge cases, links, formatting)"
  quality_criteria:
    - name: accuracy
      description: Code examples verified against actual source
      weight: 40
    - name: coverage
      description: Edge cases and error conditions documented
      weight: 30
    - name: completeness
      description: Every public API has usage example
      weight: 30
---
