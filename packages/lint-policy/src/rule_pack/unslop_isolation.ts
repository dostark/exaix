/**
 * @module UnslopIsolation
 * @path packages/lint-policy/src/rule_pack/unslop_isolation.ts
 * @description Reports an unslop module or an unslop-ts engine import outside the packages that own unslop code.
 * @architectural-layer Tooling
 * @dependencies [@dostark/unslop-ts, zod]
 * @related-files [packages/lint-policy/src/rule_pack/mod.ts, packages/lint-policy/src/policy_config.ts]
 */

import { z } from "zod";
import type { IPluginRule, IPluginRuleContext, LintVisitor } from "@dostark/unslop-ts";

type RuleContext = Parameters<IPluginRule["create"]>[0];
type RuleNode = Parameters<LintVisitor[string]>[0];

/** Options of the unslop-isolation rule. */
export const UnslopIsolationOptions = z.object({
  /** Repository path prefixes that may hold unslop modules and engine imports. */
  ownerPrefixes: z.array(z.string().min(1)).min(1),
  /** Case-insensitive pattern that marks a file name as an unslop module. */
  modulePattern: z.string().min(1),
  /** Pattern that marks an import specifier as the unslop-ts engine. */
  enginePattern: z.string().min(1),
}).strict();

/** Reads the string specifier of an import or export source node, or null when it is not a literal. */
function specifierOf(source: unknown): string | null {
  if (source === null || typeof source !== "object" || !("value" in source)) return null;
  return typeof source.value === "string" ? source.value : null;
}

/** Reads the source node of an import, export or import call, or null when it has none. */
function sourceOf(node: RuleNode): unknown {
  return "source" in node ? node.source : null;
}

/** Returns the visitor that keeps unslop modules and engine imports inside the owning packages. */
export function createUnslopIsolation(context: RuleContext, ctx: IPluginRuleContext): LintVisitor {
  const options = UnslopIsolationOptions.parse(ctx.options);
  if (options.ownerPrefixes.some((prefix) => ctx.repoPath.startsWith(prefix))) return {};
  const owners = options.ownerPrefixes.join(", ");
  const hint = `See ${ctx.codeStyle ?? "the unslop isolation rule"}.`;
  const modulePattern = new RegExp(options.modulePattern, "i");
  const enginePattern = new RegExp(options.enginePattern);
  const basename = ctx.repoPath.slice(ctx.repoPath.lastIndexOf("/") + 1);
  const check = (node: RuleNode, source: unknown): void => {
    const specifier = specifierOf(source);
    if (specifier === null || !enginePattern.test(specifier)) return;
    context.report({
      node,
      message: `Engine import '${specifier}' must live in ${owners}.`,
      hint,
    });
  };
  return {
    Program(node: RuleNode): void {
      if (!modulePattern.test(basename)) return;
      context.report({
        node,
        message: `Unslop module '${ctx.repoPath}' must live in ${owners}.`,
        hint,
      });
    },
    ImportDeclaration(node: RuleNode): void {
      check(node, sourceOf(node));
    },
    ExportNamedDeclaration(node: RuleNode): void {
      check(node, sourceOf(node));
    },
    ExportAllDeclaration(node: RuleNode): void {
      check(node, sourceOf(node));
    },
    ImportExpression(node: RuleNode): void {
      check(node, sourceOf(node));
    },
  };
}
