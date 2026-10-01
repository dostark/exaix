/**
 * @module RunBindingsStore
 * @path packages/ai/src/bindings/run_bindings_store.ts
 * @description Persists and claims per-run operator binding files beneath the runtime
 *   directory (<system.root>/.exa/run-bindings/). Write is exclusive and atomic
 *   (temp-file rename). Claim binds the file to the trusted request path and the SHA-256
 *   of the exact request bytes the daemon parsed, so a request file can never inherit
 *   an operator's bindings by reusing a trace id. Claims are single-use per distinct
 *   request; the same request may re-claim during a checkpoint resume.
 * @architectural-layer AI
 * @dependencies [@exaix/schemas, @exaix/core]
 * @related-files [packages/ai/src/bindings/binding_layers.ts, packages/ai/src/bindings/model_binding_service.ts]
 */

import { join } from "@std/path";
import type { Config } from "@exaix/schemas/config.ts";
import type { IRunBindingsFile } from "@exaix/schemas";
import { BINDING_OVERLAY_MAX_BYTES, RUN_BINDINGS_DIR } from "@exaix/core";
import type { Opt, Reason } from "@exaix/core/types";

export interface IRunBindingsStore {
  write(file: IRunBindingsFile): Promise<string>;
  claim(
    traceId: string,
    requestPath: string,
    requestSha256: string,
  ): Promise<Opt<IRunBindingsFile, Reason.OptionalContext>>;
  /** True when a run file exists for the trace. It does not claim the file. */
  exists(traceId: string): Promise<boolean>;
  pruneOlderThan(days: number, now: Date): Promise<number>;
}

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** Raised for any operator run-binding file that fails the claim/identity checks. */
export class OverlayClaimError extends Error {
  constructor(detail: string) {
    super(`overlay_invalid: ${detail}`);
    this.name = "OverlayClaimError";
  }
}

/** Per-run operator run-binding file store. */
export class RunBindingsStore implements IRunBindingsStore {
  private readonly root: string;
  /** Traces claimed this process lifetime, keyed by trace id → the request identity. */
  private readonly claims = new Map<string, { requestPath: string; requestSha256: string }>();

  constructor(config: Config) {
    this.root = join(config.system.root, config.paths.runtime, RUN_BINDINGS_DIR);
  }

  /** The absolute run-file path for a trace id. */
  private pathFor(traceId: string): string {
    if (!UUID_PATTERN.test(traceId)) {
      throw new OverlayClaimError(`trace id is not a UUID: ${traceId}`);
    }
    return join(this.root, `${traceId}.json`);
  }

  /** Persist a run-binding file exclusively. Path derives from the trace id. */
  async write(file: IRunBindingsFile): Promise<string> {
    const path = this.pathFor(file.trace_id);
    const serialized = JSON.stringify(file);
    if (new TextEncoder().encode(serialized).length > BINDING_OVERLAY_MAX_BYTES) {
      throw new OverlayClaimError("run binding file exceeds the byte ceiling");
    }
    const tempDir = await this.ensureDir();
    const tempPath = join(tempDir, `.tmp-${file.trace_id}-${crypto.randomUUID()}`);
    await Deno.writeTextFile(tempPath, serialized);
    try {
      await Deno.rename(tempPath, path);
    } catch (error) {
      await Deno.remove(tempPath).catch(() => {});
      throw error;
    }
    return path;
  }

  /** Whether a regular run file exists for the trace. A non-UUID trace never has one. */
  async exists(traceId: string): Promise<boolean> {
    if (!UUID_PATTERN.test(traceId)) return false;
    try {
      return (await Deno.lstat(this.pathFor(traceId))).isFile;
    } catch {
      return false;
    }
  }

  /** Claim a run file for a request, verifying trace id, path and content hash.
   *  Returns the file, or undefined when no run file exists for that trace.
   *  A plain request carries no operator bindings.
   *  A repeated claim for the same request returns the saved file.
   *  A different request, or a malformed file, rejects with overlay_invalid. */
  async claim(
    traceId: string,
    requestPath: string,
    requestSha256: string,
  ): Promise<Opt<IRunBindingsFile, Reason.OptionalContext>> {
    if (!UUID_PATTERN.test(traceId)) {
      throw new OverlayClaimError(`trace id is not a UUID: ${traceId}`);
    }

    const path = this.pathFor(traceId);

    const existing = this.claims.get(traceId);
    if (existing && (existing.requestPath !== requestPath || existing.requestSha256 !== requestSha256)) {
      throw new OverlayClaimError(`trace ${traceId} is already claimed by a different request`);
    }

    let info;
    try {
      info = await Deno.lstat(path);
    } catch (error) {
      if (error instanceof Deno.errors.NotFound) return undefined;
      throw new OverlayClaimError(`cannot stat run binding file: ${traceId}`);
    }
    if (!info.isFile) throw new OverlayClaimError(`not a regular file: ${path}`);

    let raw: string;
    try {
      raw = await Deno.readTextFile(path);
    } catch {
      throw new OverlayClaimError(`cannot read run binding file: ${traceId}`);
    }

    let parsed: IRunBindingsFile;
    try {
      parsed = JSON.parse(raw) as IRunBindingsFile;
    } catch {
      throw new OverlayClaimError("run binding file is not valid JSON");
    }

    if (parsed.request_path !== requestPath || parsed.request_sha256 !== requestSha256) {
      throw new OverlayClaimError("run binding file does not match the request path or content hash");
    }
    this.claims.set(traceId, { requestPath, requestSha256 });
    return parsed;
  }

  /** Prune run files older than the retention window. Returns the number removed. */
  async pruneOlderThan(days: number, now: Date): Promise<number> {
    const cutoff = now.getTime() - days * 24 * 60 * 60 * 1000;
    let removed = 0;
    try {
      for await (const entry of Deno.readDir(this.root)) {
        if (!entry.isFile) continue;
        const path = join(this.root, entry.name);
        const info = await Deno.lstat(path);
        if (info.mtime && info.mtime.getTime() < cutoff) {
          await Deno.remove(path).catch(() => {});
          removed++;
        }
      }
    } catch {
      // The directory may not exist yet — nothing to prune.
    }
    return removed;
  }

  private async ensureDir(): Promise<string> {
    await Deno.mkdir(this.root, { recursive: true });
    return this.root;
  }
}
