---
agent: senior-coder
scope: dev
title: "Phase 75: Agent Documentation Optimization"
short_summary: "Consolidate agent documentation structure, migrate workflow guidelines, and enforce READMEs across all subfolders."
version: "1.0"
topics: ["planning", "architecture", "agents", "documentation", "workflows"]
---

# Phase 75: Agent Documentation Optimization

## Proposed Changes

### 1. Deduplication & Consolidation
- **CLAUDE.md & AGENTS.md**: Update to clarify `.copilot/` is canonical and symlinks (`.agents/`, `.cursor/`, etc.) are intentionally used to support non-Copilot agents.
- **ARCHITECTURE.md**: Trim the "Key Patterns & Constraints" block; move missing parts to `.copilot/workflows/exaix-development.md` to avoid massive duplication.
- **Coverage Summary**: Delete obsolete `.copilot/coverage/coverage-summary.md` and the `coverage/` directory.

### 2. Workflow Guidelines Migration
- Move instructional/methodological files from `docs/`, `source/`, and `tests/` into the existing `.copilot/workflows/` directory.
- Convert these into standard workflow guidelines with refined frontmatter and step-by-step formats, and also refine the existing workflows (`commit.md`, `plan.md`, etc.):
  - `docs/documentation.md` -> `workflows/documentation.md`
  - `source/exaix.md` -> `workflows/exaix-development.md`
  - `source/agent-content-schema.md` -> `workflows/agent-content-schema.md`
  - `source/agent-thought-standardization.md` -> `workflows/agent-thought-standardization.md`
  - `tests/testing.md` -> `workflows/testing.md`
  - `tests/jscpd-guide.md` -> `workflows/jscpd-guide.md`

### 3. Sub-folder README Generation & Refinement
- Add/refine `README.md` files in **all critical sub-folders** (e.g., `workflows/`, `prompts/`, `process/`).
- Ensure each README clearly states:
  - The purpose of the directory.
  - The use-case of the files within (e.g., how `workflows/` structurally differ from `prompts/`).
  - Relevant context and guidelines for creating new files in the folder.

### 4. Automation & Integration
- **Cross-Reference generation**: Modify `scripts/build_agents_index.ts` to auto-generate the `Task → Agent Doc Quick Reference` table in `.copilot/cross-reference.md` by parsing `topics` and `title` fields.
- **Qwen Skill Generation**: Modify the build script to auto-generate Qwen skill wrappers in `.qwen/skills/*/SKILL.md` when a prompt specifies a `qwen_skill` frontmatter field.
- **Validation**: Update `scripts/validate_agents_docs.ts` to check that Qwen wrappers match canonical sources.

### 5. Cross-Reference Optimization
- Update all hardcoded paths in `cross-reference.md`, `README.md`, and other files to reflect files moved to `workflows/`.
- Ensure all root `.md` files explicitly cite the `manifest.json` generation.

## Verification Plan

### Automated Tests
- run `deno task docs-agent-validate` ensures all frontmatter is correct and Qwen skills are in sync.
- run `deno run -A scripts/build_agents_index.ts` works and updates `cross-reference.md` properly.

### Manual Verification
- Validate links and readmes in `.copilot/` to ensure no dead links remain.
