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
