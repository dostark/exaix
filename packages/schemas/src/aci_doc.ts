/**
 * @module AciDocSchema
 * @path packages/schemas/src/aci_doc.ts
 * @description Agent-Computer Interface (ACI) documentation block (Anthropic ACI /
 *   Poka-Yoke, Phase 112): bounded, schema-validated tool guidance (summary, when/
 *   when-not, worked example, anti-example) attached to ReAct-owned `ITool` definitions.
 *   `ITool.aciDoc` owns this metadata; `ITool.sideEffectScope` owns side-effect truth
 *   separately, so this schema carries no narrative side-effect field that could
 *   disagree with it. Trusted-local-source-only (Step 1 constraint): only
 *   `createCoreToolSchemas()` populates `ITool.aciDoc` in production; remote MCP tool
 *   descriptions never reach this schema.
 * @architectural-layer Shared
 * @dependencies ["@exaix/core"]
 * @related-files ["packages/core/src/types/i_tool_registry.ts", "packages/tool-runtime/src/tool_schemas.ts"]
 */
import { z } from "zod";
import {
  ACI_DOC_GUIDANCE_MAX_CHARS,
  ACI_DOC_INPUT_MAX_CHARS,
  ACI_DOC_INPUT_MAX_PROPERTIES,
  ACI_DOC_OUTPUT_MAX_CHARS,
  ACI_DOC_RATIONALE_MAX_CHARS,
  ACI_DOC_SUMMARY_MAX_CHARS,
  JSONValueSchema,
} from "@exaix/core";

/** Minimum length for every free-text guidance/rationale field — enforces authored content over placeholders. */
const ACI_DOC_MIN_GUIDANCE_CHARS = 10;
/** Minimum length for `example.output` — a worked output must be non-empty, but is often short. */
const ACI_DOC_MIN_OUTPUT_CHARS = 1;

/** JSON-only values, capped property count and serialized size, so one ACI block cannot
 *  exhaust the prompt-injection budget. */
const AciDocInputSchema = z.record(z.string(), JSONValueSchema)
  .refine((obj) => Object.keys(obj).length <= ACI_DOC_INPUT_MAX_PROPERTIES, {
    message: `at most ${ACI_DOC_INPUT_MAX_PROPERTIES} example-input properties`,
  })
  .refine((obj) => JSON.stringify(obj).length <= ACI_DOC_INPUT_MAX_CHARS, {
    message: `serialized example input exceeds ${ACI_DOC_INPUT_MAX_CHARS} chars`,
  });

/** Agent-Computer Interface documentation block (Anthropic ACI / Poka-Yoke). */
export const AciDocSchema = z.object({
  summary: z.string().min(ACI_DOC_MIN_GUIDANCE_CHARS).max(ACI_DOC_SUMMARY_MAX_CHARS),
  when_to_use: z.string().min(ACI_DOC_MIN_GUIDANCE_CHARS).max(ACI_DOC_GUIDANCE_MAX_CHARS),
  when_not_to_use: z.string().min(ACI_DOC_MIN_GUIDANCE_CHARS).max(ACI_DOC_GUIDANCE_MAX_CHARS),
  example: z.object({
    input: AciDocInputSchema,
    output: z.string().min(ACI_DOC_MIN_OUTPUT_CHARS).max(ACI_DOC_OUTPUT_MAX_CHARS),
    rationale: z.string().min(ACI_DOC_MIN_GUIDANCE_CHARS).max(ACI_DOC_RATIONALE_MAX_CHARS),
  }),
  anti_example: z.object({
    input: AciDocInputSchema,
    why_wrong: z.string().min(ACI_DOC_MIN_GUIDANCE_CHARS).max(ACI_DOC_RATIONALE_MAX_CHARS),
  }),
});
export type AciDoc = z.infer<typeof AciDocSchema>;
