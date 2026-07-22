/**
 * @module TomlActionBlocks
 * @path packages/core/src/planning/toml_action_blocks.ts
 * @description Extracts step-scoped TOML_BLOCK:N sentinel-marked fenced ```toml action
 *   blocks from a raw plan-generation <content> response, so a model can write a
 *   write_file.content or patch_file.search/replace value as plain TOML triple-quoted
 *   text instead of JSON-escaping it inline. Pure, standalone primitive — no
 *   integration with PlanAdapter yet (wired in Phase 151 Step 2).
 * @architectural-layer Services
 * @dependencies ["@std/toml", "@exaix/schemas/plan_schema.ts", "@exaix/core/types"]
 * @related-files ["packages/core/src/planning/plan_adapter.ts", "packages/execution/src/execution_loop.ts", "packages/core/src/types/constants.ts"]
 */

import { parse as parseToml } from "@std/toml";
import type { IPlanAction } from "@exaix/schemas/plan_schema.ts";
import { TOML_ACTION_BLOCK_MARKER_PATTERN } from "../types/constants.ts";
import type { JSONValue } from "@exaix/core";

/** Result of extracting TOML action blocks from a raw plan-generation response. */
export interface ITomlActionBlockExtraction {
  /** The original text with every matched fenced block removed; TOML_BLOCK:N sentinel
   *  strings left in place inside the JSON envelope for the caller to substitute. */
  envelope: string;
  /** Parsed actions grouped by their TOML_BLOCK:N marker number, in source order. */
  actionsByBlock: Map<number, IPlanAction[]>;
}

interface IParsedTomlActionRoot {
  tool?: unknown;
  description?: unknown;
  params?: unknown;
}

function parseActionBlock(markerNumber: number, tomlBody: string): IPlanAction {
  let parsed: unknown;
  try {
    parsed = parseToml(tomlBody);
  } catch (error) {
    throw new Error(
      `TOML_BLOCK:${markerNumber} contains invalid TOML: ${error instanceof Error ? error.message : String(error)}`,
    );
  }

  if (parsed === null || typeof parsed !== "object" || Array.isArray(parsed)) {
    throw new Error(`TOML_BLOCK:${markerNumber} does not contain a flat action object at its TOML root.`);
  }

  const root = parsed as IParsedTomlActionRoot;

  if ("action" in root || "actions" in root) {
    throw new Error(
      `TOML_BLOCK:${markerNumber} contains an [[action]]/[[actions]] array-of-tables — each fenced ` +
        `block must hold exactly one flat action (tool/description/[params] at the TOML root). ` +
        `A step needing multiple actions reuses the same TOML_BLOCK:${markerNumber} marker across ` +
        `multiple separate fenced blocks instead.`,
    );
  }

  if (typeof root.tool !== "string") {
    throw new Error(`TOML_BLOCK:${markerNumber} is missing a required "tool" field at its TOML root.`);
  }

  if (root.params !== undefined && Array.isArray(root.params)) {
    throw new Error(
      `TOML_BLOCK:${markerNumber} has "params" as an inline array — each fenced ` +
        `block's [params] must be a TOML table, not an array. Use [params]\\nkey = "value" format.`,
    );
  }

  const action: IPlanAction = {
    tool: root.tool as IPlanAction["tool"],
    params:
      (root.params && typeof root.params === "object" && !Array.isArray(root.params) ? root.params : {}) as Record<
        string,
        JSONValue
      >,
  };
  if (typeof root.description === "string") {
    action.description = root.description;
  }
  return action;
}

/**
 * Finds every TOML_BLOCK:N-marked fenced ```toml block in rawContent, parses each into
 * an IPlanAction, and returns the surrounding text with those blocks removed. A step
 * needing multiple actions reuses the same marker number across multiple separate
 * fenced blocks — all contribute, in source order, to that marker's action list.
 *
 * Returns { envelope: rawContent, actionsByBlock: new Map() } unchanged when rawContent
 * contains no TOML_BLOCK:N fence at all (the guaranteed no-op path for pure-JSON plans).
 */
export function extractTomlActionBlocks(rawContent: string): ITomlActionBlockExtraction {
  const actionsByBlock = new Map<number, IPlanAction[]>();

  const envelope = rawContent.replace(TOML_ACTION_BLOCK_MARKER_PATTERN, (_match, markerStr: string, body: string) => {
    const markerNumber = Number(markerStr);
    const action = parseActionBlock(markerNumber, body);
    const existing = actionsByBlock.get(markerNumber);
    if (existing) {
      existing.push(action);
    } else {
      actionsByBlock.set(markerNumber, [action]);
    }
    return "";
  });

  return { envelope, actionsByBlock };
}
