# Step Durability Resume

Analyse a codebase module and produce a structured summary. The flow has
three steps: a context-gathering step (tool), an analytical step (LLM,
replay-safe), and a synthesis step (LLM). If the synthesis step fails
transiently and the flow is resumed from checkpoint, the analytical step
must be skipped via result reuse rather than re-executed.

Provider: stub (in-memory IStepDurabilityStore, no live AI calls)
