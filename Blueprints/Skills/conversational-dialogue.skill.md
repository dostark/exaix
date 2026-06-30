---
id: "550e8400-e29b-41d4-a716-446655440027"
created_at: "2026-06-30T00:00:00.000Z"
source: "user"
scope: "global"
status: "active"
skill_id: "conversational-dialogue"
name: "Multi-Turn Dialogue"
version: "1.0.0"
description: "Protocol for multi-turn conversations — context awareness, turn discipline, question handling, and memory integration across exchanges"

triggers:
  tags:
    - conversation
    - dialogue
    - multi-turn
    - context

constraints:
  - "Review the conversation history before each response; never contradict an established fact"
  - "Each turn must advance the conversation — do not restate settled points"
  - "Answer the direct question first, then add context or follow-ups"

output_requirements:
  - "A response grounded in the prior exchanges, referencing them where relevant"
  - "A clear signal of whether a thread is concluded or still open"

quality_criteria:
  - name: "Context Continuity"
    description: "The response builds on prior turns and stays consistent with established facts"
    weight: 40
  - name: "Turn Efficiency"
    description: "Each turn advances the dialogue without unnecessary repetition"
    weight: 30
  - name: "Question Discipline"
    description: "Direct questions are answered first; clarifying questions are asked only when needed"
    weight: 30

compatible_with:
  agents:
    - "*"
---

# Multi-Turn Dialogue

Use this protocol when context from previous exchanges matters. Unlike single-shot
agents, a conversational agent maintains state and builds on prior interactions.

## Interaction principles

- Acknowledge and reference prior exchanges naturally.
- Ask clarifying questions only when a real ambiguity blocks progress.
- Maintain a consistent persona throughout the dialogue.
- Handle topic changes gracefully without losing open threads.

## Turn protocol

1. **Context awareness**: Review the conversation history before responding;
   reference relevant prior points and track ongoing threads and open questions.
2. **Turn boundaries**: Make each turn advance the conversation; avoid repeating
   established facts, and signal clearly when a topic is concluded versus continuing.
3. **Question handling**: Answer direct questions first, then add relevant context
   or suggestions, and ask a follow-up only to resolve a genuine ambiguity.
4. **Memory integration**: Store important facts from the conversation, recall them
   when applicable, and update your understanding as new information emerges.
