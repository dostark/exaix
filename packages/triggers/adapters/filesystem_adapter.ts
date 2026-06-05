/**
 * @module FilesystemAdapter
 * @path packages/triggers/adapters/filesystem_adapter.ts
 * @architectural-layer Triggers
 * @dependencies ["@exaix/core/triggers", "@std/path"]
 * @related-files ["packages/triggers/adapters/adapter_registry.ts"]
 * @ungrounded
 * @description Optional trigger adapter for filesystem-change signals. Guards against
 * path traversal attacks by rejecting paths containing ".." and paths that resolve
 * outside the configured `allowedDir`. Uses `Deno.realpath()` to resolve symlinks
 * before the boundary check, preventing symlink-based traversal attacks.
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

  async parse(rawInput: IFilesystemInput): Promise<ExecutionTriggerEnvelope> {
    if (!rawInput.path) {
      throw new Error("FilesystemAdapter: path must not be empty");
    }

    if (rawInput.path.includes("..")) {
      throw new Error(`FilesystemAdapter: path traversal detected in "${rawInput.path}"`);
    }

    // Use Deno.realpath() when the path exists so symlinks are followed before
    // the boundary check. Fall back to pure path-math for paths that don't
    // exist yet (e.g., a create event received before the file is visible).
    let resolved: string;
    try {
      resolved = await Deno.realPath(rawInput.path);
    } catch {
      resolved = resolve(rawInput.path);
    }

    const normalizedAllowed = this.allowedDir.endsWith("/") ? this.allowedDir : `${this.allowedDir}/`;

    if (!resolved.startsWith(normalizedAllowed) && resolved !== this.allowedDir) {
      throw new Error(
        `FilesystemAdapter: path "${resolved}" is outside allowed directory "${this.allowedDir}"`,
      );
    }

    const kind = rawInput.kind ?? FilesystemEventKind.CREATE;
    const now = new Date().toISOString();

    return {
      triggerId: crypto.randomUUID(),
      source: "filesystem",
      action: "start_flow",
      idempotencyKey: normalizeIdempotencyKey(`fs-${resolved}-${kind}-${now}`),
      subject: rawInput.path,
      payload: { path: resolved, kind },
      metadata: {},
      occurredAt: now,
    };
  }
}
