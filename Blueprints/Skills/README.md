# Blueprints/Skills/

This directory holds the **authored skill blueprints** — the curated, versioned
procedural knowledge ("how to work") that identities reference via
`default_skills`. A skill describes _how_ to do something; an identity (under
`Blueprints/Identities/`) describes _who_ the agent is.

## Source of truth vs. runtime store

- **`Blueprints/Skills/*.skill.md`** (this directory) — the **source of truth**.
  Human-authored skill definitions: YAML frontmatter (id, triggers, constraints,
  quality criteria, `critical` flag) plus markdown instructions.
- **`Memory/Skills/`** — the **runtime store** the skill service actually reads.
  It holds the generated JSON form of these skills (under `global/` and
  `project/<project>/`) **plus** learned/adapted skills derived from real usage.

The `.skill.md` files here are **not** loaded directly at runtime. They are
compiled into `Memory/Skills/**.json` by `scripts/build_skills_index.ts`; the
`check:skill-index` gate (run in pre-commit and CI) fails if the two drift, so
editing a `.skill.md` requires regenerating the index:

```bash
deno run -A scripts/build_skills_index.ts Memory/Skills .
```

## Structure

- `*.skill.md` — a skill definition: YAML frontmatter + markdown instructions.
- Each skill declares `triggers` (tags), `constraints`, `quality_criteria`, and an
  optional `critical` flag (critical skills render into a protected, non-droppable
  prompt segment).

## Usage

Identities reference skills by `skill_id` in their `default_skills` list, e.g.
`default_skills: ["response-contract", "code-review", "portal-grounding"]`. At
request time the skill service loads the matching runtime JSON from
`Memory/Skills/` and injects each skill's instructions into the agent's prompt.
