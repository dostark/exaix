/**
 * @module RequirementsControls
 * @path tests/scenario_framework/tests/helpers/requirements_controls.ts
 * @description Materializes explicit incorrect-outcome mutations without duplicating complete requirements fixtures.
 * @architectural-layer Test
 * @dependencies [zod]
 * @related-files [tests/scenario_framework/tests/unit/requirements_discovery_oracle_test.ts]
 */
import { z } from "zod";

const JsonSchema = z.json();
type Json = z.infer<typeof JsonSchema>;
const ChangesSchema = z.array(z.object({ path: z.array(z.union([z.string(), z.number()])).min(1), value: JsonSchema }));

function child(node: Json, key: string | number): Json {
  if (Array.isArray(node) && typeof key === "number") return node[key];
  if (node !== null && typeof node === "object" && !Array.isArray(node) && typeof key === "string") return node[key];
  throw new Error("Invalid requirements mutation path");
}

/** Applies each fixture's independent outcome changes to a fresh positive record. */
export function applyRequirementsControl(source: string, changes: string): string {
  const result = JsonSchema.parse(JSON.parse(source));
  for (const change of ChangesSchema.parse(JSON.parse(changes))) {
    let target = result;
    for (const key of change.path.slice(0, -1)) target = child(target, key);
    const last = change.path.at(-1)!;
    if (Array.isArray(target) && typeof last === "number") target[last] = change.value;
    else if (target !== null && typeof target === "object" && !Array.isArray(target) && typeof last === "string") {
      target[last] = change.value;
    } else throw new Error("Invalid requirements mutation target");
  }
  return JSON.stringify(result);
}
