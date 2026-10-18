/**
 * @module ExportedInterfaceNaming
 * @path packages/lint-policy/src/rule_pack/exported_interface_naming.ts
 * @description Plugin rule that reports an exported interface whose name does not start with a capital I.
 * @architectural-layer Tooling
 * @dependencies [@exaix/lint-rules]
 * @related-files [packages/lint-policy/src/rule_pack/mod.ts, packages/lint-policy/catalog.json]
 */

import type { IPluginRuleContext, LintVisitor } from "@exaix/lint-rules";

const DEFAULT_CODE_STYLE = "CODE_STYLE.md#di-and-interfaces";
const INTERFACE_PREFIX = "I";

/** True for `I`, `IFoo`, `I2c`, and `I_x`: the name starts with I and its second character is not lowercase. */
function hasInterfacePrefix(name: string): boolean {
  const second = name.charAt(1);
  return name.startsWith(INTERFACE_PREFIX) && second === second.toUpperCase();
}

export function createExportedInterfaceNaming(context: Deno.lint.RuleContext, ctx: IPluginRuleContext): LintVisitor {
  const codeStyle = ctx.codeStyle ?? DEFAULT_CODE_STYLE;
  return {
    "ExportNamedDeclaration > TSInterfaceDeclaration"(node: Deno.lint.TSInterfaceDeclaration): void {
      const name = node.id.name;
      if (hasInterfacePrefix(name)) return;
      context.report({
        node,
        message: `Exported interface '${name}' must start with a capital 'I' (e.g., I${name}).`,
        hint: `Name exported interfaces with a capital I prefix. See ${codeStyle}.`,
      });
    },
  };
}
