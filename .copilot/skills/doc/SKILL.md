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

- Write for the audience: user-facing docs in docs/, agent guidance in .copilot/.
- MCP handler changes: run `deno task docs-sync-schemas` for TOOLS.md.
- exaix-dev-docs is a git submodule — follow .copilot/skills/submodule-workflow/SKILL.md for cross-repo changes.
- ARCHITECTURE.md is strategic: what and why, not where. No implementation paths or module locations there. Move them to the package README and reference the package.
- docs/CHANGELOG.md: user-facing changes only (CLI flags, config, deprecations, behavior). No internal refactors, test additions, or paths. One sentence per entry. Keep a Changelog conventions.

Canonical prompt (short):
"Create/update documentation for {component/feature}.
Target file: {see map below}. Include: purpose, usage, code examples, edge cases."

Doc target map
  User-facing features  →  docs/Exaix_User_Guide.md
  Architecture/design   →  ARCHITECTURE.md  (update AGENT_LOGIC YAML block)
  Agent patterns        →  docs/Building_with_AI_Agents.md
  Developer setup       →  docs/dev/Exaix_Developer_Setup.md
  Tool quick-reference  →  TOOLS.md  (MCP section auto-managed by docs-sync-schemas)
  API/implementation    →  docs/Exaix_Implementation_Plan.md
  Agent guidance        →  .copilot/docs/<topic>.md
  Submodule docs        →  exaix-dev-docs/ (see submodule-workflow skill)

Doc update gate: before closing any step with a user-visible CLI flag, config key, or
behavioral change, grep `docs/Exaix_User_Guide.md` for the command or feature. Missing?
Update the User Guide in the same commit. "Not documented yet" blocks the step. Covers CLI
subcommands, config keys, env vars, flag changes, and output-format changes users rely on.

Sync commands
  # After MCP handler schema changes in packages/mcp/src/handlers/
  deno task docs-sync-schemas

  # After adding/changing .copilot/ files
  deno run --allow-read --allow-write scripts/build_agents_index.ts

  # Validate .copilot/ docs against schema (frontmatter, Canonical prompt, Examples)
  deno run -A scripts/validate_agents_docs.ts

Quality checklist
  [ ] Purpose stated in the first paragraph
  [ ] Each feature has a code example
  [ ] Edge cases and error behavior covered
  [ ] Related docs/commands linked
  [ ] deno fmt --check passes (for .md with embedded code blocks where applicable)
  [ ] No dead links
  [ ] Every runtime claim is implemented: grep the code for each documented event name,
      config key, persistence behavior, and CLI flag before writing. "Behaves this way"
      is writable only when the code path is real and reachable; otherwise describe the
      actual behavior or omit the claim.

Do / Don't
- ✅ Run deno task docs-sync-schemas after MCP handler changes.
- ✅ Follow submodule-workflow skill for exaix-dev-docs changes.
- ✅ Link back to the implementation plan step the doc covers.
- ❌ Edit TOOLS.md MCP section manually — it is auto-generated.
- ❌ Create new docs/ files without matching implementation-plan entries.
```

## Structure & Role

- **`docs/`** — Source of Truth for Humans. Guides, architecture, API references, security policies.
- **`.copilot/`** — Source of Truth for Agents. Context, prompts, workflows, manifests, schemas.
- **`exaix-dev-docs/`** — Submodule for planning docs and dev-only content. Follow [submodule-workflow](../submodule-workflow/SKILL.md).

> Read `.copilot/` for coding patterns; `docs/` for architecture. Docs conflict with source? Follow `docs/`, verify with the user.

## ARCHITECTURE.md vs Package READMEs

**ARCHITECTURE.md** is strategic: what and why, not where. No implementation paths or module locations. Reference packages by name (e.g. "the `@exaix-team/voting` package") and point to ARCHITECTURE.md anchors.

**Package READMEs** (`packages/<name>/README.md`) hold implementation details: key files, module paths, contracts, wiring diagrams. Reference the ARCHITECTURE.md section from the README.

## Style Guide

- Headers include version, release date, status, references
- Fenced code blocks use language identifiers
- Consistent table formatting
- Relative paths for internal links; file paths when referencing code
- Changes bound to Implementation Plan steps
- Consistent capitalization; add new terms to the Terminology Reference

## Version Synchronization

Documents sharing version numbers MUST update together. Add a checklist for versions and release dates.

## Output Format

1. **Target file** — created or updated.
1. **Summary** — what changed.
1. **Sync commands run** — docs-sync-schemas, build_agents_index, etc.
1. **Quality checklist results** — examples, edge cases, links, formatting.
1. **Commit payload** — use `#commit`.

## Examples

- `#doc Document the new PlanService.createPlan() API in ARCHITECTURE.md`
- `#doc Update Building_with_AI_Agents.md with Phase 13 TUI patterns`
- `#doc Sync TOOLS.md after adding a new MCP handler`

## See also

- [exaix-development](../exaix-development/SKILL.md) — service patterns, doc conventions
- [submodule-workflow](../submodule-workflow/SKILL.md) — exaix-dev-docs submodule changes

---
exaix:
  skill_id: doc
  related_skills: [exaix-development, submodule-workflow]
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
