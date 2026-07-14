/**
 * @module RequestProcessorComplexityTest
 * @path packages/request/tests/request_processor_complexity_test.ts
 * @architectural-layer Services
 * @description Verifies that RequestProcessor wires and delegates to its injected
 * TaskComplexityClassifier. The full classification behavior matrix (structured
 * analysis, content heuristics, agent-ID fallbacks) is covered directly in
 * packages/request/tests/task_complexity_classifier_test.ts (god-object
 * decomposition of RequestProcessor).
 * @related-files [packages/request/src/processor.ts, packages/request/src/task_complexity_classifier.ts]
 */

import { assert, assertEquals } from "@std/assert";
import { RequestProcessor, TaskComplexityClassifier } from "@exaix/request";
import type { ITaskComplexityClassifier } from "@exaix/request";
import type { IApplicationContext } from "@exaix/core/types";
import {
  createStubConfig,
  createStubDisplay,
  createStubGit,
  createStubProvider,
  initTestDbService,
} from "@exaix/testing";

/**
 * Accessor type to avoid prohibited Record types.
 */
interface IRequestProcessorTest {
  taskComplexityClassifier: ITaskComplexityClassifier;
}
type ProcessorAccessor = { [K in keyof IRequestProcessorTest]: IRequestProcessorTest[K] };

function getTaskComplexityClassifier(processor: RequestProcessor): ITaskComplexityClassifier {
  const accessor = (processor as object) as ProcessorAccessor;
  return accessor["taskComplexityClassifier"];
}

async function createComplexityTestSetup() {
  const { db, config, cleanup } = await initTestDbService();
  const context: IApplicationContext = {
    config: createStubConfig(config),
    db,
    provider: createStubProvider(),
    git: createStubGit(),
    display: createStubDisplay(db),
  };
  const processor = new RequestProcessor({
    workspacePath: "",
    requestsDir: "",
    blueprintsPath: "",
    includeReasoning: false,
    context,
  });
  return { processor, cleanup };
}

Deno.test("[RequestProcessor] constructs a TaskComplexityClassifier instance", async () => {
  const { processor, cleanup } = await createComplexityTestSetup();
  try {
    const classifier = getTaskComplexityClassifier(processor);
    assert(classifier instanceof TaskComplexityClassifier);
  } finally {
    await cleanup();
  }
});

Deno.test("[RequestProcessor] taskComplexityClassifier is a stable singleton per instance", async () => {
  const { processor, cleanup } = await createComplexityTestSetup();
  try {
    const first = getTaskComplexityClassifier(processor);
    const second = getTaskComplexityClassifier(processor);
    assertEquals(first, second);
  } finally {
    await cleanup();
  }
});
