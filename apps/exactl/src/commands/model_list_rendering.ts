/**
 * @module ModelListRendering
 * @path apps/exactl/src/commands/model_list_rendering.ts
 * @description Pure rendering helpers of `exactl model list`: price, verified date, stale flag and the registry table.
 * @architectural-layer CLI
 * @dependencies ["@cliffy/table", "@std/fmt/colors"]
 * @related-files ["apps/exactl/src/commands/model_commands.ts"]
 */

import * as colors from "@std/fmt/colors";
import { Table } from "@cliffy/table";
import type { Opt, Reason } from "@exaix/core/types";

export const NO_VALUE = "-";

const MS_PER_DAY = 24 * 60 * 60 * 1000;
const VERIFIED_DATE_LENGTH = 10;
const BASE_HEADERS = [
  "Model",
  "Author",
  "Service",
  "Route",
  "Provenance",
  "Source URL",
  "Verified",
  "Stale",
  "Input $/Mtok",
  "Output $/Mtok",
];

export function renderVerifiedAt(verifiedAt: Opt<number, Reason.OptionalInput>): string {
  return verifiedAt === undefined ? NO_VALUE : new Date(verifiedAt).toISOString().slice(0, VERIFIED_DATE_LENGTH);
}

/** "yes" when the price is older than the limit in days, "-" when it has no verification date. */
export function renderStale(verifiedAt: Opt<number, Reason.OptionalInput>, maxDays: number): string {
  if (verifiedAt === undefined) return NO_VALUE;
  return Date.now() - verifiedAt > maxDays * MS_PER_DAY ? "yes" : "no";
}

export function renderPrice(price: Opt<number, Reason.OptionalInput>): string {
  return price === undefined ? NO_VALUE : `$${price}`;
}

/** Prints the registry table. A benchmark name adds an advisory score column. */
export function renderModelTable(rows: string[][], benchmark: Opt<string, Reason.OptionalInput>): void {
  const headers = benchmark ? [...BASE_HEADERS, `Benchmark (${benchmark}, advisory)`] : BASE_HEADERS;
  const table = new Table().header(headers.map((header) => colors.bold(header))).body(rows);
  console.log(colors.cyan(colors.bold("\nModel Registry (Solo floor)")));
  table.render();
  console.log("");
}
