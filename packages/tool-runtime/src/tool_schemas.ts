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
import { GIT_CMD_BRANCH, GIT_CMD_STATUS } from "@exaix/git";
import { JsonSchemaType, ToolName } from "@exaix/core";
import type { ITool } from "@exaix/core/types";

export const CORE_TOOL_SCHEMAS: ITool[] = [
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
  },
  {
    name: ToolName.WRITE_FILE,
    description:
      "Write or overwrite a file with the given content. Use when you need to create or replace a file in full; for targeted in-place edits use patch_file. Returns data.path (resolved absolute path) on success. Fails if path is outside allowed roots.",
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
          description: "Path to the directory to list",
        },
      },
      required: ["path"],
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
          description: "Directory to search in",
        },
      },
      required: ["pattern", "path"],
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
  },
  {
    name: ToolName.RUN_COMMAND,
    description:
      "Execute a whitelisted shell command (git, deno, npm, grep, ls, etc.) with argument validation. Use when you need to run a CLI tool or build script; for git repo inspection use git_info instead. Returns data.output (stdout string) and data.exitCode. Blocked or failed commands return a descriptive error.",
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
  },
  {
    name: ToolName.MOVE_FILE,
    description:
      "Move or rename a file from source to destination. Use when you need to relocate or rename a file; for duplicating a file without removing the original use copy_file. Returns data.source and data.destination on success. Fails if destination exists and overwrite is false.",
    parameters: {
      type: "object",
      properties: {
        source: { type: "string", description: "Source path" },
        destination: { type: "string", description: "Destination path" },
        overwrite: { type: "boolean", description: "Overwrite existing file (default: false)" },
      },
      required: ["source", "destination"],
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
          enum: [GIT_CMD_STATUS, GIT_CMD_BRANCH, "diff_summary"],
          description: "Information to retrieve (default: status)",
        },
      },
      required: ["repo_path"],
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
  },
  {
    name: ToolName.PATCH_FILE,
    description:
      "Apply sequential search-and-replace patches to an existing file without full replacement. Use for targeted edits to a file; for complete file replacement use write_file. Returns data.path and data.appliedCount on success. Fails if any search string is not found.",
    parameters: {
      type: "object",
      properties: {
        path: {
          type: "string",
          description: "Path to file to patch",
        },
        patches: {
          type: JsonSchemaType.ARRAY,
          items: {
            type: "object",
            properties: {
              search: { type: "string", description: "String to search for (exact match)" },
              replace: { type: "string", description: "String to replace with" },
            },
            required: ["search", "replace"],
          },
          description: "List of patches to apply sequentially",
        },
      },
      required: ["path", "patches"],
    },
  },
];
