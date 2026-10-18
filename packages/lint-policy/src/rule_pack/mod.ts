/**
 * @module ExaixRulePack
 * @path packages/lint-policy/src/rule_pack/mod.ts
 * @description The Exaix rule pack: plugin rules that encode Exaix conventions, registered with the lint engine.
 * @architectural-layer Tooling
 * @dependencies [@exaix/lint-rules, zod]
 * @related-files [packages/lint-policy/src/rule_pack/exported_interface_naming.ts, packages/lint-policy/src/rule_packs.ts]
 */

import { z } from "zod";
import type { IRulePack } from "@exaix/lint-rules";
import { createExportedInterfaceNaming } from "./exported_interface_naming.ts";

export const EXAIX_PLUGIN_NAME = "exaix";

const NO_OPTIONS = z.object({}).strict();

export const EXAIX_RULE_PACK: IRulePack = {
  name: EXAIX_PLUGIN_NAME,
  rules: {
    "exported-interface-naming": { create: createExportedInterfaceNaming },
  },
  optionSchemas: {
    "exported-interface-naming": NO_OPTIONS,
  },
};
