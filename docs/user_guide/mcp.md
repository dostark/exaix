# MCP Server

The MCP server, its tools, client integration and outbound tool calls. Part of the [Exaix User Guide](README.md).

## Model Context Protocol (MCP) Server

Exaix includes a built-in MCP server, allowing generic AI clients (like Claude Desktop or IDE extensions) to interact with your workspace using standardized tools.

### Starting the Server

`exactl mcp serve` runs the MCP server. It serves **stdio** by default, which suits local clients. `exactl mcp serve --sse --port <N>` serves **Streamable HTTP** for remote clients. The port defaults to 3000. The command was called `exactl mcp start` in earlier releases, and that name now exits with an error that points to `serve`. See the generated [mcp reference](../cli/mcp.md) for every option.

The server is built on the official `@modelcontextprotocol/server` SDK and negotiates the current spec protocol version (2025-11-25) — not the legacy `2024-11-05` revision. The default `exactl mcp serve` serves **stdio**; `--sse --port <N>` serves **Streamable HTTP** (the current spec's primary HTTP transport).

**Authentication (opt-in).** By default the server is unauthenticated. To require a bearer token from every client, enable `mcp.require_auth` and put the secret in an environment variable (never in plaintext config):

```toml
# exa.config.toml
[mcp]
require_auth = true
# auth_token_env defaults to "MCP_AUTH_TOKEN" — the env var holding the bearer secret
```

Export the token before you start the server: `MCP_AUTH_TOKEN="<secret>" exactl mcp serve --sse --port 3000`.

A client without (or with the wrong) bearer token is rejected with `401`; a client supplying `Authorization: Bearer $MCP_AUTH_TOKEN` is accepted. When `require_auth` is enabled but the token env var is unset, the server fails fast at startup rather than silently rejecting every request.

### Available Tools

A connected client gets the high-level domain tools `exaix_request_create`, `exaix_plan_list`, `exaix_plan_approve` and `exaix_log_list`. It also gets the file system and git tools, such as `read_file`, `write_file` and `git_status`, scoped to your workspace. [TOOLS.md](../../.copilot/docs/TOOLS.md#agent-tools) lists every tool with its schema.

### Tool names and aliases

Exaix keeps one canonical name for each tool operation. General-purpose aliases let
provider calls and saved blueprints use familiar names; Exaix-specific tools require
their exact canonical spelling. The server advertises canonical names only.

| General-purpose names                                                                      | Canonical name         |
| ------------------------------------------------------------------------------------------ | ---------------------- |
| `glob`, `glob_file_search`, `file_search`, `find_files`                                    | `search_files`         |
| `grep`, `rg`, `ripgrep`, `text_search`, `search_file_content`, `grep_files`, `grep_search` | `search_text`          |
| `read`, `read_text_file`                                                                   | `read_file`            |
| `write`, `create_file`                                                                     | `write_file`           |
| `edit`, `str_replace`, `replace`                                                           | `patch_file`           |
| `list_dir`, `ls`, `list`                                                                   | `list_directory`       |
| `mkdir`                                                                                    | `create_directory`     |
| `move`, `mv`, `rename_file`                                                                | `move_file`            |
| `copy`, `cp`                                                                               | `copy_file`            |
| `delete`, `rm`, `remove_file`                                                              | `delete_file`          |
| `webfetch`, `web_fetch`                                                                    | `fetch_url`            |
| `save_memory`                                                                              | `remember_fact`        |
| `list_tools`                                                                               | `list_available_tools` |

General-purpose tool names are matched without case sensitivity. Accepted parameter
aliases are:

| Canonical parameter                     | Accepted aliases                                                                                       |
| --------------------------------------- | ------------------------------------------------------------------------------------------------------ |
| `path`                                  | `file_path`, `filePath`, `filepath`, `target_file`, `absolute_path`, `dir_path`, `directory`, `folder` |
| `pattern` on `search_files`             | `query`                                                                                                |
| `pattern` on `search_text`              | `query`, `regex`                                                                                       |
| `search` on `patch_file`                | `old_string`, `oldString`, `old_text`                                                                  |
| `replace` on `patch_file`               | `new_string`, `newString`, `new_text`                                                                  |
| `from` / `to` on `move_file`            | `source` / `destination`                                                                               |
| `source` / `destination` on `copy_file` | `from` / `to`                                                                                          |
| `name` on `query_symbols`               | `query`                                                                                                |
| `content` on `remember_fact`            | `fact`                                                                                                 |

Path aliases apply when the selected tool accepts `path` and does not itself declare the
alias key. If both a canonical parameter and its alias are present, the canonical value
wins and the alias is recorded as dropped. Some other familiar spellings are
intentionally unsupported: `edit_file` is not an alias for `patch_file`, and `bash` is
not an alias for `run_command`. OpenCode plan JSON has a separate compatibility rule: its
`grep` resolves to `search_text`, and its approved `bash` plan action remains
`run_command`.

The exact-only Exaix native names must use exact spelling and case. The registry names are
`run_deno_task`, `find_dependents`, `query_symbols`, `query_relationships`, and
`get_module_dependencies`. The Team MCP server also exposes exact names such as
`exaix_request_create`, `exaix_plan_list`, `exaix_plan_approve`, `exaix_log_list`,
and `exaix_config_get`; it does not expose alternate native names. Retired spellings
(`deno_task`, `who_depends_on`, `exaix_portal_symbols`, `dependents`, and `list_symbols`)
are rejected. Blueprint and skill tool lists accept general-purpose aliases, but native
names in them must be exact. Invalid native names in permission or approval rules fail
validation instead of silently removing a restriction.

MCP alias support depends on the transport. The legacy direct handler, real Streamable
HTTP ingress, and Exaix's local dispatcher normalize supported general-purpose name
aliases. SDK stdio accepts only registered canonical tool names. All paths accept
parameter aliases for a registered canonical name. Native aliases are rejected on every
path; the Team MCP server lists canonical names only. `query_symbols` accepts the
`query` parameter as an alias for `name`.

Set the live strict-parameter policy with `exactl config set tools.strict_params true`;
`exactl config set tools.strict_params false` restores permissive handling. The setting is
hot-applied while the daemon runs. A Config DB override takes precedence over
`exa.config.toml`; without an override, TOML is used, then the default `false`. In
permissive mode Exaix records unknown keys and continues. `portal` and `agent_role` are
exempt from this check.

Use the Activity Journal events `tool.alias.rewritten` and `tool.param.unknown` to inspect
normalization. Alias records include requested and canonical names, renamed and dropped
keys, entry point, and model-response provider/model when known. External calls without a
model response retain unknown attribution as `NULL`. This query groups rewrites by the
actual producer identity:

```sql
SELECT json_extract(payload, '$.provider') AS provider,
       json_extract(payload, '$.model') AS model,
       COUNT(*) AS count
FROM activity
WHERE action_type = 'tool.alias.rewritten'
GROUP BY provider, model
ORDER BY provider, model;
```

`tool.param.unknown` records unknown and accepted keys and whether strict mode was enabled.

### Client Integration

Add the server to the config of your client, for example `claude_desktop_config.json` for Claude Desktop. Start from `templates/mcp/claude_desktop_config.json` or `templates/mcp/cline_settings.json`. Both launch `exactl mcp serve` through `deno run` with a fine-grained permission list and no `--allow-all`. Set `EXAIX_ROOT` in the `env` block to your workspace path and the script path to your checkout of `apps/exactl/main.ts`.

### Connecting Outbound (`exactl mcp tool`)

`exactl mcp tool` is the reverse direction: Exaix acts as an MCP _client_ and reaches out to an external MCP server. The server can be a documentation server, a code-hosting platform endpoint or any spec-compliant server. `exactl mcp tool list --server <url>` lists the tools a server exposes. `exactl mcp tool call <name> --server <url> --args '<json>'` calls one tool. See the [mcp reference](../cli/mcp.md#exactl-mcp-tool-list) for every option.

Connection is automatic dual-transport: Streamable HTTP is tried first (the current MCP spec's primary transport), falling back to legacy SSE if the server only supports the older protocol — no flag needed either way.

**Authentication.** Some servers require a bearer token (a Personal Access Token or similar). Set it via an environment variable — never a CLI flag, so it never appears in `ps`-visible process arguments:

For example: `EXA_MCP_BEARER_TOKEN=<your-token> exactl mcp tool list --server <url>`.

`EXA_MCP_BEARER_TOKEN` is forwarded as an `Authorization: Bearer <token>` header on every request to the target server. Only this bearer-token mode is supported — interactive OAuth login flows and `client_credentials`/JWT-assertion grants are not.

For the GitHub remote MCP server, use `EXA_MCP_BEARER_TOKEN=$(gh auth token)` with `--server https://api.githubcopilot.com/mcp/`.
