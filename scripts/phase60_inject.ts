/**
 * @module phase60_inject
 * @path scripts/phase60_inject.ts
 * @description Injects frontmatter + copilot footer into root documentation files
 * as part of Phase 60 "Documentation Nervous System".
 */

import { join } from "https://deno.land/std@0.224.0/path/mod.ts";

const ROOT_FILES = [
  "README.md",
  "ARCHITECTURE.md",
  "CODE_STYLE.md",
  "CLAUDE.md",
  "CONTRIBUTING.md",
  "TOOLS.md",
];

const FOOTER = `
---
**Footer — Agent Knowledge Base**
- **Copilot Rules**: [.copilot/rules.md](./.copilot/rules.md)
- **Blueprints**: [.copilot/blueprints/](./.copilot/blueprints/)
- **Planning**: [.copilot/planning/](./.copilot/planning/)
- **Manifest**: [.copilot/manifest.json](./.copilot/manifest.json)
`;

const FRONTMATTER: Record<string, string> = {
  "ARCHITECTURE.md": `---
title: ARCHITECTURE.md
description: Complete Exaix execution model and component map
agent_priority: critical
copilot_knowledge_base: true
version: 2.1
capabilities: [architecture_overview, execution_flow, memory_bank, portal_ops]
links:
  - "src/services/request/request_processor.ts:RequestProcessor"
  - "src/services/agent/agent_runner.ts:AgentRunner"
  - "src/memory/memory_bank.ts:@region Store"
  - "tests/services/request/request_processor_test.ts"
tools_referenced:
  - write_file: src/mcp/handlers/write_file_tool.ts
  - git_commit: src/mcp/handlers/git_tool.ts
copilot_instructions: .copilot/blueprints/senior-coder.md
---
`,
  "CODE_STYLE.md": `---
title: CODE_STYLE.md
description: Coding standards and stylistic requirements for Exaix
agent_priority: mandatory
copilot_knowledge_base: true
version: 1.1
capabilities: [linting_rules, naming_conventions, testing_patterns]
links:
  - "src/shared/constants.ts"
  - "scripts/check_code_style.ts"
copilot_instructions: .copilot/blueprints/senior-coder.md
---
`,
  "CLAUDE.md": `---
title: CLAUDE.md
description: Agent coordination and task-specific guidance index
agent_priority: critical
copilot_knowledge_base: true
version: 1.1
capabilities: [task_routing, cross_reference, process_validation]
links:
  - ".copilot/manifest.json"
  - ".copilot/cross-reference.md"
copilot_instructions: .copilot/blueprints/senior-coder.md
---
`,
  "CONTRIBUTING.md": `---
title: CONTRIBUTING.md
description: Development workflow and contribution guidelines
agent_priority: medium
copilot_knowledge_base: true
version: 1.1
capabilities: [pr_workflow, workspace_deployment, regression_testing]
links:
  - "scripts/deploy_workspace.sh"
  - "scripts/ci.ts"
copilot_instructions: .copilot/blueprints/senior-coder.md
---
`,
  "README.md": `---
title: README.md
description: Exaix Orchestration Platform - Overview and Quickstart
agent_priority: critical
copilot_knowledge_base: true
version: 2.1
capabilities: [system_overview, installation, initial_setup]
links:
  - "ARCHITECTURE.md"
  - "docs/dev/Exaix_Developer_Setup.md"
copilot_instructions: .copilot/blueprints/senior-coder.md
---
`,
  "TOOLS.md": `---
title: TOOLS.md
description: Developer tools and runtime capability map
agent_priority: high
copilot_knowledge_base: true
version: 1.1
capabilities: [tool_selection, setup_verification, capability_map]
links:
  - "docs/dev/Exaix_Tools.md"
  - "scripts/sync_tool_schemas.ts"
copilot_instructions: .copilot/blueprints/senior-coder.md
---
`,
};

async function main() {
  const cwd = Deno.cwd();
  console.log(`Injecting Phase 60 infrastructure into root MD files in ${cwd}...`);

  for (const file of ROOT_FILES) {
    const path = join(cwd, file);
    try {
      let content = await Deno.readTextFile(path);
      const frontmatter = FRONTMATTER[file];

      if (!frontmatter) {
        console.warn(`No frontmatter defined for ${file}, skipping.`);
        continue;
      }

      // Check if we already injected it (basic check)
      if (content.includes("copilot_knowledge_base: true")) {
        console.log(`Skipping ${file}: Already has frontmatter.`);
      } else {
        // Prepend Frontmatter
        content = frontmatter + "\n" + content;
      }

      // Append Footer if not present
      if (!content.includes("**Footer — Agent Knowledge Base**")) {
        content = content.trimEnd() + "\n" + FOOTER + "\n";
      }

      await Deno.writeTextFile(path, content);
      console.log(`Successfully updated ${file}.`);
    } catch (err) {
      const error = err as Error;
      console.error(`Error processing ${file}: ${error.message}`);
    }
  }

  console.log("\nInjection complete.");
}

if (import.meta.main) {
  main();
}
