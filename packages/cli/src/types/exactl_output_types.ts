/**
 * @module ExaCtlOutputTypes
 * @path packages/cli/src/types/exactl_output_types.ts
 * @description Output contract types of exactl: formats, leaf kinds, columns, sink, renderer and the global options.
 * @architectural-layer CLI
 * @dependencies [@exaix/core]
 * @related-files [apps/exactl/src/output/exactl_output.ts, packages/cli/mod.ts]
 */

import type { JSONValue } from "@exaix/core";
import type { Opt, Reason } from "@exaix/core/types";

/** The formats `-o/--output` accepts. */
export enum ExaCtlOutputFormat {
  TABLE = "table",
  JSON = "json",
  JSONL = "jsonl",
  MD = "md",
  TEXT = "text",
}

/** What a leaf prints. Its doc record declares it. The sweeps and lint rules derive their leaf sets from it. */
export enum ExaCtlOutputKind {
  /** Rows: a table for humans, a JSON array, JSONL. */
  COLLECTION = "collection",
  /** One entity: a text block, a JSON object. */
  ITEM = "item",
  /** Changes state: one stderr line, the updated entity with --json. */
  MUTATION = "mutation",
  /** Events over time: JSONL with -o jsonl. */
  STREAM = "stream",
  /** Owns stdout or the terminal: dashboard, mcp serve, daemon logs. */
  PROTOCOL = "protocol",
}

export interface IExaCtlColumn<T> {
  readonly header: string;
  readonly value: (row: T) => string;
}

/** Where rendered text goes. The default writes every byte to the process streams. */
export interface IExaCtlOutputSink {
  out(text: string): Promise<void>;
  err(text: string): Promise<void>;
}

export interface IExaCtlOutputRenderer {
  /** A collection: table/md/text for humans, a JSON array, or one JSON object per line. */
  list<T extends JSONValue>(
    rows: readonly T[],
    columns: readonly IExaCtlColumn<T>[],
    id: (row: T) => string,
  ): Promise<void>;
  /** One entity: text block for humans, one JSON object otherwise. */
  item<T extends JSONValue>(item: T, fields: readonly IExaCtlColumn<T>[]): Promise<void>;
  /** One streamed event (watch, log wait, eval progress). Always JSONL unless the format is a human one. */
  event(event: JSONValue): Promise<void>;
}

/** Global options every exactl command receives through cliffy globals. */
export interface IExaCtlGlobalOptions {
  readonly output: Opt<ExaCtlOutputFormat, Reason.OptionalInput>;
  /** Absent unless passed, because cliffy sets no default for a plain boolean option. */
  readonly json: Opt<boolean, Reason.OptionalInput>;
  readonly quiet: Opt<boolean, Reason.OptionalInput>;
  /** Cliffy maps --no-color to color: false and defaults it to true. */
  readonly color: boolean;
  /** Cliffy maps --no-input to input: false and defaults it to true. */
  readonly input: boolean;
  readonly yes: Opt<boolean, Reason.OptionalInput>;
}

/** What `exactl.ts` hands to an edition contribution so it renders like every other command. */
export interface IExaCtlContributionServices {
  createRenderer(options: IExaCtlGlobalOptions): IExaCtlOutputRenderer;
}
