/**
 * @module FilesystemAdapter
 * @path packages/triggers/adapters/filesystem_adapter.ts
 * @architectural-layer Triggers
 * @dependencies ["@exaix/core/triggers", "@std/path"]
 * @related-files ["packages/triggers/adapters/adapter_registry.ts"]
 * @ungrounded
 * @description Optional trigger adapter for filesystem-change signals. Guards against
 * path traversal attacks by rejecting paths containing ".." and paths that resolve
 * outside the configured `allowedDir`. Only paths within a known portal or workspace
 * directory produce a valid ExecutionTriggerEnvelope.
 */

import { resolve } from "@std/path";
import type { ExecutionTriggerEnvelope, ITriggerAdapter } from "@exaix/core/triggers";
import { normalizeIdempotencyKey } from "@exaix/core/triggers";
import { FilesystemEventKind } from "@exaix/core/types";

export interface IFilesystemAdapterConfig {
  /** Absolute path of the directory where file events are permitted. */
  allowedDir: string;
}

export interface IFilesystemInput {
  path: string;
  kind?: FilesystemEventKind;
}

export class FilesystemAdapter implements ITriggerAdapter<IFilesystemInput> {
  readonly source = "filesystem" as const;

  private readonly allowedDir: string;

  constructor(config: IFilesystemAdapterConfig) {
    this.allowedDir = resolve(config.allowedDir);
  }

  parse(rawInput: IFilesystemInput): Promise<ExecutionTriggerEnvelope> {
    if (!rawInput.path) {
      return Promise.reject(new Error("FilesystemAdapter: path must not be empty"));
    }

    if (rawInput.path.includes("..")) {
      return Promise.reject(
        new Error(`FilesystemAdapter: path traversal detected in "${rawInput.path}"`),
      );
    }

    const resolved = resolve(rawInput.path);

    const normalizedAllowed = this.allowedDir.endsWith("/") ? this.allowedDir : `${this.allowedDir}/`;

    if (!resolved.startsWith(normalizedAllowed) && resolved !== this.allowedDir) {
      return Promise.reject(
        new Error(
          `FilesystemAdapter: path "${resolved}" is outside allowed directory "${this.allowedDir}"`,
        ),
      );
    }

    const kind = rawInput.kind ?? FilesystemEventKind.CREATE;
    const now = new Date().toISOString();

    return Promise.resolve({
      triggerId: crypto.randomUUID(),
      source: "filesystem",
      action: "start_flow",
      idempotencyKey: normalizeIdempotencyKey(`fs-${resolved}-${kind}-${now}`),
      subject: rawInput.path,
      payload: { path: resolved, kind },
      metadata: {},
      occurredAt: now,
    });
  }
}
