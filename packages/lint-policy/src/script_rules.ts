/**
 * @module ExaixScriptRules
 * @path packages/lint-policy/src/script_rules.ts
 * @description The fourteen consumer script specs and the six whole-tree host commands.
 * @architectural-layer Tooling
 * @dependencies [@dostark/unslop-ts]
 * @related-files [packages/lint-policy/unslop.project.ts, packages/lint-policy/src/script_rule_schemas.ts]
 */

import {
  type IRuleControls,
  type IRuleMeta,
  type IScriptRuleSpec,
  type IWholeTreeHostSpec,
  WHOLE_TREE_CHECKS,
} from "@dostark/unslop-ts";
import { SCRIPT_RULE_SCHEMAS } from "./script_rule_schemas.ts";

const DENO = "deno";
const TASK = "task";
const CHECK_STYLE = "check:style";
const ERROR = "error";
const LEVEL = "level";
const OPTIONS = "options";
const SCOPE = "scope";
const INCLUDE = "include";
const EXCLUDE = "exclude";
const BOUNDARIES = "boundaries";
const PROD = "prod";
const TEST = "test";
const ALL = "all";
const WARN = "warn";
const SCRIPT_COMMAND: readonly string[] = [DENO, TASK, CHECK_STYLE];

interface IScriptRow {
  readonly id: string;
  readonly description: string;
  readonly category: IRuleMeta["category"];
  readonly tags: readonly string[];
  readonly severity: "error" | "warn";
  readonly scope: "prod" | "test" | "all";
  readonly docs: string;
  readonly limits: string | null;
  readonly hasOptions: boolean;
}

const SCRIPT_ROWS: readonly IScriptRow[] = [
  {
    id: "module-header-tag",
    description: "A source header that is missing a mandatory tag.",
    category: "module-structure",
    tags: ["module-structure"],
    severity: ERROR,
    scope: ALL,
    docs: "docs/CODE_STYLE.md#module-headers",
    limits: null,
    hasOptions: false,
  },
  {
    id: "edition-conditional-outside-composer",
    description: "An edition conditional outside the composer.",
    category: BOUNDARIES,
    tags: ["edition", "boundary"],
    severity: ERROR,
    scope: PROD,
    docs: "docs/CODE_STYLE.md#edition-tier-boundary",
    limits: null,
    hasOptions: false,
  },
  {
    id: "edition-leak",
    description: "An edition tier that leaks across a boundary.",
    category: BOUNDARIES,
    tags: ["edition", "boundary"],
    severity: ERROR,
    scope: PROD,
    docs: "docs/CODE_STYLE.md#edition-tier-boundary",
    limits: "Reads source text; check:edition-graph is its resolved-graph double check.",
    hasOptions: true,
  },
  {
    id: "script-placement",
    description: "A script outside its allowed location.",
    category: "scripts",
    tags: ["scripts"],
    severity: ERROR,
    scope: ALL,
    docs: "docs/CODE_STYLE.md#utility-scripts",
    limits: null,
    hasOptions: false,
  },
  {
    id: "package-boundary",
    description: "A package import that crosses a boundary.",
    category: BOUNDARIES,
    tags: ["package", "boundary"],
    severity: ERROR,
    scope: PROD,
    docs: "docs/CODE_STYLE.md#package-imports",
    limits: null,
    hasOptions: false,
  },
  {
    id: "package-related-files-boundary",
    description: "A related-files header that crosses a package boundary.",
    category: BOUNDARIES,
    tags: ["package", "boundary"],
    severity: ERROR,
    scope: PROD,
    docs: "docs/CODE_STYLE.md#module-headers",
    limits: null,
    hasOptions: false,
  },
  {
    id: "package-subpath-promotion",
    description: "A package subpath that must be promoted to its barrel.",
    category: BOUNDARIES,
    tags: ["package", "boundary"],
    severity: ERROR,
    scope: PROD,
    docs: "docs/CODE_STYLE.md#package-imports",
    limits: null,
    hasOptions: false,
  },
  {
    id: "package-testing-import",
    description: "A package test that imports a forbidden helper.",
    category: BOUNDARIES,
    tags: ["package", "test-quality"],
    severity: ERROR,
    scope: TEST,
    docs: "docs/CODE_STYLE.md#package-test-boundaries",
    limits: null,
    hasOptions: false,
  },
  {
    id: "package-canonical-import",
    description: "A package import that bypasses the canonical entry point.",
    category: BOUNDARIES,
    tags: ["package", "imports"],
    severity: ERROR,
    scope: PROD,
    docs: "docs/CODE_STYLE.md#package-imports",
    limits: null,
    hasOptions: false,
  },
  {
    id: "package-instantiates-event-logger",
    description: "A package that instantiates an event logger.",
    category: BOUNDARIES,
    tags: ["package", "di"],
    severity: ERROR,
    scope: PROD,
    docs: "docs/CODE_STYLE.md#package-module-purity",
    limits: null,
    hasOptions: false,
  },
  {
    id: "package-concrete-logger-type",
    description: "A package that exposes a concrete logger type.",
    category: BOUNDARIES,
    tags: ["package", "di"],
    severity: WARN,
    scope: PROD,
    docs: "docs/CODE_STYLE.md#package-module-purity",
    limits: null,
    hasOptions: false,
  },
  {
    id: "package-uses-config-reader",
    description: "A package that reads configuration directly.",
    category: BOUNDARIES,
    tags: ["package", "di"],
    severity: WARN,
    scope: PROD,
    docs: "docs/CODE_STYLE.md#package-module-purity",
    limits: null,
    hasOptions: false,
  },
  {
    id: "concrete-cross-domain",
    description: "A concrete import that crosses a domain boundary.",
    category: BOUNDARIES,
    tags: ["boundary", "di"],
    severity: WARN,
    scope: PROD,
    docs: "docs/CODE_STYLE.md#layer-aware-constant-imports",
    limits: null,
    hasOptions: false,
  },
  {
    id: "layer-constant-leak",
    description: "A layer constant that leaks outside its layer.",
    category: BOUNDARIES,
    tags: ["boundary"],
    severity: WARN,
    scope: PROD,
    docs: "docs/CODE_STYLE.md#layer-aware-constant-imports",
    limits: "AST-based over this file only; dynamic imports and re-exports are not followed.",
    hasOptions: false,
  },
];

function controlsFor(row: IScriptRow): IRuleControls {
  if (row.id === "package-instantiates-event-logger") {
    return {
      editable: [SCOPE, INCLUDE, EXCLUDE],
      fixedLevel: ERROR,
      fixedScope: null,
      fixedInclude: null,
      fixedExclude: null,
      hostModes: { default: ERROR },
    };
  }
  const editable: IRuleControls["editable"] = row.hasOptions
    ? [LEVEL, SCOPE, INCLUDE, EXCLUDE, OPTIONS]
    : [LEVEL, SCOPE, INCLUDE, EXCLUDE];
  return {
    editable,
    fixedLevel: null,
    fixedScope: null,
    fixedInclude: null,
    fixedExclude: null,
    hostModes: { default: row.severity },
  };
}

/** The fourteen consumer script specs, in catalog order. */
export const SCRIPT_RULES: Readonly<Record<string, IScriptRuleSpec>> = Object.fromEntries(
  SCRIPT_ROWS.map((row) => [
    row.id,
    {
      meta: {
        description: row.description,
        category: row.category,
        docs: row.docs,
        preset: "recommended",
        limits: row.limits,
      },
      optionSchema: row.id === "edition-leak" ? SCRIPT_RULE_SCHEMAS["edition-leak"] : null,
      controls: controlsFor(row),
      command: SCRIPT_COMMAND,
    },
  ]),
);

/** The six real whole-tree host commands and their fixed engine controls. */
function hostCommand(task: string): readonly string[] {
  return [DENO, TASK, task];
}

const DUPLICATE_CONTROLS: IRuleControls = {
  editable: [OPTIONS, SCOPE, INCLUDE, EXCLUDE],
  fixedLevel: ERROR,
  fixedScope: null,
  fixedInclude: null,
  fixedExclude: null,
  hostModes: { default: ERROR },
};

export const WHOLE_TREE_HOSTS: Readonly<Record<string, IWholeTreeHostSpec>> = {
  "duplicate-type": {
    controls: DUPLICATE_CONTROLS,
    command: hostCommand(CHECK_STYLE),
  },
  "duplicate-constant": {
    controls: DUPLICATE_CONTROLS,
    command: hostCommand("check:magic"),
  },
  "magic-literals": {
    controls: WHOLE_TREE_CHECKS["magic-literals"].controls,
    command: hostCommand("check:magic"),
  },
  "constant-restatement": {
    controls: WHOLE_TREE_CHECKS["constant-restatement"].controls,
    command: hostCommand("check:constant-restatement"),
  },
  "unused-exports": {
    controls: WHOLE_TREE_CHECKS["unused-exports"].controls,
    command: hostCommand("check:unused-exports"),
  },
  "optional-params": {
    controls: WHOLE_TREE_CHECKS["optional-params"].controls,
    command: hostCommand("check:optional-params"),
  },
};
