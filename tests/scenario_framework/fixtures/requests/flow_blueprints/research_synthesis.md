---
trace_id: "research_synthesis-{{timestamp}}"
created: "{{timestamp}}"
status: "pending"
priority: "normal"
source: "cli"
created_by: "scenario-framework"
flow: "research-synthesis"
---

# Synthesise approaches to evaluating multi-agent orchestration

Research how comparable systems evaluate whether multi-agent orchestration beats a single agent, and synthesise what applies here. Cover:

- The comparison designs used, and what each controls for
- How cost is reported alongside quality, if at all
- Which findings depend on a specific model and which generalise
- What could be adopted in `tests/scenario_framework/` without new infrastructure

Acceptance criteria:

- Each source is summarised by its method, not its conclusion
- Every claim adopted is marked as model-specific or general
- Recommendations state what existing infrastructure they would use
