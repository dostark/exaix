# Identity Blueprints

This directory contains **identity blueprints** — the LLM personas, models, and
capabilities Exaix routes requests to. Each identity is a single `.md` file with
YAML frontmatter (role/scope/voice) plus a `default_skills` list that injects the
shared procedural knowledge ("how to work") at runtime.

## Catalog model

The catalog is a **flat set of concrete identities** (`*.md` in this directory).
There are no separate `examples/` or `templates/` subdirectories — example stubs
that duplicated concrete identities were merged away, and the template scaffolds
were converted into reusable **skills** under `Blueprints/Skills/`. A persona
describes _who_ the agent is; a skill describes _how_ it works.

## Frontmatter

```yaml
---
identity_id: "my-identity"
name: "My Identity"
model: "" # deprecated — use model_size + characteristics instead
model_size: "M" # S, M, L, XL — maps to capability profile via ModelResolver
thinking: true # enable extended reasoning
effort: "high" # reasoning token budget (low, medium, high)
characteristics: [] # ["fastest", "cheapest"] — soft ranking hints
preferred_provider: "" # narrow candidate pool to a specific provider
capabilities: ["analysis", "review"] # behavioural tags, NOT tool names
default_skills: ["response-contract-code-analysis"] # keep short — see §Skills
permitted_tools: ["read_file", "grep_search"] # least-privilege tool allowlist
created: "2026-01-01T00:00:00Z"
created_by: "you@example.com"
version: "1.0.0"
---

# My Identity

You are a … (role, scope, and voice — keep this short; methodology lives in skills).

Apply your `code-review` skill for systematic review; follow your
`response-contract` skill for output format.
```

- `capabilities` are **behavioural tags** (e.g. `evaluation`, `analysis`), never
  tool names. Tools an identity may invoke go in `permitted_tools` (valid
  `McpToolName` / `ToolName` values), kept least-privilege — read-only roles
  (analysts, judges, reviewers) carry no `write_file`/`run_command`/`delete_file`.
- Every identity should include `response-contract` in `default_skills` — it
  defines the mandatory `<thought>`/`<content>` output contract.

See `Blueprints/Skills/` for the full skill library and `docs/Reference_Data.md`
for the authoritative field reference.

## Available identities

| Identity               | Use case                                        |
| ---------------------- | ----------------------------------------------- |
| `default`              | General-purpose coding assistant                |
| `senior-coder`         | Complex, expert-level implementations           |
| `software-architect`   | Scalable, maintainable architecture design      |
| `code-analyst`         | Code-structure analysis (read-only)             |
| `security-expert`      | In-depth vulnerability analysis & remediation   |
| `performance-engineer` | Performance bottleneck analysis (read-only)     |
| `test-engineer`        | Comprehensive test design and implementation    |
| `qa-engineer`          | Integration testing and quality assurance       |
| `technical-writer`     | Developer documentation and guides              |
| `product-manager`      | Requirements analysis (read-only)               |
| `research-synthesizer` | Multi-source research analysis and synthesis    |
| `quality-judge`        | LLM-as-a-Judge quality evaluation               |
| `voting-judge`         | LLM-as-a-Judge multi-candidate voting consensus |
| `dogfood-developer`    | Self-hosted dogfooding (TDD loop)               |
| `mock-agent`           | Deterministic identity for tests/CI             |

## Using an identity

```bash
exactl request "Task description" --identity senior-coder
```

## Creating a new identity

Either author the `.md` file directly (using the frontmatter above), or scaffold
from an existing identity as a prototype:

```bash
# Clone an existing identity's model, capabilities, and body as a starting point:
exactl blueprint identity create my-identity --name "My Identity" --from senior-coder

# Or define it from scratch:
exactl blueprint identity create my-identity --name "My Identity" --model "provider:model"
```

> The previous `--template <name>` flag (backed by a separate template library)
> has been replaced by `--from <identity-id>`, which clones a concrete identity.

### Contributor rule: value evidence

A new identity must carry either a value-evaluation result (a head-to-head or
config-arm delta from the value tier described in
`exaix-dev-docs/planning/phase-158-artefact-value-evaluation.md`) or a stated reason
it cannot be measured yet (e.g. it is not corpus-reachable). An identity with neither
is presence-tested but never shown to help.

**Persona-body value specifically** is a separate, narrower question from "does this
identity earn its place" — `identity-swap`/`identity-config` vary the whole bundle or
just `default_skills`, never the persona/voice prose alone. See
`exaix-dev-docs/planning/phase-161-identity-persona-value-isolation.md` (🚧 Planning)
for the `persona-isolation` arm that isolates it, and
`tests/scenario_framework/templates/persona_isolation_arm.template.md` for the
authoring template. Until that arm has run for a given identity, its `KEEP` decision
in `phase-158-artefact-value-evaluation.md` reflects "no measured harm from the
identity as a whole," not "the persona text specifically helps."

## Skills

Skills are the modern, versioned, criticality-aware replacement for the retired
fragment includes. Reference them via `default_skills`:

```yaml
default_skills: ["response-contract", "tdd-methodology"]
```

### Keep `default_skills` short

Skills reach a prompt through one of two channels, and choosing the wrong one is
the most common authoring mistake:

- **`default_skills`** — injected on **every** request this identity handles,
  unconditionally. Every entry is prompt weight paid whether or not the request
  needs it.
- **Trigger matching** — the skill's own `triggers` (keywords, tags, task types,
  file patterns) pull it in on the requests that actually call for it.

A skill that declares triggers belongs in the trigger channel. `code-review`,
`portal-grounding`, `fix-bug`, `commit-message`, `error-handling` and
`gap-analysis` all declare triggers, so none of them should appear in
`default_skills` — `portal-grounding` was carried by 14 of 15 identities before
Phase 142 Step 17 removed it from all of them for exactly this reason.

Two rules the catalog enforces (`tests/eval/identity_default_skills_test.ts`):

- **At most five entries**, matching the `max_per_request` cap on matched skills.
  Skills are always concatenated — pinned ∪ trigger-matched ∪ defaults — so a
  long default list is the one thing that cannot be trimmed at request time.
- **Exactly one output contract.** Carry either the generic `response-contract`
  or a specialised variant (`response-contract-qa`, `response-contract-judge`, …),
  never both.

Key skills:

- `response-contract` — the mandatory `<thought>`/`<content>` output contract and
  executable-plan JSON schema. A good default for every identity.
- `tdd-methodology` — Red-Green-Refactor cycle and test design.
- `security-first` — secure coding and vulnerability assessment.
- `code-review` — comprehensive code-review checklist (**trigger-matched**).
- `portal-grounding` — grounding responses in the portal's real files/symbols
  (**trigger-matched**).

Skills whose content must survive context compaction carry `critical: true`; that
flag is a **retention** marker, not a selection one, and the whole
`response-contract*` family plus `verdict-rubric` carry it.

Skills are loaded at runtime by the skill service from `Memory/Skills/`, which is
generated from these authored `.skill.md` files (`deno task check:skill-index`
keeps the two in sync).

## Plan output

A plan's `<content>` block is a single JSON object matching the executable-plan
schema (`title`, `description`, `steps[]`, …). See `packages/schemas/src/plan_schema.ts`
for the complete schema, and the `response-contract` skill for the contract every
identity must emit. Generated plans land in `Workspace/Plans/`.
