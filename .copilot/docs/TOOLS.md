---
title: "MCP Agent Tool Index"
description: MCP agent tool index with descriptions, categories, and source refs
agent_priority: high
copilot_knowledge_base: true
version: 1.3
capabilities: [tool_selection, capability_map]
topics: ["mcp", "tools", "tool-selection", "agent-tools", "tool-use"]
short_summary: "Full MCP agent tool index with descriptions, categories, dynamic/approval flags, and source refs. Auto-generated from the canonical manifest."
links:
  - "exaix-dev-docs/dev/Exaix_Tools.md"
  - "scripts/sync_tool_schemas.ts"
---

> **Human developers:** For workstation setup, installation, and CLI tool guides see [exaix-dev-docs/dev/Exaix_Tools.md](./exaix-dev-docs/dev/Exaix_Tools.md).

## Evaluation coverage

Every tool below is expected to have an eval scenario tagged `subsystem:tools` and
`entity:<tool_name>`, exercised through the real MCP server rather than a shell surrogate. The
parity gate `tests/eval/tool_eval_parity_test.ts` fails when a manifest entry has neither a scenario
nor a reasoned exclusion in `tests/eval/parity_exclusions.json`.

**Adding a tool therefore means adding a scenario, or writing down why not.** Run the pack with
`deno task eval:subsystems` (all six subsystems, mock tier) and the gates with
`deno task test:parity`; both are invoked by hand, not by a CI job.

Two flags in the table below also constrain where a tool may be used. A tool that is **not**
`Dynamic`, or that requires approval, is refused in a flow step with `execution_mode: dynamic` —
`validateDynamicStepTools` checks both, because a dynamic step's tool list is chosen by a model at
runtime and the approval prompt would be the only thing between it and the effect. Note that
`side_effect_scope: none` does not imply safe-for-dynamic: `exaix_config_set` and
`exaix_config_apply` mutate configuration while declaring no side-effect scope, which is why the
approval flag is checked separately.

See `docs/Exaix_Evaluation.md` §12 for the subsystem taxonomy and cadence.

**Phase 162 (outbound MCP client, `exactl mcp connect`) note:** not applicable to this index. The
phase adds no new Exaix-exposed agent tool — `packages/mcp/src/manifest.ts` is unchanged. It adds a
CLI subcommand (`exactl mcp connect`) that lets Exaix act as an MCP _client_ against external
servers, the reverse direction from everything indexed below. See `ARCHITECTURE.md`'s "Inbound vs.
Outbound MCP" for the disambiguation.

<!-- AGENT_TOOLS_START -->

## 🤖 Agent Tool Index (MCP) {#agent-tools}

These tools are available to AI agents via the MCP protocol. They are validated, permission-checked,
and logged. The table is generated from the canonical tool manifest in `packages/mcp/src/manifest.ts`.
Run `deno task docs-sync-schemas` to regenerate after manifest changes.

**Column guide:**

- **Dynamic** (`✓`): Read-only; safe for automatic calls without per-call human review.
- **Dynamic** (`—`): Mutating or stateful; not auto-selected in dynamic execution mode.
- **Approval** (`⚠ Requires human approval`): Tool call must pause for human confirmation before executing.

> **Developer note:** The Source column is generated from explicit manifest `source_ref` metadata —
> a current ownership hint, not a permanence guarantee. Update `source_ref` values when handlers move;
> root `tests/` retains integration and server-wiring coverage while package-owned tests migrate with
> their implementations.

| Tool                          | Description                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                              | Category | Dynamic | Approval                  | Source                                                                                                                       |
| ----------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------- | ------- | ------------------------- | ---------------------------------------------------------------------------------------------------------------------------- |
| `create_directory`            | Create a directory (and any missing parent directories) inside a portal. Use before writing files into a directory that may not exist yet. Safe to call if the directory already exists. Returns a success confirmation message.                                                                                                                                                                                                                                                                                                                                                                                                                         | `write`  | —       |                           | [`packages-team/mcp-server/handlers/create_directory_tool.ts`](packages-team/mcp-server/handlers/create_directory_tool.ts)   |
| `delete_file`                 | Permanently delete a file inside a portal. Use only when you are certain the file is no longer needed; the operation is irreversible unless the portal is under git version control. Returns a success confirmation message.                                                                                                                                                                                                                                                                                                                                                                                                                             | `write`  | —       |                           | [`packages-team/mcp-server/handlers/delete_file_tool.ts`](packages-team/mcp-server/handlers/delete_file_tool.ts)             |
| `exaix_approve_plan`          | Approve or reject an execution plan, advancing it to the next state in the Exaix workflow. Use when a human has reviewed a plan and wants to authorize or cancel agent execution. Mutating — requires human confirmation before execution. Returns the updated plan record.                                                                                                                                                                                                                                                                                                                                                                              | `domain` | —       | ⚠ Requires human approval | [`packages-team/mcp-server/domain_tools.ts`](packages-team/mcp-server/domain_tools.ts)                                       |
| `exaix_config_apply`          | Apply all staged configuration changes from exaix_config_set. Use after staging one or more changes to commit them. Drains the pending list and writes each change through the config adapter. Requires human approval before execution. Returns a summary of applied and failed changes.                                                                                                                                                                                                                                                                                                                                                                | `domain` | —       | ⚠ Requires human approval | [`packages-team/mcp-server/config_tools.ts`](packages-team/mcp-server/config_tools.ts)                                       |
| `exaix_config_diff`           | Compare effective configuration values against registry defaults. Read-only; safe for dynamic execution. Returns overridden, added, and missing keys. Use to see what config has been changed from defaults.                                                                                                                                                                                                                                                                                                                                                                                                                                             | `domain` | ✓       |                           | [`packages-team/mcp-server/config_tools.ts`](packages-team/mcp-server/config_tools.ts)                                       |
| `exaix_config_get`            | Read the current effective value of a single Exaix configuration key. Read-only; safe for dynamic execution. Use to inspect current config without starting the daemon. Returns the resolved value (override → registry default).                                                                                                                                                                                                                                                                                                                                                                                                                        | `domain` | ✓       |                           | [`packages-team/mcp-server/config_tools.ts`](packages-team/mcp-server/config_tools.ts)                                       |
| `exaix_config_get_provenance` | Trace the origin of a configuration key's value — whether it comes from a DB override, registry default, schema default, or bootstrap. Read-only; safe for dynamic execution. Use to explain why a key has its current value or debug unexpected config. Returns provenance source and resolved value.                                                                                                                                                                                                                                                                                                                                                   | `domain` | ✓       |                           | [`packages-team/mcp-server/config_tools.ts`](packages-team/mcp-server/config_tools.ts)                                       |
| `exaix_config_set`            | Stage a configuration change for later activation. Use to propose a config mutation; the change is held in a per-session pending list and is NOT written until exaix_config_apply is called. Unapplied changes auto-discard after 60 seconds. Requires human approval before execution. Returns the staged key and status.                                                                                                                                                                                                                                                                                                                               | `domain` | —       | ⚠ Requires human approval | [`packages-team/mcp-server/config_tools.ts`](packages-team/mcp-server/config_tools.ts)                                       |
| `exaix_config_validate`       | Validate all registered configuration keys against their registry metadata (type, min, max, enum). Read-only; safe for dynamic execution. Use to confirm config is well-formed before applying changes or starting the daemon. Returns a validation report with any constraint violations.                                                                                                                                                                                                                                                                                                                                                               | `domain` | ✓       |                           | [`packages-team/mcp-server/config_tools.ts`](packages-team/mcp-server/config_tools.ts)                                       |
| `exaix_create_request`        | Create a new Exaix request record (a work item to be planned and executed by an agent). Use when a user describes a task that needs agent execution. Mutating — requires human confirmation before execution. Returns the created request record with its assigned ID.                                                                                                                                                                                                                                                                                                                                                                                   | `domain` | —       | ⚠ Requires human approval | [`packages-team/mcp-server/domain_tools.ts`](packages-team/mcp-server/domain_tools.ts)                                       |
| `exaix_list_plans`            | List all execution plans (active, draft, or completed) tracked in the Exaix workspace. Read-only; safe for dynamic execution. Use to check plan status or find a plan ID before approving or querying. Returns an array of plan summary objects.                                                                                                                                                                                                                                                                                                                                                                                                         | `domain` | ✓       |                           | [`packages-team/mcp-server/domain_tools.ts`](packages-team/mcp-server/domain_tools.ts)                                       |
| `exaix_portal_symbols`        | List code symbols (functions, classes, interfaces, consts, types, enums) previously extracted from a portal's codebase by 'portal analyze' (standard/deep mode). Read-only; safe for dynamic execution. Use to navigate an unfamiliar codebase, find a symbol's file and signature, or discover what a portal exports without reading whole files. Optionally filter by a case-insensitive name substring (query) or symbol kind, and cap result count (limit). Returns an error if the portal has not been analyzed yet — run 'portal analyze' first. Returns an array of symbol records ranked by connectivity (pageRankScore, most-referenced first). | `domain` | ✓       |                           | [`packages-team/mcp-server/portal_knowledge_tools.ts`](packages-team/mcp-server/portal_knowledge_tools.ts)                   |
| `exaix_query_journal`         | Query the Exaix activity journal for execution history, tool calls, or agent events. Read-only; safe for dynamic execution. Use to audit what happened or look up recent activity in a flow. Returns an array of matching journal entry records.                                                                                                                                                                                                                                                                                                                                                                                                         | `domain` | ✓       |                           | [`packages-team/mcp-server/domain_tools.ts`](packages-team/mcp-server/domain_tools.ts)                                       |
| `git_commit`                  | Stage all changes and create a git commit in the portal repository. Use after writing or modifying files to record the change. Returns the commit hash of the newly created commit.                                                                                                                                                                                                                                                                                                                                                                                                                                                                      | `git`    | —       |                           | [`packages-team/mcp-server/handlers/git_commit_tool.ts`](packages-team/mcp-server/handlers/git_commit_tool.ts)               |
| `git_create_branch`           | Create a new git branch in the portal repository. Use before making changes that should be isolated on a branch. Returns the new branch name on success.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                 | `git`    | —       |                           | [`packages-team/mcp-server/handlers/git_create_branch_tool.ts`](packages-team/mcp-server/handlers/git_create_branch_tool.ts) |
| `git_log`                     | Query git commit history in the portal repository with common filters and formatting. Use this tool when you need commit chronology, author/message filtering, or path-specific history. Supports max_count/skip pagination, date filters, author/message search, path filtering, and oneline/full/custom output modes. Returns git log output as text.                                                                                                                                                                                                                                                                                                  | `git`    | —       |                           | [`packages-team/mcp-server/handlers/git_log_tool.ts`](packages-team/mcp-server/handlers/git_log_tool.ts)                     |
| `git_status`                  | Show the working tree status (modified, staged, untracked files) of the portal git repository. Use to inspect pending changes before committing. Returns the git status output as a formatted string.                                                                                                                                                                                                                                                                                                                                                                                                                                                    | `git`    | ✓       |                           | [`packages-team/mcp-server/handlers/git_status_tool.ts`](packages-team/mcp-server/handlers/git_status_tool.ts)               |
| `git_worktree`                | Manage git worktrees in the portal repository. Use this tool when you need parallel checkouts for branch work, cleanup stale worktrees, or inspect active worktree state. Supports add/list/remove/prune/lock/unlock actions and important flags such as force, detach, porcelain output, dry-run prune, and lock reasons. Returns command output as text.                                                                                                                                                                                                                                                                                               | `git`    | —       |                           | [`packages-team/mcp-server/handlers/git_worktree_tool.ts`](packages-team/mcp-server/handlers/git_worktree_tool.ts)           |
| `list_directory`              | List the files and subdirectories at a path inside a portal. Use to check whether a file exists, explore directory structure, or enumerate files before processing. Returns an array of entry names.                                                                                                                                                                                                                                                                                                                                                                                                                                                     | `read`   | ✓       |                           | [`packages-team/mcp-server/handlers/list_directory_tool.ts`](packages-team/mcp-server/handlers/list_directory_tool.ts)       |
| `move_file`                   | Move or rename a file within a portal. The source path is removed after the move. Use for file reorganization or renaming; not for copying. Returns a success confirmation message.                                                                                                                                                                                                                                                                                                                                                                                                                                                                      | `write`  | —       |                           | [`packages-team/mcp-server/handlers/move_file_tool.ts`](packages-team/mcp-server/handlers/move_file_tool.ts)                 |
| `patch_file`                  | Apply a targeted patch to replace a specific substring in a file without rewriting the whole file. Use when you need to make a minimal change. For full rewrites use write_file. Returns a success confirmation message.                                                                                                                                                                                                                                                                                                                                                                                                                                 | `write`  | —       |                           | [`packages-team/mcp-server/handlers/patch_file_tool.ts`](packages-team/mcp-server/handlers/patch_file_tool.ts)               |
| `read_file`                   | Return the full text content of a file inside a portal. Use when you need to read or analyze file contents. For searching within files use run_command with grep or rg; for checking whether a file exists use list_directory. Returns the raw file text as a string.                                                                                                                                                                                                                                                                                                                                                                                    | `read`   | ✓       |                           | [`packages-team/mcp-server/handlers/read_file_tool.ts`](packages-team/mcp-server/handlers/read_file_tool.ts)                 |
| `run_command`                 | Execute a shell command inside the portal working directory. Use for build tasks, test runners, or any operation not covered by dedicated tools. Returns combined stdout/stderr output and exit code.                                                                                                                                                                                                                                                                                                                                                                                                                                                    | `meta`   | —       |                           | [`packages-team/mcp-server/handlers/run_command_tool.ts`](packages-team/mcp-server/handlers/run_command_tool.ts)             |
| `search_files`                | Search for files matching a name or glob pattern inside a portal. Use to locate files when you don't know the exact path. For content search within files use run_command with grep or rg. Returns an array of matching relative file paths.                                                                                                                                                                                                                                                                                                                                                                                                             | `read`   | ✓       |                           | [`packages-team/mcp-server/handlers/search_files_tool.ts`](packages-team/mcp-server/handlers/search_files_tool.ts)           |
| `write_file`                  | Write or overwrite the full content of a file inside a portal. Use when you need to create a new file or completely replace an existing file. For partial edits use patch_file. Returns a success confirmation message.                                                                                                                                                                                                                                                                                                                                                                                                                                  | `write`  | —       |                           | [`packages-team/mcp-server/handlers/write_file_tool.ts`](packages-team/mcp-server/handlers/write_file_tool.ts)               |

<!-- AGENT_TOOLS_END -->

## 🧰 Solo-Only ReAct Tools (`ToolRegistry`)

The table above is generated exclusively from `packages/mcp/src/manifest.ts`'s `TOOL_MANIFEST`
(Team-tier MCP-facing tools). `docs-sync-schemas` has no visibility into
`packages/tool-runtime/src/tool_registry.ts` — Solo's separate in-process ReAct tool catalog
(`ReActLoopStrategy`/`LegacyAgentStrategy`/`McpAgentStrategy`; see ARCHITECTURE.md's "Tool
Catalog Parity" section) — so any manual entry placed inside the markers above would be
silently discarded on the next sync. This section is intentionally outside those markers and
is **not** kept in sync automatically; update it by hand when the tools below change.

**Scope note (phase-175 Step 5):** this section documents only the two Solo-tier tools that
phase added. `ToolRegistry`'s other 14 tools (`read_file`, `write_file`, `list_directory`,
`search_files`, `create_directory`, `run_command`, `fetch_url`, `grep_search`, `move_file`,
`copy_file`, `delete_file`, `git_info`, `deno_task`, `patch_file`) have no representation here
at all — a real gap, deliberately not fixed by this phase (see phase-175's Step 5 Actions).
It is worth its own scoped phase, or a `docs-sync-schemas`/`TOOL_MANIFEST` extension that
enumerates `packages/tool-runtime`'s catalog alongside the Team MCP one.

| Tool                  | Description                                                                                                                                                                                                                                 | Side-effect scope | Source                                                                                     |
| --------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------- | ------------------------------------------------------------------------------------------ |
| `query_relationships` | Lists relationship edges leading forward from a layer name or file path in the current portal's knowledge graph — combines persisted `file_imports_file_internal` edges with on-demand `layer_contains_file` edges. Optional `kind` filter. | `none`            | [`packages/tool-runtime/src/tool_registry.ts`](packages/tool-runtime/src/tool_registry.ts) |
| `who_depends_on`      | Lists relationship edges pointing into a file path — the reverse of `query_relationships`; finds every file that imports a given file internally.                                                                                           | `none`            | [`packages/tool-runtime/src/tool_registry.ts`](packages/tool-runtime/src/tool_registry.ts) |

Both require a portal-knowledge service to be wired into the `ToolRegistry`'s
`IApplicationContext` (present in the daemon's real execution `ToolRegistryFactory`) and the
current execution root to match a configured portal's `target_path` — otherwise they return a
structured error, never a throw. No Team-tier MCP equivalent exists for either tool; they are
new Solo-only surface, not a port of `exaix_portal_symbols`.

**Why use these instead of reading imports directly:** the underlying graph is built from
`deno info`'s resolved module graph, not text pattern matching, so it correctly follows import-map
aliases and barrel re-exports that a naive `import .* from` grep would miss. `who_depends_on`
(reverse dependency lookup — "what imports this file") has no efficient text-grep equivalent at
all; answering it by reading files would mean opening every file in the portal. `layer_contains_file`
edges are synthesized from the portal's `layers` config and are not derivable from import
statements in the first place — no amount of reading source files reveals which architectural
layer a file belongs to.

## ACI (Agent-Computer Interface) Authoring Guide

Distinct from the MCP tool index above: an `aciDoc` block is structured, ReAct-only
authoring guidance attached to a tool's entry in the ReAct catalog
(`createCoreToolSchemas()`), rendered into dynamic-execution prompts when
`agents.inject_aci_docs` is enabled. It is never part of the MCP tool manifest and never
populated from a remote MCP server's tool description — only this repo's own trusted,
local catalog authors it, which is why the field never needs to appear in the generated
table above.

**Shape** (`AciDocSchema`, `packages/schemas/src/aci_doc.ts`): `summary`, `when_to_use`,
`when_not_to_use`, a worked `example` (`input`, `output`, `rationale`), and an
`anti_example` (`input`, `why_wrong`). Every free-text field has a minimum length (no
placeholder guidance) and a maximum length (bounded prompt-injection footprint); `example`/
`anti_example` inputs are JSON-only records with a capped property count and serialized
size.

**Real example** (`read_file`, `packages/tool-runtime/src/tool_schemas.ts`):

```ts
aciDoc: {
  summary: "Reads the complete text content of exactly one file at a known path.",
  when_to_use:
    "Use when you already know a file's path and need to see or analyze its full " +
    "content, e.g. before editing it or to answer a question about its contents.",
  when_not_to_use:
    "Do not use to locate files by name or pattern (use search_files) or to find a " +
    "string across many files (use grep_search) — read_file takes exactly one literal " +
    "path and has no glob or pattern support.",
  example: {
    input: { path: "src/example.ts" },
    output: "export function example(): string {\n  return \"ok\";\n}\n",
    rationale:
      "The caller already knows the exact path from a prior list_directory or " +
      "search_files call and needs the file's full text before patching it.",
  },
  anti_example: {
    input: { path: "src/**/*.ts", recursive: true },
    why_wrong:
      "read_file's only parameter is a single literal `path`; there is no `recursive` " +
      "option, and a glob pattern will fail to resolve as a literal file path — use " +
      "search_files to resolve the glob first, then read_file once per match.",
  },
},
```

**MCP-only arguments must never appear in a worked example.** `example.input`/
`anti_example.input` are checked against the tool's own ReAct-side `ITool.parameters`
schema (`packages/tool-runtime/src/aci_example_validator.ts`): every key must be a known
parameter, every required parameter must be present, and every value's runtime type (and
enum membership, where declared) must match. MCP-transport-only fields such as `portal` or
`identity_id` are never part of `ITool.parameters` — the MCP server injects them at the
transport layer, not the ReAct tool-call convention — so including one in a worked example
is always a validator error, not a stylistic choice.

**Validation**: `deno task check:aci-docs` (warn mode) / `check:aci-docs:strict` (CI-blocking,
exit `2` on any finding) run `scripts/validate_aci_docs.ts` over the real catalog; both are
chained into `deno task docs-agent-validate`. A catalog-load or internal error exits `1`
regardless of mode. Run either after adding or editing an `aciDoc` block.
