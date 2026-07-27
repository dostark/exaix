---
trace_id: "migration_planning-{{timestamp}}"
created: "{{timestamp}}"
status: "pending"
priority: "normal"
source: "cli"
created_by: "scenario-framework"
flow: "migration-planning"
---

# Plan the migration of plan storage from files to SQLite

Plan moving plan persistence from `Workspace/Active` markdown files to the SQLite journal, keeping the filesystem as an export. Establish:

- What reads plan files today, and which readers must change
- The migration path for plans in flight when the change lands
- How rollback works if the new path proves wrong
- What stays on the filesystem and why

Acceptance criteria:

- Every current reader is enumerated with its file
- In-flight plans have a stated migration path, not a cutover gap
- Rollback is described as a procedure, not an intention
