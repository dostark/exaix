/**
 * @module ClassifierTest
 * @path tests/scripts/classifier_test.ts
 * @description Validates classifyTerminalBenchTask's supported/unsupported heuristics
 *   (Phase 144 Step 3): structural environment inspection (docker-compose service count,
 *   custom network config, privileged/device access, GPU markers) and test-script content
 *   inspection (live-service probes, interactive-terminal control). Ambiguous/ absent
 *   signals default to `supported` only when nothing disqualifying is found — every
 *   disqualifying branch is conservative per the plan's classifier table.
 * @architectural-layer Test
 * @related-files [scripts/ingest_terminal_bench.ts, tests/scripts/manifest_integrity_test.ts]
 */

import { assertEquals } from "@std/assert";
import { classifyTerminalBenchTask } from "../../scripts/ingest_terminal_bench.ts";

const BENIGN_COMPOSE = `
services:
  client:
    build:
      dockerfile: Dockerfile
    image: \${T_BENCH_TASK_DOCKER_CLIENT_IMAGE_NAME}
    command: [ "sh", "-c", "sleep infinity" ]
    environment:
      - TEST_DIR=\${T_BENCH_TEST_DIR}
`;

const BENIGN_DOCKERFILE = `FROM ubuntu:24.04\nWORKDIR /app\n`;
const BENIGN_TESTS = `from pathlib import Path\n\ndef test_result():\n    assert Path("/app/result.txt").exists()\n`;

Deno.test("[Classifier] a plain file-editing task (single service, no probes) is supported", () => {
  const result = classifyTerminalBenchTask({
    dockerComposeText: BENIGN_COMPOSE,
    dockerfileText: BENIGN_DOCKERFILE,
    testScriptsText: BENIGN_TESTS,
  });
  assertEquals(result, { supported: true });
});

Deno.test("[Classifier] two services in docker-compose.yaml is unsupported (multi-container)", () => {
  const compose = `
services:
  client:
    build:
      dockerfile: Dockerfile
    command: [ "sh", "-c", "sleep infinity" ]
  database:
    image: postgres:16
`;
  const result = classifyTerminalBenchTask({
    dockerComposeText: compose,
    dockerfileText: BENIGN_DOCKERFILE,
    testScriptsText: BENIGN_TESTS,
  });
  assertEquals(result, { supported: false, reason: "multi-container" });
});

Deno.test("[Classifier] custom dns config on the client service is unsupported (custom-network-config)", () => {
  const compose = `
services:
  client:
    build:
      dockerfile: Dockerfile
    command: [ "sh", "-c", "sleep infinity" ]
    dns:
      - 192.0.2.1
`;
  const result = classifyTerminalBenchTask({
    dockerComposeText: compose,
    dockerfileText: BENIGN_DOCKERFILE,
    testScriptsText: BENIGN_TESTS,
  });
  assertEquals(result, { supported: false, reason: "custom-network-config" });
});

Deno.test("[Classifier] extra_hosts on the client service is unsupported (custom-network-config)", () => {
  const compose = `
services:
  client:
    build:
      dockerfile: Dockerfile
    command: [ "sh", "-c", "sleep infinity" ]
    extra_hosts:
      - "example.com:131.25.18.2"
`;
  const result = classifyTerminalBenchTask({
    dockerComposeText: compose,
    dockerfileText: BENIGN_DOCKERFILE,
    testScriptsText: BENIGN_TESTS,
  });
  assertEquals(result, { supported: false, reason: "custom-network-config" });
});

Deno.test("[Classifier] privileged: true is unsupported (privileged-or-device-access)", () => {
  const compose = `
services:
  client:
    build:
      dockerfile: Dockerfile
    command: [ "sh", "-c", "sleep infinity" ]
    privileged: true
`;
  const result = classifyTerminalBenchTask({
    dockerComposeText: compose,
    dockerfileText: BENIGN_DOCKERFILE,
    testScriptsText: BENIGN_TESTS,
  });
  assertEquals(result, { supported: false, reason: "privileged-or-device-access" });
});

Deno.test("[Classifier] cap_add on the client service is unsupported (privileged-or-device-access)", () => {
  const compose = `
services:
  client:
    build:
      dockerfile: Dockerfile
    command: [ "sh", "-c", "sleep infinity" ]
    cap_add:
      - NET_ADMIN
`;
  const result = classifyTerminalBenchTask({
    dockerComposeText: compose,
    dockerfileText: BENIGN_DOCKERFILE,
    testScriptsText: BENIGN_TESTS,
  });
  assertEquals(result, { supported: false, reason: "privileged-or-device-access" });
});

Deno.test("[Classifier] a CUDA/nvidia base image is unsupported (gpu-required)", () => {
  const result = classifyTerminalBenchTask({
    dockerComposeText: BENIGN_COMPOSE,
    dockerfileText: `FROM nvidia/cuda:12.4.0-base-ubuntu24.04\n`,
    testScriptsText: BENIGN_TESTS,
  });
  assertEquals(result, { supported: false, reason: "gpu-required" });
});

Deno.test("[Classifier] a test script polling a live HTTP service is unsupported (requires-live-service)", () => {
  const tests =
    `import requests\n\ndef test_health():\n    r = requests.get("http://localhost:8080/health")\n    assert r.status_code == 200\n`;
  const result = classifyTerminalBenchTask({
    dockerComposeText: BENIGN_COMPOSE,
    dockerfileText: BENIGN_DOCKERFILE,
    testScriptsText: tests,
  });
  assertEquals(result, { supported: false, reason: "requires-live-service" });
});

Deno.test("[Classifier] a test script opening a raw socket is unsupported (requires-live-service)", () => {
  const tests = `import socket\n\ndef test_port_open():\n    s = socket.create_connection(("127.0.0.1", 9000))\n`;
  const result = classifyTerminalBenchTask({
    dockerComposeText: BENIGN_COMPOSE,
    dockerfileText: BENIGN_DOCKERFILE,
    testScriptsText: tests,
  });
  assertEquals(result, { supported: false, reason: "requires-live-service" });
});

Deno.test("[Classifier] a test script driving tmux is unsupported (requires-interactive-terminal)", () => {
  const tests = `import subprocess\n\ndef test_pane():\n    subprocess.run(["tmux", "capture-pane", "-p"])\n`;
  const result = classifyTerminalBenchTask({
    dockerComposeText: BENIGN_COMPOSE,
    dockerfileText: BENIGN_DOCKERFILE,
    testScriptsText: tests,
  });
  assertEquals(result, { supported: false, reason: "requires-interactive-terminal" });
});

Deno.test("[Classifier] a test script using pexpect is unsupported (requires-interactive-terminal)", () => {
  const tests = `import pexpect\n\ndef test_prompt():\n    child = pexpect.spawn("bash")\n`;
  const result = classifyTerminalBenchTask({
    dockerComposeText: BENIGN_COMPOSE,
    dockerfileText: BENIGN_DOCKERFILE,
    testScriptsText: tests,
  });
  assertEquals(result, { supported: false, reason: "requires-interactive-terminal" });
});

Deno.test("[Classifier] a docker-compose.yaml with zero services is unsupported (ambiguous-environment), conservative default", () => {
  const result = classifyTerminalBenchTask({
    dockerComposeText: `services: {}\n`,
    dockerfileText: BENIGN_DOCKERFILE,
    testScriptsText: BENIGN_TESTS,
  });
  assertEquals(result, { supported: false, reason: "ambiguous-environment" });
});

Deno.test("[Classifier] unparseable docker-compose.yaml is unsupported (ambiguous-environment), conservative default", () => {
  const result = classifyTerminalBenchTask({
    dockerComposeText: `not: [valid, yaml, : broken`,
    dockerfileText: BENIGN_DOCKERFILE,
    testScriptsText: BENIGN_TESTS,
  });
  assertEquals(result, { supported: false, reason: "ambiguous-environment" });
});
