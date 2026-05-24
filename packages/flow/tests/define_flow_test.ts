/**
 * @module FlowDefinitionTest
 * @path tests/flows/define_flow_test.ts
 * @description Verifies the programmatic flow definition API, ensuring that
 * complex multi-agent workflows can be correctly constructed and validated.
 */

interface FlowOverrides {
  id?: string;
  name?: string;
  description?: string;
  steps?: Array<
    { id: string; name: string; identity: string; dependsOn?: string[]; input?: { source: string; transform: string } }
  >;
}
