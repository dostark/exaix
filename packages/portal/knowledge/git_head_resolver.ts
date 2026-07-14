/**
 * @module GitHeadResolver
 * @path packages/portal/knowledge/git_head_resolver.ts
 * @description Helper for resolving git HEAD SHA and changed files since a cached commit.
 * @architectural-layer Services
 * @related-files [packages/portal/knowledge/portal_knowledge_service.ts]
 */

import { join } from "@std/path";
import type { IGitServiceFactory, Opt, Reason } from "@exaix/core/types";

export interface IGitHeadResolver {
  resolve(portalPath: string): Promise<string | null>;
  changedFilesSince(portalPath: string, fromSha: string): Promise<string[] | null>;
  startWatching(
    portalPath: string,
    onHeadChange: (newHash: string, prevHash: string) => void,
    options?: { signal?: AbortSignal },
  ): void;
  stopWatching(): void;
}

const DEFAULT_DEBOUNCE_MS = 100;

export class GitHeadResolver implements IGitHeadResolver {
  constructor(private readonly gitServiceFactory?: IGitServiceFactory) {}
  private _watcher: Deno.FsWatcher | null = null;
  private _abortController: AbortController | null = null;
  private _debounceTimer: ReturnType<typeof setTimeout> | null = null;
  private _previousHash: string | null = null;

  async resolve(portalPath: string): Promise<string | null> {
    if (!this.gitServiceFactory) return null;
    try {
      const service = this.gitServiceFactory.createGitService(portalPath, "git-head-resolver");
      const result = await service.runGitCommand(["rev-parse", "HEAD"], { throwOnError: false });
      return result.exitCode === 0 ? result.output.trim() : null;
    } catch {
      return null;
    }
  }

  async changedFilesSince(portalPath: string, fromSha: string): Promise<string[] | null> {
    if (!this.gitServiceFactory) return null;
    try {
      const service = this.gitServiceFactory.createGitService(portalPath, "git-head-resolver");
      const result = await service.runGitCommand(
        ["diff", "--name-only", fromSha, "HEAD"],
        { throwOnError: false },
      );
      if (result.exitCode !== 0) return null;
      return result.output.split("\n").map((line) => line.trim()).filter((line) => line.length > 0);
    } catch {
      return null;
    }
  }

  startWatching(
    portalPath: string,
    onHeadChange: (newHash: string, prevHash: string) => void,
    options?: Opt<{ signal?: AbortSignal }, Reason.CancellationOptional>,
  ): void {
    if (this._abortController) return;
    this._abortController = new AbortController();

    const externalSignal = options?.signal;
    if (externalSignal) {
      externalSignal.addEventListener("abort", () => {
        this.stopWatching();
      }, { once: true });
    }

    const headPath = join(portalPath, ".git", "HEAD");
    try {
      // Hand-rolled loop below already debounces + compares HEAD hashes (idempotent by content) +
      // isolates errors, so it is safe. Adopt @exaix/core/fs `consumeFsEvents` (CODE_STYLE §7
      // Filesystem Watching) when next refactored, to converge on the shared pattern.
      this._watcher = Deno.watchFs(headPath);
      this._watchLoop(portalPath, onHeadChange, this._abortController.signal);
    } catch {
      // File may not exist yet; best-effort
    }
  }

  stopWatching(): void {
    if (this._debounceTimer) {
      clearTimeout(this._debounceTimer);
      this._debounceTimer = null;
    }
    if (this._abortController) {
      this._abortController.abort();
      this._abortController = null;
    }
    if (this._watcher) {
      try {
        this._watcher.close();
      } catch {
        // Already closed
      }
      this._watcher = null;
    }
    this._previousHash = null;
  }

  private async _watchLoop(
    portalPath: string,
    onHeadChange: (newHash: string, prevHash: string) => void,
    signal: AbortSignal,
  ): Promise<void> {
    this._previousHash = await this.resolve(portalPath);

    try {
      for await (const event of this._watcher!) {
        if (signal.aborted) break;
        if (event.kind === "modify") {
          if (this._debounceTimer) clearTimeout(this._debounceTimer);
          this._debounceTimer = setTimeout(() => {
            this._debounceTimer = null;
            this._onHeadChangeDebounced(portalPath, onHeadChange);
          }, DEFAULT_DEBOUNCE_MS);
        }
      }
    } catch {
      // Watcher closed
    }
  }

  private async _onHeadChangeDebounced(
    portalPath: string,
    onHeadChange: (newHash: string, prevHash: string) => void,
  ): Promise<void> {
    const newHash = await this.resolve(portalPath);
    if (newHash && newHash !== this._previousHash) {
      const prevHash = this._previousHash;
      this._previousHash = newHash;
      onHeadChange(newHash, prevHash!);
    } else if (newHash === null) {
      this._previousHash = null;
    }
  }
}
