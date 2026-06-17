/**
 * @module HitlPolicyEvaluator
 * @path packages-team/hitl/src/hitl_policy_evaluator.ts
 * @ungrounded
 * @description Team-only implementation of IHitlPolicyEvaluator for Phase 118
 * per-action HITL governance. Evaluates mandatory and blueprint policy rules
 * against tool invocations using glob patterns for path/command/branch fields
 * and intersection checks for tables.
 * @architectural-layer Governance
 * @dependencies [@exaix/schemas/hitl.ts, @exaix/core/types, @exaix/tool-runtime, @std/path]
 * @related-files [packages/core/src/types/i_hitl_policy_evaluator.ts, packages/tool-runtime/src/tool_registry.ts]
 */

import { globToRegExp } from "@std/path";
import { PathSecurity, PathTraversalError } from "@exaix/tool-runtime";
import type { HitlRule } from "@exaix/schemas/hitl.ts";
import type { HitlRuleSource, IHitlPolicyEvaluator, LogMetadata } from "@exaix/core/types";

export class HitlPolicyEvaluator implements IHitlPolicyEvaluator {
  #mandatoryRules: HitlRule[];

  constructor(mandatoryRules: HitlRule[]) {
    this.#mandatoryRules = mandatoryRules;
  }

  evaluate(
    blueprintRules: HitlRule[],
    toolName: string,
    toolArgs: LogMetadata,
  ): { rule: HitlRule; source: HitlRuleSource } | null {
    for (const key in toolArgs) {
      const val = toolArgs[key];
      if (typeof val === "string" && val.includes("\0")) {
        return {
          rule: {
            tool: toolName,
            reason: "Null byte detected in tool argument",
          },
          source: "mandatory" as HitlRuleSource,
        };
      }
    }

    const mandatoryMatch = this.#findFirstMatch(
      this.#mandatoryRules,
      toolName,
      toolArgs,
    );
    if (mandatoryMatch) {
      return { rule: mandatoryMatch, source: "mandatory" as HitlRuleSource };
    }

    const blueprintMatch = this.#findFirstMatch(
      blueprintRules,
      toolName,
      toolArgs,
    );
    if (blueprintMatch) {
      return { rule: blueprintMatch, source: "blueprint" as HitlRuleSource };
    }

    return null;
  }

  #findFirstMatch(
    rules: HitlRule[],
    toolName: string,
    toolArgs: LogMetadata,
  ): HitlRule | null {
    for (const rule of rules) {
      if (this.#ruleMatches(rule, toolName, toolArgs)) return rule;
    }
    return null;
  }

  #ruleMatches(
    rule: HitlRule,
    toolName: string,
    toolArgs: LogMetadata,
  ): boolean {
    if (rule.tool !== toolName) return false;

    if (rule.path_pattern && !this.#pathMatches(rule.path_pattern, toolArgs)) {
      return false;
    }
    if (
      rule.command_pattern &&
      !this.#fieldMatches(rule.command_pattern, toolArgs, "command")
    ) return false;
    if (rule.tables && !this.#tablesMatch(rule.tables, toolArgs)) return false;
    if (
      rule.branch_pattern &&
      !this.#fieldMatches(rule.branch_pattern, toolArgs, "branch")
    ) return false;

    return true;
  }

  #pathMatches(pattern: string, toolArgs: LogMetadata): boolean {
    const raw = toolArgs.path;
    if (raw === undefined || raw === null) return true;
    if (typeof raw !== "string") return true;

    let normalized: string;
    try {
      normalized = PathSecurity.normalizePath(raw);
    } catch (e) {
      if (e instanceof PathTraversalError) return true;
      throw e;
    }

    const regex = globToRegExp(pattern, { extended: true, globstar: true });
    return regex.test(normalized);
  }

  #fieldMatches(pattern: string, toolArgs: LogMetadata, key: string): boolean {
    const val = toolArgs[key];
    if (val === undefined || val === null) return true;
    if (typeof val !== "string") return true;

    const regex = globToRegExp(pattern, { extended: true, globstar: true });
    const joined = val.replace(/\//g, "\0");
    return regex.test(joined);
  }

  #tablesMatch(allowedTables: string[], toolArgs: LogMetadata): boolean {
    const candidateTables = toolArgs.tables;
    if (candidateTables === undefined || candidateTables === null) return true;
    if (!Array.isArray(candidateTables)) return true;

    return candidateTables.some((t) => typeof t === "string" && allowedTables.includes(t));
  }
}
