/**
 * @module RoutingPolicyLoader
 * @path packages/routing/src/routing_policy_loader.ts
 * @description Loads and validates routing policy YAML files for the routing policy layer.
 * @architectural-layer Services
 * @related-files ["packages/schemas/src/routing_policy.ts"]
 */

import { join } from "@std/path";
import { parse as parseYaml } from "@std/yaml";
import { type IRoutingPolicy, ZRoutingPolicy } from "@exaix/schemas/routing_policy.ts";
import type { Config } from "@exaix/schemas/config.ts";

export interface IRoutingPolicyLoaderOptions {
  config: Config;
  root: string;
}

export interface IRoutingPolicyLoadResult {
  success: boolean;
  policy: IRoutingPolicy;
  errors?: string[];
  path: string;
}

export class RoutingPolicyLoader {
  private readonly policyPath: string;
  private cachedPolicy: IRoutingPolicy | null = null;
  private cachedMtimeMs: number | null = null;
  private watcher: Deno.FsWatcher | null = null;

  constructor(options: IRoutingPolicyLoaderOptions) {
    const routingConfig = options.config.routing;
    this.policyPath = join(options.root, routingConfig?.policy_path ?? ".exaix/routing.policy.yaml");
  }

  /**
   * Start watching the policy file for changes.
   * On modify events, the internal cache is invalidated so the next
   * loadPolicy() call re-reads the file.
   */
  startWatching(): void {
    try {
      this.watcher = Deno.watchFs(this.policyPath);
      this.watchLoop();
    } catch {
      // File may not exist yet; watching is best-effort
    }
  }

  private async watchLoop(): Promise<void> {
    try {
      for await (const event of this.watcher!) {
        if (event.kind === "modify" || event.kind === "create") {
          this.cachedMtimeMs = null;
        }
      }
    } catch {
      // Watcher closed
    }
  }

  /** Close the file watcher if active. */
  close(): void {
    if (this.watcher) {
      try {
        this.watcher.close();
      } catch {
        // Already closed
      }
      this.watcher = null;
    }
  }

  async loadPolicy(): Promise<IRoutingPolicyLoadResult> {
    try {
      const stat = await Deno.stat(this.policyPath);
      const mtimeMs = stat.mtime?.getTime() ?? 0;
      if (this.cachedPolicy && this.cachedMtimeMs === mtimeMs) {
        return { success: true, policy: this.cachedPolicy, path: this.policyPath };
      }

      const raw = await Deno.readTextFile(this.policyPath);
      const parsed = parseYaml(raw) as unknown;
      const result = ZRoutingPolicy.safeParse(parsed);
      if (!result.success) {
        return {
          success: false,
          policy: ZRoutingPolicy.parse({}),
          errors: result.error.issues.map((issue) => `${issue.path.join(".")}: ${issue.message}`),
          path: this.policyPath,
        };
      }

      this.cachedPolicy = result.data;
      this.cachedMtimeMs = mtimeMs;
      return { success: true, policy: result.data, path: this.policyPath };
    } catch (error) {
      if (error instanceof Deno.errors.NotFound) {
        const defaultPolicy = ZRoutingPolicy.parse({});
        this.cachedPolicy = defaultPolicy;
        this.cachedMtimeMs = null;
        return { success: true, policy: defaultPolicy, path: this.policyPath };
      }
      throw error;
    }
  }
}
