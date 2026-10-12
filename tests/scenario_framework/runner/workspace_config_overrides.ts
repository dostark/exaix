/**
 * @module WorkspaceConfigOverrides
 * @path tests/scenario_framework/runner/workspace_config_overrides.ts
 * @description Patches a scenario's `workspace_config` overrides into the sandbox
 * `exa.config.toml`. A scenario that needs a non-default config value states it
 * here, so the shared framework config stays untouched for every other pack.
 *
 * The patch preserves comments and key order by editing lines, because the
 * sandbox config is seeded from the framework template and an operator reads it
 * when debugging a failed run.
 * @architectural-layer Test
 */

import type { WorkspaceConfigValue } from "../schema/scenario_schema.ts";

/** A dotted config path split into its segments, with quoted segments unquoted. */
export function splitConfigPath(key: string): string[] {
  const segments: string[] = [];
  let current = "";
  let inQuotes = false;
  for (const char of key) {
    if (char === '"') {
      inQuotes = !inQuotes;
      continue;
    }
    if (char === "." && !inQuotes) {
      segments.push(current);
      current = "";
      continue;
    }
    current += char;
  }
  segments.push(current);
  return segments;
}

/** Renders one value as TOML: strings quoted, numbers and booleans bare, arrays inline. */
export function renderTomlValue(value: WorkspaceConfigValue): string {
  if (typeof value === "string") return JSON.stringify(value);
  if (typeof value === "number") return String(value);
  if (typeof value === "boolean") return value ? "true" : "false";
  return `[${value.map((item) => renderTomlValue(item)).join(", ")}]`;
}

/** True when the line opens the named table (`[name]`) and not a sub-table. */
function opensTable(line: string, dottedPath: string): boolean {
  const trimmed = line.trim();
  if (!trimmed.startsWith("[") || trimmed.startsWith("[[")) return false;
  const inner = trimmed.replace(/^\[/, "").replace(/\]$/, "").trim();
  return inner === dottedPath;
}

/** True when the line assigns the named bare key at the start of the line. */
function assignsKey(line: string, key: string): boolean {
  const trimmed = line.trim();
  if (trimmed.startsWith("#") || trimmed.startsWith("[")) return false;
  const equals = trimmed.indexOf("=");
  if (equals < 0) return false;
  return trimmed.slice(0, equals).trim() === key;
}

/**
 * Patches `overrides` into TOML `content`.
 *
 * An existing key is replaced in place so its position and the file's comments
 * survive. A missing key is appended to its table. A missing table is appended
 * at the end of the file.
 */
export function patchWorkspaceConfig(
  content: string,
  overrides: { [key: string]: WorkspaceConfigValue },
): string {
  const lines = content.split("\n");
  // Work on a copy so a table appended for one key is visible to the next.
  const working = [...lines];

  for (const [dottedKey, value] of Object.entries(overrides)) {
    const segments = splitConfigPath(dottedKey);
    const leaf = segments[segments.length - 1];
    const tablePath = segments.slice(0, -1).join(".");
    const rendered = `${leaf} = ${renderTomlValue(value)}`;

    // Find the table's line range, then the leaf key inside it.
    let tableStart = -1;
    let tableEnd = working.length;
    if (tablePath !== "") {
      for (let i = 0; i < working.length; i++) {
        if (opensTable(working[i], tablePath)) {
          tableStart = i;
          break;
        }
      }
      if (tableStart >= 0) {
        for (let i = tableStart + 1; i < working.length; i++) {
          const trimmed = working[i].trim();
          if (trimmed.startsWith("[") && !trimmed.startsWith("#")) {
            tableEnd = i;
            break;
          }
        }
      }
    }

    let replaced = false;
    const searchFrom = tablePath === "" ? 0 : tableStart + 1;
    const searchTo = tablePath === "" ? tableStart : tableEnd;
    if (tablePath === "" || tableStart >= 0) {
      for (let i = searchFrom; i < searchTo; i++) {
        if (assignsKey(working[i], leaf)) {
          working[i] = rendered;
          replaced = true;
          break;
        }
      }
    }

    if (!replaced) {
      if (tablePath === "" || tableStart < 0) {
        // Append the table (when needed) and the key at the end of the file.
        if (tablePath !== "") working.push(`[${tablePath}]`);
        working.push(rendered);
      } else {
        // Insert directly after the table header's existing keys.
        let insertAt = tableStart + 1;
        while (insertAt < tableEnd && working[insertAt].trim() !== "") insertAt++;
        working.splice(insertAt, 0, rendered);
      }
    }
  }

  return working.join("\n");
}
