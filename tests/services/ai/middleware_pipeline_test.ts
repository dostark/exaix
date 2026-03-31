/**
 * @module MiddlewarePipelineTest
 * @path tests/services/ai/middleware_pipeline_test.ts
 * @description Verifies the logic for the asynchronous middleware execution pipeline, ensuring
 * correct Onion-model execution order and graceful short-circuiting.
 */

import { assertEquals } from "https://deno.land/std@0.200.0/testing/asserts.ts";
import { MiddlewarePipeline } from "../../../src/services/middleware/pipeline.ts";

Deno.test("MiddlewarePipeline executes middlewares in correct order with around-next behavior", async () => {
  const pipeline = new MiddlewarePipeline();
  const seq: string[] = [];

  pipeline.use(async (_ctx, next) => {
    seq.push("m1-before");
    await next();
    seq.push("m1-after");
  });

  pipeline.use(async (_ctx, next) => {
    seq.push("m2-before");
    await next();
    seq.push("m2-after");
  });

  pipeline.use(async (_ctx, next) => {
    seq.push("m3-before");
    await next();
    seq.push("m3-after");
  });

  await pipeline.execute({}, () => {
    seq.push("handler");
    return Promise.resolve();
  });

  assertEquals(seq, [
    "m1-before",
    "m2-before",
    "m3-before",
    "handler",
    "m3-after",
    "m2-after",
    "m1-after",
  ]);
});

Deno.test("MiddlewarePipeline short-circuits when middleware does not call next", async () => {
  const pipeline = new MiddlewarePipeline();
  let handlerCalled = false;

  pipeline.use((_ctx, _next) => {
    // do not call next()
    return Promise.resolve();
  });

  await pipeline.execute({}, () => {
    handlerCalled = true;
    return Promise.resolve();
  });

  assertEquals(handlerCalled, false);
});
