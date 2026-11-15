/**
 * @module ExaCtlJsonNarrow
 * @path apps/exactl/src/output/json_narrow.ts
 * @description Reads a string, a number or a plain object out of a value of unknown shape by parsing it with a schema.
 * @architectural-layer CLI
 * @dependencies [zod]
 * @related-files [apps/exactl/src/output/exactl_output.ts, apps/exactl/src/docs/command_tree_walk.ts]
 */

import type { JSONObject } from "@exaix/core/types";
import { z } from "zod";

const STRING_SCHEMA = z.string();
const NUMBER_SCHEMA = z.number();
const OBJECT_SCHEMA = z.record(z.string(), z.any());

/** The value when it is a string, otherwise undefined. */
export function stringOf<TValue>(value: TValue): string | undefined {
  const parsed = STRING_SCHEMA.safeParse(value);
  return parsed.success ? parsed.data : undefined;
}

/** The value when it is a number, otherwise undefined. */
export function numberOf<TValue>(value: TValue): number | undefined {
  const parsed = NUMBER_SCHEMA.safeParse(value);
  return parsed.success ? parsed.data : undefined;
}

/** The value when it is a plain object and not an array, otherwise undefined. */
export function objectOf<TValue>(value: TValue): JSONObject | undefined {
  const parsed = OBJECT_SCHEMA.safeParse(value);
  return parsed.success ? parsed.data : undefined;
}
