/**
 * @module RoutingCommands
 * @path src/cli/commands/routing_commands.ts
 * @description Provides CLI helpers for routing policy inspection and validation.
 * @architectural-layer CLI
 * @related-files [src/services/routing/routing_policy_service.ts, src/services/routing/routing_policy_loader.ts]
 */

import { exists } from "@std/fs";
import { parse as parseYaml } from "@std/yaml";
import { BaseCommand } from "../base.ts";
import { createRoutingPolicyService, loadRoutingPolicy } from "../../services/adapters/routing_adapter.ts";
import { ZRoutingPolicy } from "@exaix/schemas/routing_policy.ts";
import type { JSONValue } from "@exaix/core";
import type { IRoutingContext, IRoutingMatchCriteria, IRoutingPolicyDecision } from "@exaix/schemas/routing_policy.ts";

export class RoutingCommands extends BaseCommand {
  async validatePolicy(policyPath?: string): Promise<{
    success: boolean;
    errors: string[];
    path: string;
  }> {
    if (policyPath) {
      if (!await exists(policyPath)) {
        throw new Error(`Routing policy file not found: ${policyPath}`);
      }

      const raw = await Deno.readTextFile(policyPath);
      const parsed = parseYaml(raw);
      const result = ZRoutingPolicy.safeParse(parsed);
      return {
        success: result.success,
        errors: result.success ? [] : result.error.issues.map((issue) => `${issue.path.join(".")}: ${issue.message}`),
        path: policyPath,
      };
    }

    const result = await loadRoutingPolicy({
      config: this.config,
      root: this.config.system.root,
    });
    if (!result.success) {
      return { success: false, errors: result.errors ?? [], path: result.path };
    }

    if (!(await exists(result.path))) {
      return { success: true, errors: [], path: result.path };
    }

    return { success: true, errors: [], path: result.path };
  }

  async explainRequest(requestPath: string): Promise<IRoutingPolicyDecision> {
    if (!await exists(requestPath)) {
      throw new Error(`Request file not found: ${requestPath}`);
    }

    const content = await Deno.readTextFile(requestPath);
    const frontmatter = this.parseRequestFrontmatter(content, requestPath);
    const identityField = this.getRequestIdentity(frontmatter);
    const explicitVersion = typeof frontmatter.identity_version === "string" ? frontmatter.identity_version : undefined;

    const routingContext: IRoutingContext = {
      explicitIdentityId: identityField,
      explicitVersion,
      matchCriteria: this.buildMatchCriteria(frontmatter),
      traceId: String(frontmatter.trace_id ?? ""),
    };

    const service = this.buildRoutingPolicyService();
    return await service.selectIdentity(routingContext);
  }

  private parseRequestFrontmatter(content: string, filePath: string): ParsedFrontmatter {
    const match = content.match(/^---\s*\n([\s\S]*?)\n---\s*/);
    if (!match) {
      throw new Error(`Request file does not include YAML frontmatter: ${filePath}`);
    }

    const parsed = parseYaml(match[1]);
    if (parsed === null || typeof parsed !== "object") {
      throw new Error(`Unable to parse YAML frontmatter in ${filePath}`);
    }

    return parsed as ParsedFrontmatter;
  }

  private buildMatchCriteria(frontmatter: ParsedFrontmatter): IRoutingMatchCriteria {
    const tags = frontmatter.tags;
    return {
      capability: typeof frontmatter.capability === "string" ? frontmatter.capability : undefined,
      complexityMin: typeof frontmatter.complexityMin === "number" ? frontmatter.complexityMin : undefined,
      complexityMax: typeof frontmatter.complexityMax === "number" ? frontmatter.complexityMax : undefined,
      language: typeof frontmatter.language === "string" ? frontmatter.language : undefined,
      taskType: typeof frontmatter.task_type === "string" ? frontmatter.task_type : undefined,
      portalType: typeof frontmatter.portal_type === "string" ? frontmatter.portal_type : undefined,
      tags: Array.isArray(tags) ? tags.map((value) => String(value)) : typeof tags === "string" ? [tags] : [],
    };
  }

  private getRequestIdentity(frontmatter: ParsedFrontmatter): string | undefined {
    if (typeof frontmatter.identity === "string" && frontmatter.identity.trim()) {
      return frontmatter.identity.trim();
    }
    if (typeof frontmatter.agent === "string" && frontmatter.agent.trim()) {
      return frontmatter.agent.trim();
    }
    return undefined;
  }

  private buildRoutingPolicyService(): ReturnType<typeof createRoutingPolicyService> {
    return createRoutingPolicyService({
      config: this.config,
      root: this.config.system.root,
      db: this.db,
      experimentSalt: String(this.config.routing?.experiment_salt ?? ""),
    });
  }
}

interface ParsedFrontmatter {
  [key: string]: JSONValue;
}
