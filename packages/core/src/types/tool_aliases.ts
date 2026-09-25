/**
 * @module ToolAliases
 * @path packages/core/src/types/tool_aliases.ts
 * @description Static, case-insensitive translation map from the tool and parameter names
 *   other agent tools use (glob, grep, Read, file_path, old_string, ...) to Exaix's canonical
 *   ToolName / McpToolName values and canonical parameter keys. Pure: no I/O, no logger.
 *   Lives in @exaix/core so the Zod schemas and the runtime blueprint loader can canonicalize
 *   stored names too; the registry-aware wrapper is tool-runtime's canonicalizeForRegistry.
 * @architectural-layer Shared
 * @dependencies []
 * @related-files [packages/core/src/types/enums.ts, packages/tool-runtime/src/tool_call_canonicalizer.ts]
 */

import { McpToolName, ToolName } from "./enums.ts";
import type { JSONValue } from "./json.ts";

export interface IToolAlias {
  canonical: ToolName | McpToolName;
}

export interface ICanonicalizedToolCall {
  name: string;
  params: Record<string, JSONValue>;
  /** True when the tool name or any parameter key was rewritten or dropped. */
  rewritten: boolean;
  requestedName: string;
  renamedParams: ReadonlyArray<{ from: string; to: string }>;
  /** Alias keys dropped because the canonical key (or an earlier alias of it) was present. */
  droppedParams: readonly string[];
}

/** Canonical parameter keys the alias tables rename to. */
const PATH_PARAM = "path";
const PATTERN_PARAM = "pattern";
const SEARCH_PARAM = "search";
const REPLACE_PARAM = "replace";

/** Tool-name aliases (lowercase key -> canonical tool). Targets are enum members, so they
 *  follow a canonical rename automatically. An alias never equals a canonical name. */
export const TOOL_ALIASES: Readonly<Record<string, IToolAlias>> = Object.freeze({
  glob: { canonical: ToolName.SEARCH_FILES },
  glob_file_search: { canonical: ToolName.SEARCH_FILES },
  file_search: { canonical: ToolName.SEARCH_FILES },
  find_files: { canonical: ToolName.SEARCH_FILES },
  grep: { canonical: ToolName.GREP_SEARCH },
  rg: { canonical: ToolName.GREP_SEARCH },
  ripgrep: { canonical: ToolName.GREP_SEARCH },
  text_search: { canonical: ToolName.GREP_SEARCH },
  search_file_content: { canonical: ToolName.GREP_SEARCH },
  grep_files: { canonical: ToolName.GREP_SEARCH },
  read: { canonical: ToolName.READ_FILE },
  read_text_file: { canonical: ToolName.READ_FILE },
  write: { canonical: ToolName.WRITE_FILE },
  create_file: { canonical: ToolName.WRITE_FILE },
  edit: { canonical: ToolName.PATCH_FILE },
  str_replace: { canonical: ToolName.PATCH_FILE },
  replace: { canonical: ToolName.PATCH_FILE },
  list_dir: { canonical: ToolName.LIST_DIRECTORY },
  ls: { canonical: ToolName.LIST_DIRECTORY },
  list: { canonical: ToolName.LIST_DIRECTORY },
  mkdir: { canonical: ToolName.CREATE_DIRECTORY },
  move: { canonical: ToolName.MOVE_FILE },
  mv: { canonical: ToolName.MOVE_FILE },
  rename_file: { canonical: ToolName.MOVE_FILE },
  copy: { canonical: ToolName.COPY_FILE },
  cp: { canonical: ToolName.COPY_FILE },
  delete: { canonical: ToolName.DELETE_FILE },
  rm: { canonical: ToolName.DELETE_FILE },
  remove_file: { canonical: ToolName.DELETE_FILE },
  webfetch: { canonical: ToolName.FETCH_URL },
  web_fetch: { canonical: ToolName.FETCH_URL },
  dependents: { canonical: ToolName.WHO_DEPENDS_ON },
  list_symbols: { canonical: ToolName.QUERY_SYMBOLS },
  save_memory: { canonical: ToolName.REMEMBER_FACT },
  list_tools: { canonical: ToolName.LIST_AVAILABLE_TOOLS },
});

/** Parameter aliases applied to any tool whose schema declares `path` and not the alias key. */
export const COMMON_PARAM_ALIASES: Readonly<Record<string, string>> = Object.freeze({
  file_path: PATH_PARAM,
  filePath: PATH_PARAM,
  filepath: PATH_PARAM,
  target_file: PATH_PARAM,
  absolute_path: PATH_PARAM,
  dir_path: PATH_PARAM,
  directory: PATH_PARAM,
  folder: PATH_PARAM,
});

/** Parameter aliases for one canonical tool (canonical tool -> alias key -> canonical key). */
export const TOOL_PARAM_ALIASES: Readonly<Partial<Record<string, Readonly<Record<string, string>>>>> = Object
  .freeze({
    [ToolName.SEARCH_FILES]: { query: PATTERN_PARAM },
    [ToolName.GREP_SEARCH]: { query: PATTERN_PARAM, regex: PATTERN_PARAM },
    [ToolName.PATCH_FILE]: {
      old_string: SEARCH_PARAM,
      oldString: SEARCH_PARAM,
      old_text: SEARCH_PARAM,
      new_string: REPLACE_PARAM,
      newString: REPLACE_PARAM,
      new_text: REPLACE_PARAM,
    },
    [ToolName.MOVE_FILE]: { source: "from", destination: "to" },
    [ToolName.COPY_FILE]: { from: "source", to: "destination" },
    [ToolName.QUERY_SYMBOLS]: { query: "name" },
    [ToolName.REMEMBER_FACT]: { fact: "content" },
  });

const CANONICAL_TOOL_NAMES: ReadonlySet<string> = new Set<string>([
  ...Object.values(ToolName),
  ...Object.values(McpToolName),
]);

/** Name-only canonicalization for allowlists, schema values and plan actions. Total and
 *  pure: an unknown name is returned unchanged. */
export function canonicalizeToolName(name: string): string {
  if (typeof name !== "string") return name;
  const key = name.trim().toLowerCase();
  if (CANONICAL_TOOL_NAMES.has(key)) return key;
  return Object.hasOwn(TOOL_ALIASES, key) ? TOOL_ALIASES[key].canonical : name;
}

/** Resolves the canonical key an alias parameter renames to, or undefined to keep it. A key
 *  the tool itself accepts is never renamed. Without `acceptedParams`, only per-tool aliases apply. */
function paramTarget(
  key: string,
  perTool: Readonly<Record<string, string>> | undefined,
  acceptedParams: ReadonlySet<string> | undefined,
): string | undefined {
  if (acceptedParams?.has(key)) return undefined;
  if (perTool && Object.hasOwn(perTool, key)) {
    const target = perTool[key];
    return acceptedParams === undefined || acceptedParams.has(target) ? target : undefined;
  }
  if (acceptedParams && Object.hasOwn(COMMON_PARAM_ALIASES, key)) {
    const target = COMMON_PARAM_ALIASES[key];
    return acceptedParams.has(target) ? target : undefined;
  }
  return undefined;
}

/** Defines an own enumerable key without triggering `__proto__` setter semantics. */
function defineParam(target: Record<string, JSONValue>, key: string, value: JSONValue): void {
  Object.defineProperty(target, key, { value, enumerable: true, writable: true, configurable: true });
}

/** Canonicalizes a tool name and renames alias parameter keys. It never throws and never
 *  changes values. When a canonical key and its alias are both present, the canonical value
 *  wins. The alias key is then listed in `droppedParams`. */
export function canonicalizeToolCall(
  name: string,
  params: Record<string, JSONValue>,
  acceptedParams?: ReadonlySet<string>,
): ICanonicalizedToolCall {
  const canonicalName = canonicalizeToolName(name);
  const source: Record<string, JSONValue> = params !== null && typeof params === "object" ? params : {};
  const perTool = Object.hasOwn(TOOL_PARAM_ALIASES, canonicalName) ? TOOL_PARAM_ALIASES[canonicalName] : undefined;
  const out: Record<string, JSONValue> = {};
  const renamedParams: Array<{ from: string; to: string }> = [];
  const droppedParams: string[] = [];

  for (const key of Object.keys(source)) {
    const target = paramTarget(key, perTool, acceptedParams);
    if (target === undefined) {
      defineParam(out, key, source[key]);
    } else if (Object.hasOwn(source, target) || Object.hasOwn(out, target)) {
      droppedParams.push(key);
    } else {
      defineParam(out, target, source[key]);
      renamedParams.push({ from: key, to: target });
    }
  }

  return {
    name: canonicalName,
    params: out,
    rewritten: canonicalName !== name || renamedParams.length > 0 || droppedParams.length > 0,
    requestedName: name,
    renamedParams,
    droppedParams,
  };
}
