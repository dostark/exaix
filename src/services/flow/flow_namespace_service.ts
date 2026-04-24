/**
 * @module FlowNamespaceService
 * @path src/services/flow/flow_namespace_service.ts
 * @description Runtime contract surface for flow namespace persistence and shared blackboard coordination.
 * @architectural-layer Services
 * @related-files [src/shared/schemas/flow.ts, src/services/flow/flow_checkpoint_service.ts]
 */

import { ensureDir, exists } from "@std/fs";
import { dirname, join } from "@std/path";
import { DEFAULT_NAMESPACE_MAX_BYTES } from "../../shared/constants.ts";
import type { Config } from "@exaix/schemas/config.ts";
import { type IFlowNamespaceEntry, type IFlowNamespaceWrite, ZFlowNamespaceEntry } from "@exaix/schemas/flow.ts";

export interface IFlowNamespaceSnapshot {
  traceId: string;
  path: string;
  entries: Record<string, string>;
  updatedAt: string;
}

export interface IFlowNamespaceService {
  getNamespacePath(traceId: string): string;
  initialize(traceId: string): Promise<IFlowNamespaceSnapshot>;
  load(traceId: string): Promise<IFlowNamespaceSnapshot>;
  readKeys(traceId: string, keys: string[]): Promise<Record<string, string | undefined>>;
  writeEntries(
    traceId: string,
    stepId: string,
    writes: IFlowNamespaceWrite[],
    stepOutput: string,
  ): Promise<IFlowNamespaceSnapshot>;
  delete(traceId: string): Promise<void>;
}

export class NamespaceQuotaExceededError extends Error {
  constructor(traceId: string, byteSize: number, maxBytes: number) {
    super(`Namespace quota exceeded for ${traceId}: ${byteSize} bytes > ${maxBytes} limit`);
    this.name = "NamespaceQuotaExceededError";
  }
}

const NAMESPACE_FILE_NAME = "namespace.md";
const NAMESPACE_HEADER = "# Flow Namespace";
const NAMESPACE_ENTRY_HEADING_PREFIX = "## ";
const VALID_NAMESPACE_KEY_PATTERN = /^[a-zA-Z0-9._-]+$/;
const MAX_NAMESPACE_ENTRY_BYTES = 8192;
const TEXT_ENCODER = new TextEncoder();

interface IParsedNamespaceSection {
  key: string;
  authorStepId: string;
  updatedAt: string;
  value: string;
}

import type { JSONValue } from "../../shared/types/json.ts";

type INamespacePathObject = { [key: string]: JSONValue };

export class FlowNamespaceService implements IFlowNamespaceService {
  constructor(private readonly config: Config) {}

  getNamespacePath(traceId: string): string {
    const executionRoot = this.config.paths.memoryExecution.includes("/")
      ? this.config.paths.memoryExecution
      : join(this.config.paths.memory, this.config.paths.memoryExecution);

    return join(this.config.system.root, executionRoot, traceId, NAMESPACE_FILE_NAME);
  }

  async initialize(traceId: string): Promise<IFlowNamespaceSnapshot> {
    return await this.load(traceId);
  }

  async load(traceId: string): Promise<IFlowNamespaceSnapshot> {
    const entries = await this.loadEntryList(traceId);
    return this.createSnapshot(traceId, entries);
  }

  async readKeys(traceId: string, keys: string[]): Promise<Record<string, string | undefined>> {
    const snapshot = await this.load(traceId);
    return Object.fromEntries(keys.map((key) => [key, snapshot.entries[key]]));
  }

  async writeEntries(
    traceId: string,
    stepId: string,
    writes: IFlowNamespaceWrite[],
    stepOutput: string,
  ): Promise<IFlowNamespaceSnapshot> {
    const existingEntries = await this.loadEntryList(traceId);
    const entriesByKey = new Map(existingEntries.map((entry) => [entry.key, entry]));
    const updatedAt = new Date().toISOString();

    for (const write of writes) {
      if (!VALID_NAMESPACE_KEY_PATTERN.test(write.key)) {
        console.warn(`Skipping invalid flow namespace key: ${write.key}`);
        continue;
      }

      const extractedValue = this.extractWriteValue(write, stepOutput);
      const cappedValue = this.capValueBytes(
        extractedValue,
        Math.min(DEFAULT_NAMESPACE_MAX_BYTES, MAX_NAMESPACE_ENTRY_BYTES),
      );
      const previousEntry = entriesByKey.get(write.key);
      const nextValue = write.mode === "append" && previousEntry
        ? `${previousEntry.value}\n${cappedValue}`
        : cappedValue;

      entriesByKey.set(write.key, {
        key: write.key,
        value: nextValue,
        authorStepId: stepId,
        updatedAt,
      });
    }

    const nextEntries = [...entriesByKey.values()].sort((left, right) => left.key.localeCompare(right.key));
    const rendered = this.renderMarkdown(nextEntries);
    const byteSize = TEXT_ENCODER.encode(rendered).length;
    if (byteSize > DEFAULT_NAMESPACE_MAX_BYTES) {
      throw new NamespaceQuotaExceededError(traceId, byteSize, DEFAULT_NAMESPACE_MAX_BYTES);
    }

    if (nextEntries.length === 0) {
      return this.createSnapshot(traceId, []);
    }

    const namespacePath = this.getNamespacePath(traceId);
    await ensureDir(dirname(namespacePath));
    await Deno.writeTextFile(namespacePath, rendered);
    return this.createSnapshot(traceId, nextEntries);
  }

  async delete(traceId: string): Promise<void> {
    const namespacePath = this.getNamespacePath(traceId);
    if (!(await exists(namespacePath))) {
      return;
    }

    await Deno.remove(namespacePath);
  }

  private async loadEntryList(traceId: string): Promise<IFlowNamespaceEntry[]> {
    const namespacePath = this.getNamespacePath(traceId);
    if (!(await exists(namespacePath))) {
      return [];
    }

    const raw = await Deno.readTextFile(namespacePath);
    const parsedEntries = this.parseMarkdown(raw);
    return parsedEntries.map((entry) => ZFlowNamespaceEntry.parse(entry));
  }

  private createSnapshot(traceId: string, entries: IFlowNamespaceEntry[]): IFlowNamespaceSnapshot {
    const updatedAt = entries.reduce((latest, entry) => {
      return latest > entry.updatedAt ? latest : entry.updatedAt;
    }, "");

    return {
      traceId,
      path: this.getNamespacePath(traceId),
      entries: Object.fromEntries(entries.map((entry) => [entry.key, entry.value])),
      updatedAt,
    };
  }

  private parseMarkdown(raw: string): IParsedNamespaceSection[] {
    const normalized = raw.trim();
    if (normalized.length === 0) {
      return [];
    }

    const sections = normalized.split(/^## /m).slice(1);
    return sections.map((section) => this.parseSection(section));
  }

  private parseSection(section: string): IParsedNamespaceSection {
    const lines = section.split("\n");
    const key = lines.shift()?.trim() ?? "";
    let authorStepId = "";
    let updatedAt = "";

    while (lines.length > 0 && lines[0].startsWith("<!-- ")) {
      const metadataLine = lines.shift() ?? "";
      if (metadataLine.startsWith("<!-- authorStepId: ")) {
        authorStepId = metadataLine.replace("<!-- authorStepId: ", "").replace(" -->", "").trim();
      }
      if (metadataLine.startsWith("<!-- updatedAt: ")) {
        updatedAt = metadataLine.replace("<!-- updatedAt: ", "").replace(" -->", "").trim();
      }
    }

    if (lines[0] === "") {
      lines.shift();
    }

    return {
      key,
      authorStepId,
      updatedAt,
      value: lines.join("\n").trimEnd(),
    };
  }

  private renderMarkdown(entries: IFlowNamespaceEntry[]): string {
    const sections = entries.map((entry) => {
      return [
        `${NAMESPACE_ENTRY_HEADING_PREFIX}${entry.key}`,
        `<!-- authorStepId: ${entry.authorStepId} -->`,
        `<!-- updatedAt: ${entry.updatedAt} -->`,
        "",
        entry.value,
      ].join("\n");
    });

    return [NAMESPACE_HEADER, "", ...sections].join("\n\n").trimEnd() + "\n";
  }

  private extractWriteValue(write: IFlowNamespaceWrite, stepOutput: string): string {
    if (!write.from) {
      return stepOutput;
    }

    let parsedOutput: JSONValue;
    try {
      parsedOutput = JSON.parse(stepOutput);
    } catch {
      console.warn(`Flow namespace write fallback for ${write.key}: step output is not valid JSON`);
      return stepOutput;
    }

    const extracted = this.resolveDotPath(parsedOutput, write.from);
    if (extracted === undefined) {
      console.warn(`Flow namespace write fallback for ${write.key}: missing JSON path ${write.from}`);
      return stepOutput;
    }

    return typeof extracted === "string" ? extracted : JSON.stringify(extracted);
  }

  private resolveDotPath(source: JSONValue, path: string): JSONValue {
    const segments = path.split(".").filter((segment) => segment.length > 0);
    let current: JSONValue = source;

    for (const segment of segments) {
      if (typeof current !== "object" || current === null || !(segment in current)) {
        return undefined;
      }
      current = (current as INamespacePathObject)[segment];
    }

    return current;
  }

  private capValueBytes(value: string, maxBytes: number): string {
    if (TEXT_ENCODER.encode(value).length <= maxBytes) {
      return value;
    }

    let endIndex = value.length;
    while (endIndex > 0 && TEXT_ENCODER.encode(value.slice(0, endIndex)).length > maxBytes) {
      endIndex -= 1;
    }

    return value.slice(0, endIndex);
  }
}
