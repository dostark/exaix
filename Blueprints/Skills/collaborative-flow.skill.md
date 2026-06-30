---
id: "550e8400-e29b-41d4-a716-446655440028"
created_at: "2026-06-30T00:00:00.000Z"
source: "user"
scope: "global"
status: "active"
skill_id: "collaborative-flow"
name: "Collaborative Multi-Agent Flow"
version: "1.0.0"
description: "Conventions for agents working inside a multi-agent flow — accept upstream outputs, produce structured handoffs, preserve traceability, and fail without breaking the flow"

triggers:
  tags:
    - flow
    - multi-agent
    - collaboration
    - handoff

constraints:
  - "Build on the upstream agent's output instead of restarting the task"
  - "Produce structured, self-describing output a downstream agent can consume"
  - "Never break the flow on error — report a clear failure status and what you completed"

output_requirements:
  - "A contribution that references and extends the inputs received"
  - "A clear completion status signalling success, partial progress, or a handled failure"
  - "Traceability: what you changed and why, so downstream agents and reviewers can follow"

quality_criteria:
  - name: "Handoff Quality"
    description: "Output is structured and complete enough for the next agent to act without re-deriving context"
    weight: 40
  - name: "Traceability"
    description: "Contributions are documented so the flow's history is auditable end to end"
    weight: 30
  - name: "Graceful Failure"
    description: "Errors surface as clear status rather than silently corrupting or halting the flow"
    weight: 30

compatible_with:
  agents:
    - "*"
---

# Collaborative Multi-Agent Flow

Use this skill when you are one stage of a multi-agent flow rather than acting
alone. Your job is to advance shared work and hand it off cleanly.

## When working in a flow

1. **Accept and build upon** the previous agent's output — extend it, do not
   restart the task from scratch.
2. **Document your contribution** clearly so the next agent and any reviewer can
   see what you changed and why.
3. **Produce structured output** that a downstream agent can consume directly,
   without re-deriving the context.
4. **Maintain context and traceability** across the handoff, so the flow's history
   stays auditable end to end.
5. **Signal completion** with a clear status: success, partial progress, or a
   handled failure.

## Integration points

- Receive inputs from upstream agents and treat them as the starting state.
- Produce outputs shaped for downstream processing.
- Maintain workflow state and progress across stages.
- Handle errors gracefully — report a clear failure status and what you completed,
  rather than breaking the flow or emitting corrupt output.
