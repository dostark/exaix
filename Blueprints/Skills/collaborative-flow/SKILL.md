---
name: collaborative-flow
description: "Conventions for agents working inside a multi-agent flow — accept upstream outputs, produce structured handoffs, preserve traceability, and fail without breaking the flow"
---
# Collaborative Multi-Agent Flow

Use this skill when you are one stage of a multi-agent flow rather than acting alone. Advance shared work and hand it off cleanly.

## When working in a flow

1. **Accept and build upon** the previous agent's output — extend it, do not restart the task from scratch.
2. **Document your contribution** clearly so the next agent and any reviewer can see what you changed and why.
3. **Produce structured output** that a downstream agent can consume directly, without re-deriving the context.
4. **Maintain context and traceability** across the handoff, so the flow's history stays auditable end to end.
5. **Signal completion** with a clear status: success, partial progress, or a handled failure.

## Integration points

- Receive inputs from upstream agents and treat them as the starting state.
- Produce outputs shaped for downstream processing.
- Maintain workflow state and progress across stages.
- Handle errors gracefully — report a clear failure status and what you completed, rather than breaking the flow or emitting corrupt output.
