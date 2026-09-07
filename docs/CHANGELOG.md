# Changelog

> User-facing changes to Exaix. Each entry includes the date and Exaix version
> (or workspace schema version) when the change shipped.
>
> **Scope:** Only changes that affect how a user interacts with Exaix — CLI flags,
> config fields, env vars, deprecations, new commands, behavior changes.
> Internal refactors, test additions, and code moves do not belong here.
>
> **Format:** follows [Keep a Changelog](https://keepachangelog.com/) conventions
> with categories: Added, Changed, Deprecated, Removed, Fixed, Security.
>
> **Adding an entry:**
>
> 1. Add a new `## [version] — YYYY-MM-DD` section when a release ships.
> 2. During development, add entries under `## Unreleased — Phase <N>`.
> 3. Every entry must be a single sentence, user-facing, no internal file paths.
>    (e.g., write "Model Intent CLI flags" not "packages/ai/src/model_resolver.ts")
> 4. Link to the relevant section in `Exaix_User_Guide.md` for detailed docs.

## Unreleased — Phase 145 (Adversarial Robustness & Interactive Evaluation)

### Added

- `exactl eval report --view robustness` — the AgentDojo triple (clean utility,
  utility-under-attack, attack-success-rate, robustness gap) per injection vector for the new
  `adversarial` evaluation pack (portal-readme, code-comment, tool-output, filename, and
  approval-social injection vectors), plus a `--run-ids <id,id,...>` option to scope the
  rendered table to an exact run set so a recorded result can be reproduced later regardless of
  how much further local evaluation history has accumulated.
- `exactl eval report --view interactive` — per-persona (cooperative/ambiguous/adversarial)
  clarification-loop convergence, policy-adherence rate, and pass^k for the new `interactive`
  evaluation pack, with the same `--run-ids` scoping option.
- `exactl request clarify <id>` — drive a request's clarification Q&A loop from the CLI
  (`--answer id=text`, repeatable; `--proceed`; `--cancel`; `--resolved-by <actor>`; `--json`).
- `--resolved-by <actor>` option on `exactl wait approve/reject/amend/expire/cancel` — records
  who resolved a wait-state gate, visible in the Activity Journal.

### Fixed

- The daemon now actually uses the configured live provider for LLM/HYBRID quality-gate
  assessment and request analysis — previously it silently ran heuristic-only regardless of
  the configured mode, because no provider was ever wired into request processing at daemon
  startup.

## Unreleased — Phase 171 (exaix-team Submodule Extraction)

### Changed

- `exaix-team/` (Team-tier code, mounted at `packages-team/` until its later rename) is
  now a git submodule backed by its own `exaix-team` repository, rather than a plain
  tracked directory — fresh clones need `git clone --recurse-submodules` (or a subsequent
  `git submodule update --init`) to populate it, and contributors touching Team-tier code
  need a separate access grant to `exaix-team` (see
  [CONTRIBUTING.md §4.2](../CONTRIBUTING.md#42-hooks)). Solo-edition clones and builds are
  unaffected — `exaix-team/` simply stays uninitialized.

## Unreleased — Phase 193 (Team & Enterprise Directory Restructure)

### Changed

- The `exaix-team` submodule's mount point in the parent repo was renamed from
  `packages-team/` to `exaix-team/`, matching its repository name — contributors who
  already have an initialized `exaix-team` (or still-named `packages-team`) checkout need
  to run `git submodule sync --recursive` (or re-clone) to pick up the new path. Inside the
  submodule, its 9 sub-packages moved under a new internal `exaix-team/packages/`
  directory, and the standalone MCP server app (previously `apps/mcp-server/` in the parent
  repo, a documented exception to the Solo/Team import-boundary rule) moved into the
  submodule as `exaix-team/apps/mcp-server/` — both `exaix-team/` and `exaix-enterprise/`
  now share the identical `packages/` + `apps/` layout. No CLI command, config key, or
  public `@exaix/*`/`@exaix-team/*` package export changed. See
  `exaix-dev-docs/planning/phase-193-team-enterprise-directory-restructure.md` for the full
  record.

## Unreleased — Phase 180 (Runner Terminology + AgentRunner Journal Tagging)

### Added

- `exactl journal` can now distinguish direct, non-flow agent executions (routed through
  the request pipeline) with `runner_kind: agent-runner` — previously these executions
  left no execution-attribution record in the Activity Journal at all (see
  [Exaix_User_Guide.md §10.3](Exaix_User_Guide.md#103-activity-journal)).

### Changed

- The Activity Journal's `agent_kind` column — queryable via `exactl journal --filter`
  and `--distinct` — is renamed `runner_kind`; flow-dispatched executions are now tagged
  `agent-composer` (previously `agent-executor`).

A local `.exa/journal.db` created before this change is incompatible with the renamed
`runner_kind` column — delete and recreate it (or the whole `Workspace/` directory) if
you hit a "no such column" error after upgrading.

## Unreleased — Phase 179 (Agent Role Terminology Rename)

### Changed

- The LLM persona concept is now called "Agent Role" everywhere it's user-visible:
  blueprints live under `Blueprints/Agents/` (previously `Blueprints/Identities/`), and
  blueprint/request frontmatter uses `agent_role:` as the sole key (see
  [Exaix_User_Guide.md §4.6](Exaix_User_Guide.md#46-file-format-reference)).
- `exactl request`'s `-i, --identity <name>` flag is now `-a, --agent-role <name>`.

### Removed

- The legacy `identity_id`/`identity` blueprint and request frontmatter keys are no
  longer accepted — a file using either fails validation instead of being silently
  migrated.
- The `-i, --identity` flag on `exactl request` no longer exists; there is no
  deprecated alias, so a stale invocation fails immediately with an unknown-option
  error rather than misrouting.

A local `.exa/journal.db` created before this change is incompatible with the renamed
`agent_role` DB columns — delete and recreate it (or the whole `Workspace/` directory)
if you hit a "no such column" error after upgrading.

## Unreleased — Phase 147 (Memory Capability Maturation)

### Added

- Executions now feed a self-learning memory loop: learnings are extracted from run
  outcomes plus in-the-moment agent notes, reviewed through the existing Pending →
  approval workflow, retrieved into future requests via hybrid keyword-and-embedding
  search with recency ranking, and consolidated automatically.
- Solo-tier agents gain a `remember_fact` tool to capture a "worth remembering" note
  mid-run; captured notes always pass through the same review pipeline as every other
  learning.
- Extraction and consolidation follow a content-curation policy that prefers actionable
  insights and deprioritizes structural facts answerable from portal knowledge.
- Approved memory self-consolidates: near-duplicates merge, contradicted guidance is
  superseded with a full audit trail, and a reflection pass synthesises related
  learnings into new proposals for review.
- Memory retrieval now ranks results by keyword, embedding similarity, and recency, and
  can follow connections between related learnings when you enable the new
  `memory.session.expand_links` configuration option (default off).
- Opt-in automatic approval (`memory.auto_approve.enabled`) closes the review loop
  without human action, bounded by a confidence threshold, allowed-source list, and
  quiet period.
- In-the-moment agent notes no longer bypass review: insights enter tiered working
  memory only after their learning is approved, keeping unreviewed content out of the
  durable banks.
- New end-user guide [Exaix_Memory.md](Exaix_Memory.md) explains the memory lifecycle,
  the self-learning loop, and the CLI inspection and approval flow.
- Delegated sessions ([session_delegate](Exaix_User_Guide.md#258-memory-participation))
  now participate in the memory lifecycle too: an accepted session mints an execution
  record and runs through the same extraction and approval pipeline as a plan
  execution, instead of contributing nothing.

### Fixed

- Post-run learning extraction now reads the agent's own real completion summary
  instead of a placeholder string, so extracted learnings reflect what a run actually
  did.
- Memory retrieval's keyword signal now finds promoted global learnings even with no
  embedding match, matching what the semantic-similarity signal already found —
  previously a promoted learning was only reachable via embedding similarity.
- Tags you attach to a `remember_fact` note now carry through onto the learning
  extracted from it — previously they were captured and journalled but silently
  dropped during extraction.

Defaults are unchanged: memory runs local-first with deterministic fallbacks when no
cloud model is available, and automatic approval stays off until you enable it.

## Unreleased — Phase 175 (Portal Knowledge Maturation)

### Added

- Portal knowledge now includes an explicit relationship graph — which files import which
  other files internally, and which files belong to which architecture layer — covering
  every entrypoint in a portal by default. Query it mid-task via two new Solo-tier ReAct
  tools, `query_relationships` and `who_depends_on` (grant them to an identity's
  `permitted_tools`; see `Exaix_User_Guide.md` §5.8, "Portal Knowledge Gathering").

### Fixed

- The embedding-backed relevance search for portal knowledge
  (`relevanceSearchEmbeddingEnabled`) now actually fires when enabled — previously the
  retrieval index was never populated by either the daemon or `exactl`, so the flag
  silently had no effect.

## Unreleased — Phase 174 (Governed Session-Delegated Step Cycling)

### Added

- A new `session_delegate_cycle` flow step type runs a hardened, multi-step implementation
  plan as one governed sequence of external session delegations — each step's changes are
  reviewed and gated before the next step launches, and progress survives a daemon restart
  without re-running completed steps (see `Exaix_User_Guide.md` §4, "Session Delegate Cycle
  Step Type").

### Changed

- `session_delegate_cycle`'s `review.onFail` accepts only `halt`; `retry` and
  `continue-with-warning` are rejected at validation time instead of being silently ignored
  at runtime.

## Unreleased — Phase 173 (Dogfood Step-Context Sufficiency)

### Added

- Generating requests from a plan document now copies the full phase document into
  the workspace at `.exa/PlanContext/<slug>.md` and points every generated request at
  it, so a delegate that needs more than the inline summary can read the source
  document directly (see `Exaix_User_Guide.md` §4.6).

### Changed

- Generated requests now include a "Why This Step Exists" section carrying the plan's
  Executive Summary and the Constraints/Design Decisions relevant to that specific
  step, instead of only the step's own four scraped subsections.
- Request files now use `identity_id` as the frontmatter field naming the identity
  blueprint that should handle the request; the old `identity` field name is retired
  and no longer read (see `Exaix_User_Guide.md` §4.6).

## Unreleased — Phase 167 (Codex CLI Session Adapter)

### Added

- `[ai].provider = "codex-cli"` inside the ReAct execution loop and
  `[session_delegate] tool = "codex"` with `launch_mode = "headless"` are now two
  supported, separately-tested Codex surfaces — the headless gate runs in an isolated
  worktree, reports every touched path, and routes through the workspace-root + post-hoc
  `permitted_paths` reconciliation model (subscription auth via the stored `codex login`
  credential; see `Exaix_User_Guide.md` §2.4.6 / §2.5.7).
- `session_delegate.harden_permissions = true` now derives Codex's `--sandbox` mode from
  the gate (`code_changes` → `workspace-write`, all other gates → `read-only`) and the
  minimum-version probe fails closed instead of only warning.

### Changed

- Every spawned child environment is now built through one shared policy: foreign agent
  binaries (claude/opencode/codex) get an allowlist of safe variables plus their own
  explicit auth, ambient secrets and proxy settings never reach them; trusted first-party
  tools strip dynamic-linker, interpreter-overlay and git env-config injection variables;
  and the daemon/exactl entry scrubs those injection classes from the process environment
  at startup.

### Security

- Ambient secrets (e.g. `OPENROUTER_API_KEY`, cloud/VCS/SSH credentials) are no longer
  forwarded to the write-capable execution delegate — the third `[cli_delegate]` surface
  now uses the same allowlist model as the other spawn paths.
- Codex's sandbox and spawn hardening strip `LD_*`/`DYLD_*` and interpreter-overlay env
  vars (which Deno's scoped `--allow-run` refuses to forward and which otherwise silently
  broke every delegate spawn), and reasoning/thinking-token usage is now captured across
  every provider and CLI-delegate parser instead of being silently discarded.

## Unreleased — Phase 154 (MCP Tool Catalog Unification)

### Changed

- External MCP clients (Claude Desktop, Claude Code, and other connected agents) now see a
  short "Selection hint" appended to `patch_file`/`write_file`'s advertised description in
  `tools/list`, giving them the same tool-preference guidance Exaix's own internal agent
  already uses (see `Exaix_User_Guide.md` §8.2).

### Fixed

- A blueprint's `hitl.require_secondary_approval` rules now actually gate tool calls made
  through the standard plan-execution path, not just Flow's dynamic steps — previously
  declared in blueprint frontmatter but silently never enforced there (see
  `Exaix_User_Guide.md` §12.4).

### Security

- `patch_file` no longer corrupts file content when the replacement text contains
  `$`-prefixed sequences (e.g. `$&`, `$$`, `$1`) — these were previously silently
  reinterpreted as regex-style substitution patterns instead of being written literally.

## Unreleased — Phase 169 (@visible Event Runtime Verification)

### Fixed

- Activity Journal lifecycle events now preserve canonical request and execution trace correlation across request analysis, context budgeting, cost tracking, and plan-amendment decisions, so trace-scoped audit queries return complete records (see [Activity Journal](Exaix_User_Guide.md#log--journal-commands---query-the-activity-journal)).

## Unreleased — Phase 163 (MCP Server Spec Compliance)

### Added

- `mcp.require_auth` config flag (with the `MCP_AUTH_TOKEN` env var holding the bearer
  secret) — opt into bearer-token authentication for `exactl mcp start --sse`, so
  unauthenticated clients are rejected with `401` while clients presenting the configured
  token are accepted; the server fails fast at startup if the flag is on but the token is
  unset (see `Exaix_User_Guide.md` §8.1).
- `execution_mode: dynamic` flow steps now execute for real on the Team/Enterprise edition —
  the step runs a model-driven tool-selection loop bounded by its `permitted_tools` instead
  of silently falling back to the declared path (see `Exaix_User_Guide.md` — "Flow Step
  Execution Modes").

### Changed

- `exactl mcp start` now serves the MCP protocol through the official TypeScript SDK,
  negotiating the current protocol version (2025-11-25, up from the legacy 2024-11-05) over
  both stdio and, with `--sse --port <N>`, real Streamable HTTP (see `Exaix_User_Guide.md`
  §8.1).

## Unreleased — Phase 162 (Outbound MCP Client)

### Added

- `exactl mcp connect <url>` — connect to any spec-compliant external MCP server as a
  client, with `--list-tools` to enumerate its tools and `--call-tool <name> --args '<json>'`
  to invoke one, using the modern Streamable HTTP transport and falling back automatically
  to the legacy SSE transport for servers that have not migrated yet (see
  `Exaix_User_Guide.md` §8.4).
- `EXA_MCP_BEARER_TOKEN` env var — authenticate to token-gated MCP servers (for example
  GitHub's official MCP endpoint) with a bearer token instead of an interactive login flow.

### Security

- `exactl mcp connect` now refuses to attach a bearer token to a non-HTTPS, non-loopback
  endpoint, throwing a clear error instead of sending the token in cleartext.

## Unreleased — Phase 144 (External Benchmark Interop)

### Added

- `exactl eval report --view external` — comparability against a public benchmark
  (Terminal-Bench: resolved rate, coverage, cost, and provenance per benchmark/version/cell),
  with a derived-methodology caveat rendered alongside every table (see
  `Exaix_Evaluation.md` §17).
- `scripts/ingest_terminal_bench.ts` and `scripts/sweep_terminal_bench_controls.ts` —
  operator-run tools to ingest a pinned Terminal-Bench release into Exaix's own task
  contract and validate it with null/reference controls before a live run.

### Changed

- The vendored Terminal-Bench task corpus now ships only the 26 tasks whose null/reference
  validity controls both pass; the other 68 classifier-supported tasks stay recorded (with
  reason) in the manifest and coverage numbers but are no longer vendored with runnable
  content, since a controls-failing task was never safe to trust a live result from.

### Fixed

- `scripts/ingest_terminal_bench.ts` no longer hangs, or falsely times out, ingesting a task
  whose oracle solution prints more output than the OS pipe buffer holds.
- `scripts/sweep_terminal_bench_controls.ts` no longer hangs indefinitely on a stuck docker
  verify step, and a single task with a malformed contract no longer discards every other
  already-completed task's result in the same sweep.

### Security

- `scripts/ingest_terminal_bench.ts` now rejects a crafted upstream `run-tests.sh` install
  line containing shell metacharacters instead of interpolating it into a constructed shell
  command, and fails closed on a genuine I/O error reading a task-local license override
  instead of silently treating it as "no override present."

## Unreleased — Phase 159 (Flow Step Execution Strategy)

### Added

- A flow step's YAML can now declare `strategy: react | mcp | cli_delegate` to route that
  step through the agent strategy registry (tool-capable execution: reading the repo,
  running commands, delegating to a CLI) instead of the default single-shot generation,
  without changing `execution_mode` (see `Exaix_User_Guide.md` — "Flow Step Execution
  Strategy").

### Changed

- 16 of the 17 bundled flows now assign an explicit strategy per step — steps that must
  inspect the live repository use `react`, steps that produce or verify real file changes
  use `cli_delegate`, and everything else keeps the previous single-shot behavior.
- The bundled `feature-development` flow now runs every step via `cli_delegate`, giving its
  cost-vs-quality comparison against direct execution a clean, matched-strategy result
  instead of an earlier inconclusive one.

## Unreleased — Phase 158 (Artefact Value Evaluation)

### Added

- A value-evaluation tier that measures whether a curated identity, skill or flow actually
  improves task outcomes, distinct from the existing packs that only check an artefact
  reaches the run (see `Exaix_Evaluation.md §15`).
- `EXA_EVAL_SUPPRESS_SKILLS`, `EXA_EVAL_SKILL_OVERLAY_DIR` and `EXA_EVAL_IDENTITY_OVERLAY_DIR`
  env vars — vary which skills are injected or overlay a skill/identity's configuration for a
  single evaluation run, without editing the shipped catalog.
- An operator-run catalog gate confirming every shipped identity, skill and flow carries a
  recorded value decision (keep, revise, remove, or a stated reason it cannot yet be measured).
- An operator-run report tool that reproduces a value-evaluation report — paired arm
  comparisons, validity gates, and skill/identity/flow value — from a file of previously
  collected run data.
- A "Contributor rule: value evidence" section in each catalog README (identities, skills,
  flows) — a new artefact must carry a value result or a stated reason it cannot be measured yet.

## Unreleased — Phase 157 (Recorded Mock Fixtures — Capture, Replay and Drift)

### Added

- `--capture-fixtures <dir>` on the scenario runner — records a live provider run into a
  committed, replayable fixture set instead of calling the model on every future run (see
  `tests/scenario_framework/README.md` — "Recorded Mock Fixtures").
- `[ai.mock] strategy = "recorded"` and `fixtures_dir` config — the mock provider replays a
  committed fixture by call site (which step made this call), not by hashing the prompt, so
  editing a prompt no longer invalidates the whole recorded set.
- `MOCK_STRICT` env var (and `[ai.mock] strict` config) — a missing fixture fails the run
  outright instead of silently falling back to a pattern-matched guess.
- Drift and flakiness reporting — the daemon warns (`[fixture-drift]`) when a replayed
  fixture's prompt no longer matches what was recorded, and the runner warns
  (`[capture-flakiness]`) when a call site frequently failed to satisfy its response
  contract during capture, both against configurable thresholds.

### Fixed

- Capturing fixtures for a scenario with parallel steps no longer silently loses recordings
  when two steps happen to run at the same time — each step's fixture is now addressed by
  its own step id instead of a shared counter the steps could collide on.

## Unreleased — Phase 153 (Multi-Provider Native Tool-Calling)

### Added

- Native tool-calling support (`tools` and `tool_choice` parameters) for OpenAI, Google, and OpenRouter direct-API providers, ensuring models choose from tools Exaix actually offers (see `Exaix_User_Guide.md` §5.3a).
- Paid-tier live verification for Google Gemini provider native tool-calling under standard production quotas (see `Exaix_User_Guide.md` §5.3a).
- Scoping of scenario security checks via cell lists, enabling `assert-no-dynamic-tool-calls` security gates to run exclusively on CLI-delegate cells (see `Exaix_User_Guide.md` §5.3a).

## Unreleased — Phase 150 (Dogfood Delegation Fidelity)

### Added

- Faithful delegate briefs — a delegated code-change step now receives the plan step's
  full title, content, and acceptance criteria instead of a placeholder step number, so
  the headless agent has the task description it needs to do the work.
- Acceptance criteria reach the delegate even when a plan step carries no structured
  criteria, by reading the step's own acceptance section.
- Contentless-brief guard — an empty or placeholder objective is rejected and journalled
  (`session.delegate.contentless_brief`) instead of silently returning a no-op delegation.
- Brief-preparation failures are journalled as their own event, distinct from a clean
  delegate reconcile.
- Meta-workflow identities — `dogfood-coder` (write + delegate) and `code-reviewer`
  (read-only) for the documented autonomous dogfooding queue.
- `permitted_paths` in the `[session_delegate]` config block — declare which
  worktree-relative paths a delegate may change. Presets that omit it keep the previous
  behaviour.

### Changed

- The delegate end-to-end suite now requires a real, scoped change to pass; a delegation
  that reconciles without touching any file fails it.
- A scenario whose steps failed can no longer be reported as passing because its weighted
  score cleared the threshold — the score can only lower a verdict, never lift one.
- Every delegation now journals `session.delegate.briefed`, including headless runs, which
  previously recorded only `session.delegate.launched`.

### Fixed

- Delegating a code change to Claude Code with a configured model now works. The resolved
  `provider:model` identifier was passed through to the CLI, which rejects the provider
  prefix, so the delegate never ran with the requested model.
- Code changes to a portal are no longer rejected as out of scope. The delegate's brief
  permitted only `Workspace/**`, which can never match a portal-relative source path, so
  every completed delegation was discarded at reconciliation.
- Generating a request queue from a plan no longer drops the first step when the plan
  file begins directly with a step heading, which previously left the queue depending on
  a step that was never created.
- The generated request queue now correctly records and preserves `depends_on` ordering,
  so each request can reference its predecessor rather than running in an arbitrary
  sequence.
- OpenCode delegates now write changes to the correct worktree directory instead of
  the portal checkout, so code changes are properly isolated and preserved.
- A step title containing path-separator characters (e.g. `../`) no longer silently
  aborts delegation by reaching the path-normalisation boundary inside the brief
  preparation step.

## Unreleased — Phase 142 (Subsystem Evaluation Packs)

### Added

- `exactl eval report --group-by subsystem|entity` — per-subsystem and per-entity score rows with trend deltas, combinable with `--tag` (see `Exaix_Evaluation.md §12`).
- `skills.resolved` journal event — records the skills applied to every request, with the pinned/matched/defaults breakdown that produced the final set.
- `deno task eval:subsystems`, `eval:subsystems:core` and `test:parity` — run the subsystem evaluation packs and the catalog-parity gates (see `Exaix_User_Guide.md §13`).
- `--keep-sandbox` on the scenario runner, plus `deno task scenario:prune` to reclaim old sandboxes; a scenario run now removes its own sandbox on success and always keeps it on failure.

### Changed

- Skills applied to a request are now always the union of explicitly pinned, trigger-matched and identity default skills, replacing three merge rules whose result depended on which branch ran.
- Identity `default_skills` lists were shortened from 70 entries to 37 across the catalog, so a skill that declares triggers now arrives on the requests that need it rather than on every request.
- `exactl daemon start` now blocks until the daemon is ready instead of returning while its watchers are still starting.
- A config declaring `paths.flows = "Flows"` is now rejected at load with a message naming the correct `Blueprints/Flows`, instead of silently resolving to an empty flow catalog.
- Flow blueprint filenames now match the ids declared inside them, so a flow named `bug-investigation` lives in `bug-investigation.flow.yaml`.
- A tool that requires human approval can no longer be granted to a dynamic flow step, closing a path by which a model-chosen step could change configuration.
- `portal add` is now idempotent when the alias and target already match, instead of failing.

### Removed

- The `skip_skills` request frontmatter field — a subtractive escape hatch on an additive model made the resulting skill set unpredictable; keep a skill out of an identity's defaults instead.

### Fixed

- `exactl flow list`, `flow show` and `flow validate` reported "No flows found" against a workspace that held flows, because the default flow-catalog path pointed at a directory the catalog has never shipped in.
- A flow request created from the CLI was rejected by the daemon the moment it was parsed, so flow requests now run end-to-end for the first time.
- `exactl request --file` discarded the submitted file's own frontmatter — its skills, tags, identity and priority ended up as literal text in the request body instead of taking effect.
- A `skills:` list written as a YAML array raised an error; both a YAML array and a JSON string are now accepted.
- Frontmatter `tags:` were overwritten by the request analyzer, so tag-driven skill matching could never fire; both sources are now merged.
- `exactl config get`, `config diff` and `config validate` failed with a raw database error against a workspace the daemon had never started in.
- `search_files` and `run_command` were advertised by the standalone MCP server but unusable by any external client.
- Skill matching was entirely unobservable — the events recording which skills were selected, or that selection had failed, were declared but never emitted.
- The daemon's default network allowlist omitted Google and OpenRouter, so a run that selected either provider died on a permission error rather than being refused on policy.

## Unreleased — Phase 141 (SW-Task Benchmark Corpus)

### Added

- `exactl eval run --pack swe_tasks` — a 16-task benchmark across 8 typical software-task families (bug fix, feature, refactor, tests, and others), each run through the full request → plan → approve → delegate → reconcile path against a fixture project rather than through synthetic steps.
- Every benchmark task ships a reference patch and is validated by two agent-free controls — applying the patch must score 1.0, leaving the project untouched must score below threshold — so a task cannot silently become unpassable or trivially passable.
- `exactl eval report --tag <tag>` groups scores by task family, so a trend can be read per family instead of only per run.

## Unreleased — Phase 140a (Evaluation Timing, Token & Cost Metrics)

### Added

- Per-step wall-clock duration, token counts (prompt, completion, and cached) and real tracked cost are now recorded for every evaluation step and readable from `exactl eval report` (see `Exaix_Evaluation.md`).
- Prompt-cache tokens are now measured — Anthropic's cache-creation and cache-read token counts were previously discarded, so the savings from prompt caching could not be observed at all.

### Fixed

- Step durations computed by the scenario runner were dropped before reaching the run record, so every evaluation reported timing it had already measured.

## Unreleased — Phase 140 (Evaluation Framework Maturation)

### Added

- `exactl eval run --trials <n>` — run each scenario multiple times and score the aggregate, instead of the flag being accepted and ignored.
- `exactl eval run --score-threshold <n>` — gate the exit code on the suite score, instead of the flag being accepted and ignored.
- Evaluation runs are now attributable: each records the provider, model, duration and framework revision that produced it.

### Changed

- LLM-judge and trajectory scores are now continuous end to end — a partly-correct result contributes a partial score instead of being rounded to pass/fail before it reaches the total.
- `eval history` and `eval compare` now read the same store; they previously read two different backends at two different paths, so the two commands could disagree about the same run.

### Fixed

- Trajectory assertions never matched anything, because tool-call capture looked for event names Exaix does not emit — no scenario could observe an agent's tool sequence.
- LLM-judge returned a pass in mock mode, so a judged criterion appeared to succeed on runs where no model was consulted.

## Unreleased — Phase 139 (Config History, Rollback, Locking, Integrity)

### Added

- `exactl config history <key>` — the append-only override history for a key, newest first.
- `exactl config rollback <key> <id>` — revert a key to a historical value, recorded as a new entry rather than by rewriting history.
- `exactl config lock <key>`, `config unlock <key>` and `config lock-list` — refuse all writes to a key (CLI, MCP and daemon alike) until it is unlocked, so a compromised key cannot be re-poisoned immediately after a rollback.
- `exactl config edit` — edit overrides in `$EDITOR`, with changes applied through the same validation path as `config set`.
- Configuration integrity is now checksummed and verified at daemon boot and on each change; an out-of-band edit to the config database is journalled as an anomaly instead of going unnoticed.

## Unreleased — Phase 138 (Config Security — MCP Authorization, Blocklist, Rate Limiting)

### Added

- Three-tier MCP authorization for configuration writes — safe settings apply directly, ordinary settings need approval, and dangerous ones such as the system root are refused, replacing a model where every change required human review.
- `exactl config block add|remove` — an administrator blocklist that prevents MCP agents from writing specific configuration paths regardless of approval.
- `exactl config compact` — collapse the override log to one row per key, for a workspace whose history has grown large.

### Changed

- Configuration writes are now rate limited across the CLI, MCP and database surfaces, so a runaway agent can no longer fill the override log.

## Unreleased — Phase 137 (Config Cutover — Live Reload, MCP Tools, Profiles)

### Added

- Hot-apply: settings marked hot-swappable now take effect in the running daemon as soon as they are changed, instead of waiting for a restart.
- MCP configuration tools — `exaix_config_get`, `exaix_config_set`, `exaix_config_validate`, `exaix_config_diff`, `exaix_config_get_provenance` and `exaix_config_apply` — let an agent inspect and, with approval, adjust configuration (see `TOOLS.md`).
- `exactl config set-model`, `set-provider` and `set-path` — shorthands for the most common configuration changes.
- Configuration profiles: `exactl config use-profile`, `config list-profiles`, and a `--profile` flag on `config get`/`config set`.

### Changed

- The daemon now reads its settings from the configuration database rather than from `exa.config.toml`, which is reduced to the workspace root and schema version; a value changed with `exactl config set` while the daemon was down is applied when it next starts.

## Unreleased — Phase 136 (Configuring — Registry, Config DB, CLI)

### Added

- `exactl config get`, `set`, `unset`, `validate` and `show` — around 150 previously source-only defaults are now inspectable and tunable without forking Exaix, with every write validated against the setting's registered type and bounds (see `Exaix_User_Guide.md`).
- Configuration overrides are persisted in an append-only log in the workspace, so a change survives a daemon restart and every change keeps an audit trail.
- `exactl config show --sources` — see where each effective value came from (default, file, or override).

## Unreleased — Phase 135 (Model Registry — Team Rigor)

### Added

- Team edition: a live, self-updating model catalog — enable with `model_registry.enabled = true` (see `Model_Resolution.md`). Off by default; Solo behavior is unchanged when disabled.
- `best` characteristic (Team) — ranks providers by independent benchmark performance for the kind of task you're requesting, instead of a flat preference.
- Opt-in usage-based tiebreak (Team) — `model_registry.usage_tiebreak = true` breaks ties between equally-preferred providers using your own usage history instead of an arbitrary pick.
- Multi-route pricing (Team) — when a model is offered by more than one provider, `model_registry.route_policy` (`cheapest`, `reliability`, `native_first`, or `user_order`) decides which one is used.
- `exactl models refresh` — trigger/inspect the Team live catalog's refresh cycle.
- `exactl models list --benchmark <name>` — append an advisory benchmark-score column (Team) to the model list.
- `config model` now validates an explicit model against the Team live catalog and auto-admits a real-but-previously-unused model on first use, instead of only Solo's pass-through.
- Cost records now carry a `cost_source` (`provider_reported` or, on Team, `registry_computed`), and a mismatch beyond tolerance is now flagged instead of silently picked.

### Changed

- Cost accuracy (D9): Solo behavior is otherwise unchanged from Phase 134 except that cost records now carry the `cost_source` field above — expect reported cost totals to shift slightly toward more accurate figures where Team is enabled.

## Unreleased — Phase 134 (Model Registry)

### Added

- `exactl models list` and `exactl models pricing` — inspect the Solo model floor's provider/model list, pricing provenance (`static`/`unknown`), and verified-at staleness (see `Exaix_User_Guide.md §2.4.2`).
- `exactl config model --size <S|M|L|XL> <providers…>` — curate a per-size preferred provider list (with `--characteristic`, `--list`, and `--clear`), written back to `model_presets.<SIZE>.candidates` in `exa.config.toml`.
- Curated `model_presets.<SIZE>.candidates` and `model_presets.<SIZE>.characteristics` config keys — a size request resolves via this preferred list first (journalled `reason: preferred_list`).

### Changed

- A local or free provider (e.g. Ollama) is now exempt from cost/budget filtering during model-size resolution, and an unknown-priced model is never selected as "cheapest".

## Unreleased — Phase 132 (Model Routing)

### Deprecations

- **Hardcoded `model:` in identity blueprints is deprecated.** Replace with
  `model_size:` + `characteristics:` frontmatter fields. See `Exaix_User_Guide.md §6.2`
  for migration guide.

### Added

- Model Intent CLI flags: `--model-size <S|M|L|XL>`, `--thinking`, `--effort`,
  `--characteristic`, `--preferred-provider` on `exactl request`.
- `EXA_MODEL_PRESET_OVERRIDE=test` env var for deterministic model resolution.
- `exactl logs` command — queries the activity journal with event-type shortcuts
  (e.g., `exactl logs --filter model_resolved`).
- ModelResolver — policy-driven model routing (chooses provider+model from capability requirements).
- `model.resolved` log events for tracing which model was chosen and why.

### Post-gap remediation (132.18–132.28)

- Providers now register capability metadata (`supportsThinking`, `supportsEffort`,
  `contextWindow`, `costPerMtok`) so size-preset and `--thinking` selection work at
  daemon runtime instead of degrading to the mock provider.
- Context-window overflow now bumps `model_size` one tier (S→M→L→XL) and reports
  `context_window_overflow`; fallback attempts report `reason: "fallback"`.
- `--preferred-provider` narrows the candidate pool and skips cross-provider scoring;
  `rate_limit_weight` blends rate-limit headroom into characteristic scoring (>0).
- Request-level intent flags (`--model-size`, `--thinking`, …) now override blueprint
  intent during native plan execution; `model.resolved` payloads carry structured
  `intent`/`selected` fields.
