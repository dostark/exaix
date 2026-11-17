# CLI Basics

Installing exactl, the command grammar, global options, exit codes, confirmations, output formats and a quick reference. Part of the [Exaix User Guide](README.md).

## CLI Reference

### Installation

The Exaix CLI (`exactl`) provides a comprehensive interface for managing plans, reviews, git operations, the daemon, and portals.

**Automatic Installation (recommended):**

The deploy script automatically installs `exactl` globally. You just need to ensure `~/.deno/bin` is in your PATH:

```bash
# Add to your ~/.bashrc or ~/.zshrc (one-time setup)
echo 'export PATH="$HOME/.deno/bin:$PATH"' >> ~/.bashrc
source ~/.bashrc

# Verify installation
exactl --help
```

**Manual Installation:**

If you need to reinstall or the automatic installation failed:

```bash
# From your Exaix workspace
cd ~/Exaix

# Install globally with config (required for import map resolution)
deno install --global --allow-all --config deno.json -n exactl apps/exactl/main.ts

# For Deno 1.x (older versions)
# deno install --allow-all --config deno.json -n exactl apps/exactl/main.ts
```

**Alternative: Use via task runner (no global install):**

```bash
cd ~/Exaix
deno task cli <command>

# Examples:
deno task cli daemon status
deno task cli plan list
```

**Verify CLI is working:**

```bash
# Check exactl is accessible
exactl --help

# Check daemon status
exactl daemon status
```

### Command Grammar

Every `exactl` command follows one grammar:

```text
exactl <noun> [<sub-noun>] <verb> [<id>…] [flags]
```

A noun is an Exaix entity, such as `request`, `plan` or `skill`. A verb comes from one closed set, such as
`list`, `show`, `create`, `approve`, `reject`, `cancel` and `run`. A command never glues a verb to a noun, so a
bulk decision is `exactl plan approve --all` and not a separate leaf. The 20 root commands form four groups:

| Group       | Roots                                                        |
| ----------- | ------------------------------------------------------------ |
| Work        | `request`, `plan`, `review`, `flow`, `approval`              |
| Definitions | `blueprint`, `skill`, `portal`, `memory`, `model`            |
| Operations  | `daemon`, `log`, `git`, `mcp`, `config`, `eval`, `dashboard` |
| System      | `version`, `doctor`, `completion`                            |

Run `exactl <noun> --help` to list the verbs of a noun. A request starts with
`exactl request create "<description>"`, and `exactl flow run <flow-id> "<description>"` starts one through a
named flow. `exactl request watch` follows one, and `exactl request cancel <request-id>` stops a request that
has not started executing.

**Removed paths.** A hard cut replaced the older spellings. Each removed path exits with code 2 and prints
the command that replaces it on one line. The
[CHANGELOG](../CHANGELOG.md) lists every removed path next to its replacement.

**What waits for a human.** `exactl approval list` shows every pending human decision from all eight sources,
oldest first, with the exact command that decides each row. A source that takes longer than 30 seconds is skipped with a notice on stderr, and the command ends after it printed the other rows. See
[Approval Commands](security-and-safety.md#approval-commands---resolve-wait-states-and-tool-confirmations) for the `approval` verbs.

### Command Summary

The table lists every `exactl` command with its summary. It is generated from the command tree, and each row links to the page of its noun in the [CLI reference](../cli/index.md), which lists the options, examples and exit codes. Run `deno task docs:cli` after you change a command.

<!-- exactl-reference:start -->

| Command                            | Summary                                             | Page                                                        |
| ---------------------------------- | --------------------------------------------------- | ----------------------------------------------------------- |
| `exactl request create`            | Create a request for an agent or a flow             | [request](../cli/request.md#exactl-request-create)          |
| `exactl request list`              | List pending requests                               | [request](../cli/request.md#exactl-request-list)            |
| `exactl request show`              | Show the details of one request                     | [request](../cli/request.md#exactl-request-show)            |
| `exactl request watch`             | Follow the live events of a request                 | [request](../cli/request.md#exactl-request-watch)           |
| `exactl request analyze`           | Analyze the intent of a request                     | [request](../cli/request.md#exactl-request-analyze)         |
| `exactl request cancel`            | Cancel a pending request                            | [request](../cli/request.md#exactl-request-cancel)          |
| `exactl request clarify`           | Answer the clarification questions of a request     | [request](../cli/request.md#exactl-request-clarify)         |
| `exactl request inspect`           | Inspect the captured context of a trace             | [request](../cli/request.md#exactl-request-inspect)         |
| `exactl plan list`                 | List plans awaiting review                          | [plan](../cli/plan.md#exactl-plan-list)                     |
| `exactl plan show`                 | Show the details of one plan                        | [plan](../cli/plan.md#exactl-plan-show)                     |
| `exactl plan approve`              | Approve plans and move them to the active workspace | [plan](../cli/plan.md#exactl-plan-approve)                  |
| `exactl plan reject`               | Reject a plan with a reason                         | [plan](../cli/plan.md#exactl-plan-reject)                   |
| `exactl plan revise`               | Request a revision with review comments             | [plan](../cli/plan.md#exactl-plan-revise)                   |
| `exactl plan amendment list`       | List plans awaiting amendment approval              | [plan](../cli/plan.md#exactl-plan-amendment-list)           |
| `exactl plan amendment show`       | Show the details of proposed amendments             | [plan](../cli/plan.md#exactl-plan-amendment-show)           |
| `exactl plan amendment approve`    | Approve plan amendments                             | [plan](../cli/plan.md#exactl-plan-amendment-approve)        |
| `exactl plan amendment reject`     | Reject a plan amendment with a reason               | [plan](../cli/plan.md#exactl-plan-amendment-reject)         |
| `exactl review list`               | List the pending reviews                            | [review](../cli/review.md#exactl-review-list)               |
| `exactl review show`               | Show the details and the diff of a review           | [review](../cli/review.md#exactl-review-show)               |
| `exactl review approve`            | Approve a review and merge its change               | [review](../cli/review.md#exactl-review-approve)            |
| `exactl review reject`             | Reject a review with a reason                       | [review](../cli/review.md#exactl-review-reject)             |
| `exactl approval list`             | List every pending human decision                   | [approval](../cli/approval.md#exactl-approval-list)         |
| `exactl approval show`             | Show one pending approval                           | [approval](../cli/approval.md#exactl-approval-show)         |
| `exactl approval approve`          | Approve a wait state or a tool confirmation         | [approval](../cli/approval.md#exactl-approval-approve)      |
| `exactl approval reject`           | Reject a wait state or deny a tool confirmation     | [approval](../cli/approval.md#exactl-approval-reject)       |
| `exactl approval amend`            | Mark a wait state as amended                        | [approval](../cli/approval.md#exactl-approval-amend)        |
| `exactl approval expire`           | Expire a pending wait state                         | [approval](../cli/approval.md#exactl-approval-expire)       |
| `exactl approval cancel`           | Cancel a pending wait state                         | [approval](../cli/approval.md#exactl-approval-cancel)       |
| `exactl git worktree list`         | List the git worktrees                              | [git](../cli/git.md#exactl-git-worktree-list)               |
| `exactl git worktree prune`        | Prune stale git worktree metadata                   | [git](../cli/git.md#exactl-git-worktree-prune)              |
| `exactl git branch list`           | List the branches                                   | [git](../cli/git.md#exactl-git-branch-list)                 |
| `exactl git status`                | Show the repository status                          | [git](../cli/git.md#exactl-git-status)                      |
| `exactl git log`                   | Search the commit log by trace id                   | [git](../cli/git.md#exactl-git-log)                         |
| `exactl daemon start`              | Start the Exaix daemon                              | [daemon](../cli/daemon.md#exactl-daemon-start)              |
| `exactl daemon stop`               | Stop the Exaix daemon                               | [daemon](../cli/daemon.md#exactl-daemon-stop)               |
| `exactl daemon restart`            | Restart the Exaix daemon                            | [daemon](../cli/daemon.md#exactl-daemon-restart)            |
| `exactl daemon status`             | Check whether the daemon runs                       | [daemon](../cli/daemon.md#exactl-daemon-status)             |
| `exactl daemon logs`               | Show the daemon logs                                | [daemon](../cli/daemon.md#exactl-daemon-logs)               |
| `exactl portal add`                | Add a portal to an external project                 | [portal](../cli/portal.md#exactl-portal-add)                |
| `exactl portal list`               | List the configured portals                         | [portal](../cli/portal.md#exactl-portal-list)               |
| `exactl portal show`               | Show the details of one portal                      | [portal](../cli/portal.md#exactl-portal-show)               |
| `exactl portal remove`             | Remove a portal                                     | [portal](../cli/portal.md#exactl-portal-remove)             |
| `exactl portal verify`             | Verify the integrity of portals                     | [portal](../cli/portal.md#exactl-portal-verify)             |
| `exactl portal refresh`            | Refresh the context card of a portal                | [portal](../cli/portal.md#exactl-portal-refresh)            |
| `exactl portal knowledge analyze`  | Analyze the codebase of a portal                    | [portal](../cli/portal.md#exactl-portal-knowledge-analyze)  |
| `exactl portal knowledge show`     | Show the gathered knowledge of a portal             | [portal](../cli/portal.md#exactl-portal-knowledge-show)     |
| `exactl config get`                | Print the effective value of a key                  | [config](../cli/config.md#exactl-config-get)                |
| `exactl config set`                | Set a key                                           | [config](../cli/config.md#exactl-config-set)                |
| `exactl config unset`              | Reset a key to its default                          | [config](../cli/config.md#exactl-config-unset)              |
| `exactl config history`            | Show the override history of a key                  | [config](../cli/config.md#exactl-config-history)            |
| `exactl config rollback`           | Revert a key to an earlier value                    | [config](../cli/config.md#exactl-config-rollback)           |
| `exactl config edit`               | Edit the overrides in your editor                   | [config](../cli/config.md#exactl-config-edit)               |
| `exactl config block add`          | Block a key pattern from MCP writes                 | [config](../cli/config.md#exactl-config-block-add)          |
| `exactl config block remove`       | Remove a blocklist pattern                          | [config](../cli/config.md#exactl-config-block-remove)       |
| `exactl config block list`         | List the blocklist patterns                         | [config](../cli/config.md#exactl-config-block-list)         |
| `exactl config compact`            | Compact the override history                        | [config](../cli/config.md#exactl-config-compact)            |
| `exactl config validate`           | Validate the configuration                          | [config](../cli/config.md#exactl-config-validate)           |
| `exactl config show`               | Show the effective configuration                    | [config](../cli/config.md#exactl-config-show)               |
| `exactl config diff`               | Show the keys that differ from the defaults         | [config](../cli/config.md#exactl-config-diff)               |
| `exactl config lock add`           | Lock a key against writes                           | [config](../cli/config.md#exactl-config-lock-add)           |
| `exactl config lock remove`        | Unlock a key                                        | [config](../cli/config.md#exactl-config-lock-remove)        |
| `exactl config lock list`          | List the locked keys                                | [config](../cli/config.md#exactl-config-lock-list)          |
| `exactl config profile use`        | Set the active profile                              | [config](../cli/config.md#exactl-config-profile-use)        |
| `exactl config profile list`       | List the profiles                                   | [config](../cli/config.md#exactl-config-profile-list)       |
| `exactl blueprint create`          | Create a new agent blueprint                        | [blueprint](../cli/blueprint.md#exactl-blueprint-create)    |
| `exactl blueprint list`            | List the agent blueprints                           | [blueprint](../cli/blueprint.md#exactl-blueprint-list)      |
| `exactl blueprint show`            | Show the details of one blueprint                   | [blueprint](../cli/blueprint.md#exactl-blueprint-show)      |
| `exactl blueprint validate`        | Validate a blueprint file                           | [blueprint](../cli/blueprint.md#exactl-blueprint-validate)  |
| `exactl blueprint edit`            | Edit a blueprint in your editor                     | [blueprint](../cli/blueprint.md#exactl-blueprint-edit)      |
| `exactl blueprint remove`          | Remove a blueprint                                  | [blueprint](../cli/blueprint.md#exactl-blueprint-remove)    |
| `exactl blueprint deprecate`       | Retire a blueprint without deleting it              | [blueprint](../cli/blueprint.md#exactl-blueprint-deprecate) |
| `exactl flow list`                 | List the available flows                            | [flow](../cli/flow.md#exactl-flow-list)                     |
| `exactl flow show`                 | Show the details of one flow                        | [flow](../cli/flow.md#exactl-flow-show)                     |
| `exactl flow run`                  | Create a request that runs a flow                   | [flow](../cli/flow.md#exactl-flow-run)                      |
| `exactl flow validate`             | Validate a flow definition                          | [flow](../cli/flow.md#exactl-flow-validate)                 |
| `exactl flow bindings`             | Resolve the model bindings of every step            | [flow](../cli/flow.md#exactl-flow-bindings)                 |
| `exactl memory list`               | Show the memory banks summary                       | [memory](../cli/memory.md#exactl-memory-list)               |
| `exactl memory search`             | Search the memory banks                             | [memory](../cli/memory.md#exactl-memory-search)             |
| `exactl memory project list`       | List the project memories                           | [memory](../cli/memory.md#exactl-memory-project-list)       |
| `exactl memory project show`       | Show the memory of one project                      | [memory](../cli/memory.md#exactl-memory-project-show)       |
| `exactl memory execution list`     | List the execution history                          | [memory](../cli/memory.md#exactl-memory-execution-list)     |
| `exactl memory execution show`     | Show one recorded execution                         | [memory](../cli/memory.md#exactl-memory-execution-show)     |
| `exactl memory learning remove`    | Remove a global learning                            | [memory](../cli/memory.md#exactl-memory-learning-remove)    |
| `exactl memory index rebuild`      | Rebuild the memory search indices                   | [memory](../cli/memory.md#exactl-memory-index-rebuild)      |
| `exactl memory proposal list`      | List the pending memory proposals                   | [memory](../cli/memory.md#exactl-memory-proposal-list)      |
| `exactl memory proposal show`      | Show one pending proposal                           | [memory](../cli/memory.md#exactl-memory-proposal-show)      |
| `exactl memory proposal approve`   | Approve pending proposals                           | [memory](../cli/memory.md#exactl-memory-proposal-approve)   |
| `exactl memory proposal reject`    | Reject a pending proposal                           | [memory](../cli/memory.md#exactl-memory-proposal-reject)    |
| `exactl dashboard`                 | Open the interactive dashboard                      | [dashboard](../cli/dashboard.md)                            |
| `exactl mcp serve`                 | Start the MCP server                                | [mcp](../cli/mcp.md#exactl-mcp-serve)                       |
| `exactl mcp tool list`             | List the tools of an external MCP server            | [mcp](../cli/mcp.md#exactl-mcp-tool-list)                   |
| `exactl mcp tool call`             | Call one tool of an external MCP server             | [mcp](../cli/mcp.md#exactl-mcp-tool-call)                   |
| `exactl log list`                  | Query the activity journal                          | [log](../cli/log.md#exactl-log-list)                        |
| `exactl log wait`                  | Wait for a journal event                            | [log](../cli/log.md#exactl-log-wait)                        |
| `exactl log verify`                | Verify the journal hash chain                       | [log](../cli/log.md#exactl-log-verify)                      |
| `exactl log cost`                  | Show the cost of the LLM calls                      | [log](../cli/log.md#exactl-log-cost)                        |
| `exactl model list`                | List the registry models                            | [model](../cli/model.md#exactl-model-list)                  |
| `exactl model refresh`             | Refresh the Team model catalog                      | [model](../cli/model.md#exactl-model-refresh)               |
| `exactl model use`                 | Set the provider and its default model              | [model](../cli/model.md#exactl-model-use)                   |
| `exactl model candidates`          | Curate the model candidate lists                    | [model](../cli/model.md#exactl-model-candidates)            |
| `exactl model route explain`       | Explain the routing of a request                    | [model](../cli/model.md#exactl-model-route-explain)         |
| `exactl model route validate`      | Validate a routing policy file                      | [model](../cli/model.md#exactl-model-route-validate)        |
| `exactl version`                   | Show the binary and workspace schema versions       | [version](../cli/version.md)                                |
| `exactl doctor`                    | Check the health of the installation                | [doctor](../cli/doctor.md)                                  |
| `exactl completion bash`           | Print the bash completion script                    | [completion](../cli/completion.md#exactl-completion-bash)   |
| `exactl completion fish`           | Print the fish completion script                    | [completion](../cli/completion.md#exactl-completion-fish)   |
| `exactl completion zsh`            | Print the zsh completion script                     | [completion](../cli/completion.md#exactl-completion-zsh)    |
| `exactl skill list`                | List skills                                         | [skill](../cli/skill.md#exactl-skill-list)                  |
| `exactl skill show`                | Show a skill                                        | [skill](../cli/skill.md#exactl-skill-show)                  |
| `exactl skill match`               | Match skills for a request                          | [skill](../cli/skill.md#exactl-skill-match)                 |
| `exactl skill derive`              | Derive a draft skill from learnings                 | [skill](../cli/skill.md#exactl-skill-derive)                |
| `exactl skill create`              | Create a draft skill                                | [skill](../cli/skill.md#exactl-skill-create)                |
| `exactl skill approve`             | Approve a reviewed skill revision                   | [skill](../cli/skill.md#exactl-skill-approve)               |
| `exactl skill deprecate`           | Take a skill out of matching                        | [skill](../cli/skill.md#exactl-skill-deprecate)             |
| `exactl skill revisions`           | List the stored revisions of a skill                | [skill](../cli/skill.md#exactl-skill-revisions)             |
| `exactl skill usage`               | Show the skill usage of one trace                   | [skill](../cli/skill.md#exactl-skill-usage)                 |
| `exactl skill validate`            | Validate the skill roots                            | [skill](../cli/skill.md#exactl-skill-validate)              |
| `exactl eval run`                  | Run evaluation scenarios                            | [eval](../cli/eval.md#exactl-eval-run)                      |
| `exactl eval history`              | Query the evaluation history                        | [eval](../cli/eval.md#exactl-eval-history)                  |
| `exactl eval compare`              | Compare two evaluation runs                         | [eval](../cli/eval.md#exactl-eval-compare)                  |
| `exactl eval report`               | Print an evaluation report view                     | [eval](../cli/eval.md#exactl-eval-report)                   |
| `exactl eval calibration generate` | Capture judge calls for calibration                 | [eval](../cli/eval.md#exactl-eval-calibration-generate)     |
| `exactl eval calibration score`    | Score judge agreement over captured evidence        | [eval](../cli/eval.md#exactl-eval-calibration-score)        |

<!-- exactl-reference:end -->

### Global Options and the Output Contract

Six options work on every `exactl` command, before or after the command. `exactl -o json plan list` and `exactl plan list -o json` are the same command.

| Option                  | Meaning                                                                             |
| ----------------------- | ----------------------------------------------------------------------------------- |
| `-o, --output <format>` | `table`, `json`, `jsonl`, `md` or `text`. Each command has its own default.         |
| `--json`                | The same as `-o json`. It cannot be combined with another `-o` format.              |
| `-q, --quiet`           | Prints only the ids in a human format. It has no effect on `json` and `jsonl`.      |
| `--no-color`            | Turns colors off. A non-empty `NO_COLOR` variable does the same.                    |
| `--no-input`            | Never asks a question. A command that needs input fails with exit code 2.           |
| `-y, --yes`             | Confirms a destructive action without a prompt (see [Confirmation](#confirmation)). |

**Data on stdout, messages on stderr.** A command prints its data, and only its data, on stdout. Progress lines, notices and errors go to stderr. This makes `exactl -o json plan list | jq` safe. In a machine format (`-o json`, `-o jsonl` or `--json`) a failure prints one line on stderr and ends with its exit code:

```json
{ "error": { "code": "NOT_FOUND", "message": "Plan not found: plan-9" } }
```

**Output kinds.** Every command prints one of five kinds of output.

| Kind       | What it prints                                                                                                  |
| ---------- | --------------------------------------------------------------------------------------------------------------- |
| Collection | Rows: a table for people, a JSON array, or JSON lines. Every `list` command is a collection.                    |
| Item       | One entity: a text block for people, one JSON object. Every `show` command is an item.                          |
| Mutation   | The result of a change: one line on stderr, and the changed entity with `-o json`.                              |
| Stream     | Events over time as JSON lines, for example `exactl request watch`.                                             |
| Protocol   | Owns stdout or the terminal: `dashboard`, `mcp serve`, `daemon logs`, `eval report` and the completion scripts. |

**Editors need a terminal.** `exactl config edit` and `exactl blueprint edit` open `$EDITOR` and wait for it. Without a terminal on standard input and standard error, or with `--no-input`, they fail with exit code 2 before the editor starts, so a script never waits for an editor that nobody can use. Edit the file directly in a script.

**A failure is not a journal event.** A failure prints its message on stderr (in a machine format, the JSON error above) and ends with its exit code, and the root error handler writes no row for it. A script reads the exit code to learn that a command failed. The journal still holds the events that a command wrote before it failed, and the consent of a confirming command (see [Confirmation](#confirmation)).

The [CLI reference](../cli/index.md) states the kind, the options, the examples and the exit codes of every command. It is generated from the same records as `exactl <command> --help`.

### Exit Codes

Every `exactl` command ends with one of these codes, so a script can tell a missing item from a conflict or a timeout.

| Code | Name                 | Meaning                                                                                                                                                                                                                  |
| ---- | -------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| 0    | `OK`                 | The command succeeded. A warning of `exactl doctor` is still 0.                                                                                                                                                          |
| 1    | `FAILURE`            | Any failure that has no more specific code.                                                                                                                                                                              |
| 2    | `USAGE`              | A wrong or missing argument or option, or a confirmation that cannot be asked.                                                                                                                                           |
| 3    | `NOT_FOUND`          | The plan, request, review, blueprint, skill, portal, flow, configuration key or other item does not exist, for example `portal show`, `portal verify`, `flow show`, `flow bindings`, `request analyze` and `config get`. |
| 4    | `STATE_CONFLICT`     | The item is in the wrong state, for example a plan that was approved already.                                                                                                                                            |
| 5    | `DAEMON_UNAVAILABLE` | `exactl doctor` found a PID file whose process is dead.                                                                                                                                                                  |
| 6    | `INVALID`            | A validation failed: `skill validate`, `flow validate`, `blueprint validate`, `log verify`, `config validate`, or `exactl doctor` for the schema or the configuration.                                                   |
| 7    | `CREDENTIALS`        | `exactl doctor` found that the default provider has no credential.                                                                                                                                                       |
| 124  | `TIMEOUT`            | `exactl log wait` or `exactl daemon start` ran out of time.                                                                                                                                                              |
| 130  | `CANCELLED`          | You declined a confirmation prompt.                                                                                                                                                                                      |

`exactl eval run` and the other eval commands that start the scenario runner end with the code of that runner: 0 when every scenario passes, 1 when a scenario fails and 2 on an infrastructure error. In a machine format its JSON error names such a code `CHILD_EXIT`.

### Confirmation

These commands change or remove something that is hard to get back, so they ask first:

- `exactl blueprint remove`, `exactl portal remove` and `exactl git worktree prune`,
- `exactl config rollback` and `exactl config compact`,
- `exactl memory learning remove`, `exactl request cancel` and `exactl approval cancel`,
- the bulk forms `exactl plan approve --all`, `exactl plan amendment approve --all` and `exactl memory proposal approve --all`.

On a terminal the command asks `[y/N]` on stderr. Pass `--yes` to confirm without the prompt. Without a terminal, or with `--no-input`, a confirming command fails with exit code 2 and the text `pass --yes to confirm` before it changes anything, so it never waits for a prompt that nobody sees. The prompt shows the text of the command without its control characters, and it needs a terminal on both standard input and standard error, so a redirected stderr counts as no terminal. A declined prompt ends with exit code 130. A dry run (`exactl git worktree prune --dry-run`) never asks.

Each consent, refusal and declined prompt is one `cli.confirmation_resolved` row in the journal, with the command, the way consent was given (`yes`, `prompt`, `no_tty` or `no_input`) and the result (`confirmed`, `declined` or `refused`). `--force` keeps one meaning: `exactl portal knowledge analyze --force` analyzes again although the knowledge is fresh.

### Health Check and Shell Completion

`exactl doctor` runs five read-only checks and prints one row for each:

| Check      | What it tests                                                                                  |
| ---------- | ---------------------------------------------------------------------------------------------- |
| `schema`   | The workspace schema against the schema of the binary.                                         |
| `config`   | The configuration file against the registered settings.                                        |
| `daemon`   | The PID file: no file is a warning, a live process passes, a dead process fails.               |
| `pricing`  | The models that have no price or a price older than `model_registry.price_staleness_max_days`. |
| `provider` | The default provider starts, which needs its credential.                                       |

Each row is `PASS`, `WARN` or `FAIL`. A warning, such as a stopped daemon or an old price, does not change the exit code. The exit code is the class of the first failing check: 6 for the schema or the configuration, 5 for a dead daemon process and 7 for a missing credential. `exactl doctor --schema` runs only the schema check and replaces the old `exactl migrate check`. With `-o json` it prints one object for each check.

`exactl completion bash`, `exactl completion fish` and `exactl completion zsh` print the completion script of a shell. Add `source <(exactl completion bash)` to `~/.bashrc` to complete commands and options with the Tab key.

## **Version Command** - Display version information

Shows the Exaix binary version and workspace schema version.

```bash
# Show version info
exactl version
```

The output includes `binary_version` (the daemon/CLI release) and
`workspace_schema_version` (the data schema expected by the current workspace).
If these mismatch, run `exactl doctor --schema` for details.

---

## Finding a command

The [command summary](#command-summary) lists every command, and each topic file of the guide explains the commands of its subject.

| You want to                                                                                   | Read                                                                    |
| --------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------- |
| Create a request, answer clarification questions, approve a plan, review and merge the result | [Requests, Plans and Reviews](requests-plans-reviews.md)                |
| Add a project as a portal and work on it                                                      | [Portals](portals.md)                                                   |
| Change the configuration or a single setting                                                  | [Configuration](configuration.md)                                       |
| Start, stop and check the daemon, back up and upgrade                                         | [Operations](operations.md)                                             |
| Query the activity journal, watch a run, export a trace                                       | [Monitoring and Logs](monitoring.md)                                    |
| Browse memory banks, manage skills                                                            | [Workspace and Memory](workspace-and-memory.md) and [Skills](skills.md) |
| Run the MCP server or call an MCP tool                                                        | [MCP Server](mcp.md)                                                    |
| Decide pending approvals and plan amendments                                                  | [Security and Safety](security-and-safety.md)                           |
| Run evaluation scenarios                                                                      | [Evaluation](evaluation.md)                                             |

**Output format.** Every command prints human-readable text by default, and `-o json` prints machine-readable output for scripts. See [Global Options and the Output Contract](#global-options-and-the-output-contract).
