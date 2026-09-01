/**
 * @module ToolSchemas
 * @path packages/tool-runtime/src/tool_schemas.ts
 * @description Static JSON-schema metadata for every core tool registered by
 * ToolRegistry. Extracted from ToolRegistry.registerCoreTools (god-object
 * decomposition, .copilot/skills/refactor/SKILL.md step d) since this data has
 * no branching or instance state — it is a pure declarative catalog.
 * @architectural-layer Services
 * @related-files ["packages/tool-runtime/src/tool_registry.ts"]
 */
import { JsonSchemaType, ToolName, ToolSideEffectScope } from "@exaix/core";
import type { ITool } from "@exaix/core/types";
import type { Opt, Reason } from "@exaix/core/types";

export function createCoreToolSchemas(
  gitScopeValues?: Opt<{ status: string; branch: string }, Reason.OptionalInput>,
): ITool[] {
  const s = gitScopeValues?.status ?? "status";
  const b = gitScopeValues?.branch ?? "branch";
  return [
    {
      name: "read_file",
      description:
        "Return the full text content of a file at the given path. Use when you need to read or analyze file contents; for searching within files use grep_search; for finding files by pattern use search_files. Returns file text as a string in data.content.",
      parameters: {
        type: "object",
        properties: {
          path: {
            type: "string",
            description: "Path to the file to read",
          },
        },
        required: ["path"],
      },
      sideEffectScope: ToolSideEffectScope.NONE,
      aciDoc: {
        summary: "Reads the complete text content of exactly one file at a known path.",
        when_to_use:
          "Use when you already know a file's path and need to see or analyze its full content, e.g. before editing it or to answer a question about its contents.",
        when_not_to_use:
          "Do not use to locate files by name or pattern (use search_files) or to find a string across many files (use grep_search) — read_file takes exactly one literal path and has no glob or pattern support.",
        example: {
          input: { path: "src/example.ts" },
          output: 'export function example(): string {\n  return "ok";\n}\n',
          rationale:
            "The caller already knows the exact path from a prior list_directory or search_files call and needs the file's full text before patching it.",
        },
        anti_example: {
          input: { path: "src/**/*.ts", recursive: true },
          why_wrong:
            "read_file's only parameter is a single literal `path`; there is no `recursive` option, and a glob pattern like 'src/**/*.ts' will fail to resolve as a literal file path — use search_files to resolve the glob to concrete paths first, then read_file once per match.",
        },
      },
    },
    {
      name: ToolName.WRITE_FILE,
      description:
        "Write or overwrite a file with the given content. Use when you need to create or replace a file in full; for targeted in-place edits use patch_file. Returns data.path (resolved absolute path) on success. Fails if path is outside allowed roots.",
      nativeDescription:
        "PREFERRED for creating NEW files or completely replacing existing ones. For small targeted edits, choose patch_file instead.",
      parameters: {
        type: "object",
        properties: {
          path: {
            type: "string",
            description: "Path to the file to write",
          },
          content: {
            type: "string",
            description: "Content to write to the file",
          },
        },
        required: ["path", "content"],
      },
      sideEffectScope: ToolSideEffectScope.PORTAL,
      aciDoc: {
        summary: "Writes new content to a file, creating it if missing or replacing it entirely if it exists.",
        when_to_use:
          "Use when creating a brand-new file or intentionally replacing a file's entire content with fully-known text.",
        when_not_to_use:
          "Do not use for small, targeted edits to an existing file — use patch_file, which fails loudly if its search text doesn't match exactly once rather than silently discarding unrelated existing content.",
        example: {
          input: {
            path: "src/greeting.ts",
            content: "export function greet(name: string): string {\n  return `Hello, ${name}!`;\n}\n",
          },
          output: "src/greeting.ts",
          rationale:
            "Creating a brand-new file with fully-known content is exactly write_file's purpose; there is no existing content to preserve.",
        },
        anti_example: {
          input: { path: "src/greeting.ts" },
          why_wrong:
            "write_file requires both path and content; omitting content leaves nothing to write and the call fails validation instead of guessing or truncating the file.",
        },
      },
    },
    {
      name: ToolName.LIST_DIRECTORY,
      description:
        "List files and directories at the given path. Use when you need to explore a directory or verify a file exists; for pattern-matching files use search_files. Returns data.entries as an array of { name, isDirectory } objects.",
      parameters: {
        type: "object",
        properties: {
          path: {
            type: "string",
            description: "Path to the directory to list (optional, defaults to the workspace root)",
          },
        },
        required: [],
      },
      sideEffectScope: ToolSideEffectScope.NONE,
      aciDoc: {
        summary: "Lists the file and subdirectory names at a given path, one directory level deep.",
        when_to_use:
          "Use to explore a directory's structure or confirm a file or directory exists before acting on it.",
        when_not_to_use:
          "Do not use to find files by name pattern across a directory tree — use search_files, which supports glob matching and recurses; list_directory only lists one literal directory's immediate contents.",
        example: {
          input: { path: "packages/core/src" },
          output: '{"entries":[{"name":"types","isDirectory":true},{"name":"index.ts","isDirectory":false}]}',
          rationale:
            "Confirms what exists directly under packages/core/src before deciding whether to read_file a specific entry.",
        },
        anti_example: {
          input: { path: "packages/core", pattern: "**/*.ts" },
          why_wrong:
            "list_directory has no `pattern` parameter — glob matching belongs to search_files; list_directory only lists the literal directory named by `path`, one level deep.",
        },
      },
    },
    {
      name: ToolName.SEARCH_FILES,
      description:
        "Find files matching a glob pattern (e.g. '**/*.ts') under a directory. Use when you need to locate files by name pattern; for searching file contents use grep_search; for listing all items use list_directory. Returns data.files as an array of absolute file paths.",
      parameters: {
        type: "object",
        properties: {
          pattern: {
            type: "string",
            description: "Glob pattern to match (e.g., '*.ts', '**/*.md')",
          },
          path: {
            type: "string",
            description: "Directory to search in (optional, defaults to the workspace root)",
          },
        },
        required: ["pattern"],
      },
      sideEffectScope: ToolSideEffectScope.NONE,
      aciDoc: {
        summary: "Finds files whose path matches a glob pattern under a directory.",
        when_to_use: "Use when you know a file naming pattern but not the exact path, e.g. finding all test files.",
        when_not_to_use:
          "Do not use to search inside file contents for a string or regex — use grep_search instead; search_files only matches file names/paths against a glob, never file contents.",
        example: {
          input: { pattern: "**/*_test.ts", path: "packages/core" },
          output: '{"files":["packages/core/tests/foo_test.ts","packages/core/tests/bar_test.ts"]}',
          rationale:
            "Locates every test file under packages/core by name pattern without needing to already know each one's exact path.",
        },
        anti_example: {
          input: { path: "packages/core", glob: "*.ts" },
          why_wrong:
            "search_files' glob-pattern parameter is named `pattern`, not `glob` — this omits the required `pattern` field entirely.",
        },
      },
    },
    {
      name: ToolName.CREATE_DIRECTORY,
      description:
        "Create a directory and all required parent directories. Use when you need to ensure a path exists before writing or moving files into it. Returns data.path (resolved absolute path) on success. Fails if path is outside allowed roots.",
      parameters: {
        type: "object",
        properties: {
          path: {
            type: "string",
            description: "Path to the directory to create",
          },
        },
        required: ["path"],
      },
      sideEffectScope: ToolSideEffectScope.PORTAL,
      aciDoc: {
        summary: "Creates a directory and any missing parent directories at the given path.",
        when_to_use:
          "Use before writing or moving files into a directory that may not exist yet; safe to call even if the directory already exists.",
        when_not_to_use:
          "Do not use to create a file — create_directory only creates directories; use write_file to create a file's content.",
        example: {
          input: { path: "packages/newmodule/src" },
          output: "packages/newmodule/src",
          rationale: "Ensures the full parent chain exists before write_file targets a file inside it.",
        },
        anti_example: {
          input: {},
          why_wrong:
            "create_directory requires a path; omitting it leaves the tool with no target and it fails validation instead of defaulting to a location.",
        },
      },
    },
    {
      name: ToolName.RUN_COMMAND,
      description:
        "Execute a whitelisted shell command (git, deno, npm, grep, ls, etc.) with argument validation. Use when you need to run a CLI tool or build script; for git repo inspection use git_info instead. Returns data.output (stdout string) and data.exitCode. Blocked or failed commands return a descriptive error.",
      nativeDescription:
        "Execute shell commands for exploration, testing, and building. For code analysis, prefer grep_search or read_file. For editing, prefer patch_file or write_file.",
      parameters: {
        type: "object",
        properties: {
          command: {
            type: "string",
            description: "Command to execute (must be whitelisted)",
          },
          args: {
            type: JsonSchemaType.ARRAY,
            items: { type: "string" },
            description: "Command arguments",
          },
        },
        required: ["command"],
      },
      sideEffectScope: ToolSideEffectScope.SYSTEM,
      aciDoc: {
        summary: "Executes one whitelisted shell command (git, deno, npm, grep, ls, etc.) with argument validation.",
        when_to_use:
          "Use for build, test, or lint tasks, or other whitelisted CLI operations not covered by a dedicated tool.",
        when_not_to_use:
          "Do not use for git repository status, branch, or diff inspection — use git_info, which returns structured data instead of raw stdout you would otherwise have to parse yourself.",
        example: {
          input: { command: "deno", args: ["test", "--allow-all", "packages/core/tests/"] },
          output: '{"output":"running 12 tests...\\nok | 12 passed | 0 failed","exitCode":0}',
          rationale:
            "Runs the project's real test command exactly as a human would, capturing both output and exit code for pass/fail determination.",
        },
        anti_example: {
          input: { args: ["-rf", "/"] },
          why_wrong:
            "command is required and must be a single whitelisted executable name (e.g. 'deno'); here it is entirely omitted while destructive flags were placed into args, which would never run since no executable was named.",
        },
      },
    },
    {
      name: ToolName.FETCH_URL,
      description:
        "Fetch text content from a URL in the configured allowed-domains whitelist. Use when you need to retrieve web content for analysis; only whitelisted domains are accessible. Returns data.content (response text), data.url, and data.format. Fails if the domain is not whitelisted or content exceeds the size limit.",
      parameters: {
        type: "object",
        properties: {
          url: {
            type: "string",
            description: "URL to fetch",
          },
          format: {
            type: "string",
            enum: ["text", "markdown"],
            description: "Output format (default: markdown)",
          },
        },
        required: ["url"],
      },
      sideEffectScope: ToolSideEffectScope.NETWORK,
      aciDoc: {
        summary: "Fetches text content from a URL on the configured allowed-domains whitelist.",
        when_to_use:
          "Use to retrieve the text or markdown content of a whitelisted web page or API endpoint for analysis or summarization.",
        when_not_to_use:
          "Do not use for URLs outside the configured whitelist (the call fails with a domain-not-allowed error) or for local files — use read_file for filesystem paths.",
        example: {
          input: { url: "https://docs.deno.com/runtime/", format: "markdown" },
          output: '{"content":"# Deno Runtime\\n...","url":"https://docs.deno.com/runtime/","format":"markdown"}',
          rationale: "Retrieves a whitelisted documentation page as markdown for direct reading, rather than raw HTML.",
        },
        anti_example: {
          input: { url: "https://example.com", format: "json" },
          why_wrong:
            "format must be one of 'text' or 'markdown' — 'json' is not a supported output format and is rejected.",
        },
      },
    },
    {
      name: ToolName.GREP_SEARCH,
      description:
        "Search files under a directory for a string or regex pattern and return line-level matches. Use for code and text search within the workspace; prefer over read_file when scanning many files for a specific pattern. Returns an array of { file, line, content } match objects up to the configured max_results limit.",
      parameters: {
        type: "object",
        properties: {
          pattern: {
            type: "string",
            description: "Regex or literal string to search for",
          },
          path: {
            type: "string",
            description: "Root directory to search in (relative to workspace or portal)",
          },
          case_sensitive: {
            type: "boolean",
            description: "Case sensitive search (default: true)",
          },
        },
        required: ["pattern", "path"],
      },
      sideEffectScope: ToolSideEffectScope.NONE,
      aciDoc: {
        summary:
          "Searches file contents under a directory for a string or regex pattern, returning line-level matches.",
        when_to_use:
          "Use to find where a specific string, function name, or pattern appears across many files, without knowing which file contains it.",
        when_not_to_use:
          "Do not use to find files by name — use search_files; grep_search only matches file contents, and a wide, unbounded `path` on a common pattern can return far more matches than useful.",
        example: {
          input: { pattern: "function greet", path: "src" },
          output: '[{"file":"src/greeting.ts","line":1,"content":"export function greet(name: string): string {"}]',
          rationale:
            "Locates the exact file and line defining `greet` without first needing to know which file it lives in.",
        },
        anti_example: {
          input: { pattern: "greeting.ts" },
          why_wrong:
            "grep_search requires both pattern and path — path bounds the search to a directory; omitting it leaves the tool with no root to scan.",
        },
      },
    },
    {
      name: ToolName.MOVE_FILE,
      description:
        "Move or rename a file from one path to another. Use when you need to relocate or rename a file; for duplicating a file without removing the original use copy_file. Returns data.from and data.to on success. Fails if destination exists and overwrite is false.",
      parameters: {
        type: "object",
        properties: {
          from: { type: "string", description: "Source path" },
          to: { type: "string", description: "Destination path" },
          overwrite: { type: "boolean", description: "Overwrite existing file (default: false)" },
        },
        required: ["from", "to"],
      },
      sideEffectScope: ToolSideEffectScope.PORTAL,
      aciDoc: {
        summary: "Moves or renames a file from one path to another, removing the source.",
        when_to_use: "Use to relocate or rename a file while keeping its content unchanged.",
        when_not_to_use:
          "Do not use to duplicate a file while keeping the original in place — use copy_file; move_file always removes the source path.",
        example: {
          input: { from: "src/old_name.ts", to: "src/new_name.ts" },
          output: '{"from":"src/old_name.ts","to":"src/new_name.ts"}',
          rationale: "Renames a file in place after choosing a clearer name, without a separate delete step.",
        },
        anti_example: {
          input: { from: "src/a.ts" },
          why_wrong: "move_file requires both from and to — to is missing entirely, leaving no destination.",
        },
      },
    },
    {
      name: ToolName.COPY_FILE,
      description:
        "Copy a file from source to destination, leaving the original in place. Use when you need to duplicate a file; for renaming or relocating without keeping the original use move_file. Returns data.source and data.destination on success. Fails if destination exists and overwrite is false.",
      parameters: {
        type: "object",
        properties: {
          source: { type: "string", description: "Source path" },
          destination: { type: "string", description: "Destination path" },
          overwrite: { type: "boolean", description: "Overwrite existing file (default: false)" },
        },
        required: ["source", "destination"],
      },
      sideEffectScope: ToolSideEffectScope.PORTAL,
      aciDoc: {
        summary: "Copies a file to a new destination path, leaving the original file in place.",
        when_to_use: "Use to duplicate a file — e.g. creating a variant or backup — without removing the source.",
        when_not_to_use:
          "Do not use for a pure rename or relocation where the original should no longer exist — use move_file, which avoids leaving an orphaned duplicate behind.",
        example: {
          input: { source: "config/default.json", destination: "config/staging.json" },
          output: '{"source":"config/default.json","destination":"config/staging.json"}',
          rationale: "Creates a staging-specific config by duplicating the default one, to be edited independently.",
        },
        anti_example: {
          input: { source: "config/default.json" },
          why_wrong:
            "copy_file requires both source and destination; omitting destination gives the tool nowhere to write the copy.",
        },
      },
    },
    {
      name: "delete_file",
      description:
        "Permanently remove a file at the given path. Use when you need to delete a file; this action is irreversible. Returns data.path on success. Fails if the file does not exist or the path is outside allowed roots.",
      parameters: {
        type: "object",
        properties: {
          path: { type: "string", description: "Path to file to delete" },
        },
        required: ["path"],
      },
      sideEffectScope: ToolSideEffectScope.PORTAL,
      aciDoc: {
        summary: "Permanently removes a single file at the given path.",
        when_to_use:
          "Use only when a specific file is confirmed no longer needed and its removal is intentional and irreversible.",
        when_not_to_use:
          "Do not use to empty a file's content while keeping it in place — use write_file with empty content; delete_file removes the file entry itself.",
        example: {
          input: { path: "src/deprecated_helper.ts" },
          output: "src/deprecated_helper.ts",
          rationale:
            "Removes a file already confirmed (via grep_search) to have zero remaining references, after its logic was migrated elsewhere.",
        },
        anti_example: {
          input: { path: ["src/a.tmp", "src/b.tmp"] },
          why_wrong:
            "delete_file's path parameter is a single literal file path (a string), not an array — there is no batch-delete parameter; resolve matches with search_files first and delete each one individually.",
        },
      },
    },
    {
      name: "git_info",
      description:
        "Retrieve git repository information: working-tree status, current branch name, or diff summary. Use when you need to inspect repo state without running run_command directly; scope 'status' returns changed files, 'branch' returns the branch name, 'diff_summary' returns a diff stat. Returns parsed git output in data.",
      parameters: {
        type: "object",
        properties: {
          repo_path: {
            type: "string",
            description: "Path to git repository root (default: workspace root)",
          },
          scope: {
            type: "string",
            enum: [s, b, "diff_summary"],
            description: "Information to retrieve (default: status)",
          },
        },
        required: ["repo_path"],
      },
      sideEffectScope: ToolSideEffectScope.NONE,
      aciDoc: {
        summary:
          "Retrieves read-only git repository information: working-tree status, current branch, or a diff summary.",
        when_to_use:
          "Use to check repo state (uncommitted changes, current branch, or diff stats) without running run_command with raw git commands yourself.",
        when_not_to_use:
          "Do not use to make git changes such as commits or branches — git_info is read-only inspection only.",
        example: {
          input: { repo_path: ".", scope: "status" },
          output: '{"changed_files":["src/a.ts","src/b.ts"]}',
          rationale:
            "Checks what has changed so far in the current task before deciding whether more edits are needed.",
        },
        anti_example: {
          input: { repo_path: ".", scope: "stash_list" },
          why_wrong:
            "scope must be one of the tool's read-only options (status, branch, or diff_summary) — 'stash_list' is not a supported scope value; git_info exposes only those three read-only views.",
        },
      },
    },
    {
      name: "deno_task",
      description:
        "Run a standard Deno task (test, lint, fmt, check) at the given path. Use when you need to validate code quality or run tests within an agent strategy; returns output even when the task finds issues. Returns data.output (stdout), data.errorOutput, and data.exitCode.",
      parameters: {
        type: "object",
        properties: {
          task: {
            type: "string",
            enum: ["test", "lint", "fmt", "check"],
            description: "Task to run",
          },
          path: {
            type: "string",
            description: "Target path (file or directory, default: workspace root)",
          },
          args: {
            type: JsonSchemaType.ARRAY,
            items: { type: "string" },
            description: "Additional arguments or flags",
          },
        },
        required: ["task"],
      },
      sideEffectScope: ToolSideEffectScope.SYSTEM,
      aciDoc: {
        summary: "Runs one of a fixed set of standard Deno tasks (test, lint, fmt, check) at a given path.",
        when_to_use:
          "Use to validate code quality or run tests as part of an agent strategy, reading the output even when the task reports issues.",
        when_not_to_use:
          "Do not use for arbitrary shell commands — deno_task only accepts its four fixed task names; use run_command for anything else.",
        example: {
          input: { task: "check", path: "packages/core/src/" },
          output: '{"output":"Checked 42 files","exitCode":0}',
          rationale: "Type-checks the package after an edit, before considering the change complete.",
        },
        anti_example: {
          input: { task: "build" },
          why_wrong:
            "task must be exactly one of 'test', 'lint', 'fmt', or 'check' — 'build' is not one of the four supported values and is rejected.",
        },
      },
    },
    {
      name: ToolName.PATCH_FILE,
      description:
        "Apply a targeted search-and-replace patch to an existing file without full replacement. Use for targeted edits to a file; for complete file replacement use write_file. Returns data.path on success. Fails if the search string is not found, or found more than once (ambiguous).",
      nativeDescription:
        "PREFERRED for targeted edits (fixing bugs, refactoring, null-guard fixes). Modify specific lines in an existing file without rewriting the whole file. For complete replacements, choose write_file.",
      parameters: {
        type: "object",
        properties: {
          path: {
            type: "string",
            description: "Path to file to patch",
          },
          search: {
            type: "string",
            description:
              "Exact string to find in the file (including whitespace/indentation). Must match exactly once.",
          },
          replace: {
            type: "string",
            description: "Replacement string. Use empty string to delete the matched section.",
          },
        },
        required: ["path", "search", "replace"],
      },
      sideEffectScope: ToolSideEffectScope.PORTAL,
      aciDoc: {
        summary: "Applies a targeted search-and-replace patch to an existing file without rewriting its full content.",
        when_to_use:
          "Use for small, targeted edits to an existing file — e.g. fixing a bug or refactoring one line — when the search string is unique in the file.",
        when_not_to_use:
          "Do not use to create a new file or replace a file's entire content — use write_file; patch_file requires the search string to already exist exactly once and fails if it's missing or ambiguous.",
        example: {
          input: {
            path: "src/greeting.ts",
            search: "return `Hello, ${name}!`;",
            replace: "return `Hi there, ${name}!`;",
          },
          output: "src/greeting.ts",
          rationale:
            "Changes one specific line's wording without touching the rest of the file, keeping the diff minimal and reviewable.",
        },
        anti_example: {
          input: { path: "src/greeting.ts", search: "return" },
          why_wrong:
            "patch_file requires path, search, AND replace — replace is missing, leaving nothing to substitute.",
        },
      },
    },
    {
      name: ToolName.QUERY_RELATIONSHIPS,
      description:
        "List relationship edges leading forward from a layer name or file path in the current portal's knowledge graph (populated by 'portal analyze' standard/deep mode). Combines persisted file-import edges with layer-membership edges computed on demand. Use when you need to discover which files a layer contains or which files a given file imports internally; for the reverse direction (who imports a file) use who_depends_on. Optionally filter by edge kind. Returns an array of edge records in data, or an error if no portal-knowledge service is available or the current execution root is not a configured portal.",
      parameters: {
        type: "object",
        properties: {
          from: {
            type: "string",
            description: "A layer name or portal-relative file path to list outgoing edges from",
          },
          kind: {
            type: "string",
            enum: ["layer_contains_file", "file_imports_file_internal"],
            description: "Optional edge-kind filter",
          },
        },
        required: ["from"],
      },
      sideEffectScope: ToolSideEffectScope.NONE,
      aciDoc: {
        summary:
          "Lists relationship edges leading forward from a layer name or file path in the portal's knowledge graph.",
        when_to_use:
          "Use to discover which files belong to an architecture layer, or which files a given file imports internally, when navigating an unfamiliar codebase.",
        when_not_to_use:
          "Do not use to find who imports a given file — that's the reverse direction, use who_depends_on instead.",
        example: {
          input: { from: "services" },
          output: '[{"from":"services","to":"services/main.ts","kind":"layer_contains_file"}]',
          rationale: "Lists every file the 'services' layer contains, without reading any files directly.",
        },
        anti_example: {
          input: {},
          why_wrong: "query_relationships requires 'from' — there is no default starting point to list edges from.",
        },
      },
    },
    {
      name: ToolName.WHO_DEPENDS_ON,
      description:
        "List relationship edges pointing INTO a file path in the current portal's knowledge graph — the reverse of query_relationships. Use before changing or removing a file's exports, to find every file that imports it internally. Returns an array of edge records in data, or an error if no portal-knowledge service is available or the current execution root is not a configured portal.",
      parameters: {
        type: "object",
        properties: {
          path: {
            type: "string",
            description: "A portal-relative file path to find dependents of",
          },
        },
        required: ["path"],
      },
      sideEffectScope: ToolSideEffectScope.NONE,
      aciDoc: {
        summary: "Lists relationship edges pointing into a file path — the files that depend on it.",
        when_to_use: "Use before changing or removing a file's exports, to find every file that imports it internally.",
        when_not_to_use:
          "Do not use to list what a file itself imports — that's the forward direction, use query_relationships instead.",
        example: {
          input: { path: "util.ts" },
          output: '[{"from":"main.ts","to":"util.ts","kind":"file_imports_file_internal"}]',
          rationale: "Finds every file that imports util.ts before changing its exported signature.",
        },
        anti_example: {
          input: {},
          why_wrong: "who_depends_on requires 'path' — there is no default target to find dependents of.",
        },
      },
    },
    {
      name: ToolName.REMEMBER_FACT,
      description:
        "Persist a lightweight, execution-scoped 'worth remembering' note into the current execution's scratchpad so it survives beyond the current reasoning step. Use the moment you notice something useful (a gotcha, a constraint, a user preference, a debugging insight). Notes are captured raw — no scoring, no embedding — and are reviewed by later extraction passes, so keep each note self-contained and specific. Returns data.entry_id on success.",
      parameters: {
        type: "object",
        properties: {
          content: {
            type: "string",
            description: "The note text — self-contained, specific, and complete (never truncated)",
          },
          tags: {
            type: "array",
            items: { type: "string" },
            description: "Optional free-form tags, e.g. ['perf', 'gotcha']",
          },
        },
        required: ["content"],
      },
      sideEffectScope: ToolSideEffectScope.SYSTEM,
      aciDoc: {
        summary: "Persists a lightweight execution-scoped note into the run's scratchpad.",
        when_to_use:
          "Use the moment you notice something worth remembering later in the run (a gotcha, constraint, preference, or debugging insight) — capture in the moment beats reconstruction afterwards.",
        when_not_to_use:
          "Do not use for facts already recorded elsewhere (files, memory learnings) or for transient reasoning state — the scratchpad is for durable 'worth remembering' notes, not working scratch space.",
        example: {
          input: {
            content: "Rate limiter resets on full restart, not per-request — backoff must be process-lifetime aware",
            tags: ["gotcha"],
          },
          output: '{"entry_id":"3f9c…","created_at":"2026-09-01T10:00:00.000Z"}',
          rationale: "Captured in the moment so the later extraction pass can curate it into durable memory.",
        },
        anti_example: {
          input: {},
          why_wrong: "remember_fact requires 'content' — an empty call records nothing.",
        },
      },
    },
  ];
}
