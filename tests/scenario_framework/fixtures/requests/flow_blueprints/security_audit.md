---
trace_id: "security_audit-{{timestamp}}"
created: "{{timestamp}}"
status: "pending"
priority: "normal"
source: "cli"
created_by: "scenario-framework"
flow: "security-audit"
---

# Audit the portal path boundary for traversal and escape

Audit how portal paths are resolved and enforced across `packages/tool-runtime/` and the MCP tool handlers. Identify:

- Every place a caller-supplied path reaches the filesystem
- Which paths pass through `PathResolver` and which bypass it
- Whether a symlink inside a portal can escape its boundary
- What an agent sees when a path is refused

Acceptance criteria:

- Every filesystem entry point is listed with its file and line
- Each bypass is classified as a defect or an accepted risk with reasoning
- Symlink behaviour is determined by test, not by reading
