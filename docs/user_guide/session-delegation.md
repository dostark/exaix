# Session Delegation

Delegate code changes to a CLI tool and run steps through a CLI delegate. Part of the [Exaix User Guide](README.md).

## Session Delegation Configuration

Exaix can delegate specific pipeline gates to external CLI agent tools (OpenCode, Claude
Code, Codex) instead of using the built-in LLM. This is useful when you want
human-in-the-loop review or want to use a specialized tool for specific tasks.

### Configuration

Add a `[session_delegate]` section to your `exa.config.toml`:

```toml
[session_delegate]
enabled = true
tool = "opencode"              # claude-code | opencode | codex | cursor | vscode
gates = ["refinement", "plan_review"]   # which gates to delegate
launch_mode = "headless"       # advisory (Mode 1) | supervised (Mode 2) | headless (Mode 3)
```

### Prerequisites

The delegate tools must be installed separately:

| Tool            | Installation                                                                                                                                        |
| --------------- | --------------------------------------------------------------------------------------------------------------------------------------------------- |
| **OpenCode**    | [opencode.ai](https://opencode.ai) — CLI installer and setup guide                                                                                  |
| **Claude Code** | [docs.anthropic.com/en/docs/claude-code](https://docs.anthropic.com/en/docs/claude-code/overview) — requires Claude Pro/Max subscription            |
| **Codex**       | [developers.openai.com/codex](https://developers.openai.com/codex/noninteractive) — requires `codex login` (ChatGPT Codex subscription; no API key) |
| **OpenRouter**  | See [Enterprise providers](../Model_Settings.md#enterprise-providers-vertex-ai-openrouter) — API key from [openrouter.ai](https://openrouter.ai)    |

### Launch Modes

| Mode       | Value        | Description                                                                |
| ---------- | ------------ | -------------------------------------------------------------------------- |
| **Mode 1** | `advisory`   | Prints the command; human runs the tool out-of-band                        |
| **Mode 2** | `supervised` | Interactive TTY spawn                                                      |
| **Mode 3** | `headless`   | Non-interactive spawn; daemon captures stdout and reconciles automatically |

Mode 3 (headless) supports `claude-code`, `opencode`, and `codex`. For tools that don't
write `return.json` natively (`opencode run --format json`, `codex exec --json`), the
daemon captures their JSON event stream from stdout and synthesizes a valid `return.json`.
**Codex's tested, intended mode is headless (Mode 3)** — Mode 2 (`supervised`) launch
throws (`resolveLaunch()` rejects it); see [Codex sandbox and permitted-path security](#codex-sandbox-and-permitted-path-security).

### Per-Request Override via Environment Variables

For CI and testing, use environment variables instead of TOML config:

```bash
export EXA_SESSION_DELEGATE_ENABLED=true
export EXA_SESSION_DELEGATE_TOOL=opencode
export EXA_SESSION_DELEGATE_GATES=refinement,plan_review
export EXA_SESSION_DELEGATE_BIN_OVERRIDES=/path/to/custom/binary
```

Default gates when `EXA_SESSION_DELEGATE_ENABLED=true`: `refinement`, `plan_review`.
`code_changes` requires explicit opt-in via `EXA_SESSION_DELEGATE_GATES`.

### Gate Effects

| Gate           | What happens when delegated                                        |
| -------------- | ------------------------------------------------------------------ |
| `refinement`   | Request quality gate delegates to CLI tool instead of LLM Q&A loop |
| `plan_review`  | Plan approval delegates to CLI tool (requires handler wiring)      |
| `code_changes` | Plan step execution delegates to CLI tool instead of AgentExecutor |
| `review`       | Code review delegates to CLI tool (requires handler wiring)        |

### Mock Binary for Testing

```bash
deno task build:mock-tool   # compiles .cache/mock_session_tool_bin
```

The mock binary reads `--brief <path>` and writes a schema-valid `return.json`.
Add it to `bin_overrides` for CI scenarios:

```toml
bin_overrides = ["/path/to/.cache/mock_session_tool_bin"]
```

### Codex Sandbox and Permitted-Path Security

`codex`'s tested, intended integration path is Mode 3 (headless) — `BuiltinSessionAdapter`
registers it without Mode 2 (`supervised`) support (`resolveLaunch()` throws), unlike
`claude-code`/`opencode`. It
reuses the same `codex login` subscription credential as
[Subscription-billed CLI providers](../Model_Settings.md#subscription-billed-cli-providers-codex-cli); there is no separate auth step
for session delegation.

Codex enforces scope through two independent, layered mechanisms:

1. **Sandbox (enforced by the `codex` CLI itself, during the run).** With
   `harden_permissions = true`, the daemon derives `--sandbox workspace-write` when the
   delegated gate is `code_changes`, or `--sandbox read-only` for every other gate — see
   `deriveCodexSandboxFlags` (`@exaix/session`). `workspace-write` confines all writes to
   the worktree root; a write to an absolute path outside it (e.g. `/tmp/...`) never
   reaches disk, regardless of what the model attempted.
1. **`permitted_paths` (enforced by Exaix, after the run).** Being inside the worktree is
   not sufficient on its own: `SessionReturnWatcher`/`reconcile` also check every path the
   delegate actually touched (via `git diff --name-only`) against the worktree-relative
   globs in `permitted_paths`. A touched path outside those globs — even one safely inside
   the sandboxed worktree — is rejected as `session.delegate.scope_violation`, and
   `session.delegate.reconciled` is never journaled for that request (the durable wait is
   never resumed).

```toml
[session_delegate]
enabled = true
tool = "codex"
model = "codex-cli:gpt-5.6-terra"   # provider:model form; a bare model id is rejected
gates = ["code_changes"]
launch_mode = "headless"
permitted_paths = ["src/**", "tests/**"]
harden_permissions = true
```

### Memory Participation

An accepted delegated session — any gate — feeds Exaix's memory lifecycle exactly
like a plan execution: the daemon mints an execution record from the return's own
`summary`/`paths_touched` and the brief's `agent_role`, then runs the same
skill-guided extraction and Pending → approval pipeline. A rejected or expired
return never does. The delegate's `transcript_ref` (the full session transcript)
stays audit-only — extraction never reads it. See
[Exaix_Memory.md §2.1](../Exaix_Memory.md#21-born--capture-and-extraction) for how
this fits the wider capture story.

## Per-Step CLI Delegate Execution — the Cost-Preferred Path for Live/Eval Runs

`[cli_delegate]` is a **different, narrower** mechanism than `[session_delegate]` above: it
selects a single per-step execution strategy (`CliDelegateStrategy`) rather than delegating a
whole pipeline gate. Where `ReActLoopStrategy` calls the configured `IModelProvider` directly
(Anthropic/OpenAI/Google API — metered, per-token billing), `CliDelegateStrategy` drives the
same headless `claude`/`opencode` CLI you already use interactively, authenticating the same
way that CLI does by default: against a **Claude Pro/Max (or equivalent) subscription**, not
the API.

> [!TIP]
> **Use `[cli_delegate]` for repeated live evaluation and manual/nightly `swe_tasks` runs.**
> If you already pay for a Claude Code subscription, every headless call it drives is covered
> by that flat monthly rate instead of adding to metered API spend — the same work, at no
> marginal per-run cost. This is the preferred configuration for `exactl eval run` against
> live provider cells (see `tests/scenario_framework/README.md`).

### Configuration

Add a `[cli_delegate]` section, and grant the agent role's blueprint the matching capability tag:

```toml
[cli_delegate]
enabled = true
tool = "claude-code"          # claude-code | opencode
model = "claude-sonnet-5"     # optional; tool default when absent
```

By default the tool runs with no provider API key in its environment and uses its own login.
To run a tool on a provider API instead, add a `[cli_delegate.provider]` block. The daemon reads
the key from the named variable and passes it to the tool only. A missing variable is a startup
error. This is the same block as `[session_delegate.provider]`:

```toml
[cli_delegate]
enabled = true
tool = "opencode"
model = "openrouter/deepseek/deepseek-v4.1-flash"

[cli_delegate.provider]
name = "openrouter"
key_env = "OPENROUTER_API_KEY"
```

OpenCode 2.x sends a run to a shared background service that keeps the environment it started
with. Exaix launches OpenCode with `--standalone` so that each run uses its own environment.

For planning and analysis calls that use the `claude-cli` model provider, you may
limit Claude Code's native tool catalog to Bash:

```toml
[cli_delegate]
enabled = true
tool = "claude-code"
tool_exposure = "shell_only" # optional; default is the full native catalog
```

This option affects `CliDelegateModelProvider` calls, not the code-writing
`CliDelegateStrategy` used for per-step execution. `shell_only` passes
`--tools Bash` to Claude Code. Codex and OpenCode reject this setting because
their equivalent native tool-catalog restriction has not been established.

```yaml
# Blueprints/Agents/<agent-role>.md frontmatter
capabilities: ["code_generation", "cli_delegate"]
```

`AgentComposer` only registers `CliDelegateStrategy` when `[cli_delegate].enabled = true`,
and only dispatches a step to it when the executing agent role's `capabilities` includes
`"cli_delegate"` — both conditions must hold. A step whose agent role lacks the tag still runs
through ReAct by default, or MCP when its capabilities select it, even with
`[cli_delegate]` enabled globally.

### Auth — making sure the subscription is actually used

Claude Code's own auth precedence always prefers an `ANTHROPIC_API_KEY` (or
`ANTHROPIC_AUTH_TOKEN`) present in the environment over a subscription login, even when
both exist. `CliDelegateStrategy` handles this for you: it strips both variables from the
spawned CLI's environment on every call, so your subscription login is used regardless of
whether the daemon's own environment carries an API key for its other, direct-API calls.

For a daemon or CI environment where an interactive `claude login` session isn't practical,
generate a long-lived subscription-backed token instead:

```bash
claude setup-token   # opens a one-time browser approval, prints a 1-year OAuth token
export CLAUDE_CODE_OAUTH_TOKEN=<token>
```

This is the credential Claude Code's own docs recommend for headless/CI environments — it
authenticates against your subscription and does not expire the way an interactive terminal
login's warning-then-lockout cycle does.

### Prerequisites and multi-turn behavior

Same tool installs as in [Prerequisites](#prerequisites) (`claude` or `opencode` on `PATH`). Each
plan step is a fresh, cold-spawned CLI call that resumes the prior step's conversation via a
captured session id (`claude -p <objective> --resume <session_id>` /
`opencode run --session <session_id>`) — so a multi-step plan reads as one continuous
session to the CLI, not N unrelated calls. The first turn of each plan includes the whole
plan's text so the CLI orients on the complete task; later turns send only the current step.

### Reviewing the changes of a worktree run

A plan that executes inside a git worktree (`PortalExecutionStrategy.WORKTREE`, forced whenever the plan targets a real `portal`) commits the changes of `CliDelegateStrategy` inside that worktree checkout. The daemon never writes into your live checkout before a human review. The changes reach the portal when you approve the review: `exactl review approve <branch>` merges the branch into the base branch and removes the worktree. Until then the mounted portal does not show them. Look for the files under `.exa/worktrees/<portal>/<trace_id>/` or read the diff with `exactl review show <branch>`. See [Requests, Plans and Reviews](requests-plans-reviews.md) for the review workflow.
