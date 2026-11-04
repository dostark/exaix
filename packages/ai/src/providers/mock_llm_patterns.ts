/**
 * @module MockLLMPatterns
 * @path packages/ai/src/providers/mock_llm_patterns.ts
 * @description The prompt dialect classifiers and the default pattern table of the mock provider's pattern strategy.
 * @architectural-layer AI
 * @related-files [packages/ai/src/providers/mock_llm_provider.ts, packages/ai/src/providers/capture_recording_provider.ts]
 */

import type { IPatternMatcher } from "./mock_llm_provider.ts";

/** Markers that a plan-execution turn announces itself with. Merged flow context has none. */
const PLAN_EXECUTION_MARKERS = /executing a plan|Performing step|Action required:|Execution Context|Current Step:/i;

/** True for a flow step prompt. The step header alone is not enough, because execution prompts embed it too. */
export function isFlowStepPrompt(prompt: string): boolean {
  return !PLAN_EXECUTION_MARKERS.test(prompt) && /^##\s+Step \d+/m.test(prompt);
}

/** True for the ReAct prompt that PromptBuilder writes, which the ReAct parser pairs with. */
export function isReActLoopPrompt(prompt: string): boolean {
  return prompt.includes("AGENT ROLE: ") && prompt.includes("AVAILABLE TOOLS:");
}

/** The response that the prompt's own parser can read, or null for the legacy envelope. */
export function responseForPromptDialect(prompt: string): string | null {
  if (isFlowStepPrompt(prompt)) return FLOW_STEP_RESPONSE;
  if (isReActLoopPrompt(prompt)) return REACT_COMPLETE_RESPONSE;
  return null;
}

/** A ReAct reply with explicit certainty, because the confidence check halts a plan on hedged wording. */
const REACT_COMPLETE_RESPONSE =
  `THOUGHT: Completed the step successfully with high confidence. The implementation is correct and verified.
STATUS: COMPLETE
SUMMARY: Completed the step successfully with high confidence. The implementation is correct and verified.`;

const FLOW_STEP_RESPONSE = `<thought>
I will address this step and produce output the next step can consume.
</thought>

<content>
{
  "subject": "Flow Step Output",
  "description": "Structured output for this flow step, suitable as input to the next step.",
  "steps": [
    {
      "step": 1,
      "title": "Address the step's objective",
      "description": "Work through what this step was asked to produce, using the prior step's output as context."
    },
    {
      "step": 2,
      "title": "Hand off",
      "description": "Summarise the result so the next step in the flow can build on it."
    }
  ]
}
</content>`;

/** Specialist patterns, which hit first. */
function specialistPatterns(): IPatternMatcher[] {
  return [
    {
      pattern: /Plan Amendment specialist/i,
      response: `{
  "summary": "Adjust remaining steps due to detected environmental drift.",
  "affectedRemainingStepIds": ["1", "2"],
  "adds": [
    { "number": 3, "title": "Verification", "content": "Verify the fix." }
  ],
  "updates": [
    { "number": 1, "title": "Analyze Requirements", "content": "Review the request and identify key requirements (amended)." },
    { "number": 2, "title": "Corrected Refactor", "content": "Perform the refactor with corrected paths." }
  ],
  "removes": []
}`,
    },
    {
      // A resumed amendment step carries only its own rewritten content, so these markers match it.
      pattern: /SIMULATE_DRIFT_TRIGGER|\(amended\)|Corrected Refactor|Verify the fix/i,
      response: (_match, prompt) => {
        // 1. Intent Analysis Phase
        if (prompt.includes("request intent analyzer") || prompt.includes("intent analysis")) {
          return `<thought>
I see the drift instructions in the analysis phase.
</thought>

<content>
{
  "goals": [
    {
      "description": "Implementation with SIMULATE_DRIFT_TRIGGER",
      "explicit": true,
      "priority": 1
    }
  ],
  "requirements": [],
  "constraints": [],
  "acceptanceCriteria": [],
  "ambiguities": [],
  "actionabilityScore": 100,
  "complexity": "medium",
  "taskType": "refactor",
  "tags": ["drift"],
  "referencedFiles": ["src/main.ts"]
}
</content>`;
        }

        // 2. Execution Phase — AgentComposer defaults provider-backed plan steps to ReActLoopStrategy.
        const isReActPrompt = prompt.includes("AGENT ROLE: ") && prompt.includes("AVAILABLE TOOLS:");
        if (prompt.includes("## Execution Context (SYSTEM CONTROLLED)") || isReActPrompt) {
          // Each step prompt carries only its own content, so a later title never reaches an earlier amended prompt.
          // The (amended) marker lets a resumed step see its update.
          const isAmendedStep = prompt.includes("Corrected Refactor") || prompt.includes("Verify the fix") ||
            prompt.includes("(amended)");

          if (isReActPrompt) {
            return isAmendedStep
              ? `THOUGHT: Executed the amended step with absolute certainty and high confidence. Everything is perfectly fine.
STATUS: COMPLETE
SUMMARY: Executed the amended step with absolute certainty and high confidence. Everything is perfectly fine.`
              : `THOUGHT: I see some drift in the environment. I am not sure perhaps uncertain maybe. SIMULATE_DRIFT_TRIGGER
STATUS: COMPLETE
SUMMARY: I encountered some drift. I am not sure perhaps uncertain maybe. SIMULATE_DRIFT_TRIGGER`;
          }

          if (isAmendedStep) {
            return `<thought>
Executing the amended step successfully.
</thought>

<content>
{
  "branch": "feat/drift-fix",
  "commit_sha": "0000000000000000000000000000000000000000",
  "description": "Executed the amended step with absolute certainty and high confidence. Everything is perfectly fine.",
  "status": "completed",
  "files_changed": ["src/main.ts"],
  "tool_calls": 1,
  "execution_time_ms": 100
}
</content>`;
          }

          return `<thought>
I see some drift in the environment. I am not sure perhaps uncertain maybe. SIMULATE_DRIFT_TRIGGER
</thought>

<content>
{
  "branch": "feat/drift-fix",
  "commit_sha": "0000000000000000000000000000000000000000",
  "description": "I encountered some drift. I am not sure perhaps uncertain maybe. SIMULATE_DRIFT_TRIGGER",
  "status": "completed",
  "files_changed": [],
  "tool_calls": 0,
  "execution_time_ms": 100
}
</content>`;
        }

        // 3. Planning Phase (Fallback)
        return `<thought>
I see the drift instructions in the planning phase. I will pass them to the execution phase.
</thought>

<content>
{
  "subject": "Implementation Plan",
  "description": "Based on the request, I will implement the required functionality with a structured approach. SIMULATE_DRIFT_TRIGGER",
  "steps": [
    {
      "step": 1,
      "title": "Analyze Requirements",
      "description": "Review the request and identify key requirements. SIMULATE_DRIFT_TRIGGER"
    },
    {
      "step": 2,
      "title": "Implement Code",
      "description": "Write the necessary code changes. SIMULATE_DRIFT_TRIGGER",
      "tools": ["write_file"]
    }
  ],
  "estimatedDuration": "2-4 hours",
  "risks": []
}
</content>`;
      },
    },
  ];
}

/** Plan generation requests. */
function generationPatterns(): IPatternMatcher[] {
  return [
    {
      pattern: /intent analyzer/i,
      response: `<thought>
I will analyze the request and provide a detailed architectural assessment.
</thought>

<content>
{
  "goals": [
    {
      "description": "Analyze the core architecture of the Exaix Scenario Framework",
      "explicit": true,
      "priority": 1
    }
  ],
  "requirements": [],
  "constraints": [],
  "acceptanceCriteria": [],
  "ambiguities": [],
  "actionabilityScore": 100,
  "complexity": "medium",
  "taskType": "analysis",
  "tags": ["smoke", "framework"],
  "referencedFiles": [],
  "metadata": {
    "analyzedAt": "2026-03-20T18:00:00Z",
    "durationMs": 100,
    "mode": "llm",
    "analyzerVersion": "1.0.0"
  }
}
</content>`,
    },
  ];
}

/** Execution triggers. They must come before the planning patterns, so that "Step N" prompts are caught before generic "implement" patterns. */
function executionPatterns(): IPatternMatcher[] {
  return [
    {
      // ReAct prompts (`AGENT ROLE: ... CAPABILITIES: ... AVAILABLE TOOLS: ...`) carry none of the execution markers below.
      // Without this check they fell through to a plan-shaped pattern that returns neither a toml action nor STATUS: COMPLETE.
      // The loop then reports no actions, and PlanExecutor turns that into a tool_error amendment that halts the plan.
      pattern: /^AVAILABLE TOOLS:/m,
      response: REACT_COMPLETE_RESPONSE,
    },
    {
      pattern: /executing a plan|Performing step|Action required:|Step \d+|Execution Context/i,
      response: (_match, prompt) => {
        const dialect = responseForPromptDialect(prompt);
        if (dialect) return dialect;

        // Check what kind of action is being requested
        const needsFileWrite = /write|create|add|implement|modify|update/i.test(prompt);
        const needsFileRead = /read|analyze|review|check/i.test(prompt);
        if (needsFileWrite) {
          return `<thought>
I will implement this step by creating or modifying the necessary files.
</thought>

<actions>
[
  {
    "tool": "write_file",
    "params": {
      "path": "src/utils.ts",
      "content": "// Mock implementation\\nexport function helloWorld(): string {\\n  return 'Hello, World!';\\n}\\n"
    }
  }
]
</actions>`;
        } else if (needsFileRead) {
          return `<thought>
I will read the relevant files to understand the current implementation.
</thought>

<actions>
[
  {
    "tool": "read_file",
    "params": {
      "path": "src/index.ts"
    }
  }
]
</actions>`;
        } else {
          // Generic execution response
          return `<thought>
I will execute this step according to the plan.
</thought>

<actions>
[
  {
    "tool": "write_file",
    "params": {
      "path": "src/output.txt",
      "content": "Step completed successfully"
    }
  }
]
</actions>`;
        }
      },
    },
  ];
}

/** Planning patterns. */
function planningPatterns(): IPatternMatcher[] {
  return [
    {
      pattern: /implement|add|create/i,
      response: (_match, prompt) => {
        const includeDrift = /SIMULATE_DRIFT_TRIGGER/i.test(prompt);
        const step1Content = includeDrift
          ? "Review the request and identify key requirements. SIMULATE_DRIFT_TRIGGER"
          : "Review the request and identify key requirements for the implementation.";

        return `<thought>
I need to analyze the request and create a plan for implementation.
</thought>

<content>
{
  "subject": "Implementation Plan",
  "description": "Based on the request, I will implement the required functionality with a structured approach.",
  "steps": [
    {
      "step": 1,
      "title": "Analyze Requirements",
      "description": "${step1Content}"
    },
    {
      "step": 2,
      "title": "Design Solution",
      "description": "Create a technical design for the implementation, considering architecture and patterns."
    },
    {
      "step": 3,
      "title": "Implement Code",
      "description": "Write the necessary code changes to implement the feature.",
      "tools": ["write_file"]
    },
    {
      "step": 4,
      "title": "Write Tests",
      "description": "Add unit tests to verify the implementation works correctly.",
      "tools": ["write_file"],
      "dependencies": [3]
    },
    {
      "step": 5,
      "title": "Review",
      "description": "Self-review the changes for quality and ensure all requirements are met."
    }
  ],
  "estimatedDuration": "2-4 hours"
}
</content>`;
      },
    },
    {
      pattern: /fix|bug|error|issue/i,
      response: `<thought>
I need to investigate and fix the reported issue.
</thought>

<content>
{
  "subject": "Bug Fix Plan",
  "description": "I will investigate and fix the reported issue systematically.",
  "steps": [
    {
      "step": 1,
      "title": "Reproduce Issue",
      "description": "Verify the bug exists and understand the exact conditions that trigger it."
    },
    {
      "step": 2,
      "title": "Root Cause Analysis",
      "description": "Identify why the bug occurs by analyzing the relevant code paths.",
      "tools": ["read_file"]
    },
    {
      "step": 3,
      "title": "Implement Fix",
      "description": "Apply the necessary correction to resolve the issue.",
      "tools": ["write_file"],
      "dependencies": [2]
    },
    {
      "step": 4,
      "title": "Test Fix",
      "description": "Verify the bug is resolved and the fix works as expected.",
      "tools": ["write_file"],
      "dependencies": [3]
    },
    {
      "step": 5,
      "title": "Regression Test",
      "description": "Ensure no new issues are introduced by the fix.",
      "dependencies": [4]
    }
  ],
  "estimatedDuration": "1-2 hours",
  "risks": ["Fix may have unintended side effects on related functionality"]
}
</content>`,
    },
  ];
}

/** The pattern that matches any other prompt. */
function fallbackPatterns(): IPatternMatcher[] {
  return [
    {
      pattern: /.*/,
      response: `<thought>
I will create a plan to address this request.
</thought>

<content>
{
  "subject": "Execution Plan",
  "description": "I will address the user's request with a structured approach.",
  "steps": [
    {
      "step": 1,
      "title": "Analyze",
      "description": "Review the request details and understand what needs to be done."
    },
    {
      "step": 2,
      "title": "Plan",
      "description": "Design the approach and identify files that need to be modified."
    },
    {
      "step": 3,
      "title": "Implement",
      "description": "Execute the changes according to the plan.",
      "tools": ["write_file"]
    },
    {
      "step": 4,
      "title": "Test",
      "description": "Verify the solution works correctly.",
      "dependencies": [3]
    }
  ]
}
</content>`,
    },
  ];
}

export function defaultMockPatterns(): IPatternMatcher[] {
  return [
    ...specialistPatterns(),
    ...generationPatterns(),
    ...executionPatterns(),
    ...planningPatterns(),
    ...fallbackPatterns(),
  ];
}
