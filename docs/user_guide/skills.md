# Skills

Procedural skills: format, matching, lifecycle and commands. Part of the [Exaix User Guide](README.md).

## Procedural Skills

A procedural skill is a specialized how-to guide that an agent uses to do one kind of task correctly. Unlike declarative memory, which holds facts, a skill holds instructions, constraints and examples for a process, such as how to run the tests in this project or how to deploy to production. Exaix matches skills to a request and adds the matching ones to the prompt of the agent.

### Key Concepts

- **Skill folders**: A skill is a folder `<name>/SKILL.md` in the Agent Skills format. The optional `exaix.yaml` next to it holds Exaix-only fields (`title`, `triggers`, `constraints`, `critical`, `tools`, `applies_to` and more). An optional `references/` folder holds read-only markdown files that the body links to. The daemon reads the folders directly, so an edit takes effect on the next request without a restart.
- **Triggering**: Skills are automatically matched to your request based on keywords, task types, or file patterns. A skill with no `triggers` in its sidecar, such as a folder written for another harness, gets keywords derived from its name and description. A sidecar that sets `triggers: {}` turns that fallback off.
- **Hydration**: When a skill matches, its full instructions are "hydrated" and injected into the agent's prompt. Linked reference files are appended in full mode and omitted in trimmed mode.
- **Revisions**: The id of a revision comes from the hash of the skill's files, so every edit is a new revision. The first time a revision is used, its complete content is stored in the journal database. Each model call records one row per injected skill in `skill_usage`, so a trace always shows what the agent saw.
- **Plan pins**: A plan records the skill revisions that were used to write it (`resolved_skills` in the plan frontmatter). When you approve the plan, execution runs those exact revisions even if the files changed. The journal records `skills.pin_drifted` once when the live revision differs.
- **Fail-Open Design**: Skill retrieval has a 500ms timeout. If it takes too long, the agent continues without the skill to avoid delays.
- **Drafts**: A skill that has no sidecar status in the `learned` or `project` roots, and every skill the learning system writes, is a **draft**. A draft is never matched or injected until a person approves the exact revision they reviewed.

### Skill roots

Skills load from an ordered list of roots. The first root that holds a name wins. Without a `[skills].roots` list the defaults are `Memory/Skills/project/<portal>` (only when you pass `--portal` or set `EXA_PORTAL`), `Memory/Skills/learned`, then `Blueprints/Skills`. Without a portal only global skills apply. The dogfood sandbox adds the worktree's `.copilot/skills` as a `dogfood` root.

### Working with skills

Use the `exactl skill` command. Add `--portal <alias>` to include that portal's project skills, and `-o table|json|md` to choose the output format. Every option is in the [skill command reference](../cli/skill.md).

- `exactl skill list` lists the available skills. `--category core|project|learned` filters the list, and `--all` also reports the folders that did not load.
- `exactl skill show <name>` shows one skill, and `--revision <revision-uuid>` shows one stored revision of it.
- `exactl skill match "<request text>"` tests which skills a request would match.
- `exactl skill create <name>` and `exactl skill derive --learning-ids a,b --name "..."` create a **draft**. You review its folder, then `exactl skill approve <name> --revision <revision-uuid>` approves the exact revision that you read. `exactl skill deprecate <name>` takes a skill out of matching.
- `exactl skill revisions <name>` and `exactl skill usage --trace <trace-id>` show the history and the use of a skill.
- `exactl skill validate [name]` gives typed reasons for every folder, and it exits with code 1 when one is invalid.

**The review flow.**

1. Create a draft. The command prints the draft path, for example `learned/release-notes`, and its revision.
1. Read the folder, then approve exactly the revision that you read.
1. Use the skill in a request, for example `exactl request create "Write the release notes" --skills release-notes`.

`approve` fails with exit code 1 when the draft changed after your review, so an old review never approves new content. `deprecate` takes a skill out of matching, and it needs a fresh approval to return. Exit code 0 means success, exit code 1 means a refused or failed operation, and exit code 2 means a malformed argument such as a revision that is not a UUID. Failures print a short message and never the body of a skill.

Skill text is shown with terminal control characters removed, so a draft cannot change your terminal while you review it. `-o json` returns the exact stored text. A stored revision is readable only from its own portal or from global scope, so `show --revision` and `revisions` never reveal another portal's project skill.

Only `exactl skill show --revision` and `revisions` read stored history. A deleted or edited skill stays readable there, but a stored revision is never injected by itself.

### Configuration

You can tune skill matching in your `exa.config.toml`:

```toml
[skills]
max_per_request = 5        # Max skills to inject per request
match_threshold = 0.3      # Minimum confidence score (0.0 to 1.0)
context_budget_chars = 32000 # Max characters for skills context (default)
render_mode = "trimmed"    # "full" (default) includes each ordinary skill's examples and references; "trimmed" omits them
keyword_match_saturation = 2 # Matched keywords that earn the full keyword score

# Explicit root order, highest precedence first. Omit it to use the defaults above.
roots = [
  { kind = "project", path = "Memory/Skills/project" },
  { kind = "learned", path = "Memory/Skills/learned" },
  { kind = "blueprint", path = "Blueprints/Skills" },
]

# Resource limits. An overflow makes that one skill invalid.
main_max_bytes = 262144
sidecar_max_bytes = 65536
reference_max_bytes = 65536
reference_max_chars = 16384
reference_max_count = 16
reference_total_max_bytes = 262144
snapshot_max_bytes = 524288

# Fallback keywords for a skill with no authored triggers
fallback_min_word_chars = 4
fallback_max_keywords = 32
```

Edits to these settings apply to the next operation. A refused edit leaves the last valid config in force.

### Output contracts and the context budget

A role declares its deliverable with `output_contract`: `plan`, `analysis`, `security`, `qa`, `performance` or `verdict`. The runtime adds the matching `response-contract*` skill. A flow step can set `output_contract` to override the role. A `verdict` run returns one raw JSON verdict and does not receive the plan-schema instruction. The critical `response-contract` skill requires a `<thought>` block and raw JSON inside `<content>`, and the planning skill uses that contract.

The skill context budget is 32,000 characters by default. Set it with `skills.context_budget_chars`. A budget of 2,000 characters cannot hold the response contract alone, and flows that need the larger contract reject it. With `skills.inject_in_prompt = false`, Exaix injects no skills.

### Skills for planning and authoring

Two bundled skills serve different tasks. Implementation-planning steps select the `implementation-plan` skill explicitly. It prepares a bounded plan from agreed requirements, uses the conventions of the target project, and covers dependencies, production wiring, validation and migration rollback. Planning does not authorize implementation or publication. Skill-authoring requests select `blueprint-best-practices` with the `default` role. It covers metadata, references, revisions and validation evidence, and it gives no implementation-planning guidance.

### Skills in CLI-delegate flow steps

For a CLI-delegate flow step, Exaix pins the explicit skills and the role defaults to immutable revisions before the launch. Each submission records the request, trace, flow and step identity. The launch stops when a skill is missing, when a revision or usage write fails, or when there is not enough space for an explicit or critical skill.

### Communication Requirement

Exaix instructs its agents to write concise, result-first prose under
**ASD-STE100** and the **Exaix STE Extension v1**: state the result or action
first, omit needless detail and self-reflection, and use bullets when they
help scanning. This directive shapes agent instructions, skill guidance, and
source comments.

Two limits apply to what the requirement can promise:

- **No guaranteed token savings.** Writing under the requirement reduces
  wording, but a prompt instruction does not guarantee a provider bills fewer
  tokens. Provider pricing, reasoning-effort settings, and repetition vary.
- **No private-reasoning control.** The requirement governs authored
  instruction and status prose. It does not inspect, rewrite, or claim
  control over a provider's private reasoning or signed thinking blocks.

Documentation deliverables (guides, design docs, READMEs, changelogs) are
exempt from the mandatory rule, though the surrounding instructions remain
eligible.

`render_mode = "trimmed"` drops each ordinary matched skill's `examples` content from the
rendered prompt, reducing assembled-prompt tokens without losing the skill's instructions.
Critical skill content always renders in full regardless of this setting.

To keep skills themselves within a healthy size, run the skill content-size governance check:

```bash
deno task check:skill-size
```

It reports any skill whose rendered `instructions` length exceeds the size threshold
(default: `DEFAULT_SKILL_SIZE_WARNING_CHARS`) — advisory output only (always exits 0);
see `scripts/check_skill_size.ts`.

### Skill Tools

A skill can optionally declare a `tools:` list — the MCP tools its own procedure calls for (e.g. `read_file`, `write_file`, `git_commit`). When one or more skills are matched onto a request, their `tools:` lists are combined into a single set (a matched-only tool is added once even if two skills both name it). That combined set is then narrowed to whatever the agent role's own `permitted_tools` allowlist already permits — a skill can only restrict which of the agent role's tools are shown, never add a tool the agent role isn't already allowed to use. If no matched skill declares `tools:`, the agent role's `permitted_tools` (or the full registered tool set, if the agent role has no allowlist) is used unchanged.

This keeps prompts focused: an agent role broadly permitted to use many tools only sees the ones relevant to the skills actually driving a given request, without an author having to hand-tune `permitted_tools` per request.
