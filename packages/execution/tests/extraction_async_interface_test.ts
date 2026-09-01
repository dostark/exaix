/**
 * @module ExtractionAsyncInterfaceTest
 * @path packages/execution/tests/extraction_async_interface_test.ts
 * @description Compile-time contract proving memory extraction is asynchronous.
 * @architectural-layer Tests
 */
import { assertEquals } from "@std/assert";
import type { IMemoryExtractorService } from "@exaix/core/types";
import type { IExecutionMemory, IProposalLearning } from "@exaix/schemas/memory_bank.ts";
import { castAny, createMinimalExecutionMemory } from "@exaix/testing";

Deno.test("IMemoryExtractorService: analyzeExecution returns Promise<IProposalLearning[]>", async () => {
  let resolved = false;
  const service = castAny<IMemoryExtractorService>({
    analyzeExecution(_execution: IExecutionMemory): Promise<IProposalLearning[]> {
      return Promise.resolve().then(() => {
        resolved = true;
        return [];
      });
    },
  });

  const result: Promise<IProposalLearning[]> = service.analyzeExecution(createMinimalExecutionMemory());
  assertEquals(resolved, false);
  assertEquals(await result, []);
  assertEquals(resolved, true);
});
