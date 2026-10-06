# Blueprints/Skills/

This directory holds the **authored skill blueprints** — the curated, versioned
procedural knowledge ("how to work") that agent roles reference via
`default_skills`. A skill describes _how_ to do something; an agent role (under
`Blueprints/Agents/`) describes _who_ the agent is.

## Folder format

A skill is a folder in the Agent Skills format. The folder is the single source: the skill
service reads it directly, and nothing is compiled.

```text
Blueprints/Skills/<name>/
  SKILL.md       # required: spec frontmatter (name, description) + the markdown body
  exaix.yaml     # optional: Exaix-only fields (title, triggers, constraints, critical, ...)
  references/    # optional: read-only markdown files the body links to
```

- `SKILL.md` frontmatter holds only Agent Skills spec fields. `name` equals the folder name.
- `exaix.yaml` holds what the spec cannot carry: `title`, `status`, `triggers`, `constraints`,
  `output_requirements`, `quality_criteria`, `critical`, `effort`, `thinking`, `tools`,
  `applies_to`, `derived_from` and `related_skills`.
- `scripts/` and `assets/` directories make a skill invalid. Flat `*.skill.md` and `*.json`
  files in a skill root are load errors.
- A skill's revision id derives from the hash of its files, so an edit is a new revision.
  `deno task check:skill-index` validates every folder through the production loader.

Project-scoped skills live under `Memory/Skills/project/<portal>/<name>/`. Skills written by
the learning system are draft folders under `Memory/Skills/learned/` until a person approves them.

## Structure

- Each skill declares `triggers` (tags), `constraints`, `quality_criteria`, and an
  optional `critical` flag (critical skills render into a protected, non-droppable
  prompt segment).

## Usage

Agent roles reference skills by name in their `default_skills` list, e.g.
`default_skills: ["response-contract", "code-review", "portal-grounding"]`. At
request time the skill service loads the matching skill folder and injects each skill's
instructions into the agent's prompt.

## Contributor rule: value evidence

A new skill must carry either a value-evaluation result (a paired treatment/control
delta from the value tier described in
`exaix-dev-docs/planning/phase-158-artefact-value-evaluation.md`) or a stated reason
it cannot be measured yet (e.g. no corpus task reaches it). A skill with neither is
presence-tested but never shown to help — see that phase's Executive Summary for why
that distinction matters.

## Contributor rule: communication

Skill and agent-body instruction prose follows **ASD-STE100** and the **Exaix STE
Extension v1** (result-first, omit needless detail and self-reflection, prefer
bullets). The runtime renders these folders into the agent prompt, so authoring prose is
model-facing and must be concise.
Useful rationale stays; repeated facts and narration of process drop out.
Documentation deliverables embedded in skill examples remain exempt as spans, but the
surrounding instruction prose stays eligible. `deno task check:agent-prose` reviews
instruction prose against the same shared rules.

## Effort/thinking floors

A skill may declare an optional `effort` (a concrete tier: `low`/`medium`/`high`) and
`thinking` (a boolean) floor in its `exaix.yaml` sidecar. When the skill is matched onto a
request, the resolved reasoning depth is raised to at least the floor — a floor never
lowers a value, never changes an explicit request-level concrete value, and `auto` is
not a valid floor. Example:

```yaml
effort: medium # this deliverable needs at least medium reasoning
thinking: true
```

`response-contract-security-analysis` declares `effort: medium`, so a security
analysis that would otherwise resolve to `low`/`unset` runs at `medium`. Skills are
`critical`-style protected segments only when `critical: true`.
