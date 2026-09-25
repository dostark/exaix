/**
 * @module RequestIntentFromFrontmatterTest
 * @path packages/request/tests/request_intent_from_frontmatter_test.ts
 * @description Verifies RequestProcessor.requestIntentFromFrontmatter never forwards a
 *   declaration-time "auto" into the concrete IModelIntent it feeds provider selection —
 *   "auto" must be resolved after selection (GAP-3), so it travels only as declared pairs.
 * @architectural-layer Services
 * @related-files [packages/request/src/processor.ts]
 */

import { assertEquals } from "@std/assert";
import { RequestProcessor } from "@exaix/request";
import type { IRequestFrontmatter } from "@exaix/core/request";

import type { IModelIntent } from "@exaix/schemas";

interface IRequestProcessorStatic {
  requestIntentFromFrontmatter(frontmatter: IRequestFrontmatter): Partial<IModelIntent>;
}

function intentFrom(frontmatter: Partial<IRequestFrontmatter>): Partial<IModelIntent> {
  const accessor = (RequestProcessor as object) as IRequestProcessorStatic;
  return accessor.requestIntentFromFrontmatter(frontmatter as IRequestFrontmatter);
}

Deno.test("requestIntentFromFrontmatter: thinking auto is absent from the concrete intent", () => {
  const intent = intentFrom({ thinking: "auto", effort: "high" });
  assertEquals(intent.thinking, undefined);
  assertEquals(intent.effort, "high");
});

Deno.test("requestIntentFromFrontmatter: thinking false stays a concrete boolean", () => {
  const intent = intentFrom({ thinking: false });
  assertEquals(intent.thinking, false);
});

Deno.test("requestIntentFromFrontmatter: effort auto is absent from the concrete intent", () => {
  const intent = intentFrom({ effort: "auto" });
  assertEquals(intent.effort, undefined);
});

Deno.test("requestIntentFromFrontmatter: concrete effort passes through", () => {
  const intent = intentFrom({ effort: "low", model_size: "S" });
  assertEquals(intent.effort, "low");
  assertEquals(intent.model_size, "S");
});
