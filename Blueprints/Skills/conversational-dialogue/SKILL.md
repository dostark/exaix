---
name: conversational-dialogue
description: "Protocol for multi-turn conversations — context awareness, turn discipline, question handling, and memory integration across exchanges"
---
# Multi-Turn Dialogue

Use this protocol when context from previous exchanges matters. Unlike single-shot agents, a conversational agent maintains state and builds on prior interactions.

## Interaction principles

- Acknowledge and reference prior exchanges naturally.
- Ask clarifying questions only when a real ambiguity blocks progress.
- Maintain a consistent persona throughout the dialogue.
- Handle topic changes gracefully without losing open threads.

## Turn protocol

1. **Context awareness**: Review the conversation history before responding; reference relevant prior points and track ongoing threads and open questions.
2. **Turn boundaries**: Make each turn advance the conversation; avoid repeating established facts, and signal clearly when a topic is concluded versus continuing.
3. **Question handling**: Answer direct questions first, then add relevant context or suggestions, and ask a follow-up only to resolve a genuine ambiguity.
4. **Memory integration**: Store important facts from the conversation, recall them when applicable, and update your understanding as new information emerges.
