---
id: "550e8400-e29b-41d4-a716-446655440013"
created_at: "2026-07-23T00:00:00.000Z"
source: "user"
scope: "global"
status: "active"
skill_id: "response-contract-xml"
name: "Response Output Contract (XML/Markdown)"
version: "1.0.0"
description: "The mandatory <thought>/<content> response format and XML+Markdown contract for providers without native JSON enforcement (opencode CLI)."
critical: true

triggers:
  tags:
    - response-contract
    - output-format
    - xml-format

constraints:
  - "Respond with exactly a <thought> block and a <content> block; ignore everything outside them"
  - "<content> must contain ONLY the structured XML plan — no commentary, explanations, or markdown before or after"
  - "Do not write 'I've added', 'Here are', 'Based on', or any other preamble before or after the XML block"
  - "The first character after <content> MUST be < — anything else will be rejected"
  - "For a plan, use <plan> as root element with <step number=\"N\"> entries, <tool>, and <params>"
  - "You are in the PLANNING phase — do not try to edit files. Output a structured plan only."

output_requirements:
  - "A <thought> block with reasoning and tool-selection logic"
  - "A <content> block containing a structured XML document for the requested deliverable"

quality_criteria:
  - name: "Contract Compliance"
    description: "Output has both tags and a valid XML content block"
    weight: 60
  - name: "Self-Containment"
    description: "The content XML parses standalone with no extra prose"
    weight: 40

compatible_with:
  agents:
    - "*"

usage_count: 0
---

# Response Output Contract (XML/Markdown variant for opencode CLI)

You MUST respond with exactly two sections, each wrapped in XML-like tags. Any
text outside these tags is ignored.

1. `<thought>` — Your internal analysis: reasoning, plan breakdown, architectural
   decisions, and tool-selection logic. Not parsed as structured data.

2. `<content>` — Your deliverable. For a plan this MUST be a structured XML
   document using these elements:

   - `<plan>` — Root element containing the entire plan
   - `<title>` — Plan name (optional, 1-80 chars)
   - `<description>` — What this plan accomplishes (required)
   - `<step number="N">` — Each execution step
   - `<tool>` — Tool name for the action
   - `<params>` — Tool parameters as child elements
   - `<successCriteria>` — Verification items as `<item>` children
   - `<estimatedDuration>` — Optional time estimate

   The `<content>` block is extracted and parsed by the runtime, so it must be
   valid, self-contained XML free of commentary.

   **Never wrap the XML in a markdown code fence.** The runtime takes the exact
   text between `<content>` and `</content>` and passes it directly to an XML
   parser — a leading `` ```xml `` line causes parsing to fail.

## Planning Phase — Read-Only Tools

You are in the PLANNING phase. Your task is to create a structured plan, not
code. You have read-only tools (read_file, grep_search, glob) to explore the
codebase. Do NOT try to edit files — the execution phase will apply the changes
later.

## Plan XML structure

```xml
<plan>
  <title>Short descriptive title (optional)</title>
  <description>What this plan accomplishes (required)</description>
  <step number="1">
    <title>Step name (required)</title>
    <description>What this step performs (optional, defaults to title)</description>
    <tool>read_file</tool>
    <params>
      <path>src/file.ts</path>
    </params>
    <successCriteria>
      <item>A verifiable check</item>
    </successCriteria>
  </step>
</plan>
```

## Agent Thought Standardization

The `<thought>` block must follow this structured format:

```xml
<thought>
## Problem Analysis
[Brief summary of the user's request and core problem to solve]

## Solution Approach
[High-level strategy and methodology to address the problem]

## Key Considerations
[Important factors: technical constraints, edge cases, dependencies]

## Implementation Strategy
[Step-by-step reasoning for how to execute the solution]
</thought>
```

## Minimal example

```xml
<thought>
The request asks to add input validation. I will plan the changes needed.
</thought>

<content>
<plan>
  <title>Add input validation</title>
  <description>Validate the request body with a schema at the entry point.</description>
  <step number="1">
    <title>Add boundary validation</title>
    <description>Parse and reject malformed input before business logic.</description>
    <tool>read_file</tool>
    <params>
      <path>src/handler.ts</path>
    </params>
    <successCriteria>
      <item>Invalid input is rejected</item>
    </successCriteria>
  </step>
</plan>
</content>
```
