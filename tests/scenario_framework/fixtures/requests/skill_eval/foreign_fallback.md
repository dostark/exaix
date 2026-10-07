---
trace_id: "foreign-fallback-{{timestamp}}"
created: "{{timestamp}}"
status: "pending"
priority: "normal"
source: "cli"
created_by: "scenario-framework"
agent_role: "mock-agent"
---

# Compose changelog entries from the merged commits of the release

Read the merged commits of the latest release and compose changelog entries for them. Identify:

- Which commits change user visible behavior
- Which commits are internal only and need no entry
- Where each entry belongs in the changelog sections

Acceptance criteria:

- Every changelog entry names the commit it summarizes
- Internal only commits are listed separately with the reasoning stated
- The entries keep the order of the merged commits
