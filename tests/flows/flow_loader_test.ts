/**
 * @module FlowLoaderTest
 * @path tests/flows/flow_loader_test.ts
 * @description Verifies the FlowLoader's ability to discover, parse, and instantiate agentic models
 * from the filesystem, ensuring correct path resolution and error reporting for missing files.
 */

import { assert, assertEquals } from "@std/assert";
import { FlowLoader } from "../../src/flows/flow_loader.ts";
import { FlowSchema } from "@exaix/schemas/flow.ts";

const mockFlowsDir = "/tmp/test-flows";

Deno.test("FlowLoader: loads flow files from directory", async () => {
  await Deno.mkdir(mockFlowsDir, { recursive: true });
  try {
    const mockFlowContent = `
id: "test-flow"
name: "Test Flow"
description: "A test flow"
version: "1.0.0"
steps:
  - id: "step1"
    name: "Test Step"
    identity: "test-agent"
    input: { source: "request", transform: "passthrough" }
output: { from: "step1", format: "markdown" }
`;
    await Deno.writeTextFile(`${mockFlowsDir}/test-flow.flow.yaml`, mockFlowContent);

    const loader = new FlowLoader(mockFlowsDir);
    const flows = await loader.loadAllFlows();
    assertEquals(flows.length, 1);
    assertEquals(flows[0].id, "test-flow");
    assertEquals(flows[0].name, "Test Flow");

    const result = FlowSchema.parse(flows[0]);
    assertEquals(result.id, "test-flow");
  } finally {
    await Deno.remove(mockFlowsDir, { recursive: true });
  }
});

Deno.test("FlowLoader: loads specific flow by ID", async () => {
  await Deno.mkdir(mockFlowsDir, { recursive: true });
  try {
    const flow1Content = `
id: "flow1"
name: "Flow 1"
description: "First flow"
steps: [{ id: "s1", name: "Step 1", identity: "agent1", input: { source: "request", transform: "passthrough" } }]
output: { from: "s1", format: "markdown" }
`;
    const flow2Content = `
id: "flow2"
name: "Flow 2"
description: "Second flow"
steps: [{ id: "s2", name: "Step 2", identity: "agent2", input: { source: "request", transform: "passthrough" } }]
output: { from: "s2", format: "markdown" }
`;
    await Deno.writeTextFile(`${mockFlowsDir}/flow1.flow.yaml`, flow1Content);
    await Deno.writeTextFile(`${mockFlowsDir}/flow2.flow.yaml`, flow2Content);

    const loader = new FlowLoader(mockFlowsDir);
    const flow = await loader.loadFlow("flow1");
    assertEquals(flow.id, "flow1");
    const flow2 = await loader.loadFlow("flow2");
    assertEquals(flow2.id, "flow2");
  } finally {
    await Deno.remove(mockFlowsDir, { recursive: true });
  }
});

Deno.test("FlowLoader: throws error for non-existent flow", async () => {
  const loader = new FlowLoader(mockFlowsDir);
  try {
    await loader.loadFlow("nonexistent");
    throw new Error("Expected error");
  } catch (error) {
    assert(error instanceof Error);
    assert(error.message.includes("Failed to load flow 'nonexistent'"));
  }
});

Deno.test("FlowLoader: ignores non-flow files and invalid files", async () => {
  await Deno.mkdir(mockFlowsDir, { recursive: true });
  try {
    const _validFlow = `
id: "valid-flow"
name: "Valid Flow"
description: "Valid flow"
steps: [{ id: "s1", name: "Step 1", identity: "agent1", input: { source: "request", transform: "passthrough" } }]
output: { from: "s1", format: "markdown" }
`;
    const invalidFlow = `
export default { invalid: "flow" }
`;
    const nonFlowFile = `
console.log("not a flow");
`;
    await Deno.writeTextFile(`${mockFlowsDir}/valid-flow.flow.yaml`, _validFlow);
    await Deno.writeTextFile(`${mockFlowsDir}/invalid-flow.flow.yaml`, invalidFlow);
    await Deno.writeTextFile(`${mockFlowsDir}/not-a-flow.ts`, nonFlowFile);
    await Deno.writeTextFile(`${mockFlowsDir}/readme.txt`, "not a flow file");

    const loader = new FlowLoader(mockFlowsDir);
    const flows = await loader.loadAllFlows();
    assertEquals(flows.length, 1);
    assertEquals(flows[0].id, "valid-flow");
  } finally {
    await Deno.remove(mockFlowsDir, { recursive: true });
  }
});

Deno.test("FlowLoader: validates flow file naming convention", async () => {
  await Deno.mkdir(mockFlowsDir, { recursive: true });
  try {
    const loader = new FlowLoader(mockFlowsDir);
    const namingTestFlow = `
id: "my-flow"
name: "Test Flow"
description: "Test flow"
steps: [{ id: "s1", name: "Step 1", identity: "agent1", input: { source: "request", transform: "passthrough" } }]
output: { from: "s1", format: "markdown" }
`;
    await Deno.writeTextFile(`${mockFlowsDir}/my-flow.flow.yaml`, namingTestFlow);
    const flows = await loader.loadAllFlows();
    assertEquals(flows.length, 1);
    assertEquals(flows[0].id, "my-flow");
    const flow = await loader.loadFlow("my-flow");
    assertEquals(flow.id, "my-flow");
  } finally {
    await Deno.remove(mockFlowsDir, { recursive: true });
  }
});

Deno.test("FlowLoader: handles import errors gracefully", async () => {
  await Deno.mkdir(mockFlowsDir, { recursive: true });
  try {
    const brokenFlow = `
id: "broken"
name: "Broken Flow"
description: "Broken flow"
steps: [ invalid syntax  ]
output: { from: "s1" }
`;
    await Deno.writeTextFile(`${mockFlowsDir}/broken.flow.yaml`, brokenFlow);
    const loader = new FlowLoader(mockFlowsDir);
    const flows = await loader.loadAllFlows();
    assertEquals(flows.length, 0);
  } finally {
    await Deno.remove(mockFlowsDir, { recursive: true });
  }
});

Deno.test("FlowLoader: checks if flow exists", async () => {
  await Deno.mkdir(mockFlowsDir, { recursive: true });
  try {
    const loader = new FlowLoader(mockFlowsDir);
    assertEquals(await loader.flowExists("nonexistent"), false);
    const flowContent = `
id: "existing-flow"
name: "Existing Flow"
description: "A flow that exists"
steps: [{ id: "s1", name: "Step 1", identity: "agent1", input: { source: "request", transform: "passthrough" } }]
output: { from: "s1", format: "markdown" }
`;
    await Deno.writeTextFile(`${mockFlowsDir}/existing-flow.flow.yaml`, flowContent);
    assertEquals(await loader.flowExists("existing-flow"), true);
    await Deno.writeTextFile(`${mockFlowsDir}/not-a-flow.ts`, "not a flow");
    assertEquals(await loader.flowExists("not-a-flow"), false);
  } finally {
    await Deno.remove(mockFlowsDir, { recursive: true });
  }
});

Deno.test("FlowLoader: lists available flow IDs", async () => {
  await Deno.mkdir(mockFlowsDir, { recursive: true });
  try {
    const loader = new FlowLoader(mockFlowsDir);
    let flowIds = await loader.listFlowIds();
    assertEquals(flowIds.length, 0);

    const flow1Content = `
id: "flow-one"
name: "Flow One"
description: "First flow"
steps: [{ id: "s1", name: "Step 1", identity: "agent1", input: { source: "request", transform: "passthrough" } }]
output: { from: "s1", format: "markdown" }
`;
    const flow2Content = `
id: "flow-two"
name: "Flow Two"
description: "Second flow"
steps: [{ id: "s2", name: "Step 2", identity: "agent2", input: { source: "request", transform: "passthrough" } }]
output: { from: "s2", format: "markdown" }
`;
    await Deno.writeTextFile(`${mockFlowsDir}/flow-one.flow.yaml`, flow1Content);
    await Deno.writeTextFile(`${mockFlowsDir}/flow-two.flow.yaml`, flow2Content);
    await Deno.writeTextFile(`${mockFlowsDir}/not-a-flow.ts`, "not a flow file");

    flowIds = await loader.listFlowIds();
    assertEquals(flowIds.length, 2);
    assert(flowIds.includes("flow-one"));
    assert(flowIds.includes("flow-two"));
    assert(!flowIds.includes("not-a-flow"));
  } finally {
    await Deno.remove(mockFlowsDir, { recursive: true });
  }
});

Deno.test("FlowLoader: handles non-existent directory gracefully", async () => {
  const loader = new FlowLoader("/tmp/non-existent-flows-dir");
  assertEquals((await loader.loadAllFlows()).length, 0);
  assertEquals((await loader.listFlowIds()).length, 0);
  assertEquals(await loader.flowExists("any-flow"), false);
});
