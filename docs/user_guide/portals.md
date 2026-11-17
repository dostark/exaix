# Portals

Add external projects as portals and work on them with agents. Part of the [Exaix User Guide](README.md).

## What a portal is

A portal is a symlink under `Portals/<alias>` that points to a directory outside your workspace, usually the checkout of one of your projects. It gives agents controlled access to that project. Exaix also keeps a short description of the project, the **context card**, at `Memory/Projects/<alias>/portal.md`.

A request that names a portal runs against the project and not against the workspace. The agent reads and writes the project files, and Exaix creates the branches, commits and reviews in the project repository. [Portal Workflows](#portal-workflows) shows what that looks like for analysis and for feature work.

## Lifecycle of a portal

1. **Add** the project with `exactl portal add <target-path> <alias>`. You can set a default branch and an execution strategy at the same time, for example `--default-branch main --execution-strategy worktree`.
1. **Look** at your portals with `exactl portal list` and `exactl portal show <alias>`. A portal whose target moved or was deleted is flagged as broken.
1. **Use** it by naming the portal in a request: `exactl request create ... --portal <alias>`. Add `--target-branch <branch>` to choose the branch the review merges into.
1. **Refresh** the context card with `exactl portal refresh <alias>` after the project changes, so the description that agents read stays current.
1. **Verify** with `exactl portal verify`, for all portals or for one, when something looks wrong.
1. **Remove** the portal with `exactl portal remove <alias>` when you no longer need it. Use `--keep-card` to leave the context card in place.

Every option of every portal command is in the [portal command reference](../cli/portal.md).

### What happens when you add a portal

1. Creates the symlink `Portals/<alias>` that points to `<target-path>`.
1. Generates the context card `Memory/Projects/<alias>/portal.md`.
1. Updates `exa.config.toml` with the portal configuration (optional per-portal keys: `default_branch` and `execution_strategy`).
1. Validates Deno permissions for the new path.
1. Restarts the daemon if it runs, or prompts for a manual restart.
1. Logs the action to the Activity Journal.

### Base branch and execution strategy

- `exactl request create --portal <alias> --target-branch <branch>` stores `target_branch` in request/plan frontmatter and uses it as the review's merge target (`base_branch`) for portal code reviews.
- If `target_branch` is not provided, Exaix falls back to the portal's configured `default_branch` (if set), and otherwise auto-detects the repository's default branch.
- `--execution-strategy` controls how Exaix runs write-capable portal work:
  - `branch` (default): create a feature branch in the portal repo checkout.
  - `worktree`: create an isolated git worktree per execution (good for parallel requests) and record `worktree_path` on the review.

For worktree executions, Exaix also writes a discoverability pointer at `Memory/Execution/{trace-id}/worktree` (symlink when possible; `PATH.txt` fallback).

### Worktree maintenance

- `exactl git worktree list [--portal <alias>] [--repo <path>]` shows all Git worktrees for a repository (useful to locate the active execution worktree).
- `exactl git worktree prune [--portal <alias>] [--repo <path>]` prunes stale worktree metadata (useful after manual deletion or crashes).

### Verification checks

`exactl portal verify` checks that:

- Symlink exists and is valid
- Target directory exists and is readable
- Target path matches config
- Deno has necessary permissions
- Context card exists

### Safety features

- Portal removal moves context cards to `_archived/` instead of deleting
- Broken portals are detected and flagged (target moved/deleted)
- OS-specific handling:
  - **Windows:** Creates junction points if symlinks unavailable
  - **macOS:** Prompts for Full Disk Access on first portal
  - **Linux:** Checks inotify limits for filesystem watching

## Tips

- Use the `worktree` execution strategy when several requests run against one portal at the same time. Each execution gets its own checkout, so the runs do not disturb each other.
- Run `exactl git worktree prune` after you delete a worktree directory by hand or after a crash, to remove the stale metadata.
- When you move or delete a project, `exactl portal list` shows its portal as broken. Run `exactl portal verify <alias>` for the details, then fix the target or remove the portal.
- Removing a portal archives its context card in `_archived/`, so you can recover the description later.
- The first portal on macOS prompts for Full Disk Access. On Linux, Exaix checks the inotify limits for filesystem watching, and on Windows it creates a junction point if symlinks are not available.

## Post-execution verification (`portals[].verification`)

A portal may declare a `verification` block. After a plan's work is committed, Exaix runs the
configured checks in the execution worktree. When a check fails and repair attempts remain, the
truncated, redacted failure output is fed back to the model as a one-step repair plan; the daemon
then re-verifies. This is opt-in: a portal without `verification` behaves exactly as before.

Two check kinds are supported:

| Kind        | What it checks                                                 | Where it reads                                    |
| ----------- | -------------------------------------------------------------- | ------------------------------------------------- |
| `deno_task` | one Deno task in the execution worktree                        | the worktree, which holds the model-written files |
| `deno_lint` | the installed lint policy over the portal's tracked TypeScript | tracked files of the immutable target commit      |

> `portals[].verification` (post-execution checks) is unrelated to `exactl portal verify`, which is
> a read-only health check of a portal's symlink, target and permissions. It is also distinct from
> `ConfigService.updatePortalVerification`, which records a `last_verified` timestamp.

```toml
[[portals]]
alias = "MyWebsite"
target_path = "~/Dev/MyWebsite"

[portals.verification]
max_repair_attempts = 2      # default 2; hard cap 5
check_timeout_ms = 300000    # default 300000 (5 min)
output_max_chars = 4000      # default 4000

[[portals.verification.checks]]
kind = "deno_lint"                             # installed lint policy
policy = "unslop"                              # default "unslop"; a directory below the policy root
include = ["src/**/*.ts", "packages/**/*.tsx"] # default: every TS/TSX/MTS/CTS file
exclude = ["node_modules/**", "vendor/**"]     # default

[[portals.verification.checks]]
kind = "deno_task"
task = "test"                # test | lint | check | fmt
path = "."                   # relative to the worktree, default "."
args = ["--allow-read=src"]  # operator flags; permission flags must be scoped (see below)
```

**Deno task checks.** Permission flags in `args` must use the scoped long form `--allow-<name>=<values>`
with a non-empty value list, for every permission (`read`, `write`, `env`, `net`, `run`, `ffi`, `sys`,
`import`). The schema rejects at config load:

- `-A` / `--allow-all` and `--fix`;
- short permission flags (`-R`, `-W`, `-N`, `-E`, `-S`, `-I`, `-P`), alone or in a cluster such as `-qA`;
- `-P` / `--permission-set`, which loads permissions from the worktree's `deno.json`, a file the model can edit;
- any bare `--allow-<name>`, or one with an empty value list.

Non-permission flags such as `--no-check`, `--parallel` or `--filter=<name>` are accepted.

**Deno lint checks.** A `deno_lint` check runs `deno lint` with the installed policy named by
`policy`. It resolves `<system.root>/<policy_root>/<policy>`, requires a regular directory with a
valid `manifest.json`, and rejects a symlink, a non-directory, a path outside the system root, and
a directory under the execution worktree or a portal root with `LintPolicyUntrusted`. The check
lists the tracked files of the immutable target commit through a strict `git ls-tree` query, applies
`include` minus `exclude`, and runs `deno lint --deny-import --config <policy>/deno.json
--rules-tags= --json` in bounded batches under one deadline. The worktree, portal files and the
network do not resolve the plugin.

The installed policy owns the rule set and the plugin. The guard streams each selected file line by
line with a bounded line prefix and checks the shared deadline before every file and chunk, so a
large file or a hostile selection cannot outlast `check_timeout_ms`. A file-level
`// deno-lint-ignore-file` directive is rejected before the host runs: the check fails with
`LintSuppressionForbidden` and no repair runs. A named line ignore reaches `deno lint` and is
reported by the policy's `unslop/no-forbidden-lint-ignore` rule, so a suppression attempt is a
finding, not a pass.

The check returns one of these categorical errors, never portal-controlled text:

| Error class                | Cause                                                                 |
| -------------------------- | --------------------------------------------------------------------- |
| `LintPolicyMissing`        | the policy directory or its manifest is absent                        |
| `LintPolicyUntrusted`      | the policy is a symlink, a non-directory, or outside the trusted root |
| `LintSuppressionForbidden` | a selected file carries `// deno-lint-ignore-file`                    |
| `LintSourceInvalid`        | a selected file is undecodable or has an invalid Git mode             |
| `LintHostFailed`           | `deno lint` failed or returned malformed JSON                         |
| `LintTimeout`              | the whole-check deadline expired                                      |
| `LintOutputLimit`          | a stdout, stderr, JSON or argv budget was exceeded                    |
| `LintGitFailed`            | a strict Git query failed                                             |

Resource knobs live in the workspace config. Every key is restart-required:

| Key                                  | Default    | Meaning                                     |
| ------------------------------------ | ---------- | ------------------------------------------- |
| `verification.lint.policy_root`      | `lint`     | trusted policy root below the system root   |
| `verification.lint.findings_limit`   | `50`       | global cap on findings kept in the snapshot |
| `verification.lint.json_max_bytes`   | `8388608`  | complete stdout budget of one lint batch    |
| `verification.lint.stderr_max_bytes` | `65536`    | complete stderr budget of one lint batch    |
| `verification.lint.batch_max_files`  | `32`       | maximum files passed to one lint child      |
| `verification.lint.git_max_bytes`    | `16777216` | maximum bytes of one strict Git query       |

Install a policy with `deno task unslop-ts:policy --out <workspace>/lint`, then deploy it through
the workspace deploy path. The installer and deploy verify every recorded file hash. A deployed
policy directory holds `unslop_engine.js`, `catalog.json`, `plugin.ts`, `deno.json` and
`manifest.json`. At run time the check applies the containment checks: a missing, symlinked or
out-of-root directory fails with `LintPolicyMissing` or `LintPolicyUntrusted`. The runner does not
re-hash the installed files. See `packages/lint-policy/README.md` for recovery.

`verification_status` is written on `execution.completed`:

| Value            | Meaning                                                                                    |
| ---------------- | ------------------------------------------------------------------------------------------ |
| `not_configured` | The plan has no portal, or the portal has no `verification` block.                         |
| `skipped`        | Configured, but nothing to verify (read-only plan, or no commit).                          |
| `passed`         | The first verification run passed.                                                         |
| `repaired`       | A run after at least one repair attempt passed.                                            |
| `failed`         | Checks still fail after `max_repair_attempts`, or a repair step threw.                     |
| `error`          | A check could not run (timeout, spawn failure, path outside the worktree). No repair runs. |

For a configured deno_lint run, Exaix journals exactly one terminal
`execution.verification.lint_findings` snapshot. It carries the request and run ids, the attempt, the
verified commit, each lint check's outcome, and every retained finding as `file`, `line` and
`rule`. `total` is exact when every check completed; otherwise it is `null` and the review reports
`lint: findings count incomplete`. The snapshot keeps at most `findings_limit` findings and marks
`truncated` when the exact total is larger. The matching `execution.completed` row carries the same
`verification_run_id`.

Security: verification executes model-written code without a human in the loop, with a cleared
environment (the `ChildEnvPolicy` allowlist plus `DENO_DIR`, `DENO_NO_UPDATE_CHECK` and
`XDG_CACHE_HOME`). Proxy variables are not forwarded, so dependencies must be pre-cached in
`DENO_DIR` (for example with `deno install`). `fmt` always runs with `--check`. Failure output is
redacted against the daemon's known secret values and framed as untrusted data. A check's output is
bounded in memory while it is read: the daemon keeps only the tail (`output_max_chars` plus a small
redaction margin), so a check that prints without limit cannot exhaust the daemon. ANSI escapes and
control characters are stripped before the output enters the repair prompt. The worst-case wall
clock is `(1 + max_repair_attempts) × N_checks × check_timeout_ms`. A deno_lint check also keeps its
stdout, stderr, file and argv bounds, so a hostile portal cannot make the daemon buffer unbounded
data.

`exactl review show` prints `verification_status` for the review's trace, and adds a warning line
when it is `failed` or `error`, so a reviewer sees a failed verification before approving. For an
deno_lint run it joins the one exact `file:line rule` list of that run and commit, capped by
`findings_limit`. A clean run prints `lint: no findings remain`; a failed run prints the exact
count and the capped entries plus any `more not listed` note; a missing or mismatched snapshot
prints `lint: lint details unavailable`.

The agent `run_deno_task` tool also stops after `DEFAULT_DENO_TASK_TOOL_TIMEOUT_MS` (300 s) where it
previously had no timeout.

## Portal Workflows

Portals enable agents to work directly in external project repositories (e.g., `~/git/MyProject`) instead of the deployed workspace. This ensures git operations, feature branches, and reviews track actual source code changes in the correct repositories.

### How Portal Execution Works

When you submit a request targeting a portal:

1. **Execution Environment**: Agent runs in portal workspace (e.g., `~/git/MyProject`)
1. **Git Operations**: Branches and commits created in portal's repository
1. **File Access**: Agent can read/write portal files directly
1. **Reviews**: Track actual code changes in portal repository

### Cleanup & lifecycle notes

- **Portals:** A portal is a stable symlink entry under `Portals/`. It is not auto-removed; use `exactl portal remove <alias>` when you no longer want it mounted.
- **Reviews:** Review records remain for audit/history, but their _working artifacts_ (branches/worktrees) may be cleaned up as part of approve/reject.
- **Worktree execution:** Some portal runs use an isolated Git worktree checkout. A pointer is recorded at `Memory/Execution/{trace-id}/worktree` pointing to the worktree directory.
  - **Approve/Reject:** Worktree checkout + pointer are removed to avoid stale worktrees.
  - **Approve:** The feature branch is deleted after cleanup.
  - **Merge conflict:** Exaix aborts the merge (best effort) and removes the worktree checkout + pointer, but keeps the feature branch for manual conflict resolution.

### Code Analysis with Portal

Read-only agents (like `code-analyst`) execute in portal workspace but don't create git branches. Instead, they produce analysis artifacts stored in `Memory/Execution/`:

```bash
# Add portal to workspace
exactl portal add ~/git/MyProject my-project

# Submit analysis request (read-only agent)
exactl request create --portal my-project "Analyze src/ architecture"

# Review results (artifact, not git review)
exactl review list
exactl review show artifact-<id>

# Approve the analysis
exactl review approve artifact-<id>
```

**Analysis Workflow:**

- Agent reads portal files for context
- No git branch created (read-only operation)
- Analysis stored as markdown artifact with frontmatter status
- Review via unified `exactl review` command

### Feature Development with Portal

Write-capable agents (like `feature-developer`) create feature branches in the portal repository:

```bash
# Submit feature request (write-capable agent)
exactl request create --portal my-project --agent feature-developer "Add user authentication"

# Review changes in portal repository
cd ~/git/MyProject
git log --oneline  # Shows feature branch
git diff main      # Shows actual code changes

# Or review via Exaix
exactl review list
exactl review show <review-id>

# Approve and merge
exactl review approve <review-id>
```

**Development Workflow:**

- Agent creates feature branch in portal's .git/
- Code modifications happen in portal workspace
- Review shows only modified files (not entire workspace)
- Feature branch ready for review in source repository

### Portal Git Integration

**Automatic Behaviors:**

- ✅ Write agents create feature branches in portal repository
- ✅ Reviews reference portal repo, not deployed workspace
- ✅ File modifications happen in portal workspace
- ✅ Git history maintained in correct repository

**Manual Steps:**

- Add portals: `exactl portal add /path/to/repo alias`
- Review changes: `exactl review show <id>`
- Approve changes: `exactl review approve <id>`
- Merge feature branch in portal repo after execution

### Troubleshooting Portal Issues

#### Issue: Portal not found

```bash
# Verify portal exists
exactl portal list

# Check portal configuration
exactl portal show my-project
```

#### Issue: Git operations in wrong repository

```bash
# Verify portal has .git directory
ls -la ~/git/MyProject/.git

# Check review repository reference
exactl review show <id> | grep repository
```

#### Issue: Review shows all workspace files

```bash
# This indicates portal execution didn't work
# Verify request used --portal flag
exactl request create --portal my-project "..."

# Check that portal path is correct
exactl portal show my-project
```

#### Problems when adding a portal

- **Target path does not exist.** `exactl portal add` stops with "Target path does not exist" and changes nothing. Check that the path exists and that you can access it.
- **Alias already exists.** Use a different alias, or remove the existing portal first.
- **Invalid alias characters.** Use only letters, numbers, dashes and underscores. The alias rules below list the rest.
- **Permission denied on macOS.** The error says "Full Disk Access required". Open System Settings, then Privacy & Security, then Full Disk Access, and enable it for your terminal.
- **inotify limit on Linux.** A warning says that the file watch limit may be insufficient for large portals. Raise the limit with `echo fs.inotify.max_user_watches=524288 | sudo tee -a /etc/sysctl.conf && sudo sysctl -p`.

**Alias validation rules:**

- Must contain only alphanumeric characters, dashes, and underscores
- Cannot start with a number
- Cannot be empty
- Cannot use reserved names: `System`, `Workspace`, `Memory`, `Blueprints`, `Active`, `Archive`
- Maximum length: 50 characters

### Migration from Workspace Execution

**Before (workspace execution):**

```bash
exactl request create "Analyze code"
# Result: Operates in ~/Exaix
```

**After (portal execution - recommended):**

```bash
exactl request create --portal my-project "Analyze code"
# Result: Operates in ~/git/MyProject
```

### Portal Knowledge Gathering

Exaix automatically analyzes every portal codebase and stores the results in
`Memory/Projects/{alias}/knowledge.json`. This gives agents structured, up-to-date
context about the project without reading every file on each request.

**What is gathered:**

| Category            | Examples                                            |
| ------------------- | --------------------------------------------------- |
| Directory census    | File count, extension breakdown, top-level folders  |
| Key files           | Entry points, `package.json`, `deno.json`, configs  |
| Dependencies        | Runtime deps, dev deps, package manager             |
| Code conventions    | Naming patterns, test file naming, style hints      |
| Architecture layers | `src/`, `tests/`, `docs/` inference                 |
| Exported symbols    | Public API types and functions (TS/JS portals only) |

**When does analysis run?**

- Automatically on `portal add` and `portal refresh` (when `auto_analyze_on_mount = true`).
- Automatically before each request execution, invalidated primarily by comparing the portal's
  live git commit SHA against the SHA stored at last analysis — an unchanged SHA skips
  re-analysis entirely, regardless of elapsed time. On a SHA mismatch, a small number of changed
  files triggers a cheaper incremental re-analysis; a large number triggers a full one.
  `staleness_hours` (below) is a time-based fallback used only when the portal isn't a git repo
  or its `HEAD` can't be resolved.
- Manually on demand with `exactl portal knowledge analyze <alias>`.

**Modes:**

| Mode       | Speed  | Detail | Requires LLM |
| ---------- | ------ | ------ | ------------ |
| `quick`    | Fast   | Low    | No           |
| `standard` | Medium | High   | No           |
| `deep`     | Slow   | Full   | Optional     |

**CLI commands:**

```bash
# Run analysis manually (default: quick mode)
exactl portal knowledge analyze MyProject

# Force deep analysis, ignore staleness
exactl portal knowledge analyze MyProject --mode deep --force

# Display gathered knowledge (human-readable)
exactl portal knowledge show MyProject

# Display as machine-readable JSON
exactl portal knowledge show MyProject --json
```

**Configuration (`[portal_knowledge]` in `exa.config.toml`):**

```toml
[portal_knowledge]
auto_analyze_on_mount = false     # Analyze on portal add/refresh (opt-in)
default_mode          = "quick"   # quick | standard | deep
quick_scan_limit      = 200       # Max files read in quick mode
max_files_to_read     = 50        # Hard cap across all strategies
staleness_hours       = 168       # Fallback TTL for non-git portals or when HEAD can't be resolved (default: 1 week)
use_llm_inference     = true      # Allow LLM calls in deep mode
ignore_patterns       = ["node_modules", ".git", "dist", "build"]
enable_symbol_level_dependency_graph = false  # Enterprise only: symbol-level reference edges (opt-in)
```

**Where is it stored?**

Knowledge snapshots are saved at `Memory/Projects/{alias}/knowledge.json`. You can
inspect them directly or via `exactl portal knowledge show <alias> --json`.

**Supported languages for symbol extraction:**

The portal knowledge pipeline produces a `symbolMap` — a ranked index of exported
symbols. The languages available depend on edition:

| Edition    | Languages                                                                                          |
| ---------- | -------------------------------------------------------------------------------------------------- |
| Solo       | TypeScript, JavaScript (via `deno doc`), **Python** (via tree-sitter)                              |
| Team       | Solo baseline + extended set: Rust, Go, Java (via tree-sitter)                                     |
| Enterprise | Same as Team, plus symbol-level reference edges when `enable_symbol_level_dependency_graph = true` |
| None       | All other languages yield an empty map (fail-soft, no error)                                       |

**Symbol-level reference edges** (`query_symbol_references`) answer "who calls this symbol" rather than "which file imports which file". The Solo-tier `find_dependents` tool answers the same question when you pass the file path and the symbol name joined with `#`. Pass a bare file path to it instead for file-level dependents. Symbol endpoints cover Go, Java, Rust, TypeScript, JavaScript, and Python portals. Both `find_dependents` and `query_relationships` accept a portal-qualified `@<alias>/<path>` endpoint as well as a portal-relative one. They are opt-in and Enterprise only, and the artifact that delivers them is the **Team build run with `EXAIX_EDITION=enterprise`** — the separate `build:enterprise` binary is still a scaffold with no runtime, so a green `build:enterprise` does not mean this feature works. Matching is name-and-scope based rather than semantic, and it resolves only against the capped symbol map, so treat the graph as a useful subset rather than a complete call graph. The tool is visible to every paid-edition MCP client and returns an empty list, not an error, on a portal analyzed without the symbol graph.

Python extraction uses a local tree-sitter WASM grammar — no network access, no
native code (`--allow-ffi` not required). Extended-language extractors (Team)
follow the same pattern. Symbol extraction is primary-language-scoped: only the
dominant language's symbols are mapped in mixed-language portals.

**Why analyze once instead of reading the codebase every request?** The gathered
knowledge is computed once and queried cheaply on every subsequent request instead
of re-reading files each time. Relationship data (imports, layer membership) is
built from a resolved module graph rather than text search, so it correctly follows
import aliases and re-exports, and supports reverse-dependency questions ("what
depends on this file?") that would otherwise require opening every file in the
portal. Architecture and convention summaries reach the agent automatically as part
of its request context, without it needing to ask for them.

**Known limitations:**

- The background re-analysis triggered when a cached snapshot turns out to be stale
  does not block or update the request that triggered it — that request still sees
  the stale snapshot; only a later request benefits from the refresh.
- Staleness detection compares against the portal's last committed `HEAD`, so
  uncommitted working-tree changes are not detected as staleness.
- `symbolMap` entries currently store an absolute file path while every other path
  field in the knowledge snapshot is portal-relative — an inconsistency, not yet fixed.
- `architectureOverview` can come back empty when analysis ran in `quick` mode; use
  `standard` or `deep` mode if you need it populated.
- Most gathered categories (dependencies, tech stack, directory stats, git history,
  licenses, vulnerabilities) can only be inspected via `exactl portal knowledge show
  <alias>` or by reading `knowledge.json` directly — they have no dedicated
  on-demand query surface for an agent today. Only exported symbols and file
  relationships do.
- **Fixed history:** earlier versions of the relationship-graph builder traced only
  a portal's first 5 entrypoints, severely undercounting large monorepos. This is
  fixed — the limit is now a much higher, configurable default (500), with a
  visible warning logged if a portal's entrypoint count ever exceeds it.

## Portal knowledge inclusion

By default, Exaix includes the existing fixed portal summary in a planning prompt.
Set `portal_knowledge.inclusion` to `"adaptive"` to select a small core of portal
facts and then add entries ranked for the request's task, tags, and referenced
files. This uses the analyzed portal knowledge snapshot; it does not analyze
source files during prompt assembly. The default `"summary"` path preserves its
existing prompt content.

```toml
[portal_knowledge]
inclusion = "adaptive"       # default: "summary"
max_tokens = 3000           # existing hard cap on this knowledge segment
core_max_tokens = 512       # cap for the core within the available section
relevant_max_entries = 20   # maximum ranked entries after the core
```

The portal directory listing uses the same prompt-budget section. Adaptive
knowledge gets at most the smaller of `max_tokens` and the section's remaining
tokens after that listing. If no tokens remain, Exaix adds no adaptive knowledge
segment. A selection that does run records `portal.knowledge.selection_applied`
on the request trace with selected and finally included token counts. In the
adaptive-context cutover fixture, a request naming `PaymentRouter` kept that symbol
while the included knowledge segment used 76–77 adaptive tokens versus 85
summary tokens across focused runs. The saving depends on the request and portal.

Two read-only Solo ReAct tools let an authorized role inspect the cached graph
when the prompt does not contain enough detail:

| Tool                      | Input                                                                        | Bound and result                                                                                                                      |
| ------------------------- | ---------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------- |
| `query_symbols`           | Optional `name` substring, `kind`, exact portal-relative `file`, and `limit` | Returns ranked cached symbol records; at most 50 records and 2,000 result tokens. Each symbol's documentation is capped at 40 tokens. |
| `get_module_dependencies` | Portal-relative `path`; optional `depth` (default 1, maximum 3)              | Traverses cached internal imports forward; at most 50 edges and 2,000 result tokens.                                                  |

Both tools require cached knowledge for the current portal. They return an error
if the execution root is not that portal or the cache is missing or mismatched;
they never trigger a new analysis. Use `standard` or `deep` portal analysis to
populate AST symbols. The `query_symbols` file filter compares the stored
`symbolMap.file` value exactly; current analysis may store an absolute file URL,
so use name or kind filters if a portal-relative file filter finds nothing.
To allow the tools in a ReAct agent role, list their IDs in its
frontmatter:

```yaml
capabilities: ["react"]
permitted_tools:
  - query_symbols
  - get_module_dependencies
```

`permitted_tools` controls what the ReAct prompt shows, what native
provider tool-call definitions the model receives, and what the
execution loop will dispatch. A model-supplied call to an unlisted tool is
denied before `ToolRegistry` runs it. The Team MCP export
uses the same `query_symbols` name. It has its own registration and
permission surface.
