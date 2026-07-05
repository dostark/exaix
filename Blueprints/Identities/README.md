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
default_skills: ["response-contract", "code-review", "portal-grounding"]
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

## Skills

Skills are the modern, versioned, criticality-aware replacement for the retired
fragment includes. Reference them via `default_skills`:

```yaml
default_skills: ["response-contract", "code-review", "portal-grounding"]
```

Key skills:

- `response-contract` — the mandatory `<thought>`/`<content>` output contract and
  executable-plan JSON schema.
- `code-review` — comprehensive code-review checklist.
- `security-first` — secure coding and vulnerability assessment.
- `tdd-methodology` — Red-Green-Refactor cycle and test design.
- `portal-grounding` — grounding responses in the portal's real files/symbols.

Skills are loaded at runtime by the skill service from `Memory/Skills/`, which is
generated from these authored `.skill.md` files (`deno task check:skill-index`
keeps the two in sync).

## Plan output

A plan's `<content>` block is a single JSON object matching the executable-plan
schema (`title`, `description`, `steps[]`, …). See `packages/schemas/src/plan_schema.ts`
for the complete schema, and the `response-contract` skill for the contract every
identity must emit. Generated plans land in `Workspace/Plans/`.
